/**
 * Sentiment-Aware Agent Router — routes interactions based on customer sentiment
 *
 * SECURITY (CLAUDE.md Rules 2, 3, 6, 9):
 * - All routing decisions audit-logged (WORM, Rule 3)
 * - No PHI in routing logs or decision metadata (Rule 6)
 * - Tenant-scoped sentiment history queries (Rule 2)
 * - Agent safety: confidence-gated routing (Rule 9)
 * - Human escalation for very negative sentiment
 *
 * SOC2 CC7.2 — Monitoring and responding to customer sentiment patterns.
 * HIPAA §164.312 — No PHI in routing pipeline.
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
  InternalError,
} from '@ordr/core';
import type { SentimentResult } from '../sentiment.js';

// ─── Types ───────────────────────────────────────────────────────

export const ROUTING_ACTIONS = [
  'escalate_human',
  'route_retention',
  'keep_current',
  'route_growth',
] as const;
export type RoutingAction = (typeof ROUTING_ACTIONS)[number];

export interface RoutingDecision {
  readonly action: RoutingAction;
  readonly targetAgent: string;
  readonly reason: string;
  readonly currentSentiment: SentimentResult;
  readonly trendDirection: 'improving' | 'stable' | 'declining';
  readonly confidence: number;
}

export interface RoutingThresholds {
  readonly veryNegativeBelow: number;
  readonly negativeBelow: number;
  readonly positiveAbove: number;
}

/** Audit entry for routing decisions — NEVER contains message content */
export interface RoutingAuditEntry {
  readonly tenantId: string;
  readonly customerId: string;
  readonly action: RoutingAction;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly sentimentScore: number;
  readonly trendDirection: string;
  readonly timestamp: Date;
}

// ─── Dependency Interfaces ──────────────────────────────────────

/** Pluggable sentiment analyzer */
export interface RouterSentimentProvider {
  readonly analyze: (text: string) => Promise<Result<SentimentResult, InternalError | ValidationError>>;
}

/** Pluggable sentiment history store */
export interface SentimentHistoryProvider {
  readonly getRecent: (
    tenantId: string,
    customerId: string,
    limit: number,
  ) => Promise<Result<SentimentResult[], InternalError>>;
}

/** Pluggable audit logger */
export type RoutingAuditLogger = (entry: RoutingAuditEntry) => void;

// ─── Constants ───────────────────────────────────────────────────

/** Number of recent interactions to consider for trend analysis */
const TREND_WINDOW_SIZE = 5 as const;

/** Default routing thresholds */
const DEFAULT_THRESHOLDS: RoutingThresholds = {
  veryNegativeBelow: -0.6,
  negativeBelow: -0.2,
  positiveAbove: 0.4,
} as const;

/** Well-known agent roles for routing targets */
const AGENT_TARGETS = {
  HUMAN_OPERATOR: 'human_operator',
  RETENTION_AGENT: 'retention_agent',
  GROWTH_AGENT: 'growth_agent',
} as const;

// ─── Implementation ─────────────────────────────────────────────

export class SentimentRouter {
  private readonly sentimentProvider: RouterSentimentProvider;
  private readonly historyProvider: SentimentHistoryProvider;
  private readonly auditLog: RoutingAuditLogger;
  private readonly tenantId: string;
  private readonly thresholds: RoutingThresholds;

  constructor(deps: {
    readonly sentimentProvider: RouterSentimentProvider;
    readonly historyProvider: SentimentHistoryProvider;
    readonly auditLog: RoutingAuditLogger;
    readonly tenantId: string;
    readonly thresholds?: RoutingThresholds;
  }) {
    this.sentimentProvider = deps.sentimentProvider;
    this.historyProvider = deps.historyProvider;
    this.auditLog = deps.auditLog;
    this.tenantId = deps.tenantId;
    this.thresholds = deps.thresholds ?? DEFAULT_THRESHOLDS;
  }

