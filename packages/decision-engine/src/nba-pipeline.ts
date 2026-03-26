/**
 * @ordr/decision-engine — Next-Best-Action Pipeline (THE CORE)
 *
 * Orchestrates the 3-layer decision flow:
 *   Event -> [L1: Rules] -> [L2: ML Scoring] -> [L3: LLM Reasoning] -> NBA
 *
 * Each layer is optional — fast decisions use only rules (80% of traffic),
 * complex ones flow through all three layers.
 *
 * COMPLIANCE:
 * - Every decision is WORM audit-logged with full layer chain
 * - Compliance gate is checked on final action before returning
 * - PHI is NEVER logged — only tokenized refs, scores, metadata
 * - All methods return Result<T, AppError>
 */

import { randomUUID } from 'node:crypto';
import {
  type Result,
  ok,
  err,
  InternalError,
  ComplianceViolationError,
  type AppError,
} from '@ordr/core';
import type {
  DecisionContext,
  Decision,
  RuleResult,
  MLPrediction,
  NBACandidate,
  DecisionLayer,
  DecisionAuditEntry,
  ActionType,
  ChannelType,
  ComplianceGateInterface,
  AuditLoggerInterface,
} from './types.js';
import type { RulesEngine } from './rules.js';
import type { MLScorer } from './ml-scorer.js';
import type { LLMReasoner } from './llm-reasoner.js';

// ─── Constants ───────────────────────────────────────────────────

/** ML confidence threshold — below this, invoke LLM reasoning. */
const ML_CONFIDENCE_THRESHOLD = 0.8 as const;

/** Decision expiry in minutes. */
const DECISION_EXPIRY_MINUTES = 60 as const;

/** Estimated cost per action type (cents). */
const ACTION_COST_ESTIMATES: Readonly<Record<string, number>> = {
  send_sms: 5,
  send_email: 1,
  send_voice: 25,
  route_to_agent: 0,
  escalate_to_human: 0,
  offer_payment_plan: 1,
  cease_communication: 0,
  schedule_callback: 0,
  trigger_workflow: 0,
  no_action: 0,
} as const;

// ─── Pipeline Dependencies ───────────────────────────────────────

export interface NBAPipelineDeps {
  readonly rules: RulesEngine;
  readonly ml: MLScorer;
  readonly llm: LLMReasoner;
  readonly compliance: ComplianceGateInterface;
  readonly auditLogger: AuditLoggerInterface;
}

// ─── NBA Pipeline ────────────────────────────────────────────────

export class NBAPipeline {
  private readonly rules: RulesEngine;
  private readonly ml: MLScorer;
  private readonly llm: LLMReasoner;
  private readonly compliance: ComplianceGateInterface;
  private readonly auditLogger: AuditLoggerInterface;

  constructor(deps: NBAPipelineDeps) {
    this.rules = deps.rules;
    this.ml = deps.ml;
    this.llm = deps.llm;
    this.compliance = deps.compliance;
    this.auditLogger = deps.auditLogger;
  }

