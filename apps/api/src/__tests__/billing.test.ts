/**
 * Billing route tests
 *
 * Verifies:
 * - GET /plans   — list all plans (public, no auth)
 * - GET /        — get current subscription (auth required)
 * - POST /       — create subscription (auth required, validated body)
 * - PUT /upgrade — upgrade subscription (auth required)
 * - PUT /downgrade — downgrade subscription (auth required)
 * - DELETE /     — cancel subscription (auth required)
 * - GET /usage   — get usage summary (auth required)
 * - POST /webhooks/stripe — Stripe webhook (no auth, returns 200 on signature failure)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { billingRouter, configureBillingRoutes } from '../routes/billing.js';
import { configureAuth } from '../middleware/auth.js';
import { configureBillingGate } from '../middleware/plan-gate.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { SubscriptionManager, InMemorySubscriptionStore, MockStripeClient } from '@ordr/billing';
import type { Subscription, UsageSummary } from '@ordr/billing';
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
      permissions: [{ resource: 'billing', action: 'read', scope: 'tenant' }],
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

// ─── Test constants ──────────────────────────────────────────────

// Not a real secret — unit test fixture only, never used in production.
// The billing route reads this from process.env.STRIPE_WEBHOOK_SECRET at runtime.
const TEST_WEBHOOK_KEY = 'unit-test-webhook-key-not-a-real-value';

// ─── Mock Subscription ───────────────────────────────────────────

const mockSubscription: Subscription = {
  id: 'sub-001',
  tenant_id: 'tenant-1',
  plan_tier: 'professional',
  status: 'active',
  stripe_subscription_id: 'enc_sub_test',
  current_period_start: new Date('2026-03-01'),
  current_period_end: new Date('2026-04-01'),
  cancel_at_period_end: false,
  created_at: new Date('2026-03-01'),
  updated_at: new Date('2026-03-01'),
};

const mockUsageSummary: UsageSummary = {
  agents: 2,
  contacts: 150,
  messages: 3200,
  api_calls: 12000,
  period_start: new Date('2026-03-01'),
  period_end: new Date('2026-04-01'),
};

// ─── Mock SubscriptionManager ────────────────────────────────────

function createMockSubscriptionManager() {
  return {
    getSubscription: vi.fn().mockResolvedValue(mockSubscription),
    createSubscription: vi.fn().mockResolvedValue(mockSubscription),
    upgradeSubscription: vi.fn().mockResolvedValue({
      ...mockSubscription,
      plan_tier: 'enterprise',
    }),
    downgradeSubscription: vi.fn().mockResolvedValue({
      ...mockSubscription,
      plan_tier: 'starter',
    }),
    cancelSubscription: vi.fn().mockResolvedValue({
      ...mockSubscription,
      cancel_at_period_end: true,
    }),
    getUsage: vi.fn().mockResolvedValue(mockUsageSummary),
    checkLimit: vi.fn().mockResolvedValue({ within_limit: true, current: 2, limit: 10 }),
    enforceLimit: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockUsageTracker() {
  return {
    trackUsage: vi.fn(),
    getCounter: vi.fn().mockReturnValue(0),
    getUsageSummary: vi.fn().mockResolvedValue(mockUsageSummary),
    resetUsage: vi.fn().mockResolvedValue(undefined),
    flushAll: vi.fn().mockResolvedValue(undefined),
    startPeriodicFlush: vi.fn(),
    stopPeriodicFlush: vi.fn().mockResolvedValue(undefined),
    getActiveCounters: vi.fn().mockReturnValue(new Map()),
  };
}

// ─── Test App ────────────────────────────────────────────────────

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);

  // Simulate authenticated user context for all routes in the test app
  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'billing', action: 'read' }],
    });
    await next();
  });

  app.route('/api/v1/billing', billingRouter);
  return app;
}

/**
 * App without the pre-set tenantContext — used to verify 401 responses.
 */
function createUnauthenticatedApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/billing', billingRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Billing Routes', () => {
  let mockManager: ReturnType<typeof createMockSubscriptionManager>;
  let mockTracker: ReturnType<typeof createMockUsageTracker>;

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockManager = createMockSubscriptionManager();
    mockTracker = createMockUsageTracker();

    configureBillingRoutes({
      subscriptionManager: mockManager as never,
      usageTracker: mockTracker as never,
      stripeWebhookSecret: TEST_WEBHOOK_KEY,
    });

    // Configure billing gate — required because plan-gate middleware reads SubscriptionManager
    const subStore = new InMemorySubscriptionStore();
    void subStore.saveSubscription({
      id: 'sub-gate-001',
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

  // ─── GET /plans ─────────────────────────────────────────────────

  describe('GET /api/v1/billing/plans', () => {
    it('returns 200 with array of plans (no auth required)', async () => {
      // Use unauthenticated app — /plans is public
      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/billing/plans');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });
  });

  // ─── GET / ──────────────────────────────────────────────────────

  describe('GET /api/v1/billing', () => {
    it('returns 401 without auth', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
      });

      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/billing');

      expect(res.status).toBe(401);
    });

    it('returns 200 with subscription when authenticated', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: Subscription };
      expect(body.success).toBe(true);
      expect(body.data.plan_tier).toBe('professional');
      expect(body.data.tenant_id).toBe('tenant-1');
    });

    it('calls getSubscription with tenantId from JWT context', async () => {
      const app = createTestApp();
      await app.request('/api/v1/billing');

      expect(mockManager.getSubscription).toHaveBeenCalledWith('tenant-1');
    });
  });

  // ─── POST / ─────────────────────────────────────────────────────

  describe('POST /api/v1/billing', () => {
    it('returns 401 without auth', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
      });

      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: 'professional', paymentMethodId: 'pm_test' }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 400 with invalid body (missing planTier)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethodId: 'pm_test' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 with invalid planTier value', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: 'ultra', paymentMethodId: 'pm_test' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 201 with valid body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: 'professional', paymentMethodId: 'pm_test' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { success: boolean; data: Subscription };
      expect(body.success).toBe(true);
      expect(body.data.plan_tier).toBe('professional');
    });

    it('passes tenantId and userId to createSubscription', async () => {
      const app = createTestApp();
      await app.request('/api/v1/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: 'professional', paymentMethodId: 'pm_test' }),
      });

      expect(mockManager.createSubscription).toHaveBeenCalledWith(
        'tenant-1',
        'professional',
        'pm_test',
        'user-1',
      );
    });
  });

  // ─── PUT /upgrade ───────────────────────────────────────────────

  describe('PUT /api/v1/billing/upgrade', () => {
    it('returns 401 without auth', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
      });

      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/billing/upgrade', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: 'enterprise' }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 200 for valid upgrade request', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing/upgrade', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: 'enterprise' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: Subscription };
      expect(body.success).toBe(true);
      expect(body.data.plan_tier).toBe('enterprise');
    });

    it('passes tenantId and userId to upgradeSubscription', async () => {
      const app = createTestApp();
      await app.request('/api/v1/billing/upgrade', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: 'enterprise' }),
      });

      expect(mockManager.upgradeSubscription).toHaveBeenCalledWith(
        'tenant-1',
        'enterprise',
        'user-1',
      );
    });
  });

  // ─── PUT /downgrade ─────────────────────────────────────────────

  describe('PUT /api/v1/billing/downgrade', () => {
    it('returns 401 without auth', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
      });

      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/billing/downgrade', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: 'starter' }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 200 for valid downgrade request', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing/downgrade', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier: 'starter' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: Subscription };
      expect(body.success).toBe(true);
    });
  });

  // ─── DELETE / ───────────────────────────────────────────────────

  describe('DELETE /api/v1/billing', () => {
    it('returns 401 without auth', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
      });

      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/billing', { method: 'DELETE' });

      expect(res.status).toBe(401);
    });

    it('returns 200 when canceling existing subscription', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: Subscription;
      };
      expect(body.success).toBe(true);
      expect(body.data.cancel_at_period_end).toBe(true);
    });

    it('calls cancelSubscription with tenantId and userId', async () => {
      const app = createTestApp();
      await app.request('/api/v1/billing', { method: 'DELETE' });

      expect(mockManager.cancelSubscription).toHaveBeenCalledWith(
        'tenant-1',
        expect.any(String) as unknown,
        'user-1',
      );
    });
  });

  // ─── GET /usage ─────────────────────────────────────────────────

  describe('GET /api/v1/billing/usage', () => {
    it('returns 401 without auth', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
      });

      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/billing/usage');

      expect(res.status).toBe(401);
    });

    it('returns 200 with usage summary', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing/usage');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: UsageSummary };
      expect(body.success).toBe(true);
      expect(body.data.agents).toBe(2);
      expect(body.data.messages).toBe(3200);
    });

    it('calls getUsage with tenantId from JWT context', async () => {
      const app = createTestApp();
      await app.request('/api/v1/billing/usage');

      expect(mockManager.getUsage).toHaveBeenCalledWith('tenant-1');
    });
  });

  // ─── POST /webhooks/stripe ──────────────────────────────────────

  describe('POST /api/v1/billing/webhooks/stripe', () => {
    it('returns 200 even with invalid signature (Stripe retries on non-200)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=invalid,v1=badsig',
        },
        body: JSON.stringify({ type: 'invoice.payment_succeeded', data: {} }),
      });

      // CRITICAL: must be 200 regardless of signature validity
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; received: boolean };
      expect(body.received).toBe(true);
    });

    it('returns 200 with missing signature header', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/billing/webhooks/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'customer.subscription.updated' }),
      });

      expect(res.status).toBe(200);
    });

    it('does not require auth header (webhook endpoint is public)', async () => {
      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/billing/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=abc',
        },
        body: JSON.stringify({ type: 'invoice.paid' }),
      });

      // 200 because endpoint has no requireAuth + invalid sig caught internally
      expect(res.status).toBe(200);
    });
  });
});
