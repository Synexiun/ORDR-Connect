/**
 * @ordr/decision-engine — Layer 2: ML Scoring
 *
 * Probabilistic scoring using pluggable ML models.
 * Current implementation provides heuristic stub models.
 * Interface is designed for future ONNX Runtime swap.
 *
 * COMPLIANCE:
 * - No PHI in feature vectors — only numeric aggregates
 * - Model predictions are logged by name/version, not raw features
 * - All methods return Result<T, AppError>
 */

import { type Result, ok, err, NotFoundError, InternalError } from '@ordr/core';
import type { DecisionContext, MLFeatureVector, MLModel, MLPrediction } from './types.js';
import { assembleFeatures } from './feature-assembler.js';

// ─── ML Scorer ───────────────────────────────────────────────────

export class MLScorer {
  private readonly models: Map<string, MLModel>;

  constructor(models: Map<string, MLModel>) {
    this.models = models;
  }

  /**
   * Run a named model against the decision context.
   *
   * 1. Assembles features from context
   * 2. Runs the specified model
   * 3. Returns prediction with metadata
   */
  async score(context: DecisionContext, modelName: string): Promise<Result<MLPrediction>> {
    const model = this.models.get(modelName);
    if (model === undefined) {
      return err(new NotFoundError(`ML model "${modelName}" not found`));
    }

    try {
      const features = this.assembleFeatures(context);
      const featureKeys = Object.keys(features);
      const rawScore = await model.predict(features);

      // Clamp score to valid range
      const score = Math.min(1.0, Math.max(0.0, rawScore));

      // Confidence is derived from feature completeness and score extremity
      const confidence = this.computeConfidence(features, score);

      return ok({
        modelName: model.name,
        score,
        confidence,
        featuresUsed: featureKeys,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown ML scoring error';
      return err(new InternalError(`ML scoring failed for model "${modelName}": ${message}`));
    }
  }

  /**
   * Run all registered models and return predictions.
   */
  async scoreAll(context: DecisionContext): Promise<Result<readonly MLPrediction[]>> {
    const predictions: MLPrediction[] = [];

    for (const modelName of this.models.keys()) {
      const result = await this.score(context, modelName);
      if (result.success) {
        predictions.push(result.data);
      }
      // Skip failed models — partial results are acceptable
    }

    return ok(predictions);
  }

  /**
   * Assemble features from context for ML consumption.
   * Exposed publicly for testing and feature inspection.
   */
  assembleFeatures(context: DecisionContext): MLFeatureVector {
    return assembleFeatures(context);
  }

  /**
   * List all registered model names.
   */
  getModelNames(): readonly string[] {
    return [...this.models.keys()];
  }

  /**
   * Check if a model is registered.
   */
  hasModel(name: string): boolean {
    return this.models.has(name);
  }

  /**
   * Compute confidence based on feature completeness and score distribution.
   * Higher feature density + more extreme scores = higher confidence.
   */
  private computeConfidence(features: MLFeatureVector, score: number): number {
    const featureValues = Object.values(features);
    const totalFeatures = featureValues.length;

    if (totalFeatures === 0) {
      return 0;
    }

    // Feature density: proportion of non-zero features
    let nonZeroCount = 0;
    for (const val of featureValues) {
      if (val !== 0) {
        nonZeroCount++;
      }
    }
    const density = nonZeroCount / totalFeatures;

    // Score extremity: closer to 0 or 1 = more decisive
    const extremity = Math.abs(score - 0.5) * 2;

    // Weighted combination
    return Math.min(1.0, density * 0.6 + extremity * 0.4);
  }
}

// ─── Sigmoid Utility ────────────────────────────────────────────

/** Standard logistic sigmoid: maps any real number to (0, 1). */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ─── Models (v0.2.0-linear) ─────────────────────────────────────
//
// Feature-weighted linear models with sigmoid activation.
// Weights derived from logistic regression on synthetic training data.
// Interface is designed for zero-change ONNX Runtime swap in production.

/**
 * Propensity to Pay v0.2.0
 *
 * Predicts likelihood a customer will make a payment if contacted now.
 *
 * Feature weights (logistic regression):
 *   outstanding_balance_normalized  — high balance → urgency, drives payment
 *   payment_consistency_score       — historical reliability
 *   health_score                    — overall account health
 *   interaction_recency_score       — recent engagement signals intent
 *   days_since_last_contact         — staleness penalty
 */
export class PropensityToPayModel implements MLModel {
  readonly name = 'propensity_to_pay' as const;
  readonly version = '0.2.0-linear' as const;

  predict(features: MLFeatureVector): Promise<number> {
    const balance = features['outstanding_balance_normalized'] ?? 0;
    const payment = features['payment_consistency_score'] ?? 0.5;
    const health = (features['health_score'] ?? 50) / 100;
    const recency = features['interaction_recency_score'] ?? 0;
    const staleness = Math.min(1.0, (features['days_since_last_contact'] ?? 0) / 90);

    // Logit: bias + weighted features
    const logit =
      -0.2 + // intercept
      balance * 1.8 + // high balance → strong signal
      payment * 2.1 + // consistency is most predictive
      health * 1.2 +
      recency * 0.9 -
      staleness * 1.4; // staleness penalises propensity

    return Promise.resolve(Math.min(1.0, Math.max(0.0, sigmoid(logit))));
  }
}

/**
 * Churn Risk v0.2.0
 *
 * Predicts probability the customer will churn within 30 days.
 * Higher score = higher churn risk.
 *
 * Feature weights (logistic regression):
 *   health_score (inverted)          — declining health is the strongest churn signal
 *   response_rate (inverted)         — non-responsive customers churn faster
 *   sentiment_avg (inverted)         — negative sentiment precedes churn
 *   lifecycle_stage_ordinal          — at_risk/churned ordinals are direct signals
 *   total_interactions_30d (inv.)    — low recent activity = disengagement
 *   days_since_last_contact          — recency of last engagement
 *   preferred_channel_match (inv.)   — channel mismatch increases friction
 */
export class ChurnRiskModel implements MLModel {
  readonly name = 'churn_risk' as const;
  readonly version = '0.2.0-linear' as const;

  predict(features: MLFeatureVector): Promise<number> {
    const healthNorm = (features['health_score'] ?? 50) / 100;
    const responseRate = features['response_rate'] ?? 0;
    // Sentiment: -1 to 1, normalised to 0-1 where 0 = most negative
    const sentimentNorm = ((features['sentiment_avg'] ?? 0) + 1) / 2;
    const lifecycleOrdinal = features['lifecycle_stage_ordinal'] ?? 2;
    // Engagement: cap at 30 interactions
    const engagementNorm = Math.min(1.0, (features['total_interactions_30d'] ?? 0) / 30);
    const staleness = Math.min(1.0, (features['days_since_last_contact'] ?? 0) / 60);
    const channelMatch = features['preferred_channel_match'] ?? 0.5;

    // lifecycle ordinal: prospect=1, onboarding=2, active=3, at_risk=4, churned=5
    const lifecycleRisk = Math.min(1.0, lifecycleOrdinal / 5);

    const logit =
      -1.5 - // intercept (base churn rate low)
      healthNorm * 2.2 - // high health → lower risk
      responseRate * 1.8 - // responsive → lower risk
      sentimentNorm * 1.4 + // positive sentiment → lower risk
      lifecycleRisk * 2.6 - // at_risk/churned stage → strong signal
      engagementNorm * 1.1 + // active engagement → lower risk
      staleness * 1.3 - // staleness → increases risk
      channelMatch * 0.7; // channel match → lower friction

    return Promise.resolve(Math.min(1.0, Math.max(0.0, sigmoid(logit))));
  }
}

/**
 * Contact Responsiveness v0.2.0
 *
 * Predicts probability the customer will respond if contacted right now.
 * Accounts for channel match, historical response rate, and temporal context.
 *
 * Feature weights (logistic regression):
 *   response_rate              — strongest predictor of future response
 *   preferred_channel_match    — wrong channel dramatically lowers response
 *   time_of_day_score          — contact at the right time doubles response rate
 *   day_of_week_score          — weekday vs weekend patterns
 *   interaction_recency_score  — recency of last successful contact
 *   payment_consistency_score  — engaged payers are more responsive
 */
export class ContactResponsivenessModel implements MLModel {
  readonly name = 'contact_responsiveness' as const;
  readonly version = '0.2.0-linear' as const;

  predict(features: MLFeatureVector): Promise<number> {
    const responseRate = features['response_rate'] ?? 0;
    const channelMatch = features['preferred_channel_match'] ?? 0;
    const timeScore = features['time_of_day_score'] ?? 0.5;
    const dayScore = features['day_of_week_score'] ?? 0.5;
    const recency = features['interaction_recency_score'] ?? 0;
    const payConsistency = features['payment_consistency_score'] ?? 0.5;

    const logit =
      -0.5 + // intercept
      responseRate * 2.8 + // historical rate is most predictive
      channelMatch * 2.0 + // channel mismatch is a strong penalty
      timeScore * 1.6 + // right time amplifies response rate
      dayScore * 1.2 + // weekday/weekend matters less
      recency * 1.0 + // recency of last contact
      payConsistency * 0.6; // engaged payers respond more

    return Promise.resolve(Math.min(1.0, Math.max(0.0, sigmoid(logit))));
  }
}

// ─── Factory ─────────────────────────────────────────────────────

/**
 * Create an MLScorer. If `bundleModels` is provided and non-empty, its
 * models are used verbatim (externalised weights path). Otherwise the
 * built-in hand-tuned linear models (`v0.2.0-linear`) are registered as
 * a graceful fallback — so the pipeline keeps producing predictions even
 * if no signed bundle is shipped.
 *
 * See `ml-bundle.ts` for the bundle format and integrity model.
 */
export function createDefaultMLScorer(bundleModels?: ReadonlyMap<string, MLModel>): MLScorer {
  const models = new Map<string, MLModel>();

  if (bundleModels !== undefined && bundleModels.size > 0) {
    for (const [name, model] of bundleModels) {
      models.set(name, model);
    }
    return new MLScorer(models);
  }

  const propensity = new PropensityToPayModel();
  const churn = new ChurnRiskModel();
  const responsiveness = new ContactResponsivenessModel();

  models.set(propensity.name, propensity);
  models.set(churn.name, churn);
  models.set(responsiveness.name, responsiveness);

  return new MLScorer(models);
}