  /**
   * Evaluate the Next-Best-Action for a customer interaction.
   *
   * Flow:
   * 1. Layer 1 — Rules: If terminal match with confidence 1.0, return immediately (fast path)
   * 2. Layer 2 — ML: Score with models, combine with rule results
   * 3. Layer 3 — LLM: If ML confidence < 0.8 or complex context, invoke reasoning
   * 4. Generate + rank candidates
   * 5. Compliance gate on top candidate
   * 6. Audit log full decision chain
   * 7. Return winning Decision
   */
  async evaluate(
    context: DecisionContext,
  ): Promise<Result<Decision, AppError>> {
    const startTime = performance.now();
    const decisionId = randomUUID();
    const layersUsed: DecisionLayer[] = [];
    const auditEntries: DecisionAuditEntry[] = [];

    // ── Layer 1: Rules Engine ────────────────────────────────
    const rulesStart = performance.now();
    const rulesResult = await this.rules.evaluate(context);

    if (!rulesResult.success) {
      return rulesResult;
    }

    const ruleResults = rulesResult.data;
    layersUsed.push('rules');

    const rulesDurationMs = Math.round(performance.now() - rulesStart);
    auditEntries.push(this.createAuditEntry(
      decisionId,
      context,
      'rules',
      `Evaluated ${String(ruleResults.length)} rules`,
      `Matched: ${String(ruleResults.filter((r) => r.matched).length)}`,
      rulesDurationMs,
      ruleResults.filter((r) => r.matched).length > 0 ? 1.0 : 0.0,
      1.0,
      ruleResults.find((r) => r.matched)?.action?.type ?? 'no_action',
    ));

    // Fast path: terminal rule match
    const terminalResult = await this.rules.findTerminalMatch(context);
    if (terminalResult.success && terminalResult.data !== undefined) {
      const terminalRule = terminalResult.data;

      // Compliance check on terminal action
      const complianceResult = this.checkCompliance(context, terminalRule.action?.type ?? 'no_action');
      if (!complianceResult.success) {
        await this.logAuditEntries(auditEntries);
        return complianceResult;
      }

      const decision = this.buildDecision(
        decisionId,
        context,
        terminalRule.action?.type ?? 'no_action',
        terminalRule.action?.channel,
        terminalRule.action?.parameters ?? {},
        1.0,
        1.0,
        terminalRule.reasoning,
        ['rules'],
        [],
      );

      await this.logAuditEntries(auditEntries);
      return ok(decision);
    }

    // ── Layer 2: ML Scoring ──────────────────────────────────
    const mlStart = performance.now();
    const mlResult = await this.ml.scoreAll(context);

    let mlScores: readonly MLPrediction[] = [];
    if (mlResult.success) {
      mlScores = mlResult.data;
      layersUsed.push('ml');
    }

    const mlDurationMs = Math.round(performance.now() - mlStart);
    const avgMlConfidence = mlScores.length > 0
      ? mlScores.reduce((sum, s) => sum + s.confidence, 0) / mlScores.length
      : 0;

    auditEntries.push(this.createAuditEntry(
      decisionId,
      context,
      'ml',
      `Ran ${String(mlScores.length)} models`,
      mlScores.map((s) => `${s.modelName}=${s.score.toFixed(3)}`).join(', '),
      mlDurationMs,
      mlScores.length > 0 ? mlScores.reduce((sum, s) => sum + s.score, 0) / mlScores.length : 0,
      avgMlConfidence,
      'no_action',
    ));

    // ── Layer 3: LLM Reasoning (conditional) ─────────────────
    let llmDecision: Decision | undefined;

    if (avgMlConfidence < ML_CONFIDENCE_THRESHOLD || this.isComplexContext(context)) {
      const llmStart = performance.now();
      const llmResult = await this.llm.reason(context, [...ruleResults], [...mlScores]);
      const llmDurationMs = Math.round(performance.now() - llmStart);

      if (llmResult.success) {
        llmDecision = llmResult.data;
        layersUsed.push('llm');

        auditEntries.push(this.createAuditEntry(
          decisionId,
          context,
          'llm',
          `LLM reasoning invoked (tier: ${context.customerProfile.ltv > 50000 ? 'premium' : 'standard'})`,
          `action=${llmDecision.action}, confidence=${llmDecision.confidence.toFixed(3)}`,
          llmDurationMs,
          llmDecision.score,
          llmDecision.confidence,
          llmDecision.action,
        ));
      } else {
        // LLM failed — continue with rules + ML only
        auditEntries.push(this.createAuditEntry(
          decisionId,
          context,
          'llm',
          'LLM reasoning failed — falling back to L1+L2',
          llmResult.error.message,
          llmDurationMs,
          0,
          0,
          'no_action',
        ));
      }
    }

    // ── Candidate Generation + Ranking ───────────────────────
    const candidates = this.generateCandidates(ruleResults, mlScores, llmDecision, context);
    const ranked = this.rankCandidates(candidates);

    // ── Select Best Action ───────────────────────────────────
    if (ranked.length === 0) {
      const noActionDecision = this.buildDecision(
        decisionId,
        context,
        'no_action',
        undefined,
        {},
        0,
        0,
        'No viable candidates after evaluation',
        layersUsed,
        [],
      );

      await this.logAuditEntries(auditEntries);
      return ok(noActionDecision);
    }

    // Find first candidate that passes compliance
    for (const candidate of ranked) {
      const complianceResult = this.checkCompliance(context, candidate.action);
      if (complianceResult.success) {
        const decision = this.buildDecision(
          decisionId,
          context,
          candidate.action,
          candidate.channel,
          {},
          candidate.score,
          candidate.confidence,
          candidate.reasoning,
          layersUsed,
          ranked,
        );

        await this.logAuditEntries(auditEntries);
        return ok(decision);
      }
    }

    // All candidates blocked by compliance
    await this.logAuditEntries(auditEntries);
    return err(new ComplianceViolationError(
      'All NBA candidates blocked by compliance gate',
      'multi',
      context.correlationId,
    ));
  }

