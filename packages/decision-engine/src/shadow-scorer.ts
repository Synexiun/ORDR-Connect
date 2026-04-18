/**
 * @ordr/decision-engine — Shadow Model Scorer (A/B harness)
 *
 * Runs one or more shadow scorers alongside the primary and records the
 * divergence between primary and shadow predictions to an event sink.
 * Shadow output NEVER affects the Decision pipeline — the primary result
 * is what `score()` returns. Shadow failures are isolated per-shadow and
 * never propagate.
 *
 * Intent: enables safe rollout of future trained ML models. A candidate
 * model can run in production against real traffic, its predictions
 * compared against the current production model, divergence tracked over
 * time, and only promoted to primary once the team is satisfied with its
 * stability and accuracy relative to the incumbent.
 *
 * Usage pattern:
 *   const primary  = createDefaultMLScorer(prodBundle.models);
 *   const candidate = createDefaultMLScorer(candidateBundle.models);
 *
 *   const scorer = new ShadowScorer({
 *     primary,
 *     shadows: [{ name: 'candidate-v0.4.0', scorer: candidate }],
 *     sink: siemShadowSink,
 *   });
 *
 *   const result = await scorer.score(context, 'churn_risk');  // primary-only output
 *
 * Rule 9 compliance (Agent Safety / AI Governance):
 *   - Shadows are pure observability — they do not and cannot influence
 *     agent actions.
 *   - Every comparison event carries both model versions so audit replay
 *     can reconstruct exactly which pair was compared.
 *   - Per-shadow errors are caught and converted to an event (not rethrown)
 *     so one misbehaving shadow cannot degrade the primary decision path.
 */

import { type Result } from '@ordr/core';
import type { MLScorer, MLScorerLike } from './ml-scorer.js';
import type { DecisionContext, MLPrediction } from './types.js';

// ─── Types ───────────────────────────────────────────────────────

export interface ShadowComparisonEvent {
  /** UTC milliseconds when the comparison completed. */
  readonly ts: number;
  /** Tenant for correlation with audit logs; undefined if context extraction not configured. */
  readonly tenantId: string | undefined;
  /** Customer being scored, if extractable. */
  readonly customerId: string | undefined;
  /** Name of the ML model scored on both primary and shadow. */
  readonly modelName: string;
  /** Logical name of the shadow (e.g., 'candidate-v0.4.0'). */
  readonly shadowName: string;
  /** Primary model output. */
  readonly primaryScore: number;
  readonly primaryConfidence: number;
  /** Shadow model output. */
  readonly shadowScore: number;
  readonly shadowConfidence: number;
  /** |primaryScore − shadowScore|. */
  readonly divergence: number;
  /** Number of features the primary reported using. */
  readonly featureCount: number;
  /** Set when the shadow errored; primary/shadow-score fields are NaN in that case. */
  readonly shadowError: string | undefined;
}

export interface ShadowComparisonSink {
  record(event: ShadowComparisonEvent): Promise<void>;
}

export interface ShadowDefinition {
  readonly name: string;
  readonly scorer: MLScorer;
}

export interface ShadowScorerOptions {
  readonly primary: MLScorer;
  readonly shadows: readonly ShadowDefinition[];
  readonly sink?: ShadowComparisonSink;
  /**
   * Called when the comparison sink fails to persist an event. Intended
   * for wiring a Prometheus `shadow_audit_sink_errors_total` counter or
   * forwarding to an out-of-band alert path so the audit-chain gap
   * becomes observable (Rule 3: every comparison event MUST be
   * recorded — a silently-dropped sink write violates that guarantee).
   * If omitted, the error is still logged as structured JSON.
   */
  readonly onSinkError?: (event: ShadowComparisonEvent, error: Error) => void;
}

// ─── Scorer ──────────────────────────────────────────────────────

/**
 * A dual-path scorer: primary result drives decisions, shadow results feed
 * comparison telemetry only. API-compatible with MLScorer — wherever a
 * MLScorer is accepted for scoring, a ShadowScorer can be substituted.
 */
export class ShadowScorer implements MLScorerLike {
  private readonly primary: MLScorer;
  private readonly shadows: readonly ShadowDefinition[];
  private readonly sink: ShadowComparisonSink | undefined;
  private readonly onSinkError: ((event: ShadowComparisonEvent, error: Error) => void) | undefined;

  constructor(opts: ShadowScorerOptions) {
    this.primary = opts.primary;
    this.shadows = opts.shadows;
    this.sink = opts.sink;
    this.onSinkError = opts.onSinkError;
  }

  /**
   * Score through primary; fan-out to shadows; record divergences.
   *
   * Returns whatever the primary returns. Shadow results are observed by
   * side effect only — no primary decision can be altered by a shadow.
   */
  async score(context: DecisionContext, modelName: string): Promise<Result<MLPrediction>> {
    const primaryResult = await this.primary.score(context, modelName);
    if (!primaryResult.success) {
      return primaryResult;
    }
    if (this.shadows.length === 0) {
      return primaryResult;
    }
    await this.recordShadows(context, modelName, primaryResult.data);
    return primaryResult;
  }

