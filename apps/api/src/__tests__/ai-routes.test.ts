/**
 * AI Routes tests — sentiment analysis, agent insights, entity routing
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, role-checked.
 * SOC2 CC7.2 — AI monitoring: sentiment anomaly detection.
 * HIPAA §164.312 — No PHI in request/response bodies; tokenized IDs only.
 *
 * Verifies:
 * - POST /sentiment (valid texts array) → 200 with results, modelUsed, costCents
 * - POST /sentiment (empty texts) → 400 validation error
 * - POST /insights (valid body) → 200 with insight, recommendedAction, confidence
 * - POST /insights (invalid context enum) → 400 validation error
 * - POST /route (valid body) → 200 with selectedRoute, confidence, reasoning
 * - POST /route (empty availableRoutes) → 400 validation error
 * - Auth: unauthenticated request → 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { aiRouter, configureAiRoutes } from '../routes/ai.js';
import { configureAuth } from '../middleware/auth.js';
import { configureBillingGate } from '../middleware/plan-gate.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { SubscriptionManager, InMemorySubscriptionStore, MockStripeClient } from '@ordr/billing';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { FieldEncryptor } from '@ordr/crypto';

// ─── Mock @ordr/auth ─────────────────────────────────────────────

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    },
  }),
  requireRole: vi.fn(),
  requirePermission: vi.fn(),
  requireTenant: vi.fn(),
  ROLE_HIERARCHY: {},
  ROLE_PERMISSIONS: {},
  hasRole: vi.fn().mockReturnValue(true),
  hasPermission: vi.fn().mockReturnValue(true),
}));

// ─── Mock @ordr/ai ───────────────────────────────────────────────

vi.mock('@ordr/ai', () => ({
  SentimentAnalyzer: vi.fn().mockImplementation(() => ({
    analyzeBatch: vi.fn().mockResolvedValue({
      success: true,
      data: [
        { text: 'Great service!', label: 'positive', score: 0.92 },
        { text: 'Average experience', label: 'neutral', score: 0.55 },
      ],
    }),
  })),
  LlmSentimentBackend: vi.fn().mockImplementation(() => ({})),
}));

// ─── Mock LLM Client ─────────────────────────────────────────────

const MOCK_INSIGHT_CONTENT = JSON.stringify({
  insight: 'Customer shows signs of churn risk based on low engagement',
  recommendedAction: 'Schedule proactive outreach within 48 hours',
  confidence: 0.82,
});

const MOCK_ROUTE_CONTENT = JSON.stringify({
  selectedRoute: 'support-tier-1',
  confidence: 0.91,
  reasoning: 'Entity matches support escalation criteria',
});

function createMockLlmClient() {
  return {
    complete: vi.fn().mockResolvedValue({
      success: true,
      data: {
        content: MOCK_INSIGHT_CONTENT,
        tokenUsage: { total: 150, input: 100, output: 50 },
        modelId: 'claude-sonnet-4-6',
      },
    }),
  };
}

// ─── Test Fixtures ───────────────────────────────────────────────

// Tokenized UUIDs — no real customer identifiers (HIPAA §164.312)
const CUSTOMER_TOKEN = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const SESSION_TOKEN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const ENTITY_TOKEN = 'b1b3b0b3-7425-40de-944b-e07fc1f90ae7';

// ─── Setup Helpers ───────────────────────────────────────────────

async function setupBillingGate(): Promise<void> {
  const subStore = new InMemorySubscriptionStore();
  await subStore.saveSubscription({
    id: 'sub-test',
    tenant_id: 'tenant-1',
    stripe_subscription_id: 'stripe-test',
    plan_tier: 'professional',
    status: 'active',
    current_period_start: new Date('2026-01-01'),
    current_period_end: new Date('2027-01-01'),
    cancel_at_period_end: false,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  });
  configureBillingGate(
    new SubscriptionManager({
      store: subStore,
      stripe: new MockStripeClient(),
      auditLogger: new AuditLogger(new InMemoryAuditStore()),
      fieldEncryptor: new FieldEncryptor(Buffer.from('test-key-32-bytes-for-unit-tests!')),
    }),
  );
}

function createTestApp(withTenantContext = true): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  if (withTenantContext) {
    app.use('*', async (c, next) => {
      c.set('tenantContext', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        roles: ['tenant_admin'],
        permissions: [],
      });
      await next();
    });
  }

  app.route('/api/v1/ai', aiRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('AI Routes', () => {
  let mockLlmClient: ReturnType<typeof createMockLlmClient>;

  beforeEach(async () => {
    configureAuth({
      publicKey: 'test-public-key',
      privateKey: 'test-private-key',
      issuer: 'test-issuer',
      audience: 'test-audience',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockLlmClient = createMockLlmClient();
    configureAiRoutes({ llmClient: mockLlmClient as never });
    await setupBillingGate();
  });

  // ─── POST /sentiment ─────────────────────────────────────────

  describe('POST /api/v1/ai/sentiment', () => {
    it('returns 200 with results, modelUsed, and costCents', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/ai/sentiment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({ texts: ['Great service!', 'Average experience'] }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { results: unknown[]; modelUsed: string; costCents: number };
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.results)).toBe(true);
      expect(body.data.results.length).toBeGreaterThan(0);
      expect(typeof body.data.modelUsed).toBe('string');
      expect(typeof body.data.costCents).toBe('number');
    });

    it('passes texts to SentimentAnalyzer.analyzeBatch', async () => {
      const { SentimentAnalyzer } = await import('@ordr/ai');
      const mockAnalyzer = {
        analyzeBatch: vi.fn().mockResolvedValue({
          success: true,
          data: [{ text: 'Hello', label: 'neutral', score: 0.5 }],
        }),
      };
      vi.mocked(SentimentAnalyzer).mockImplementationOnce(() => mockAnalyzer as never);

      const app = createTestApp();
      await app.request('/api/v1/ai/sentiment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({ texts: ['Hello'] }),
      });

      expect(mockAnalyzer.analyzeBatch).toHaveBeenCalledWith(['Hello']);
    });

    it('returns 400 when texts array is empty', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/ai/sentiment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({ texts: [] }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('returns 400 when texts field is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/ai/sentiment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/ai/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: ['Hello'] }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── POST /insights ───────────────────────────────────────────

  describe('POST /api/v1/ai/insights', () => {
    it('returns 200 with insight, recommendedAction, confidence, modelUsed, costCents', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/ai/insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          customerId: CUSTOMER_TOKEN,
          sessionId: SESSION_TOKEN,
          context: 'churn_risk',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          insight: string;
          recommendedAction: string;
          confidence: number;
          modelUsed: string;
          costCents: number;
        };
      };
      expect(body.success).toBe(true);
      expect(typeof body.data.insight).toBe('string');
      expect(typeof body.data.recommendedAction).toBe('string');
      expect(typeof body.data.confidence).toBe('number');
      expect(body.data.confidence).toBeGreaterThanOrEqual(0);
      expect(body.data.confidence).toBeLessThanOrEqual(1);
      expect(typeof body.data.modelUsed).toBe('string');
      expect(typeof body.data.costCents).toBe('number');
    });

    it('calls llmClient.complete with modelTier: standard', async () => {
      const app = createTestApp();
      await app.request('/api/v1/ai/insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          customerId: CUSTOMER_TOKEN,
          sessionId: SESSION_TOKEN,
          context: 'support',
        }),
      });

      expect(mockLlmClient.complete).toHaveBeenCalledWith(
        expect.objectContaining({ modelTier: 'standard' }),
      );
    });

    it('returns 400 on invalid context enum value', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/ai/insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          customerId: CUSTOMER_TOKEN,
          sessionId: SESSION_TOKEN,
          context: 'invalid_context_value',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when customerId is not a UUID', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/ai/insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          customerId: 'not-a-uuid',
          sessionId: SESSION_TOKEN,
          context: 'upsell',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('accepts all valid context enum values', async () => {
      const validContexts = ['churn_risk', 'upsell', 'support', 'healthcare'] as const;

      for (const context of validContexts) {
        mockLlmClient.complete.mockResolvedValueOnce({
          success: true,
          data: {
            content: MOCK_INSIGHT_CONTENT,
            tokenUsage: { total: 100, input: 70, output: 30 },
          },
        });

        const app = createTestApp();
        const res = await app.request('/api/v1/ai/insights', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer mock-token',
          },
          body: JSON.stringify({
            customerId: CUSTOMER_TOKEN,
            sessionId: SESSION_TOKEN,
            context,
          }),
        });

        expect(res.status).toBe(200);
      }
    });
  });

  // ─── POST /route ──────────────────────────────────────────────

  describe('POST /api/v1/ai/route', () => {
    it('returns 200 with selectedRoute, confidence, reasoning, modelUsed', async () => {
      mockLlmClient.complete.mockResolvedValueOnce({
        success: true,
        data: {
          content: MOCK_ROUTE_CONTENT,
          tokenUsage: { total: 80, input: 50, output: 30 },
        },
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/ai/route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          entityId: ENTITY_TOKEN,
          entityType: 'customer',
          availableRoutes: ['support-tier-1', 'support-tier-2', 'escalate'],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          selectedRoute: string;
          confidence: number;
          reasoning: string;
          modelUsed: string;
        };
      };
      expect(body.success).toBe(true);
      expect(typeof body.data.selectedRoute).toBe('string');
      expect(typeof body.data.confidence).toBe('number');
      expect(body.data.confidence).toBeGreaterThanOrEqual(0);
      expect(body.data.confidence).toBeLessThanOrEqual(1);
      expect(typeof body.data.reasoning).toBe('string');
      expect(typeof body.data.modelUsed).toBe('string');
    });

    it('returns a selectedRoute that is one of the availableRoutes', async () => {
      const availableRoutes = ['support-tier-1', 'support-tier-2', 'escalate'];

      mockLlmClient.complete.mockResolvedValueOnce({
        success: true,
        data: {
          content: JSON.stringify({
            selectedRoute: 'support-tier-1',
            confidence: 0.91,
            reasoning: 'Best match for the entity type',
          }),
          tokenUsage: { total: 80, input: 50, output: 30 },
        },
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/ai/route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          entityId: ENTITY_TOKEN,
          entityType: 'customer',
          availableRoutes,
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { selectedRoute: string } };
      expect(availableRoutes).toContain(body.data.selectedRoute);
    });

    it('returns 400 when availableRoutes is empty', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/ai/route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          entityId: ENTITY_TOKEN,
          entityType: 'customer',
          availableRoutes: [],
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 on invalid entityType enum', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/ai/route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({
          entityId: ENTITY_TOKEN,
          entityType: 'unknown_type',
          availableRoutes: ['route-a'],
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/ai/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: ENTITY_TOKEN,
          entityType: 'customer',
          availableRoutes: ['route-a'],
        }),
      });

      expect(res.status).toBe(401);
    });
  });
});