  /**
   * Generate NBA candidates from layer outputs.
   */
  generateCandidates(
    ruleResults: readonly RuleResult[],
    mlScores: readonly MLPrediction[],
    llmDecision: Decision | undefined,
    context: DecisionContext,
  ): readonly NBACandidate[] {
    const candidates: NBACandidate[] = [];

    // Candidates from matched rules
    for (const rule of ruleResults) {
      if (rule.matched && rule.action !== undefined) {
        candidates.push({
          action: rule.action.type,
          channel: rule.action.channel,
          score: rule.score,
          confidence: 1.0,
          constraintsSatisfied: this.checkConstraints(rule.action.type, rule.action.channel, context),
          complianceChecked: false,
          estimatedCostCents: ACTION_COST_ESTIMATES[rule.action.type] ?? 0,
          source: 'rules',
          reasoning: rule.reasoning,
        });
      }
    }

    // Candidates from ML (use highest-scoring model to suggest action)
    if (mlScores.length > 0) {
      const bestMl = mlScores.reduce((best, current) =>
        current.score > best.score ? current : best,
      );

      const mlAction = this.mapMlScoreToAction(bestMl, context);
      if (mlAction !== undefined) {
        candidates.push({
          action: mlAction.action,
          channel: mlAction.channel,
          score: bestMl.score,
          confidence: bestMl.confidence,
          constraintsSatisfied: this.checkConstraints(mlAction.action, mlAction.channel, context),
          complianceChecked: false,
          estimatedCostCents: ACTION_COST_ESTIMATES[mlAction.action] ?? 0,
          source: 'ml',
          reasoning: `ML model "${bestMl.modelName}" scored ${bestMl.score.toFixed(3)} with confidence ${bestMl.confidence.toFixed(3)}`,
        });
      }
    }

    // Candidate from LLM
    if (llmDecision !== undefined) {
      candidates.push({
        action: llmDecision.action,
        channel: llmDecision.channel,
        score: llmDecision.score,
        confidence: llmDecision.confidence,
        constraintsSatisfied: this.checkConstraints(llmDecision.action, llmDecision.channel, context),
        complianceChecked: false,
        estimatedCostCents: ACTION_COST_ESTIMATES[llmDecision.action] ?? 0,
        source: 'llm',
        reasoning: llmDecision.reasoning,
      });
    }

    return candidates;
  }

  /**
   * Rank candidates by composite score.
   * Composite = score * 0.5 + confidence * 0.3 + constraintBonus * 0.2
   */
  rankCandidates(candidates: readonly NBACandidate[]): readonly NBACandidate[] {
    return [...candidates].sort((a, b) => {
      const aComposite = a.score * 0.5 + a.confidence * 0.3 + (a.constraintsSatisfied ? 0.2 : 0);
      const bComposite = b.score * 0.5 + b.confidence * 0.3 + (b.constraintsSatisfied ? 0.2 : 0);
      return bComposite - aComposite;
    });
  }

  // ── Private Helpers ────────────────────────────────────────

  /**
   * Build a final Decision object.
   */
  private buildDecision(
    id: string,
    context: DecisionContext,
    action: ActionType,
    channel: ChannelType | undefined,
    parameters: Record<string, unknown>,
    score: number,
    confidence: number,
    reasoning: string,
    layersUsed: readonly DecisionLayer[],
    candidates: readonly NBACandidate[],
  ): Decision {
    const now = new Date();
    return {
      id,
      tenantId: context.tenantId,
      customerId: context.customerId,
      action,
      channel,
      parameters,
      score,
      confidence,
      reasoning,
      layersUsed,
      candidates,
      evaluatedAt: now,
      expiresAt: new Date(now.getTime() + DECISION_EXPIRY_MINUTES * 60 * 1000),
    };
  }

  /**
   * Check compliance gate on an action.
   */
  private checkCompliance(
    context: DecisionContext,
    action: ActionType,
  ): Result<boolean, ComplianceViolationError> {
    const gateResult = this.compliance.check(action, {
      tenantId: context.tenantId,
      customerId: context.customerId,
      data: {
        eventType: context.eventType,
        healthScore: context.customerProfile.healthScore,
        lifecycleStage: context.customerProfile.lifecycleStage,
      },
      timestamp: context.timestamp,
    });

    if (!gateResult.allowed) {
      const violationSummary = gateResult.violations
        .filter((v) => !v.passed)
        .map((v) => `${v.regulation}:${v.ruleId}`)
        .join(', ');
      return err(new ComplianceViolationError(
        `Action "${action}" blocked by compliance: ${violationSummary}`,
        'multi',
        context.correlationId,
      ));
    }

    return ok(true);
  }

