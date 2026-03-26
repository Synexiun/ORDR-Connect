/**
 * Token estimation — fast-path token counting for cost prediction
 *
 * Uses chars/4 heuristic for rapid estimation without loading
 * a full tokenizer. This is intentionally approximate — precise
 * counts come from the API response.
 *
 * Accuracy: ~90% for English text. For mixed content (code, JSON),
 * accuracy may drop to ~80%. Always use API-reported token counts
 * for billing reconciliation.
 */

import type { LLMRequest, ModelTier } from './types.js';
import { MODEL_REGISTRY } from './models.js';

// ─── Constants ───────────────────────────────────────────────────

/**
 * Average characters per token for Claude models.
 * Empirically measured at ~4 chars/token for English prose.
 * Code and structured data tend toward ~3.5 chars/token.
 */
const CHARS_PER_TOKEN = 4 as const;

/**
 * Overhead tokens added per request for message framing,
 * role tokens, and special delimiters.
 */
const PER_MESSAGE_OVERHEAD = 4 as const;

/**
 * Base overhead per request (conversation structure tokens).
 */
const REQUEST_BASE_OVERHEAD = 3 as const;

// ─── Token Estimation ────────────────────────────────────────────

/**
 * Estimate token count for a text string.
 *
 * Uses the chars/4 heuristic — fast and allocation-free.
 * Returns at minimum 1 token for non-empty strings.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/**
 * Estimate total input tokens for an LLM request.
 *
 * Accounts for:
 * - System prompt tokens
 * - Per-message content tokens
 * - Per-message overhead (role tokens, delimiters)
 * - Base request overhead
 */
export function estimateRequestTokens(request: LLMRequest): number {
  let total = REQUEST_BASE_OVERHEAD;

  // System prompt
  if (request.systemPrompt !== undefined) {
    total += estimateTokens(request.systemPrompt) + PER_MESSAGE_OVERHEAD;
  }

  // Messages
  for (const msg of request.messages) {
    total += estimateTokens(msg.content) + PER_MESSAGE_OVERHEAD;
  }

  return total;
}

/**
 * Estimate the cost in cents for a request before sending it.
 *
 * Assumes the response will use the full maxTokens allocation
 * for worst-case cost estimation. Use this for budget gating
 * before making the API call.
 */
export function estimateRequestCost(request: LLMRequest): number {
  const config = MODEL_REGISTRY[request.modelTier];
  const inputTokens = estimateRequestTokens(request);
  const outputTokens = request.maxTokens;

  const inputCostDollars = (inputTokens * config.costPerMillionInput) / 1_000_000;
  const outputCostDollars = (outputTokens * config.costPerMillionOutput) / 1_000_000;
  const totalCents = (inputCostDollars + outputCostDollars) * 100;

  return Math.round(totalCents * 1_000_000) / 1_000_000;
}

/**
 * Estimate cost for a specific model tier given token counts.
 * Useful for quick cost checks without building a full request.
 */
export function estimateCostForTokens(
  inputTokens: number,
  outputTokens: number,
  tier: ModelTier,
): number {
  const config = MODEL_REGISTRY[tier];
  const inputCostDollars = (inputTokens * config.costPerMillionInput) / 1_000_000;
  const outputCostDollars = (outputTokens * config.costPerMillionOutput) / 1_000_000;
  const totalCents = (inputCostDollars + outputCostDollars) * 100;
  return Math.round(totalCents * 1_000_000) / 1_000_000;
}
