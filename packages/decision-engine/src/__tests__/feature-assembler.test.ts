/**
 * @ordr/decision-engine — Feature Assembler Tests
 *
 * Tests all features, boundary values, and missing data handling.
 */

import { describe, it, expect } from 'vitest';
import { assembleFeatures } from '../feature-assembler.js';
import type { DecisionContext } from '../types.js';

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
        timestamp: new Date('2025-06-14T14:00:00Z'),
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

// ─── Tests ───────────────────────────────────────────────────────

describe('assembleFeatures', () => {
  it('should return all expected features', () => {
    const features = assembleFeatures(createTestContext());
    const keys = Object.keys(features);

    expect(keys).toContain('days_since_last_contact');
    expect(keys).toContain('total_interactions_30d');
    expect(keys).toContain('response_rate');
    expect(keys).toContain('health_score');
    expect(keys).toContain('sentiment_avg');
    expect(keys).toContain('outstanding_balance_normalized');
    expect(keys).toContain('lifecycle_stage_ordinal');
    expect(keys).toContain('preferred_channel_match');
    expect(keys).toContain('time_of_day_score');
    expect(keys).toContain('day_of_week_score');
    expect(keys).toContain('interaction_recency_score');
    expect(keys).toContain('payment_consistency_score');
    expect(keys).toHaveLength(12);
  });

  describe('days_since_last_contact', () => {
    it('should return the positive value', () => {
      const features = assembleFeatures(createTestContext());
      expect(features['days_since_last_contact']).toBe(5);
    });

    it('should clamp negative values to 0', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          daysSinceLastContact: -3,
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['days_since_last_contact']).toBe(0);
    });
  });

  describe('total_interactions_30d', () => {
    it('should return the count', () => {
      const features = assembleFeatures(createTestContext());
      expect(features['total_interactions_30d']).toBe(8);
    });

    it('should clamp negative to 0', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          totalInteractions30d: -2,
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['total_interactions_30d']).toBe(0);
    });
  });

  describe('response_rate', () => {
    it('should clamp to 0-1 range', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          responseRate: 1.5,
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['response_rate']).toBe(1);
    });

    it('should clamp negative to 0', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          responseRate: -0.5,
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['response_rate']).toBe(0);
    });
  });

  describe('health_score', () => {
    it('should clamp to 0-100', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          healthScore: 150,
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['health_score']).toBe(100);
    });
  });

  describe('sentiment_avg', () => {
    it('should clamp to -1 to 1', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          sentimentAvg: 2.5,
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['sentiment_avg']).toBe(1);
    });
  });

  describe('outstanding_balance_normalized', () => {
    it('should normalize to 0-1', () => {
      const features = assembleFeatures(createTestContext());
      expect(features['outstanding_balance_normalized']).toBe(0.3);
    });

    it('should cap at 1 when balance exceeds max', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          outstandingBalance: 15000,
          maxBalance: 10000,
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['outstanding_balance_normalized']).toBe(1);
    });
  });

  describe('payment_consistency_score', () => {
    it('should calculate ratio of on-time payments', () => {
      const features = assembleFeatures(createTestContext());
      // 2 out of 3 on time
      expect(features['payment_consistency_score']).toBeCloseTo(0.6667, 3);
    });

    it('should return 0.5 (neutral) for empty history', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          paymentHistory: [],
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['payment_consistency_score']).toBe(0.5);
    });

    it('should return 1.0 for all on-time payments', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          paymentHistory: [
            { date: new Date(), amount: 100, onTime: true },
            { date: new Date(), amount: 100, onTime: true },
          ],
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['payment_consistency_score']).toBe(1.0);
    });

    it('should return 0.0 for all late payments', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          paymentHistory: [
            { date: new Date(), amount: 100, onTime: false },
            { date: new Date(), amount: 100, onTime: false },
          ],
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['payment_consistency_score']).toBe(0);
    });
  });

  describe('interaction_recency_score', () => {
    it('should return high score for recent interaction', () => {
      // Interaction 24h ago should give a decent score
      const ctx = createTestContext({
        interactionHistory: [
          {
            id: 'int-1',
            channel: 'sms',
            direction: 'outbound',
            // 24 hours before context timestamp
            timestamp: new Date('2025-06-14T14:00:00Z'),
            outcome: 'delivered',
            sentiment: 0.5,
            responded: true,
          },
        ],
        timestamp: new Date('2025-06-15T14:00:00Z'),
      });
      const features = assembleFeatures(ctx);
      expect(features['interaction_recency_score']).toBeGreaterThan(0.5);
    });

    it('should return 0 for empty interaction history', () => {
      const ctx = createTestContext({ interactionHistory: [] });
      const features = assembleFeatures(ctx);
      expect(features['interaction_recency_score']).toBe(0);
    });
  });

  describe('time_of_day_score', () => {
    it('should return high score during peak hours (2 PM)', () => {
      const ctx = createTestContext({
        timestamp: new Date('2025-06-15T14:00:00'), // 2 PM
      });
      const features = assembleFeatures(ctx);
      expect(features['time_of_day_score']).toBeGreaterThan(0.5);
    });
  });

  describe('day_of_week_score', () => {
    it('should return high score for weekday', () => {
      // June 17, 2025 is a Tuesday
      const ctx = createTestContext({
        timestamp: new Date('2025-06-17T14:00:00'),
      });
      const features = assembleFeatures(ctx);
      expect(features['day_of_week_score']).toBeGreaterThanOrEqual(0.9);
    });

    it('should return low score for weekend', () => {
      // June 14, 2025 is a Saturday
      const ctx = createTestContext({
        timestamp: new Date('2025-06-14T14:00:00'),
      });
      const features = assembleFeatures(ctx);
      expect(features['day_of_week_score']).toBeLessThanOrEqual(0.3);
    });
  });

  describe('preferred_channel_match', () => {
    it('should return 1 when preferred channel is in preferences list', () => {
      const features = assembleFeatures(createTestContext());
      expect(features['preferred_channel_match']).toBe(1);
    });

    it('should return 0 when preferred channel is not in preferences', () => {
      const ctx = createTestContext({
        channelPreferences: ['email', 'voice'],
      });
      const features = assembleFeatures(ctx);
      expect(features['preferred_channel_match']).toBe(0);
    });

    it('should return 0 when no preferred channel', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          preferredChannel: undefined,
        },
      });
      const features = assembleFeatures(ctx);
      expect(features['preferred_channel_match']).toBe(0);
    });
  });
});
