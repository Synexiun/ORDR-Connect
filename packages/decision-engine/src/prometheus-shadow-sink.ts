/**
 * @ordr/decision-engine — Prometheus sink for ShadowComparisonEvent
 *
 * Adapts the ShadowComparisonSink interface to a Prometheus metrics
 * registry. Intended as the production pairing for ShadowScorer.
 *
 * Paired metrics (registered in @ordr/observability):
 *   - shadow_comparisons_total    counter  {model_name, shadow_name, status}
 *   - shadow_divergence           histogram {model_name, shadow_name}
 *
 * Label cardinality notes (Rule 6 — no PHI in labels):
 *   - tenant_id deliberately OMITTED from both series. Shadow-model
 *     performance is a property of the model pair, not the tenant; the
 *     underlying ShadowComparisonEvent still carries tenantId for audit
 *     correlation via the SIEM/event path.
 *   - status is a bounded enum: 'divergence' | 'agreement' | 'error' | 'missing_model'
 *   - model_name and shadow_name are developer-authored identifiers, not
 *     free-form user input.
 *
 * Rule 9 (AI Governance): this sink enables the operational-monitoring
 * half of safe model rollout — audit events answer "what was compared",
 * metrics answer "how well is the candidate performing right now".
 */

import type { ShadowComparisonEvent, ShadowComparisonSink } from './shadow-scorer.js';

// Minimal metrics interface — mirrors the Pick<MetricsRegistry, ...> pattern
// used elsewhere (e.g. cobrowse route). Avoids a direct package dep on
// @ordr/observability while remaining structurally compatible.
export interface ShadowMetricsSink {
  incrementCounter(name: string, labels: Record<string, string>, value?: number): void;
  observeHistogram(name: string, labels: Record<string, string>, value: number): void;
}

// Agreement threshold: divergences below this round to 'agreement' in the
// status label. 0.05 on a 0..1 score surface is ~5 percentile points — too
// small to flip most downstream decisions and therefore not interesting as
// a divergence event.
const AGREEMENT_EPSILON = 0.05;

export interface PrometheusShadowSinkOptions {
  readonly metrics: ShadowMetricsSink;
  /** Optional fallback sink for full event payload (e.g., SIEM forwarder). */
  readonly passthrough?: ShadowComparisonSink;
  /** Override for the agreement/divergence boundary (default 0.05). */
  readonly agreementEpsilon?: number;
}

export class PrometheusShadowSink implements ShadowComparisonSink {
  private readonly metrics: ShadowMetricsSink;
  private readonly passthrough: ShadowComparisonSink | undefined;
  private readonly epsilon: number;

  constructor(opts: PrometheusShadowSinkOptions) {
    this.metrics = opts.metrics;
    this.passthrough = opts.passthrough;
    this.epsilon = opts.agreementEpsilon ?? AGREEMENT_EPSILON;
  }

  async record(event: ShadowComparisonEvent): Promise<void> {
    const labels = {
      model_name: event.modelName,
      shadow_name: event.shadowName,
    };

    let status: 'divergence' | 'agreement' | 'error' | 'missing_model';
    if (event.shadowError !== undefined) {
      status = event.shadowError.startsWith('shadow "') ? 'missing_model' : 'error';
    } else if (Number.isFinite(event.divergence) && event.divergence <= this.epsilon) {
      status = 'agreement';
    } else {
      status = 'divergence';
    }

    this.metrics.incrementCounter('shadow_comparisons_total', {
      ...labels,
      status,
    });

    // Only observe divergence when we actually have a number. Error/missing
    // rows set divergence to NaN and should not pollute the histogram.
    if (Number.isFinite(event.divergence)) {
      this.metrics.observeHistogram('shadow_divergence', labels, event.divergence);
    }

    if (this.passthrough !== undefined) {
      await this.passthrough.record(event);
    }
  }
}
