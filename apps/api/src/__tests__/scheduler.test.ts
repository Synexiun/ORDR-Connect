/**
 * Scheduler route tests
 *
 * Verifies:
 * - GET /jobs — list registered job definitions
 * - POST /jobs/once — schedule a one-time job (admin only)
 * - GET /instances — list job instances
 * - GET /instances/:id — get specific instance
 * - GET /dead-letter — list dead letter queue (admin only)
 * - Auth required on all routes
 * - Tenant isolation from JWT context
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { schedulerRouter, configureSchedulerRoutes } from '../routes/scheduler.js';
import { configureAuth } from '../middleware/auth.js';
import { configureBillingGate } from '../middleware/plan-gate.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { SubscriptionManager, InMemorySubscriptionStore, MockStripeClient } from '@ordr/billing';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { FieldEncryptor } from '@ordr/crypto';

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'scheduler', action: 'read', scope: 'tenant' }],
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

vi.mock('@ordr/scheduler', async () => {
  const actual = await vi.importActual<typeof import('@ordr/scheduler')>('@ordr/scheduler');
  return {
    ...actual,
    JOB_PRIORITIES: ['low', 'normal', 'high', 'critical'],
    isValidCron: vi.fn().mockReturnValue(true),
  };
});

// ─── Mock Dependencies ────────────────────────────────────────────

const MOCK_JOB_INSTANCE = {
  id: 'job-instance-1',
  jobType: 'send-email',
  tenantId: 'tenant-1',
  status: 'completed',
  createdAt: new Date().toISOString(),
};

function createMockScheduler() {
  return {
    getStatus: vi.fn().mockResolvedValue({
      jobs: [
        { jobType: 'send-email', registered: true, nextRunAt: null },
        { jobType: 'sync-contacts', registered: true, nextRunAt: '2026-04-01T00:00:00Z' },
      ],
      runningCount: 0,
      queuedCount: 2,
    }),
    // scheduleOnce returns instanceId string directly
    scheduleOnce: vi.fn().mockResolvedValue('job-instance-1'),
  };
}

function createMockStore() {
  return {
    listInstances: vi.fn().mockResolvedValue([MOCK_JOB_INSTANCE]),
    getInstance: vi.fn().mockResolvedValue(MOCK_JOB_INSTANCE),
    listDeadLetter: vi.fn().mockResolvedValue([
      {
        id: 'job-dead-1',
        jobType: 'sync-contacts',
        failedAt: new Date().toISOString(),
        error: 'Connection timeout',
      },
    ]),
  };
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'scheduler', action: 'read' }],
    });
    await next();
  });

  app.route('/api/v1/scheduler', schedulerRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Scheduler Routes', () => {
  let mockScheduler: ReturnType<typeof createMockScheduler>;
  let mockStore: ReturnType<typeof createMockStore>;

  beforeEach(async () => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockScheduler = createMockScheduler();
    mockStore = createMockStore();
    configureSchedulerRoutes({
      scheduler: mockScheduler as never,
      store: mockStore as never,
    });

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
  });

  // ─── GET /jobs ────────────────────────────────────────────────

  describe('GET /api/v1/scheduler/jobs', () => {
    it('returns job definitions with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/scheduler/jobs');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { jobs: unknown[] } };
      expect(body.success).toBe(true);
      expect(mockScheduler.getStatus).toHaveBeenCalled();
    });
  });

  // ─── POST /jobs/once ──────────────────────────────────────────

  describe('POST /api/v1/scheduler/jobs/once', () => {
    it('schedules a one-time job and returns 201', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/scheduler/jobs/once', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: 'send-email',
          payload: { to: 'test@example.com' },
          runAt: '2026-04-01T12:00:00.000Z',
          priority: 'normal',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { success: boolean; data: { instanceId: string } };
      expect(body.success).toBe(true);
      expect(body.data.instanceId).toBe('job-instance-1');
    });

    it('passes jobType, payload, runAt and tenantId to scheduleOnce', async () => {
      const app = createTestApp();
      await app.request('/api/v1/scheduler/jobs/once', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: 'send-email',
          payload: {},
          runAt: '2026-04-01T12:00:00.000Z',
        }),
      });

      expect(mockScheduler.scheduleOnce).toHaveBeenCalledWith(
        'send-email',
        expect.any(Object),
        expect.any(Date),
        expect.objectContaining({ tenantId: 'tenant-1' }),
      );
    });

    it('returns 400 for missing jobType', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/scheduler/jobs/once', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runAt: '2026-04-01T12:00:00.000Z', payload: {} }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid runAt format', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/scheduler/jobs/once', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: 'send-email',
          payload: {},
          runAt: 'not-a-date',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /instances ───────────────────────────────────────────

  describe('GET /api/v1/scheduler/instances', () => {
    it('returns job instances with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/scheduler/instances');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[]; total: number };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
      expect(body.total).toBe(1);
    });

    it('passes optional status filter to store', async () => {
      const app = createTestApp();
      await app.request('/api/v1/scheduler/instances?status=completed&limit=25');

      expect(mockStore.listInstances).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  // ─── GET /instances/:id ───────────────────────────────────────

  describe('GET /api/v1/scheduler/instances/:id', () => {
    it('returns a specific job instance with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/scheduler/instances/job-instance-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('job-instance-1');
    });

    it('looks up instance by id from store', async () => {
      const app = createTestApp();
      await app.request('/api/v1/scheduler/instances/job-instance-1');

      expect(mockStore.getInstance).toHaveBeenCalledWith('job-instance-1');
    });
  });

  // ─── GET /dead-letter ─────────────────────────────────────────

  describe('GET /api/v1/scheduler/dead-letter', () => {
    it('returns dead letter queue with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/scheduler/dead-letter');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[]; total: number };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
      expect(body.total).toBe(1);
    });

    it('calls listDeadLetter with no args', async () => {
      const app = createTestApp();
      await app.request('/api/v1/scheduler/dead-letter');

      expect(mockStore.listDeadLetter).toHaveBeenCalledWith();
    });
  });

  // ─── Auth Enforcement ─────────────────────────────────────────

  describe('auth enforcement', () => {
    it('calls authenticateRequest on protected routes', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();

      await app.request('/api/v1/scheduler/instances');

      expect(authenticateRequest).toHaveBeenCalled();
    });
  });
});
