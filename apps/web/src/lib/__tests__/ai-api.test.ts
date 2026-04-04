/**
 * AI API Tests
 *
 * Validates:
 * - analyzeSentiment → POST /v1/ai/sentiment
 * - generateAgentInsight → POST /v1/ai/insights
 * - routeEntity → POST /v1/ai/route
 *
 * COMPLIANCE: HIPAA §164.312 — no PHI in test assertions.
 * All requests use sanitized tokens/IDs only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockPost = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: vi.fn(),
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { analyzeSentiment, generateAgentInsight, routeEntity } from '../ai-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_SENTIMENT_RESPONSE = {
  results: [{ score: 0.75, label: 'positive' as const, confidence: 0.91 }],
  modelUsed: 'claude-haiku-4-5',
  costCents: 1,
};

const MOCK_INSIGHT_RESPONSE = {
  insight: 'Customer shows high engagement',
  recommendedAction: 'schedule follow-up',
  confidence: 0.88,
  modelUsed: 'claude-sonnet-4-6',
  costCents: 5,
};

const MOCK_ROUTE_RESPONSE = {
  selectedRoute: 'collections',
  confidence: 0.92,
  reasoning: 'Overdue balance detected',
  modelUsed: 'claude-sonnet-4-6',
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPost.mockResolvedValue(MOCK_SENTIMENT_RESPONSE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('analyzeSentiment', () => {
  it('calls POST /v1/ai/sentiment with body', async () => {
    const body = { texts: ['token-a', 'token-b'] };
    await analyzeSentiment(body);
    expect(mockPost).toHaveBeenCalledWith('/v1/ai/sentiment', body);
  });

  it('returns sentiment results on success', async () => {
    const result = await analyzeSentiment({ texts: ['token-a'] });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.label).toBe('positive');
    expect(result.costCents).toBe(1);
  });

  it('passes multiple texts in the request', async () => {
    const texts = ['tok-1', 'tok-2', 'tok-3'];
    await analyzeSentiment({ texts });
    expect(mockPost).toHaveBeenCalledWith('/v1/ai/sentiment', { texts });
  });
});

describe('generateAgentInsight', () => {
  it('calls POST /v1/ai/insights with body', async () => {
    mockPost.mockResolvedValue(MOCK_INSIGHT_RESPONSE);
    const body = {
      customerId: 'cust-0001',
      sessionId: 'sess-test-1',
      context: 'churn_risk' as const,
    };
    await generateAgentInsight(body);
    expect(mockPost).toHaveBeenCalledWith('/v1/ai/insights', body);
  });

  it('returns insight and recommendedAction on success', async () => {
    mockPost.mockResolvedValue(MOCK_INSIGHT_RESPONSE);
    const result = await generateAgentInsight({
      customerId: 'cust-0001',
      sessionId: 'sess-1',
      context: 'support',
    });
    expect(result.insight).toBe('Customer shows high engagement');
    expect(result.recommendedAction).toBe('schedule follow-up');
    expect(result.confidence).toBe(0.88);
  });

  it('supports all InsightContext values', async () => {
    mockPost.mockResolvedValue(MOCK_INSIGHT_RESPONSE);
    const contexts = ['churn_risk', 'upsell', 'support', 'healthcare'] as const;
    for (const context of contexts) {
      await generateAgentInsight({ customerId: 'cust-1', sessionId: 'sess-1', context });
      expect(mockPost).toHaveBeenCalledWith(
        '/v1/ai/insights',
        expect.objectContaining({ context }),
      );
    }
  });
});

describe('routeEntity', () => {
  it('calls POST /v1/ai/route with body', async () => {
    mockPost.mockResolvedValue(MOCK_ROUTE_RESPONSE);
    const body = {
      entityId: 'entity-001',
      entityType: 'customer' as const,
      availableRoutes: ['collections', 'support'],
    };
    await routeEntity(body);
    expect(mockPost).toHaveBeenCalledWith('/v1/ai/route', body);
  });

  it('returns selectedRoute and confidence on success', async () => {
    mockPost.mockResolvedValue(MOCK_ROUTE_RESPONSE);
    const result = await routeEntity({
      entityId: 'entity-001',
      entityType: 'interaction',
      availableRoutes: ['collections', 'support'],
    });
    expect(result.selectedRoute).toBe('collections');
    expect(result.confidence).toBe(0.92);
  });

  it('supports all entityType values', async () => {
    mockPost.mockResolvedValue(MOCK_ROUTE_RESPONSE);
    const entityTypes = ['customer', 'interaction', 'session'] as const;
    for (const entityType of entityTypes) {
      await routeEntity({ entityId: 'e-1', entityType, availableRoutes: ['support'] });
      expect(mockPost).toHaveBeenCalledWith(
        '/v1/ai/route',
        expect.objectContaining({ entityType }),
      );
    }
  });
});
