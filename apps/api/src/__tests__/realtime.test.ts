/**
 * Realtime route tests
 *
 * Verifies:
 * - GET /stream   — SSE connection (401 when token missing, 401 when token invalid)
 * - POST /publish — broadcast event (auth + tenant_admin required, body validated)
 * - GET /stats    — channel statistics (auth + tenant_admin required)
 *
 * NOTE: The SSE stream itself is not tested in unit tests — establishing a
 * persistent streaming response is impractical in a Hono test harness.
 * Auth failure paths on /stream are testable and are covered here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { realtimeRouter, configureRealtimeRoutes } from '../routes/realtime.js';
import { configureAuth } from '../middleware/auth.js';
import { configureBillingGate } from '../middleware/plan-gate.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { SubscriptionManager, InMemorySubscriptionStore, MockStripeClient } from '@ordr/billing';
import type { ChannelStats } from '@ordr/realtime';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { FieldEncryptor } from '@ordr/crypto';

// Mock @ordr/auth so requireAuth() and authenticateRequest succeed with test context.
// authenticateRequest is also called directly in /stream for the ?token= flow.
vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'realtime', action: 'read', scope: 'tenant' }],
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

// ─── Mock ChannelManager ─────────────────────────────────────────

const mockStats: ChannelStats = {
  totalConnections: 3,
  connectionsByTenant: { 'tenant-1': 2, 'tenant-2': 1 },
  eventsSent: 42,
  eventsDropped: 0,
  uptime: 120_000,
};

function createMockChannelManager() {
  return {
    addConnection: vi.fn().mockReturnValue({
      id: 'sub-abc-123',
      tenantId: 'tenant-1',
      userId: 'user-1',
      categories: ['agent', 'notification', 'system'],
      connectedAt: new Date(),
      lastHeartbeatAt: new Date(),
    }),
    removeConnection: vi.fn().mockReturnValue(true),
    heartbeat: vi.fn().mockReturnValue(true),
    publish: vi.fn().mockReturnValue(2),
    getConnections: vi.fn().mockReturnValue([]),
    getConnectionCount: vi.fn().mockReturnValue(2),
    getStats: vi.fn().mockReturnValue(mockStats),
    pruneStaleConnections: vi.fn().mockReturnValue(0),
    startCleanup: vi.fn(),
    stopCleanup: vi.fn(),
    closeAll: vi.fn(),
  };
}

// ─── Mock EventPublisher ─────────────────────────────────────────

function createMockPublisher() {
  return {
    publish: vi.fn().mockResolvedValue(2),
    publishEvent: vi.fn().mockResolvedValue(2),
    notifyUsers: vi.fn().mockResolvedValue(1),
    broadcastToTenant: vi.fn().mockResolvedValue(2),
  };
}

// ─── Test App ────────────────────────────────────────────────────

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);

  // Simulate authenticated user context for all routes
  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'realtime', action: 'read' }],
    });
    await next();
  });

  app.route('/api/v1/realtime', realtimeRouter);
  return app;
}

/**
 * App without pre-set tenantContext — used to verify 401 responses.
 */
function createUnauthenticatedApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/realtime', realtimeRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Realtime Routes', () => {
  let mockChannelManager: ReturnType<typeof createMockChannelManager>;
  let mockPublisher: ReturnType<typeof createMockPublisher>;

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockChannelManager = createMockChannelManager();
    mockPublisher = createMockPublisher();

    configureRealtimeRoutes({
      channelManager: mockChannelManager as never,
      publisher: mockPublisher as never,
      jwtConfig: {
        publicKey: 'test-key',
        privateKey: 'test-key',
        issuer: 'test',
        audience: 'test',
        accessTokenTtl: 3600,
        refreshTokenTtl: 86400,
      } as never,
    });

    // Configure billing gate — required by plan-gate middleware on all routes
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

  // ─── GET /stream ────────────────────────────────────────────────

  describe('GET /api/v1/realtime/stream', () => {
    it('returns 401 when token query param is missing', async () => {
      // Use unauthenticated app — no tenantContext pre-set.
      // authenticateRequest is not called because the route checks for ?token= first.
      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/realtime/stream');

      expect(res.status).toBe(401);
      const body = (await res.json()) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('AUTH_FAILED');
    });

    it('returns 401 when token is invalid (authenticateRequest returns authenticated: false)', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
      });

      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/realtime/stream?token=invalid-jwt-token');

      expect(res.status).toBe(401);
      const body = (await res.json()) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('AUTH_FAILED');
    });

    // NOTE: We do not test the full SSE stream because a persistent streaming
    // Response cannot be read to completion in a synchronous test harness.
    // The auth failure paths above cover the security boundary.
    // Integration tests cover the full SSE lifecycle.
  });

  // ─── POST /publish ───────────────────────────────────────────────

  describe('POST /api/v1/realtime/publish', () => {
    it('returns 401 without auth', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
      });

      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/realtime/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'agent', type: 'agent.test', data: {} }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 400 with missing body fields (missing category)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/realtime/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent.test', data: {} }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 with missing body fields (missing type)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/realtime/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'agent', data: {} }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 with invalid category', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/realtime/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'not_a_real_category', type: 'test', data: {} }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 200 with valid body (broadcast to tenant)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/realtime/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'agent', type: 'agent.test', data: {} }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { delivered: number; category: string; type: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.category).toBe('agent');
      expect(body.data.type).toBe('agent.test');
      expect(typeof body.data.delivered).toBe('number');
    });

    it('calls broadcastToTenant when no userIds provided', async () => {
      const app = createTestApp();
      await app.request('/api/v1/realtime/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'agent', type: 'agent.test', data: { agentId: 'a1' } }),
      });

      expect(mockPublisher.broadcastToTenant).toHaveBeenCalledWith('tenant-1', 'agent.test', {
        agentId: 'a1',
      });
      expect(mockPublisher.notifyUsers).not.toHaveBeenCalled();
    });

    it('calls notifyUsers when userIds provided', async () => {
      const app = createTestApp();
      await app.request('/api/v1/realtime/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'notification',
          type: 'notification.alert',
          data: { message: 'hello' },
          userIds: ['user-2', 'user-3'],
        }),
      });

      expect(mockPublisher.notifyUsers).toHaveBeenCalledWith(
        'tenant-1',
        ['user-2', 'user-3'],
        'notification.alert',
        { message: 'hello' },
      );
      expect(mockPublisher.broadcastToTenant).not.toHaveBeenCalled();
    });
  });

  // ─── GET /stats ──────────────────────────────────────────────────

  describe('GET /api/v1/realtime/stats', () => {
    it('returns 401 without auth', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
      });

      const app = createUnauthenticatedApp();
      const res = await app.request('/api/v1/realtime/stats');

      expect(res.status).toBe(401);
    });

    it('returns 200 with channel stats object', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/realtime/stats');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: ChannelStats };
      expect(body.success).toBe(true);
      expect(body.data.totalConnections).toBe(3);
      expect(body.data.eventsSent).toBe(42);
      expect(typeof body.data.uptime).toBe('number');
    });

    it('calls getStats on the ChannelManager', async () => {
      const app = createTestApp();
      await app.request('/api/v1/realtime/stats');

      expect(mockChannelManager.getStats).toHaveBeenCalled();
    });
  });
});