  /**
   * Score through primary across all registered models; shadow every one
   * with each registered shadow scorer.
   */
  async scoreAll(context: DecisionContext): Promise<Result<readonly MLPrediction[]>> {
    const result = await this.primary.scoreAll(context);
    if (!result.success || this.shadows.length === 0) {
      return result;
    }
    for (const prediction of result.data) {
      await this.recordShadows(context, prediction.modelName, prediction);
    }
    return result;
  }

  hasModel(name: string): boolean {
    return this.primary.hasModel(name);
  }

  getModelNames(): readonly string[] {
    return this.primary.getModelNames();
  }

  // ── Internal ──────────────────────────────────────────────────

  private async recordShadows(
    context: DecisionContext,
    modelName: string,
    primary: MLPrediction,
  ): Promise<void> {
    const sink = this.sink;
    if (sink === undefined) {
      return;
    }

    await Promise.all(
      this.shadows.map((shadow) =>
        this.compareOne(context, modelName, primary, shadow).then(
          (event) =>
            sink.record(event).catch((err: unknown) => {
              this.reportSinkError(event, err);
            }),
          () => undefined,
        ),
      ),
    );
  }

  /**
   * Structured warn log + optional callback when a sink write fails. Never
   * throws — a failing sink must not propagate into the primary path. But
   * silent swallowing would hide audit-chain gaps, which violates Rule 3;
   * this is the minimum observability floor.
   */
  private reportSinkError(event: ShadowComparisonEvent, err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));

    console.warn(
      JSON.stringify({
        level: 'warn',
        component: 'decision-engine-shadow-scorer',
        event: 'shadow_sink_record_failed',
        shadowName: event.shadowName,
        modelName: event.modelName,
        tenantId: event.tenantId,
        error: error.message,
      }),
    );
    if (this.onSinkError !== undefined) {
      try {
        this.onSinkError(event, error);
      } catch {
        /* user-supplied callback must never propagate */
      }
    }
  }

  private async compareOne(
    context: DecisionContext,
    modelName: string,
    primary: MLPrediction,
    shadow: ShadowDefinition,
  ): Promise<ShadowComparisonEvent> {
    const ts = Date.now();
    const tenantId = context.tenantId;
    const customerId = context.customerId;

    if (!shadow.scorer.hasModel(modelName)) {
      return {
        ts,
        tenantId,
        customerId,
        modelName,
        shadowName: shadow.name,
        primaryScore: primary.score,
        primaryConfidence: primary.confidence,
        shadowScore: Number.NaN,
        shadowConfidence: Number.NaN,
        divergence: Number.NaN,
        featureCount: primary.featuresUsed.length,
        shadowError: `shadow "${shadow.name}" does not register model "${modelName}"`,
      };
    }

    try {
      const shadowResult = await shadow.scorer.score(context, modelName);
      if (!shadowResult.success) {
        return {
          ts,
          tenantId,
          customerId,
          modelName,
          shadowName: shadow.name,
          primaryScore: primary.score,
          primaryConfidence: primary.confidence,
          shadowScore: Number.NaN,
          shadowConfidence: Number.NaN,
          divergence: Number.NaN,
          featureCount: primary.featuresUsed.length,
          shadowError: shadowResult.error.message,
        };
      }
      const shadowPrediction = shadowResult.data;
      return {
        ts,
        tenantId,
        customerId,
        modelName,
        shadowName: shadow.name,
        primaryScore: primary.score,
        primaryConfidence: primary.confidence,
        shadowScore: shadowPrediction.score,
        shadowConfidence: shadowPrediction.confidence,
        divergence: Math.abs(primary.score - shadowPrediction.score),
        featureCount: primary.featuresUsed.length,
        shadowError: undefined,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        ts,
        tenantId,
        customerId,
        modelName,
        shadowName: shadow.name,
        primaryScore: primary.score,
        primaryConfidence: primary.confidence,
        shadowScore: Number.NaN,
        shadowConfidence: Number.NaN,
        divergence: Number.NaN,
        featureCount: primary.featuresUsed.length,
        shadowError: message,
      };
    }
  }
}

// ─── In-memory sink (for tests + dev) ────────────────────────────

/**
 * Non-persistent sink that collects events in memory. Useful for tests and
 * local development. Production should use a sink that forwards to the
 * audit chain and/or a metrics pipeline.
 */
export class InMemoryShadowSink implements ShadowComparisonSink {
  private readonly events: ShadowComparisonEvent[] = [];

  record(event: ShadowComparisonEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  all(): readonly ShadowComparisonEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}
