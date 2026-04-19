/**
 * DSR Route tests
 *
 * SOC2 CC6.1 — tenant-scoped, role-checked
 * GDPR Art. 12, 15, 17, 20 — request lifecycle
 *
 * Verifies:
 * - POST /   → 201 with pending DSR
 * - POST /   → 409 when open DSR already exists for customer+type
 * - POST /   → 400 when erasure has no reason
 * - GET  /   → 200 list with pagination + overdue_count
 * - GET  /:id → 200 with DSR detail
 * - GET  /:id → 410 when export expired
 * - POST /:id/approve → 200 transitions pending→approved
 * - POST /:id/approve → 409 when not pending
 * - POST /:id/reject  → 200 with rejection_reason
 * - DELETE /:id       → 200 cancels pending DSR
 * - DELETE /:id       → 409 when not pending
 * - Auth: unauthenticated request → 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { dsrRouter, configureDsrRoutes } from '../routes/dsr.js';
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
      userId: 'user-admin-1',
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

// ─── Shared State ─────────────────────────────────────────────────

const DSR_ID = '00000000-0000-0000-0000-000000000010';
const CUSTOMER_ID = '00000000-0000-0000-0000-000000000020';
const TENANT_ID = 'tenant-1';

// ─── Shared DSR mock ─────────────────────────────────────────────

const baseDsr = {
  id: DSR_ID,
  tenantId: TENANT_ID,
  customerId: CUSTOMER_ID,
  type: 'access' as const,
  status: 'pending' as const,
  requestedBy: 'user-admin-1',
  reason: null,
  deadlineAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  completedAt: null,
  rejectionReason: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ─── Mock DSR store ───────────────────────────────────────────────

const mockCreateDsr = vi.fn().mockResolvedValue(baseDsr);
const mockListDsrs = vi.fn().mockResolvedValue({ items: [baseDsr], total: 1, overdue_count: 0 });
const mockGetDsr = vi.fn().mockResolvedValue({ dsr: baseDsr, export: null });
const mockApproveDsr = vi.fn().mockResolvedValue({ ...baseDsr, status: 'approved' });
const mockRejectDsr = vi
  .fn()
  .mockResolvedValue({ ...baseDsr, status: 'rejected', rejectionReason: 'Unjustified' });
const mockCancelDsr = vi.fn().mockResolvedValue({ ...baseDsr, status: 'cancelled' });
const mockPublishApproved = vi.fn().mockResolvedValue(undefined);

// ─── App setup ────────────────────────────────────────────────────

async function buildApp(): Promise<Hono<Env>> {
  const auditStore = new InMemoryAuditStore();
  const auditLogger = new AuditLogger(auditStore);
  const fieldEncryptor = new FieldEncryptor(Buffer.from('test-encryption-key-32bytes!!!!!'));

  const subStore = new InMemorySubscriptionStore();
  await subStore.saveSubscription({
    id: 'sub-test',
    tenant_id: TENANT_ID,
    stripe_subscription_id: 'stripe-test',
    plan_tier: 'enterprise',
    status: 'active',
    current_period_start: new Date(Date.now() - 86400000),
    current_period_end: new Date(Date.now() + 86400000),
    cancel_at_period_end: false,
    created_at: new Date(),
    updated_at: new Date(),
  });
  configureBillingGate(
    new SubscriptionManager({
      store: subStore,
      stripe: new MockStripeClient(),
      auditLogger,
      fieldEncryptor,
    }),
  );

  configureAuth({
    publicKey: 'test-key',
    privateKey: 'test-key',
    issuer: 'test',
    audience: 'test',
    accessTokenTtl: 3600,
    refreshTokenTtl: 86400,
  } as never);
  configureDsrRoutes({
    createDsr: mockCreateDsr,
    listDsrs: mockListDsrs,
    getDsr: mockGetDsr,
    approveDsr: mockApproveDsr,
    rejectDsr: mockRejectDsr,
    cancelDsr: mockCancelDsr,
    publishApproved: mockPublishApproved,
    auditLogger,
  });

  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/dsr', dsrRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('POST /dsr', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('creates a DSR and returns 201', async () => {
    const res = await app.request('/dsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ customerId: CUSTOMER_ID, type: 'access' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe('pending');
  });

  it('returns 400 when erasure has no reason', async () => {
    const res = await app.request('/dsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ customerId: CUSTOMER_ID, type: 'erasure' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 when an open DSR already exists', async () => {
    mockCreateDsr.mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { code: 'DSR_CONFLICT' }),
    );
    const res = await app.request('/dsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ customerId: CUSTOMER_ID, type: 'access' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 401 without auth token', async () => {
    const res = await app.request('/dsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /dsr', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with list and overdue_count', async () => {
    const res = await app.request('/dsr', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; overdue_count: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.overdue_count).toBe('number');
  });
});

describe('GET /dsr/:id', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with DSR detail', async () => {
    const res = await app.request(`/dsr/${DSR_ID}`, { headers: { Authorization: 'Bearer tok' } });
    expect(res.status).toBe(200);
  });

  it('returns 410 when export is expired', async () => {
    mockGetDsr.mockResolvedValueOnce({
      dsr: { ...baseDsr, status: 'completed' },
      export: {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        checksumSha256: 'abc',
        s3Key: 'k',
        s3Bucket: 'b',
        fileSizeBytes: 100,
      },
    });
    const res = await app.request(`/dsr/${DSR_ID}`, { headers: { Authorization: 'Bearer tok' } });
    expect(res.status).toBe(410);
  });
});

describe('POST /dsr/:id/approve', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with status=approved', async () => {
    const res = await app.request(`/dsr/${DSR_ID}/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('approved');
  });

  it('returns 409 when DSR is not pending', async () => {
    mockApproveDsr.mockRejectedValueOnce(
      Object.assign(new Error('not pending'), { code: 'DSR_STATE_ERROR' }),
    );
    const res = await app.request(`/dsr/${DSR_ID}/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(409);
  });

  it('publishes dsr.approved Kafka event', async () => {
    await app.request(`/dsr/${DSR_ID}/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(mockPublishApproved).toHaveBeenCalledWith(expect.objectContaining({ dsrId: DSR_ID }));
  });
});

describe('POST /dsr/:id/reject', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with status=rejected', async () => {
    const res = await app.request(`/dsr/${DSR_ID}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ reason: 'Unjustified request' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('rejected');
  });

  it('returns 400 when reason is missing', async () => {
    const res = await app.request(`/dsr/${DSR_ID}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /dsr/:id', () => {
  let app: Hono<Env>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with status=cancelled', async () => {
    const res = await app.request(`/dsr/${DSR_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('cancelled');
  });

  it('returns 409 when not pending', async () => {
    mockCancelDsr.mockRejectedValueOnce(
      Object.assign(new Error('not pending'), { code: 'DSR_STATE_ERROR' }),
    );
    const res = await app.request(`/dsr/${DSR_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(409);
  });
});
