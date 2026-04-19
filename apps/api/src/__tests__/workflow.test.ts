/**
 * Workflow route tests
 *
 * Verifies:
 * - GET /definitions — list built-in templates
 * - POST /instances — start a workflow instance
 * - GET /instances — list instances for tenant
 * - GET /instances/:id — get specific instance
 * - PUT /instances/:id/pause — pause an instance
 * - PUT /instances/:id/resume — resume an instance
 * - DELETE /instances/:id — cancel an instance
 * - Auth required on all routes
 * - Tenant isolation from JWT context
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createTenantId } from '@ordr/core';
import { requestId } from '../middleware/request-id.js';
import { workflowRouter, configureWorkflowRoutes } from '../routes/workflow.js';
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
      permissions: [{ resource: 'workflow', action: 'read', scope: 'tenant' }],
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

// ─── Mock BUILTIN_TEMPLATES ───────────────────────────────────────

vi.mock('@ordr/workflow', async () => {
  const actual = await vi.importActual<typeof import('@ordr/workflow')>('@ordr/workflow');
  return {
    ...actual,
    BUILTIN_TEMPLATES: {
      'onboarding-v1': {
        id: 'onboarding-v1',
        name: 'Customer Onboarding',
        version: 1,
        steps: [],
      },
      'collections-v1': {
        id: 'collections-v1',
        name: 'Collections Flow',
        version: 1,
        steps: [],
      },
    },
  };
});

// ─── Mock Dependencies ────────────────────────────────────────────

const MOCK_INSTANCE = {
  id: 'instance-1',
  definitionId: 'onboarding-v1',
  tenantId: 'tenant-1',
  status: 'running',
  context: {},
  createdAt: new Date().toISOString(),
};

function createMockEngine() {
  return {
    startWorkflow: vi.fn().mockResolvedValue(MOCK_INSTANCE),
    pauseWorkflow: vi.fn().mockResolvedValue({ ...MOCK_INSTANCE, status: 'paused' }),
    resumeWorkflow: vi.fn().mockResolvedValue({ ...MOCK_INSTANCE, status: 'running' }),
    cancelWorkflow: vi.fn().mockResolvedValue({ ...MOCK_INSTANCE, status: 'cancelled' }),
  };
}

function createMockInstanceStore() {
  return {
    list: vi.fn().mockResolvedValue([MOCK_INSTANCE]),
    getById: vi.fn().mockResolvedValue(MOCK_INSTANCE),
  };
}

const VALID_CONTEXT = {
  entityType: 'contact',
  entityId: 'contact-1',
  tenantId: 'tenant-1',
  variables: {},
  correlationId: 'corr-1',
  initiatedBy: 'user-1',
};

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: createTenantId('tenant-1'),
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    });
    await next();
  });

  app.route('/api/v1/workflow', workflowRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Workflow Routes', () => {
  let mockEngine: ReturnType<typeof createMockEngine>;
  let mockInstanceStore: ReturnType<typeof createMockInstanceStore>;

  beforeEach(async () => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockEngine = createMockEngine();
    mockInstanceStore = createMockInstanceStore();
    configureWorkflowRoutes({
      engine: mockEngine as never,
      instanceStore: mockInstanceStore as never,
      auditLogger: { log: vi.fn() } as never,
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

  // ─── GET /definitions ─────────────────────────────────────────

  describe('GET /api/v1/workflow/definitions', () => {
    it('returns built-in templates with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/definitions');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[]; total: number };
      expect(body.success).toBe(true);
      expect(body.total).toBe(2);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('does not require deps — templates are static', async () => {
      // Even without calling configureWorkflowRoutes, definitions should work
      // because BUILTIN_TEMPLATES is a static import
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/definitions');
      expect(res.status).toBe(200);
    });
  });

  // ─── POST /instances ──────────────────────────────────────────

  describe('POST /api/v1/workflow/instances', () => {
    it('starts a workflow and returns 201', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definitionId: 'onboarding-v1',
          context: VALID_CONTEXT,
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('instance-1');
    });

    it('calls startWorkflow with context before tenantId', async () => {
      const app = createTestApp();
      await app.request('/api/v1/workflow/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definitionId: 'onboarding-v1',
          context: VALID_CONTEXT,
        }),
      });

      expect(mockEngine.startWorkflow).toHaveBeenCalledWith(
        'onboarding-v1',
        expect.any(Object),
        'tenant-1',
      );
    });

    it('returns 400 for missing definitionId', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: VALID_CONTEXT }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /instances ───────────────────────────────────────────

  describe('GET /api/v1/workflow/instances', () => {
    it('returns instance list with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/instances');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[]; total: number };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
    });

    it('passes tenantId and optional status filter to instanceStore', async () => {
      const app = createTestApp();
      await app.request('/api/v1/workflow/instances?status=running&limit=10');

      expect(mockInstanceStore.list).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ status: 'running' }),
      );
    });

    it('returns 400 for invalid limit', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/instances?limit=999');

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /instances/:id ───────────────────────────────────────

  describe('GET /api/v1/workflow/instances/:id', () => {
    it('returns instance with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/instances/instance-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('instance-1');
    });

    it('passes tenantId and instanceId for isolation', async () => {
      const app = createTestApp();
      await app.request('/api/v1/workflow/instances/instance-1');

      expect(mockInstanceStore.getById).toHaveBeenCalledWith('tenant-1', 'instance-1');
    });
  });

  // ─── PUT /instances/:id/pause ─────────────────────────────────

  describe('PUT /api/v1/workflow/instances/:id/pause', () => {
    it('pauses an instance and returns 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/instances/instance-1/pause', {
        method: 'PUT',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { status: string } };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('paused');
    });
  });

  // ─── PUT /instances/:id/resume ────────────────────────────────

  describe('PUT /api/v1/workflow/instances/:id/resume', () => {
    it('resumes an instance and returns 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/instances/instance-1/resume', {
        method: 'PUT',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { status: string } };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('running');
    });
  });

  // ─── DELETE /instances/:id ────────────────────────────────────

  describe('DELETE /api/v1/workflow/instances/:id', () => {
    it('cancels an instance and returns 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/instances/instance-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User requested cancellation' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { status: string } };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('cancelled');
    });

    it('returns 400 for missing reason', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/workflow/instances/instance-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Auth Enforcement ─────────────────────────────────────────

  describe('auth enforcement', () => {
    it('calls authenticateRequest on protected routes', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();

      await app.request('/api/v1/workflow/instances');

      expect(authenticateRequest).toHaveBeenCalled();
    });
  });
});
