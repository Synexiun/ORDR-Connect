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

import {
  type Result,
  ok,
  err,
  NotFoundError,
  InternalError,
} from '@ordr/core';
import type {
  DecisionContext,
  MLFeatureVector,
  MLModel,
  MLPrediction,
} from './types.js';
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
  async score(
    context: DecisionContext,
    modelName: string,
  ): Promise<Result<MLPrediction, NotFoundError | InternalError>> {
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
  async scoreAll(
    context: DecisionContext,
  ): Promise<Result<readonly MLPrediction[], InternalError>> {
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

// ─── Stub Models (MVP) ──────────────────────────────────────────

/**
 * Propensity to Pay — heuristic stub.
 *
 * Weighted formula based on:
 * - Health score (30%)
 * - Payment consistency (30%)
 * - Interaction recency (20%)
 * - Balance severity (20% — inverted)
 */
export class PropensityToPayModel implements MLModel {
  readonly name = 'propensity_to_pay' as const;
  readonly version = '0.1.0-stub' as const;

  async predict(features: MLFeatureVector): Promise<number> {
    const healthNorm = (features['health_score'] ?? 50) / 100;
    const paymentConsistency = features['payment_consistency_score'] ?? 0.5;
    const recency = features['interaction_recency_score'] ?? 0;
    const balanceSeverity = features['outstanding_balance_normalized'] ?? 0;

    const score =
      healthNorm * 0.3 +
      paymentConsistency * 0.3 +
      recency * 0.2 +
      (1 - balanceSeverity) * 0.2;

    return Math.min(1.0, Math.max(0.0, score));
  }
}

/**
 * Churn Risk — heuristic stub.
 *
 * Higher score = higher churn risk. Weighted formula:
 * - Inverse health score (25%)
 * - Low engagement (25%)
 * - Negative sentiment (25%)
 * - Lifecycle stage risk (25%)
 */
export class ChurnRiskModel implements MLModel {
  readonly name = 'churn_risk' as const;
  readonly version = '0.1.0-stub' as const;

  async predict(features: MLFeatureVector): Promise<number> {
    const healthNorm = (features['health_score'] ?? 50) / 100;
    const interactions = features['total_interactions_30d'] ?? 0;
    const sentiment = features['sentiment_avg'] ?? 0;
    const lifecycleOrdinal = features['lifecycle_stage_ordinal'] ?? 3;

    // Engagement score: more interactions = lower churn risk
    // Cap at 20 interactions for normalization
    const engagementScore = Math.min(1.0, interactions / 20);

    // Sentiment: -1 to 1, normalized to 0-1 where 0 = most negative
    const sentimentNorm = (sentiment + 1) / 2;

    // Lifecycle risk: at_risk (4) and churned (5) are highest risk
    const lifecycleRisk = lifecycleOrdinal >= 4 ? 1.0 : lifecycleOrdinal <= 2 ? 0.2 : 0.5;

    const churnRisk =
      (1 - healthNorm) * 0.25 +
      (1 - engagementScore) * 0.25 +
      (1 - sentimentNorm) * 0.25 +
      lifecycleRisk * 0.25;

    return Math.min(1.0, Math.max(0.0, churnRisk));
  }
}

/**
 * Contact Responsiveness — heuristic stub.
 *
 * Predicts likelihood of customer responding to outreach.
 * Weighted formula:
 * - Historical response rate (35%)
 * - Channel preference match (20%)
 * - Time-of-day score (20%)
 * - Day-of-week score (15%)
 * - Recency (10%)
 */
export class ContactResponsivenessModel implements MLModel {
  readonly name = 'contact_responsiveness' as const;
  readonly version = '0.1.0-stub' as const;

  async predict(features: MLFeatureVector): Promise<number> {
    const responseRate = features['response_rate'] ?? 0;
    const channelMatch = features['preferred_channel_match'] ?? 0;
    const timeScore = features['time_of_day_score'] ?? 0.5;
    const dayScore = features['day_of_week_score'] ?? 0.5;
    const recency = features['interaction_recency_score'] ?? 0;

    const score =
      responseRate * 0.35 +
      channelMatch * 0.20 +
      timeScore * 0.20 +
      dayScore * 0.15 +
      recency * 0.10;

    return Math.min(1.0, Math.max(0.0, score));
  }
}

// ─── Factory ─────────────────────────────────────────────────────

/**
 * Create an MLScorer with all built-in stub models registered.
 */
export function createDefaultMLScorer(): MLScorer {
  const models = new Map<string, MLModel>();

  const propensity = new PropensityToPayModel();
  const churn = new ChurnRiskModel();
  const responsiveness = new ContactResponsivenessModel();

  models.set(propensity.name, propensity);
  models.set(churn.name, churn);
  models.set(responsiveness.name, responsiveness);

  return new MLScorer(models);
}
