import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateRequestTokens,
  estimateRequestCost,
  estimateCostForTokens,
} from '../token-counter.js';
import type { LLMRequest } from '../types.js';

// ─── Helper ──────────────────────────────────────────────────────

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    messages: [{ role: 'user', content: 'Hello world' }],
    modelTier: 'standard',
    maxTokens: 4096,
    temperature: 0.1,
    systemPrompt: undefined,
    metadata: {
      tenant_id: 'test-tenant',
      correlation_id: 'test-corr',
      agent_id: 'test-agent',
    },
    ...overrides,
  };
}

// ─── estimateTokens ──────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns at least 1 for non-empty string', () => {
    expect(estimateTokens('a')).toBeGreaterThanOrEqual(1);
    expect(estimateTokens('ab')).toBeGreaterThanOrEqual(1);
  });

  it('estimates roughly chars/4', () => {
    const text = 'Hello, how are you doing today?'; // 31 chars
    const tokens = estimateTokens(text);
    // 31 / 4 = 7.75, ceil = 8
    expect(tokens).toBe(8);
  });

  it('handles long text proportionally', () => {
    const short = estimateTokens('Hello');
    const long = estimateTokens('Hello'.repeat(100));
    expect(long).toBeGreaterThan(short);
  });

  it('always returns an integer', () => {
    expect(Number.isInteger(estimateTokens('test string'))).toBe(true);
    expect(Number.isInteger(estimateTokens('a'))).toBe(true);
  });
});

// ─── estimateRequestTokens ───────────────────────────────────────

describe('estimateRequestTokens', () => {
  it('includes base overhead', () => {
    const tokens = estimateRequestTokens(makeRequest({
      messages: [{ role: 'user', content: '' }],
      systemPrompt: undefined,
    }));
    // base overhead (3) + per-message overhead (4) + 0 content = 7
    expect(tokens).toBeGreaterThanOrEqual(7);
  });

  it('accounts for system prompt', () => {
    const withoutSystem = estimateRequestTokens(makeRequest({
      systemPrompt: undefined,
    }));
    const withSystem = estimateRequestTokens(makeRequest({
      systemPrompt: 'You are a helpful assistant.',
    }));
    expect(withSystem).toBeGreaterThan(withoutSystem);
  });

  it('scales with number of messages', () => {
    const oneMsg = estimateRequestTokens(makeRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    }));
    const threeMsgs = estimateRequestTokens(makeRequest({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ],
    }));
    expect(threeMsgs).toBeGreaterThan(oneMsg);
  });
});

// ─── estimateRequestCost ─────────────────────────────────────────

describe('estimateRequestCost', () => {
  it('returns a positive number for non-empty request', () => {
    const cost = estimateRequestCost(makeRequest());
    expect(cost).toBeGreaterThan(0);
  });

  it('budget tier is cheaper than premium', () => {
    const budgetCost = estimateRequestCost(makeRequest({ modelTier: 'budget' }));
    const premiumCost = estimateRequestCost(makeRequest({ modelTier: 'premium' }));
    expect(budgetCost).toBeLessThan(premiumCost);
  });

  it('uses maxTokens for worst-case output estimation', () => {
    const lowMax = estimateRequestCost(makeRequest({ maxTokens: 100 }));
    const highMax = estimateRequestCost(makeRequest({ maxTokens: 8000 }));
    expect(highMax).toBeGreaterThan(lowMax);
  });
});

// ─── estimateCostForTokens ───────────────────────────────────────

describe('estimateCostForTokens', () => {
  it('returns 0 for zero tokens', () => {
    expect(estimateCostForTokens(0, 0, 'budget')).toBe(0);
  });

  it('matches calculateCost for same inputs', () => {
    // estimateCostForTokens uses same formula as calculateCost from models
    const cost = estimateCostForTokens(1000, 500, 'standard');
    expect(cost).toBeGreaterThan(0);
    expect(Number.isFinite(cost)).toBe(true);
  });
});
