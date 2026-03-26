/**
 * @ordr/decision-engine — Feature Assembler for ML Scoring (Layer 2)
 *
 * Extracts numeric features from DecisionContext for ML model consumption.
 * All features are normalized to predictable ranges for model stability.
 *
 * COMPLIANCE:
 * - No PHI in feature vectors — only numeric/categorical scores
 * - Features are derived from aggregated metrics, not raw data
 */

import type { DecisionContext, MLFeatureVector } from './types.js';

// ─── Constants ───────────────────────────────────────────────────

/** Peak business hours: 9 AM - 5 PM (local time) */
const PEAK_HOUR_START = 9 as const;
const PEAK_HOUR_END = 17 as const;

/** Lifecycle stage ordinal mapping (higher = more mature) */
const LIFECYCLE_ORDINALS: Readonly<Record<string, number>> = {
  prospect: 1,
  onboarding: 2,
  active: 3,
  at_risk: 4,
  churned: 5,
} as const;

/** Day-of-week scoring (Mon-Fri higher, weekends lower) */
const DAY_SCORES: readonly number[] = [
  0.3, // Sunday
  0.9, // Monday
  1.0, // Tuesday
  1.0, // Wednesday
  0.9, // Thursday
  0.8, // Friday
  0.2, // Saturday
] as const;

// ─── Feature Assembly ────────────────────────────────────────────

/**
 * Assemble a feature vector from the decision context.
 *
 * All features are normalized to consistent ranges:
 * - Counts/days: raw numeric value
 * - Rates/scores: 0.0 to 1.0
 * - Health score: 0 to 100
 * - Sentiment: -1.0 to 1.0
 * - Ordinals: integer scale
 *
 * Missing data defaults to neutral values (0 or midpoint).
 */
export function assembleFeatures(context: DecisionContext): MLFeatureVector {
  const profile = context.customerProfile;
  const history = context.interactionHistory;
  const now = context.timestamp;

  return {
    days_since_last_contact: computeDaysSinceLastContact(profile.daysSinceLastContact),
    total_interactions_30d: computeTotalInteractions30d(profile.totalInteractions30d),
    response_rate: clamp01(profile.responseRate),
    health_score: clamp(profile.healthScore, 0, 100),
    sentiment_avg: clamp(profile.sentimentAvg, -1, 1),
    outstanding_balance_normalized: computeBalanceNormalized(
      profile.outstandingBalance,
      profile.maxBalance,
    ),
    lifecycle_stage_ordinal: computeLifecycleOrdinal(profile.lifecycleStage),
    preferred_channel_match: computeChannelMatch(context),
    time_of_day_score: computeTimeOfDayScore(now),
    day_of_week_score: computeDayOfWeekScore(now),
    interaction_recency_score: computeRecencyScore(history, now),
    payment_consistency_score: computePaymentConsistency(profile.paymentHistory),
  };
}

// ─── Individual Feature Computations ─────────────────────────────

function computeDaysSinceLastContact(days: number): number {
  return Math.max(0, days);
}

function computeTotalInteractions30d(count: number): number {
  return Math.max(0, Math.round(count));
}

function computeBalanceNormalized(outstanding: number, maxBalance: number): number {
  if (maxBalance <= 0 || outstanding <= 0) {
    return 0;
  }
  return clamp01(outstanding / maxBalance);
}

function computeLifecycleOrdinal(stage: string): number {
  return LIFECYCLE_ORDINALS[stage] ?? 3;
}

function computeChannelMatch(context: DecisionContext): number {
  const preferred = context.customerProfile.preferredChannel;
  if (preferred === undefined || context.channelPreferences.length === 0) {
    return 0;
  }
  return context.channelPreferences.includes(preferred) ? 1 : 0;
}

function computeTimeOfDayScore(now: Date): number {
  const hour = now.getHours();
  if (hour >= PEAK_HOUR_START && hour < PEAK_HOUR_END) {
    // Peak hours — score based on distance from midday
    const midday = (PEAK_HOUR_START + PEAK_HOUR_END) / 2;
    const distanceFromMidday = Math.abs(hour - midday);
    const maxDistance = (PEAK_HOUR_END - PEAK_HOUR_START) / 2;
    return 1.0 - (distanceFromMidday / maxDistance) * 0.3;
  }
  // Off-peak — linearly decay
  if (hour < PEAK_HOUR_START) {
    return Math.max(0, hour / PEAK_HOUR_START * 0.5);
  }
  return Math.max(0, 1.0 - ((hour - PEAK_HOUR_END) / (24 - PEAK_HOUR_END)) * 0.8);
}

function computeDayOfWeekScore(now: Date): number {
  const day = now.getDay();
  return DAY_SCORES[day] ?? 0.5;
}

function computeRecencyScore(
  history: readonly { readonly timestamp: Date }[],
  now: Date,
): number {
  if (history.length === 0) {
    return 0;
  }

  // Find most recent interaction
  let mostRecent = 0;
  for (const record of history) {
    const ts = record.timestamp.getTime();
    if (ts > mostRecent) {
      mostRecent = ts;
    }
  }

  const hoursSince = (now.getTime() - mostRecent) / (1000 * 60 * 60);
  // Exponential decay: recent = high score, old = low score
  // Half-life of 48 hours
  return Math.exp(-hoursSince / 48);
}

function computePaymentConsistency(
  payments: readonly { readonly onTime: boolean }[],
): number {
  if (payments.length === 0) {
    return 0.5; // Neutral — no data
  }

  let onTimeCount = 0;
  for (const payment of payments) {
    if (payment.onTime) {
      onTimeCount++;
    }
  }

  return onTimeCount / payments.length;
}

// ─── Helpers ─────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
