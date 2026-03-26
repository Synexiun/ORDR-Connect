/**
 * Customer health scoring — graph-derived customer intelligence
 *
 * Calculates a 0–100 health score from interaction patterns,
 * sentiment, deal value, and recency. Used by agents and dashboards
 * to surface at-risk accounts proactively.
 *
 * Weighted formula:
 *   - Interaction frequency (25%): contact count over 30 days
 *   - Response rate (25%): % of outbound that got replies
 *   - Sentiment trend (20%): average sentiment score
 *   - Deal value (15%): relative to tenant average
 *   - Recency (15%): days since last interaction (decay function)
 */

import type { HealthScoreFactors, HealthClassification } from './types.js';

// ─── Weight Constants ────────────────────────────────────────────

export const HEALTH_WEIGHTS = {
  INTERACTION_FREQUENCY: 0.25,
  RESPONSE_RATE: 0.25,
  SENTIMENT_TREND: 0.20,
  DEAL_VALUE: 0.15,
  RECENCY: 0.15,
} as const;

// ─── Normalization Constants ─────────────────────────────────────

/**
 * Target interactions per 30 days for a "perfect" frequency score.
 * More than this yields a normalized value of 1.0.
 */
const TARGET_INTERACTIONS_30D = 20;

/**
 * Reference deal value for normalization.
 * This should be replaced with the tenant average in production.
 * A deal at this value scores 0.5 (50%); double scores 1.0.
 */
const REFERENCE_DEAL_VALUE = 50_000;

/**
 * Half-life in days for the recency decay function.
 * After this many days with no interaction, recency score drops to 50%.
 */
const RECENCY_HALF_LIFE_DAYS = 14;

// ─── Classification Thresholds ───────────────────────────────────

export const HEALTH_THRESHOLDS = {
  HEALTHY_MIN: 75,
  AT_RISK_MIN: 50,
  CHURNING_MIN: 25,
} as const;

// ─── Calculator ──────────────────────────────────────────────────

export class HealthScoreCalculator {
  /**
   * Calculate a customer health score from 0 to 100.
   *
   * @param factors - Input metrics for the health calculation
   * @returns Score clamped to [0, 100]
   */
  calculateScore(factors: HealthScoreFactors): number {
    const frequency = this.normalizeFrequency(factors.interactionFrequency);
    const response = this.normalizeResponseRate(factors.responseRate);
    const sentiment = this.normalizeSentiment(factors.sentimentTrend);
    const deal = this.normalizeDealValue(factors.dealValue);
    const recency = this.normalizeRecency(factors.recency);

    const rawScore =
      frequency * HEALTH_WEIGHTS.INTERACTION_FREQUENCY +
      response * HEALTH_WEIGHTS.RESPONSE_RATE +
      sentiment * HEALTH_WEIGHTS.SENTIMENT_TREND +
      deal * HEALTH_WEIGHTS.DEAL_VALUE +
      recency * HEALTH_WEIGHTS.RECENCY;

    // Convert from 0–1 to 0–100 and clamp
    return clamp(Math.round(rawScore * 100), 0, 100);
  }

  /**
   * Classify health status based on score.
   *
   * - 75–100: healthy
   * - 50–74: at_risk
   * - 25–49: churning
   * - 0–24: critical
   */
  classifyHealth(score: number): HealthClassification {
    const clamped = clamp(Math.round(score), 0, 100);

    if (clamped >= HEALTH_THRESHOLDS.HEALTHY_MIN) {
      return 'healthy';
    }
    if (clamped >= HEALTH_THRESHOLDS.AT_RISK_MIN) {
      return 'at_risk';
    }
    if (clamped >= HEALTH_THRESHOLDS.CHURNING_MIN) {
      return 'churning';
    }
    return 'critical';
  }

  // ─── Normalization Functions (0.0 – 1.0) ────────────────────

  /**
   * Normalize interaction count over 30 days.
   * Uses logarithmic scaling to avoid penalizing low-touch accounts.
   */
  private normalizeFrequency(count: number): number {
    if (count <= 0) return 0;
    // log(count + 1) / log(target + 1) → 1.0 at target
    const normalized =
      Math.log(count + 1) / Math.log(TARGET_INTERACTIONS_30D + 1);
    return clamp(normalized, 0, 1);
  }

  /**
   * Normalize response rate (already 0.0–1.0).
   * Clamp to valid range.
   */
  private normalizeResponseRate(rate: number): number {
    return clamp(rate, 0, 1);
  }

  /**
   * Normalize sentiment from [-1.0, 1.0] to [0.0, 1.0].
   */
  private normalizeSentiment(sentiment: number): number {
    const clamped = clamp(sentiment, -1, 1);
    return (clamped + 1) / 2;
  }

  /**
   * Normalize deal value relative to reference.
   * Uses square root scaling to reduce extreme value dominance.
   */
  private normalizeDealValue(value: number): number {
    if (value <= 0) return 0;
    const normalized = Math.sqrt(value) / Math.sqrt(REFERENCE_DEAL_VALUE * 2);
    return clamp(normalized, 0, 1);
  }

  /**
   * Normalize recency using exponential decay.
   * Score = exp(-days * ln(2) / halfLife)
   * At 0 days: 1.0, at halfLife: 0.5, at 2*halfLife: 0.25
   */
  private normalizeRecency(daysSinceLastInteraction: number): number {
    if (daysSinceLastInteraction <= 0) return 1;
    const decay = Math.exp(
      (-daysSinceLastInteraction * Math.LN2) / RECENCY_HALF_LIFE_DAYS,
    );
    return clamp(decay, 0, 1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
