/**
 * @ordr/decision-engine — ML Scorer Tests (Layer 2)
 *
 * Tests feature assembly, propensity-to-pay stub, churn-risk stub,
 * contact-responsiveness stub, model not found, and score boundaries.
 */

import { describe, it, expect } from 'vitest';
import {
  MLScorer,
  PropensityToPayModel,
  ChurnRiskModel,
  ContactResponsivenessModel,
  createDefaultMLScorer,
} from '../ml-scorer.js';
import { assembleFeatures } from '../feature-assembler.js';
import type { DecisionContext, MLModel, MLFeatureVector } from '../types.js';

// ─── Test Helpers ────────────────────────────────────────────────

function createTestContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    eventType: 'payment_overdue',
    eventPayload: {},
    customerProfile: {
      healthScore: 70,
      lifecycleStage: 'active',
      segment: 'mid-market',
      ltv: 25000,
      sentimentAvg: 0.4,
      responseRate: 0.7,
      preferredChannel: 'sms',
      outstandingBalance: 3000,
      maxBalance: 10000,
      daysSinceLastContact: 5,
      totalInteractions30d: 8,
      paymentHistory: [
        { date: new Date('2025-01-15'), amount: 1000, onTime: true },
        { date: new Date('2025-02-15'), amount: 1000, onTime: true },
        { date: new Date('2025-03-15'), amount: 1000, onTime: false },
      ],
    },
    channelPreferences: ['sms', 'email'],
    interactionHistory: [
      {
        id: 'int-1',
        channel: 'sms',
        direction: 'outbound',
        timestamp: new Date('2025-06-10T14:00:00Z'),
        outcome: 'delivered',
        sentiment: 0.5,
        responded: true,
      },
    ],
    constraints: {
      budgetCents: undefined,
      timeWindowMinutes: undefined,
      blockedChannels: [],
      maxContactsPerWeek: 3,
      maxSmsPerDay: 1,
      maxEmailsPerWeek: 5,
    },
    timestamp: new Date('2025-06-15T14:00:00Z'),
    correlationId: 'corr-1',
    ...overrides,
  };
}

// ─── Feature Assembly ────────────────────────────────────────────

describe('assembleFeatures', () => {
  it('should produce all expected feature keys', () => {
    const ctx = createTestContext();
    const features = assembleFeatures(ctx);

    expect(features).toHaveProperty('days_since_last_contact');
    expect(features).toHaveProperty('total_interactions_30d');
    expect(features).toHaveProperty('response_rate');
    expect(features).toHaveProperty('health_score');
    expect(features).toHaveProperty('sentiment_avg');
    expect(features).toHaveProperty('outstanding_balance_normalized');
    expect(features).toHaveProperty('lifecycle_stage_ordinal');
    expect(features).toHaveProperty('preferred_channel_match');
    expect(features).toHaveProperty('time_of_day_score');
    expect(features).toHaveProperty('day_of_week_score');
    expect(features).toHaveProperty('interaction_recency_score');
    expect(features).toHaveProperty('payment_consistency_score');
  });

  it('should normalize outstanding balance to 0-1', () => {
    const ctx = createTestContext();
    const features = assembleFeatures(ctx);
    expect(features['outstanding_balance_normalized']).toBeGreaterThanOrEqual(0);
    expect(features['outstanding_balance_normalized']).toBeLessThanOrEqual(1);
  });

  it('should return 0 for zero balance', () => {
    const ctx = createTestContext({
      customerProfile: {
        ...createTestContext().customerProfile,
        outstandingBalance: 0,
        maxBalance: 10000,
      },
    });
    const features = assembleFeatures(ctx);
    expect(features['outstanding_balance_normalized']).toBe(0);
  });

  it('should return 0 for zero max balance', () => {
    const ctx = createTestContext({
      customerProfile: {
        ...createTestContext().customerProfile,
        outstandingBalance: 5000,
        maxBalance: 0,
      },
    });
    const features = assembleFeatures(ctx);
    expect(features['outstanding_balance_normalized']).toBe(0);
  });

  it('should clamp response rate to 0-1', () => {
    const ctx = createTestContext({
      customerProfile: {
        ...createTestContext().customerProfile,
        responseRate: 1.5,
      },
    });
    const features = assembleFeatures(ctx);
    expect(features['response_rate']).toBe(1);
  });

  it('should map lifecycle stage to ordinal', () => {
    const stages = ['prospect', 'onboarding', 'active', 'at_risk', 'churned'] as const;
    for (let i = 0; i < stages.length; i++) {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          lifecycleStage: stages[i]!,
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['lifecycle_stage_ordinal']).toBe(i + 1);
    }
  });

  it('should return 1 when preferred channel matches', () => {
    const ctx = createTestContext(); // preferredChannel = 'sms', channelPreferences includes 'sms'
    const features = assembleFeatures(ctx);
    expect(features['preferred_channel_match']).toBe(1);
  });

  it('should return 0 when preferred channel does not match', () => {
    const ctx = createTestContext({
      channelPreferences: ['email', 'voice'],
    });
    const features = assembleFeatures(ctx);
    expect(features['preferred_channel_match']).toBe(0);
  });

  it('should handle empty payment history', () => {
    const ctx = createTestContext({
      customerProfile: {
        ...createTestContext().customerProfile,
        paymentHistory: [],
      },
    });
    const features = assembleFeatures(ctx);
    expect(features['payment_consistency_score']).toBe(0.5); // Neutral default
  });

  it('should handle empty interaction history', () => {
    const ctx = createTestContext({
      interactionHistory: [],
    });
    const features = assembleFeatures(ctx);
    expect(features['interaction_recency_score']).toBe(0);
  });
});

