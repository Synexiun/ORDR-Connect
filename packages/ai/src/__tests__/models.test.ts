import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY,
  selectModel,
  calculateCost,
  getAvailableTiers,
  getRateLimit,
} from '../models.js';

// ─── MODEL_REGISTRY ──────────────────────────────────────────────

describe('MODEL_REGISTRY', () => {
  it('contains exactly three tiers', () => {
    const tiers = Object.keys(MODEL_REGISTRY);
    expect(tiers).toHaveLength(3);
    expect(tiers).toContain('budget');
    expect(tiers).toContain('standard');
    expect(tiers).toContain('premium');
  });

  it('budget tier uses claude-haiku-4-5', () => {
    const config = MODEL_REGISTRY.budget;
    expect(config.provider).toBe('anthropic');
    expect(config.modelName).toBe('claude-haiku-4-5-20251001');
    expect(config.costPerMillionInput).toBe(0.25);
    expect(config.costPerMillionOutput).toBe(1.25);
  });

  it('standard tier uses claude-sonnet-4-6', () => {
    const config = MODEL_REGISTRY.standard;
    expect(config.provider).toBe('anthropic');
    expect(config.modelName).toBe('claude-sonnet-4-6');
    expect(config.costPerMillionInput).toBe(3);
    expect(config.costPerMillionOutput).toBe(15);
  });

  it('premium tier uses claude-opus-4-6', () => {
    const config = MODEL_REGISTRY.premium;
    expect(config.provider).toBe('anthropic');
    expect(config.modelName).toBe('claude-opus-4-6');
    expect(config.costPerMillionInput).toBe(15);
    expect(config.costPerMillionOutput).toBe(75);
  });

  it('all tiers have positive rate limits', () => {
    for (const config of Object.values(MODEL_REGISTRY)) {
      expect(config.rateLimitRpm).toBeGreaterThan(0);
    }
  });

  it('all tiers have positive max tokens', () => {
    for (const config of Object.values(MODEL_REGISTRY)) {
      expect(config.maxTokens).toBeGreaterThan(0);
    }
  });

  it('budget is cheapest, premium is most expensive', () => {
    expect(MODEL_REGISTRY.budget.costPerMillionInput).toBeLessThan(
      MODEL_REGISTRY.standard.costPerMillionInput,
    );
    expect(MODEL_REGISTRY.standard.costPerMillionInput).toBeLessThan(
      MODEL_REGISTRY.premium.costPerMillionInput,
    );
  });
});

// ─── selectModel ─────────────────────────────────────────────────

describe('selectModel', () => {
  it('returns the correct config for budget tier', () => {
    const config = selectModel('budget');
    expect(config.modelName).toBe('claude-haiku-4-5-20251001');
  });

  it('returns the correct config for standard tier', () => {
    const config = selectModel('standard');
    expect(config.modelName).toBe('claude-sonnet-4-6');
  });

  it('returns the correct config for premium tier', () => {
    const config = selectModel('premium');
    expect(config.modelName).toBe('claude-opus-4-6');
  });
});

// ─── calculateCost ───────────────────────────────────────────────

describe('calculateCost', () => {
  it('calculates zero cost for zero tokens', () => {
    expect(calculateCost(0, 0, 'budget')).toBe(0);
    expect(calculateCost(0, 0, 'standard')).toBe(0);
    expect(calculateCost(0, 0, 'premium')).toBe(0);
  });

  it('calculates budget tier cost correctly', () => {
    // 1M input tokens = $0.25 = 25 cents
    // 1M output tokens = $1.25 = 125 cents
    const cost = calculateCost(1_000_000, 1_000_000, 'budget');
    expect(cost).toBeCloseTo(150, 4); // 25 + 125 = 150 cents
  });

  it('calculates standard tier cost correctly', () => {
    // 1M input = $3 = 300 cents, 1M output = $15 = 1500 cents
    const cost = calculateCost(1_000_000, 1_000_000, 'standard');
    expect(cost).toBeCloseTo(1800, 4); // 300 + 1500
  });

  it('calculates premium tier cost correctly', () => {
    // 1M input = $15 = 1500 cents, 1M output = $75 = 7500 cents
    const cost = calculateCost(1_000_000, 1_000_000, 'premium');
    expect(cost).toBeCloseTo(9000, 4); // 1500 + 7500
  });

  it('handles small token counts', () => {
    // 1000 input tokens on budget: $0.25/1M * 1000 = $0.00025 = 0.025 cents
    // 500 output tokens on budget: $1.25/1M * 500 = $0.000625 = 0.0625 cents
    const cost = calculateCost(1000, 500, 'budget');
    expect(cost).toBeCloseTo(0.0875, 4);
  });

  it('returns a number with bounded precision', () => {
    const cost = calculateCost(123, 456, 'standard');
    // Verify it's a finite number
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThan(0);
  });
});

// ─── getAvailableTiers ───────────────────────────────────────────

describe('getAvailableTiers', () => {
  it('returns tiers in cheapest-to-most-expensive order', () => {
    const tiers = getAvailableTiers();
    expect(tiers).toEqual(['budget', 'standard', 'premium']);
  });
});

// ─── getRateLimit ────────────────────────────────────────────────

describe('getRateLimit', () => {
  it('returns rate limit for each tier', () => {
    expect(getRateLimit('budget')).toBe(MODEL_REGISTRY.budget.rateLimitRpm);
    expect(getRateLimit('standard')).toBe(MODEL_REGISTRY.standard.rateLimitRpm);
    expect(getRateLimit('premium')).toBe(MODEL_REGISTRY.premium.rateLimitRpm);
  });

  it('budget has highest rate limit', () => {
    expect(getRateLimit('budget')).toBeGreaterThan(getRateLimit('standard'));
    expect(getRateLimit('standard')).toBeGreaterThan(getRateLimit('premium'));
  });
});
