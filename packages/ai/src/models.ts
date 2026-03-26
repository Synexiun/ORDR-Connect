/**
 * Model registry — multi-tier LLM routing for ORDR-Connect
 *
 * Maps model tiers to specific Anthropic models with precise
 * cost tracking for budget enforcement (CLAUDE.md Rule 9).
 *
 * Pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
 */

import type { ModelConfig, ModelTier } from './types.js';

// ─── Model Registry ──────────────────────────────────────────────

export const MODEL_REGISTRY: Readonly<Record<ModelTier, ModelConfig>> = {
  budget: {
    provider: 'anthropic',
    modelName: 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
    costPerMillionInput: 0.25,
    costPerMillionOutput: 1.25,
    rateLimitRpm: 4000,
  },
  standard: {
    provider: 'anthropic',
    modelName: 'claude-sonnet-4-5-20250514',
    maxTokens: 8192,
    costPerMillionInput: 3,
    costPerMillionOutput: 15,
    rateLimitRpm: 2000,
  },
  premium: {
    provider: 'anthropic',
    modelName: 'claude-opus-4-5-20250514',
    maxTokens: 4096,
    costPerMillionInput: 15,
    costPerMillionOutput: 75,
    rateLimitRpm: 1000,
  },
} as const;

// ─── Selection ───────────────────────────────────────────────────

/**
 * Returns the model configuration for the given tier.
 */
export function selectModel(tier: ModelTier): ModelConfig {
  return MODEL_REGISTRY[tier];
}

// ─── Cost Calculation ────────────────────────────────────────────

/**
 * Calculates request cost in cents with full precision.
 *
 * Formula: (inputTokens * costPerMInput / 1_000_000 + outputTokens * costPerMOutput / 1_000_000) * 100
 * The multiplication by 100 converts dollars to cents.
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  tier: ModelTier,
): number {
  const config = MODEL_REGISTRY[tier];
  const inputCostDollars = (inputTokens * config.costPerMillionInput) / 1_000_000;
  const outputCostDollars = (outputTokens * config.costPerMillionOutput) / 1_000_000;
  const totalCents = (inputCostDollars + outputCostDollars) * 100;
  // Round to 6 decimal places to avoid floating point noise
  return Math.round(totalCents * 1_000_000) / 1_000_000;
}

/**
 * Returns all available tiers in order from cheapest to most expensive.
 */
export function getAvailableTiers(): readonly ModelTier[] {
  return ['budget', 'standard', 'premium'] as const;
}

/**
 * Returns the rate limit (requests per minute) for a tier.
 */
export function getRateLimit(tier: ModelTier): number {
  return MODEL_REGISTRY[tier].rateLimitRpm;
}