// ─── ML Scorer ───────────────────────────────────────────────────

describe('MLScorer', () => {
  it('should score with a registered model', async () => {
    const scorer = createDefaultMLScorer();
    const ctx = createTestContext();
    const result = await scorer.score(ctx, 'propensity_to_pay');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modelName).toBe('propensity_to_pay');
      expect(result.data.score).toBeGreaterThanOrEqual(0);
      expect(result.data.score).toBeLessThanOrEqual(1);
      expect(result.data.confidence).toBeGreaterThanOrEqual(0);
      expect(result.data.confidence).toBeLessThanOrEqual(1);
      expect(result.data.featuresUsed.length).toBeGreaterThan(0);
    }
  });

  it('should return NotFound for unknown model', async () => {
    const scorer = createDefaultMLScorer();
    const ctx = createTestContext();
    const result = await scorer.score(ctx, 'nonexistent_model');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('should score all models', async () => {
    const scorer = createDefaultMLScorer();
    const ctx = createTestContext();
    const result = await scorer.scoreAll(ctx);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(3);
      const names = result.data.map((p) => p.modelName);
      expect(names).toContain('propensity_to_pay');
      expect(names).toContain('churn_risk');
      expect(names).toContain('contact_responsiveness');
    }
  });

  it('should list registered model names', () => {
    const scorer = createDefaultMLScorer();
    const names = scorer.getModelNames();
    expect(names).toContain('propensity_to_pay');
    expect(names).toContain('churn_risk');
    expect(names).toContain('contact_responsiveness');
  });

  it('should check model existence', () => {
    const scorer = createDefaultMLScorer();
    expect(scorer.hasModel('propensity_to_pay')).toBe(true);
    expect(scorer.hasModel('nonexistent')).toBe(false);
  });

  it('should handle model prediction errors gracefully', async () => {
    const failingModel: MLModel = {
      name: 'failing_model',
      version: '1.0.0',
      async predict(_features: MLFeatureVector): Promise<number> {
        throw new Error('Model crashed');
      },
    };

    const models = new Map<string, MLModel>();
    models.set('failing_model', failingModel);
    const scorer = new MLScorer(models);

    const ctx = createTestContext();
    const result = await scorer.score(ctx, 'failing_model');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });
});

// ─── Individual Stub Models ──────────────────────────────────────

describe('PropensityToPayModel', () => {
  const model = new PropensityToPayModel();

  it('should return score between 0 and 1', async () => {
    const score = await model.predict({
      health_score: 80,
      payment_consistency_score: 0.9,
      interaction_recency_score: 0.5,
      outstanding_balance_normalized: 0.3,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should return high score for healthy, consistent payer', async () => {
    const score = await model.predict({
      health_score: 95,
      payment_consistency_score: 1.0,
      interaction_recency_score: 0.9,
      outstanding_balance_normalized: 0.1,
    });
    expect(score).toBeGreaterThan(0.7);
  });

  it('should return low score for unhealthy, inconsistent payer', async () => {
    const score = await model.predict({
      health_score: 10,
      payment_consistency_score: 0.1,
      interaction_recency_score: 0.0,
      outstanding_balance_normalized: 0.95,
    });
    expect(score).toBeLessThan(0.3);
  });
});

describe('ChurnRiskModel', () => {
  const model = new ChurnRiskModel();

  it('should return score between 0 and 1', async () => {
    const score = await model.predict({
      health_score: 50,
      total_interactions_30d: 5,
      sentiment_avg: 0,
      lifecycle_stage_ordinal: 3,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should return high churn risk for at-risk customer', async () => {
    const score = await model.predict({
      health_score: 15,
      total_interactions_30d: 0,
      sentiment_avg: -0.8,
      lifecycle_stage_ordinal: 4,
    });
    expect(score).toBeGreaterThan(0.6);
  });

  it('should return low churn risk for healthy engaged customer', async () => {
    const score = await model.predict({
      health_score: 90,
      total_interactions_30d: 15,
      sentiment_avg: 0.8,
      lifecycle_stage_ordinal: 2,
    });
    expect(score).toBeLessThan(0.3);
  });
});

describe('ContactResponsivenessModel', () => {
  const model = new ContactResponsivenessModel();

  it('should return score between 0 and 1', async () => {
    const score = await model.predict({
      response_rate: 0.5,
      preferred_channel_match: 1,
      time_of_day_score: 0.8,
      day_of_week_score: 0.9,
      interaction_recency_score: 0.5,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should return high score for responsive customer at optimal time', async () => {
    const score = await model.predict({
      response_rate: 0.95,
      preferred_channel_match: 1,
      time_of_day_score: 1.0,
      day_of_week_score: 1.0,
      interaction_recency_score: 0.9,
    });
    expect(score).toBeGreaterThan(0.8);
  });

  it('should return low score for non-responsive customer', async () => {
    const score = await model.predict({
      response_rate: 0.05,
      preferred_channel_match: 0,
      time_of_day_score: 0.1,
      day_of_week_score: 0.2,
      interaction_recency_score: 0.0,
    });
    expect(score).toBeLessThan(0.2);
  });
});
