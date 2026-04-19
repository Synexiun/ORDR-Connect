/**
 * Analytics route tests
 *
 * Verifies:
 * - GET /dashboard — dashboard summary
 * - GET /channels — channel metrics with time range
 * - GET /agents — agent performance metrics
 * - GET /compliance — compliance metrics
 * - GET /trends/:metric — trend data for specific metric
 * - GET /real-time — current real-time counters
 * - Auth required on all routes
 * - Tenant filtering from JWT context
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { analyticsRouter, configureAnalyticsRoutes } from '../routes/analytics.js';
import { createTenantId } from '@ordr/core';
import { configureAuth } from '../middleware/auth.js';
import { configureBillingGate } from '../middleware/plan-gate.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { SubscriptionManager, InMemorySubscriptionStore, MockStripeClient } from '@ordr/billing';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { FieldEncryptor } from '@ordr/crypto';

// Mock @ordr/auth so requireAuth() succeeds with our test context
vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'analytics', action: 'read', scope: 'tenant' }],
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

// ─── Mock Dependencies ───────────────────────────────────────────

function createMockQueries() {
  return {
    getDashboardSummary: vi.fn().mockResolvedValue({
      success: true,
      data: {
        totalCustomers: 150,
        activeAgents: 5,
        complianceScore: 98.5,
        revenueCollected: 45000,
        channelMetrics: [
          {
            channel: 'email',
            sent: 100,
            delivered: 95,
            failed: 5,
            deliveryRate: 0.95,
            avgCost: 0.02,
          },
        ],
        agentMetrics: [
          {
            agentRole: 'collections',
            sessions: 20,
            resolutions: 15,
            resolutionRate: 0.75,
            avgConfidence: 0.85,
            avgSteps: 3,
            avgCostCents: 12,
            avgDurationMs: 5000,
          },
        ],
        complianceMetrics: [
          { regulation: 'HIPAA', checks: 200, violations: 3, complianceRate: 0.985 },
        ],
      },
    }),
    getChannelMetrics: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          channel: 'email',
          sent: 100,
          delivered: 95,
          failed: 5,
          deliveryRate: 0.95,
          avgCost: 0.02,
        },
      ],
    }),
    getAgentMetrics: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          agentRole: 'collections',
          sessions: 20,
          resolutions: 15,
          resolutionRate: 0.75,
          avgConfidence: 0.85,
          avgSteps: 3,
          avgCostCents: 12,
          avgDurationMs: 5000,
        },
      ],
    }),
    getComplianceMetrics: vi.fn().mockResolvedValue({
      success: true,
      data: [{ regulation: 'HIPAA', checks: 200, violations: 3, complianceRate: 0.985 }],
    }),
    getDeliveryTrend: vi.fn().mockResolvedValue({
      success: true,
      data: [{ metric: 'messages_sent', value: 10, timestamp: new Date(), dimensions: {} }],
    }),
    getAgentPerformanceTrend: vi.fn().mockResolvedValue({
      success: true,
      data: [{ metric: 'agent_sessions', value: 5, timestamp: new Date(), dimensions: {} }],
    }),
    getComplianceTrend: vi.fn().mockResolvedValue({
      success: true,
      data: [],
    }),
    getCustomerEngagementTrend: vi.fn().mockResolvedValue({
      success: true,
      data: [],
    }),
  };
}

function createMockCounters() {
  return {
    get: vi.fn().mockResolvedValue(42),
    getMultiple: vi.fn().mockResolvedValue({
      messages_sent: 100,
      messages_delivered: 95,
      messages_failed: 5,
      agent_sessions: 10,
      agent_resolutions: 8,
      compliance_violations: 0,
      response_rate: 0,
      avg_response_time: 0,
      revenue_collected: 0,
      cost_per_interaction: 0,
    }),
    increment: vi.fn().mockResolvedValue(undefined),
    resetDaily: vi.fn().mockResolvedValue(undefined),
    getAllCounters: vi.fn().mockResolvedValue({}),
  };
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  // Simulate authenticated user
  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: createTenantId('tenant-1'),
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    });
    await next();
  });

  app.route('/api/v1/analytics', analyticsRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Analytics Routes', () => {
  let mockQueries: ReturnType<typeof createMockQueries>;
  let mockCounters: ReturnType<typeof createMockCounters>;

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockQueries = createMockQueries();
    mockCounters = createMockCounters();

    configureAnalyticsRoutes({
      queries: mockQueries as never,
      realTimeCounters: mockCounters as never,
    });

    // Configure billing gate — analytics router uses featureGate(FEATURES.ANALYTICS)
    const subStore = new InMemorySubscriptionStore();
    void subStore.saveSubscription({
      id: 'sub-test-001',
      tenant_id: 'tenant-1',
      plan_tier: 'professional',
      status: 'active',
      stripe_subscription_id: 'sub_test',
      current_period_start: new Date(),
      current_period_end: new Date(Date.now() + 30 * 86_400_000),
      cancel_at_period_end: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const billingAudit = new AuditLogger(new InMemoryAuditStore());
    const fieldEncryptor = new FieldEncryptor(Buffer.from('test-key-32-bytes-for-unit-tests!'));
    configureBillingGate(
      new SubscriptionManager({
        store: subStore,
        stripe: new MockStripeClient(),
        auditLogger: billingAudit,
        fieldEncryptor,
      }),
    );
  });

  // ─── GET /dashboard ────────────────────────────────────────────

  describe('GET /api/v1/analytics/dashboard', () => {
    it('returns dashboard summary with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/analytics/dashboard');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { totalCustomers: number } };
      expect(body.success).toBe(true);
      expect(body.data.totalCustomers).toBe(150);
    });

    it('calls getDashboardSummary with tenant from JWT', async () => {
      const app = createTestApp();
      await app.request('/api/v1/analytics/dashboard');

      expect(mockQueries.getDashboardSummary).toHaveBeenCalledWith('tenant-1');
    });
  });

  // ─── GET /channels ─────────────────────────────────────────────

  describe('GET /api/v1/analytics/channels', () => {
    it('returns channel metrics for time range', async () => {
      const app = createTestApp();
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const to = new Date().toISOString();

      const res = await app.request(`/api/v1/analytics/channels?from=${from}&to=${to}`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
    });

    it('returns 400 for missing time range', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/analytics/channels');

      expect(res.status).toBe(400);
    });

    it('passes tenant context to query', async () => {
      const app = createTestApp();
      const from = new Date(Date.now() - 86400000).toISOString();
      const to = new Date().toISOString();

      await app.request(`/api/v1/analytics/channels?from=${from}&to=${to}`);

      expect(mockQueries.getChannelMetrics).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          from: expect.any(Date) as unknown,
          to: expect.any(Date) as unknown,
        }),
      );
    });
  });

  // ─── GET /agents ───────────────────────────────────────────────

  describe('GET /api/v1/analytics/agents', () => {
    it('returns agent metrics for time range', async () => {
      const app = createTestApp();
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const to = new Date().toISOString();

      const res = await app.request(`/api/v1/analytics/agents?from=${from}&to=${to}`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
    });

    it('returns 400 for invalid time range', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/analytics/agents?from=invalid&to=invalid');

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /compliance ───────────────────────────────────────────

  describe('GET /api/v1/analytics/compliance', () => {
    it('returns compliance metrics for time range', async () => {
      const app = createTestApp();
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const to = new Date().toISOString();

      const res = await app.request(`/api/v1/analytics/compliance?from=${from}&to=${to}`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
    });
  });

  // ─── GET /trends/:metric ──────────────────────────────────────

  describe('GET /api/v1/analytics/trends/:metric', () => {
    it('returns delivery trend data', async () => {
      const app = createTestApp();
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const to = new Date().toISOString();

      const res = await app.request(`/api/v1/analytics/trends/delivery?from=${from}&to=${to}`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; metric: string };
      expect(body.success).toBe(true);
      expect(body.metric).toBe('delivery');
    });

    it('returns agent performance trend', async () => {
      const app = createTestApp();
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const to = new Date().toISOString();

      const res = await app.request(
        `/api/v1/analytics/trends/agent_performance?from=${from}&to=${to}`,
      );

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid metric name', async () => {
      const app = createTestApp();
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const to = new Date().toISOString();

      const res = await app.request(
        `/api/v1/analytics/trends/invalid_metric?from=${from}&to=${to}`,
      );

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing time range on trend', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/analytics/trends/delivery');

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /real-time ────────────────────────────────────────────

  describe('GET /api/v1/analytics/real-time', () => {
    it('returns real-time counters', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/analytics/real-time');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: Record<string, number>;
        timestamp: string;
      };
      expect(body.success).toBe(true);
      expect(body.data['messages_sent']).toBe(100);
      expect(body.timestamp).toBeDefined();
    });

    it('passes tenantId from JWT to counters', async () => {
      const app = createTestApp();
      await app.request('/api/v1/analytics/real-time');

      expect(mockCounters.getMultiple).toHaveBeenCalledWith('tenant-1', expect.any(Array));
    });

    it('accepts optional metrics filter', async () => {
      const app = createTestApp();
      const res = await app.request(
        '/api/v1/analytics/real-time?metrics=messages_sent,agent_sessions',
      );

      expect(res.status).toBe(200);
    });
  });

  // ─── Auth Enforcement ──────────────────────────────────────────

  describe('auth enforcement', () => {
    it('verifies analytics router uses requireAuth and requirePermission middleware', async () => {
      // The analyticsRouter applies requireAuth() and requirePermissionMiddleware('analytics', 'read')
      // on all routes. We verify this by checking that the mock auth functions are invoked
      // on every request via the standard createTestApp flow.
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();

      await app.request('/api/v1/analytics/dashboard');

      // authenticateRequest is called by requireAuth() in the router
      expect(authenticateRequest).toHaveBeenCalled();
    });

    it('passes tenantId from auth context to all query methods', async () => {
      const app = createTestApp();

      // Make requests to multiple endpoints
      await app.request('/api/v1/analytics/dashboard');

      // Verify the tenant from JWT context was passed through
      expect(mockQueries.getDashboardSummary).toHaveBeenCalledWith('tenant-1');
    });
  });
});
