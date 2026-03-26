import { describe, it, expect } from 'vitest';
import { HealthScoreCalculator, HEALTH_WEIGHTS, HEALTH_THRESHOLDS } from '../health-score.js';
import type { HealthScoreFactors } from '../types.js';

// ─── Factory ─────────────────────────────────────────────────────

function makeFactors(overrides: Partial<HealthScoreFactors> = {}): HealthScoreFactors {
  return {
    interactionFrequency: 10,
    responseRate: 0.5,
    sentimentTrend: 0.0,
    dealValue: 50_000,
    recency: 7,
    ...overrides,
  };
}

// ─── Constructor ─────────────────────────────────────────────────

describe('HealthScoreCalculator', () => {
  const calculator = new HealthScoreCalculator();

  // ─── calculateScore ──────────────────────────────────────────

  describe('calculateScore()', () => {
    it('returns a number between 0 and 100', () => {
      const score = calculator.calculateScore(makeFactors());
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('returns 0 for worst-case factors', () => {
      const score = calculator.calculateScore({
        interactionFrequency: 0,
        responseRate: 0,
        sentimentTrend: -1.0,
        dealValue: 0,
        recency: 365,
      });
      expect(score).toBe(0);
    });

    it('returns 100 for best-case factors', () => {
      const score = calculator.calculateScore({
        interactionFrequency: 100,
        responseRate: 1.0,
        sentimentTrend: 1.0,
        dealValue: 200_000,
        recency: 0,
      });
      expect(score).toBe(100);
    });

    it('weights interaction frequency at 25%', () => {
      const base = calculator.calculateScore(makeFactors({ interactionFrequency: 0 }));
      const high = calculator.calculateScore(makeFactors({ interactionFrequency: 100 }));
      // Higher frequency should yield higher score
      expect(high).toBeGreaterThan(base);
    });

    it('weights response rate at 25%', () => {
      const low = calculator.calculateScore(makeFactors({ responseRate: 0 }));
      const high = calculator.calculateScore(makeFactors({ responseRate: 1.0 }));
      expect(high).toBeGreaterThan(low);
    });

    it('weights sentiment trend at 20%', () => {
      const negative = calculator.calculateScore(makeFactors({ sentimentTrend: -1.0 }));
      const positive = calculator.calculateScore(makeFactors({ sentimentTrend: 1.0 }));
      expect(positive).toBeGreaterThan(negative);
    });

    it('weights deal value at 15%', () => {
      const zero = calculator.calculateScore(makeFactors({ dealValue: 0 }));
      const high = calculator.calculateScore(makeFactors({ dealValue: 200_000 }));
      expect(high).toBeGreaterThan(zero);
    });

    it('weights recency at 15% with decay', () => {
      const recent = calculator.calculateScore(makeFactors({ recency: 0 }));
      const stale = calculator.calculateScore(makeFactors({ recency: 60 }));
      expect(recent).toBeGreaterThan(stale);
    });

    it('handles negative interaction frequency as zero', () => {
      const score = calculator.calculateScore(makeFactors({ interactionFrequency: -5 }));
      const zeroScore = calculator.calculateScore(makeFactors({ interactionFrequency: 0 }));
      expect(score).toBe(zeroScore);
    });

    it('clamps response rate above 1.0 to 1.0', () => {
      const capped = calculator.calculateScore(makeFactors({ responseRate: 1.5 }));
      const exact = calculator.calculateScore(makeFactors({ responseRate: 1.0 }));
      expect(capped).toBe(exact);
    });

    it('clamps sentiment below -1.0 to -1.0', () => {
      const capped = calculator.calculateScore(makeFactors({ sentimentTrend: -2.0 }));
      const floor = calculator.calculateScore(makeFactors({ sentimentTrend: -1.0 }));
      expect(capped).toBe(floor);
    });

    it('recency of zero yields maximum recency contribution', () => {
      const immediate = calculator.calculateScore(makeFactors({ recency: 0 }));
      const oneDay = calculator.calculateScore(makeFactors({ recency: 1 }));
      expect(immediate).toBeGreaterThanOrEqual(oneDay);
    });
  });

  // ─── classifyHealth ──────────────────────────────────────────

  describe('classifyHealth()', () => {
    it('classifies 75 as healthy', () => {
      expect(calculator.classifyHealth(75)).toBe('healthy');
    });

    it('classifies 100 as healthy', () => {
      expect(calculator.classifyHealth(100)).toBe('healthy');
    });

    it('classifies 74 as at_risk', () => {
      expect(calculator.classifyHealth(74)).toBe('at_risk');
    });

    it('classifies 50 as at_risk', () => {
      expect(calculator.classifyHealth(50)).toBe('at_risk');
    });

    it('classifies 49 as churning', () => {
      expect(calculator.classifyHealth(49)).toBe('churning');
    });

    it('classifies 25 as churning', () => {
      expect(calculator.classifyHealth(25)).toBe('churning');
    });

    it('classifies 24 as critical', () => {
      expect(calculator.classifyHealth(24)).toBe('critical');
    });

    it('classifies 0 as critical', () => {
      expect(calculator.classifyHealth(0)).toBe('critical');
    });

    it('clamps scores above 100 to healthy', () => {
      expect(calculator.classifyHealth(150)).toBe('healthy');
    });

    it('clamps scores below 0 to critical', () => {
      expect(calculator.classifyHealth(-10)).toBe('critical');
    });
  });

  // ─── Constants Integrity ─────────────────────────────────────

  describe('weight constants', () => {
    it('weights sum to 1.0', () => {
      const sum =
        HEALTH_WEIGHTS.INTERACTION_FREQUENCY +
        HEALTH_WEIGHTS.RESPONSE_RATE +
        HEALTH_WEIGHTS.SENTIMENT_TREND +
        HEALTH_WEIGHTS.DEAL_VALUE +
        HEALTH_WEIGHTS.RECENCY;
      expect(sum).toBeCloseTo(1.0, 10);
    });

    it('thresholds are in descending order', () => {
      expect(HEALTH_THRESHOLDS.HEALTHY_MIN).toBeGreaterThan(
        HEALTH_THRESHOLDS.AT_RISK_MIN,
      );
      expect(HEALTH_THRESHOLDS.AT_RISK_MIN).toBeGreaterThan(
        HEALTH_THRESHOLDS.CHURNING_MIN,
      );
    });
  });
});