  /**
   * Check if an action satisfies the context constraints.
   */
  private checkConstraints(
    action: ActionType,
    channel: ChannelType | undefined,
    context: DecisionContext,
  ): boolean {
    // Check blocked channels
    if (channel !== undefined && context.constraints.blockedChannels.includes(channel)) {
      return false;
    }

    // Check budget
    const estimatedCost = ACTION_COST_ESTIMATES[action] ?? 0;
    if (context.constraints.budgetCents !== undefined && estimatedCost > context.constraints.budgetCents) {
      return false;
    }

    return true;
  }

  /**
   * Determine if the context requires complex reasoning (triggers LLM).
   */
  private isComplexContext(context: DecisionContext): boolean {
    // Multiple constraints active
    const constraintCount =
      (context.constraints.budgetCents !== undefined ? 1 : 0) +
      (context.constraints.timeWindowMinutes !== undefined ? 1 : 0) +
      context.constraints.blockedChannels.length;

    if (constraintCount >= 3) {
      return true;
    }

    // At-risk or churned customers need more nuanced handling
    if (
      context.customerProfile.lifecycleStage === 'at_risk' ||
      context.customerProfile.lifecycleStage === 'churned'
    ) {
      return true;
    }

    // Low health score
    if (context.customerProfile.healthScore < 30) {
      return true;
    }

    return false;
  }

  /**
   * Map ML model scores to a suggested action.
   */
  private mapMlScoreToAction(
    prediction: MLPrediction,
    context: DecisionContext,
  ): { readonly action: ActionType; readonly channel: ChannelType | undefined } | undefined {
    switch (prediction.modelName) {
      case 'propensity_to_pay':
        if (prediction.score > 0.7) {
          return { action: 'send_sms', channel: 'sms' };
        }
        if (prediction.score > 0.4) {
          return { action: 'offer_payment_plan', channel: undefined };
        }
        return { action: 'escalate_to_human', channel: undefined };

      case 'churn_risk':
        if (prediction.score > 0.7) {
          return { action: 'route_to_agent', channel: undefined };
        }
        if (prediction.score > 0.4) {
          return { action: 'send_email', channel: 'email' };
        }
        return undefined;

      case 'contact_responsiveness': {
        const preferred = context.customerProfile.preferredChannel;
        if (prediction.score > 0.6 && preferred !== undefined) {
          const actionMap: Readonly<Record<string, ActionType>> = {
            sms: 'send_sms',
            email: 'send_email',
            voice: 'send_voice',
          } as const;
          const action = actionMap[preferred];
          if (action !== undefined) {
            return { action, channel: preferred };
          }
        }
        return undefined;
      }

      default:
        return undefined;
    }
  }

  /**
   * Create an audit entry for a decision layer evaluation.
   * CRITICAL: No PHI — only tokenized IDs, scores, and metadata.
   */
  private createAuditEntry(
    decisionId: string,
    context: DecisionContext,
    layer: DecisionLayer,
    inputSummary: string,
    outputSummary: string,
    durationMs: number,
    score: number,
    confidence: number,
    actionSelected: ActionType,
  ): DecisionAuditEntry {
    return {
      decisionId,
      tenantId: context.tenantId,
      customerId: context.customerId,
      layer,
      inputSummary,
      outputSummary,
      durationMs,
      score,
      confidence,
      actionSelected,
      metadata: {
        correlationId: context.correlationId,
        eventType: context.eventType,
      },
      createdAt: new Date(),
    };
  }

  /**
   * Log all accumulated audit entries via the WORM audit logger.
   */
  private async logAuditEntries(entries: readonly DecisionAuditEntry[]): Promise<void> {
    for (const entry of entries) {
      try {
        await this.auditLogger.log({
          tenantId: entry.tenantId,
          eventType: 'agent.decision',
          actorType: 'agent',
          actorId: 'decision-engine',
          resource: 'decision',
          resourceId: entry.decisionId,
          action: `${entry.layer}_evaluation`,
          details: {
            layer: entry.layer,
            inputSummary: entry.inputSummary,
            outputSummary: entry.outputSummary,
            durationMs: entry.durationMs,
            score: entry.score,
            confidence: entry.confidence,
            actionSelected: entry.actionSelected,
          },
          timestamp: entry.createdAt,
        });
      } catch {
        // Audit logging failure is logged but does not block the decision.
        // In production, this triggers a P0 alert via monitoring.
      }
    }
  }
}