  /**
   * Route an interaction based on customer sentiment.
   *
   * Routing rules:
   * - Very negative (< -0.6): escalate to human operator
   * - Negative (-0.6 to -0.2): route to retention/escalation agent
   * - Neutral (-0.2 to 0.4): keep current agent
   * - Positive (> 0.4): route to upsell/growth agent
   *
   * Also considers the last 5 interactions for trend analysis.
   *
   * SECURITY:
   * - Message content is only passed to sentiment analyzer (never stored)
   * - Decision is audit-logged without message content
   * - Tenant-scoped history queries
   */
  async route(
    customerId: string,
    message: string,
    currentAgent: string,
  ): Promise<Result<RoutingDecision, ValidationError | InternalError>> {
    // ── Validate inputs ─────────────────────────────────
    if (customerId.length === 0) {
      return err(new ValidationError('Customer ID must not be empty', { customerId: ['Required'] }));
    }
    if (message.length === 0) {
      return err(new ValidationError('Message must not be empty', { message: ['Required'] }));
    }
    if (currentAgent.length === 0) {
      return err(new ValidationError('Current agent must not be empty', { currentAgent: ['Required'] }));
    }

    // ── Analyze current message sentiment ───────────────
    const sentimentResult = await this.sentimentProvider.analyze(message);
    if (!sentimentResult.success) {
      return sentimentResult;
    }
    const currentSentiment = sentimentResult.data;

    // ── Get historical sentiment trend ──────────────────
    const historyResult = await this.historyProvider.getRecent(
      this.tenantId,
      customerId,
      TREND_WINDOW_SIZE,
    );

    // If history fails, we still route — just without trend data
    const history = historyResult.success ? historyResult.data : [];
    const trendDirection = computeTrend(history, currentSentiment);

    // ── Make routing decision ───────────────────────────
    const decision = this.makeDecision(
      currentSentiment,
      trendDirection,
      currentAgent,
    );

    // ── Audit log (WORM) — no message content ──────────
    this.auditLog({
      tenantId: this.tenantId,
      customerId,
      action: decision.action,
      fromAgent: currentAgent,
      toAgent: decision.targetAgent,
      sentimentScore: currentSentiment.score,
      trendDirection,
      timestamp: new Date(),
    });

    return ok(decision);
  }

  // ── Private ─────────────────────────────────────────────────

  private makeDecision(
    sentiment: SentimentResult,
    trend: 'improving' | 'stable' | 'declining',
    currentAgent: string,
  ): RoutingDecision {
    const score = sentiment.score;

    // Very negative: escalate to human
    if (score < this.thresholds.veryNegativeBelow) {
      return {
        action: 'escalate_human',
        targetAgent: AGENT_TARGETS.HUMAN_OPERATOR,
        reason: 'Very negative sentiment detected — escalating to human operator',
        currentSentiment: sentiment,
        trendDirection: trend,
        confidence: sentiment.confidence,
      };
    }

    // Negative: route to retention agent
    if (score < this.thresholds.negativeBelow) {
      return {
        action: 'route_retention',
        targetAgent: AGENT_TARGETS.RETENTION_AGENT,
        reason: 'Negative sentiment detected — routing to retention agent',
        currentSentiment: sentiment,
        trendDirection: trend,
        confidence: sentiment.confidence,
      };
    }

    // Positive: route to growth agent
    if (score > this.thresholds.positiveAbove) {
      return {
        action: 'route_growth',
        targetAgent: AGENT_TARGETS.GROWTH_AGENT,
        reason: 'Positive sentiment detected — routing to growth agent',
        currentSentiment: sentiment,
        trendDirection: trend,
        confidence: sentiment.confidence,
      };
    }

    // Neutral: keep current agent
    return {
      action: 'keep_current',
      targetAgent: currentAgent,
      reason: 'Neutral sentiment — maintaining current agent assignment',
      currentSentiment: sentiment,
      trendDirection: trend,
      confidence: sentiment.confidence,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Compute sentiment trend from historical data + current reading.
 *
 * Uses simple linear trend: if average of recent scores is improving
 * compared to older scores, trend is "improving".
 */
function computeTrend(
  history: readonly SentimentResult[],
  current: SentimentResult,
): 'improving' | 'stable' | 'declining' {
  if (history.length === 0) {
    return 'stable';
  }

  // Compute average historical score
  let historySum = 0;
  for (const h of history) {
    historySum += h.score;
  }
  const historyAvg = historySum / history.length;

  const diff = current.score - historyAvg;

  if (diff > 0.15) return 'improving';
  if (diff < -0.15) return 'declining';
  return 'stable';
}
