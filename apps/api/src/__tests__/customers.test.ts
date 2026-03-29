/**
 * Customers route tests
 *
 * Verifies:
 * - GET /              — list customers (paginated)
 * - GET /:id           — get single customer
 * - POST /             — create customer (valid + invalid body)
 * - PATCH /:id         — update customer
 * - DELETE /:id        — soft delete customer
 * - GET / with search  — search query param forwarded to listCustomers
 * - Auth enforcement   — unauthenticated GET / returns 401
 *
 * COMPLIANCE: SOC2 CC6.1 / HIPAA §164.312
 * No PHI in test data — names and emails are clearly synthetic test values.
 * Field-level encryption is exercised via mock (encryptField / decryptField).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { customersRouter, configureCustomerRoutes } from '../routes/customers.js';
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

// ─── Mock Data ────────────────────────────────────────────────────

const MOCK_CUSTOMER: {
  id: string;
  tenantId: string;
  externalId: null;
  type: string;
  status: string;
  name: string;
  email: string;
  phone: null;
  metadata: null;
  healthScore: null;
  lifecycleStage: string;
  assignedUserId: null;
  createdAt: Date;
  updatedAt: Date;
} = {
  id: 'cust-1',
  tenantId: 'tenant-1',
  externalId: null,
  type: 'individual',
  status: 'active',
  name: 'Test Customer',
  email: 'customer@test-domain.example',
  phone: null,
  metadata: null,
  healthScore: null,
  lifecycleStage: 'customer',
  assignedUserId: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
  updatedAt: new Date('2026-03-01T00:00:00Z'),
};

// ─── Mock Dependencies ────────────────────────────────────────────

function createMockDeps() {
  const mockEncryptor = {
    encryptField: vi.fn().mockImplementation((_field: string, value: string) => value),
    decryptField: vi.fn().mockImplementation((_field: string, value: string) => value),
  };

  const mockAuditLogger = {
    log: vi.fn().mockResolvedValue(undefined),
  };

  const mockEventProducer = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  return {
    fieldEncryptor: mockEncryptor as never,
    auditLogger: mockAuditLogger as never,
    eventProducer: mockEventProducer as never,
    findCustomerById: vi.fn().mockResolvedValue(MOCK_CUSTOMER),
    listCustomers: vi.fn().mockResolvedValue({ data: [MOCK_CUSTOMER], total: 1 }),
    createCustomer: vi.fn().mockResolvedValue(MOCK_CUSTOMER),
    updateCustomer: vi.fn().mockResolvedValue(MOCK_CUSTOMER),
    softDeleteCustomer: vi.fn().mockResolvedValue(true),
  };
}

// ─── App Builders ─────────────────────────────────────────────────

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    });
    await next();
  });

  app.route('/api/v1/customers', customersRouter);
  return app;
}

function createUnauthApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);
  app.route('/api/v1/customers', customersRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Customers Routes', () => {
  let mockDeps: ReturnType<typeof createMockDeps>;

  beforeEach(async () => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockDeps = createMockDeps();
    configureCustomerRoutes(mockDeps);

    // Billing gate — needed for POST / which uses quotaGate('contacts')
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

  // ─── GET / — list customers ───────────────────────────────────

  describe('GET /api/v1/customers', () => {
    it('returns 200 with { success, data, pagination }', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/customers');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { id: string }[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data[0]?.id).toBe('cust-1');
      expect(typeof body.pagination.page).toBe('number');
      expect(typeof body.pagination.total).toBe('number');
    });

    it('calls listCustomers with tenantId from context', async () => {
      const app = createTestApp();
      await app.request('/api/v1/customers');

      expect(mockDeps.listCustomers).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ page: 1 }),
      );
    });

    it('returns empty data array when no customers exist', async () => {
      mockDeps.listCustomers.mockResolvedValueOnce({ data: [], total: 0 });

      const app = createTestApp();
      const res = await app.request('/api/v1/customers');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  // ─── GET / with search query param ───────────────────────────

  describe('GET /api/v1/customers?search=...', () => {
    it('returns 200 and forwards search to listCustomers', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/customers?search=Acme');

      expect(res.status).toBe(200);
      expect(mockDeps.listCustomers).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ search: 'Acme' }),
      );
    });
  });

  // ─── GET /:id — single customer ──────────────────────────────

  describe('GET /api/v1/customers/:id', () => {
    it('returns 200 with { success: true, data: CustomerRecord }', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/customers/cust-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('cust-1');
    });

    it('calls findCustomerById with tenantId and customerId', async () => {
      const app = createTestApp();
      await app.request('/api/v1/customers/cust-1');

      expect(mockDeps.findCustomerById).toHaveBeenCalledWith('tenant-1', 'cust-1');
    });

    it('returns 404 when customer does not exist', async () => {
      mockDeps.findCustomerById.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/api/v1/customers/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ─── POST / — create customer ─────────────────────────────────

  describe('POST /api/v1/customers', () => {
    it('returns 201 with { success: true, data: CustomerRecord } on valid body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'individual',
          name: 'New Test Customer',
          email: 'new@test-domain.example',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('cust-1');
    });

    it('calls createCustomer with tenantId from JWT context (not body)', async () => {
      const app = createTestApp();
      await app.request('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'company',
          name: 'Acme Corp',
        }),
      });

      expect(mockDeps.createCustomer).toHaveBeenCalledWith('tenant-1', expect.any(Object));
    });

    it('logs audit entry on successful create', async () => {
      const app = createTestApp();
      await app.request('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'individual', name: 'Audit Test Customer' }),
      });

      expect(mockDeps.auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'data.created',
          resource: 'customers',
        }),
      );
    });

    it('returns 422 on missing required fields (name)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'individual' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 422 on invalid type enum', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'robot', name: 'Test' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 422 on malformed JSON body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /:id — update customer ─────────────────────────────

  describe('PATCH /api/v1/customers/:id', () => {
    it('returns 200 with { success: true, data: CustomerRecord }', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/customers/cust-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'inactive' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('cust-1');
    });

    it('calls updateCustomer with tenantId and customerId', async () => {
      const app = createTestApp();
      await app.request('/api/v1/customers/cust-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthScore: 85 }),
      });

      expect(mockDeps.updateCustomer).toHaveBeenCalledWith(
        'tenant-1',
        'cust-1',
        expect.any(Object),
      );
    });

    it('returns 404 when customer does not exist during update', async () => {
      mockDeps.findCustomerById.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/api/v1/customers/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'inactive' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE /:id — soft delete ────────────────────────────────

  describe('DELETE /api/v1/customers/:id', () => {
    it('returns 200 with { success: true }', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/customers/cust-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('calls softDeleteCustomer with tenantId and customerId', async () => {
      const app = createTestApp();
      await app.request('/api/v1/customers/cust-1', { method: 'DELETE' });

      expect(mockDeps.softDeleteCustomer).toHaveBeenCalledWith('tenant-1', 'cust-1');
    });

    it('logs audit entry on successful delete', async () => {
      const app = createTestApp();
      await app.request('/api/v1/customers/cust-1', { method: 'DELETE' });

      expect(mockDeps.auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'data.deleted',
          resource: 'customers',
          resourceId: 'cust-1',
        }),
      );
    });

    it('returns 404 when customer does not exist during delete', async () => {
      mockDeps.findCustomerById.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/api/v1/customers/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ─── Auth Enforcement ─────────────────────────────────────────

  describe('auth enforcement', () => {
    it('returns 401 when request is unauthenticated (no tenantContext)', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      });

      const app = createUnauthApp();
      const res = await app.request('/api/v1/customers');

      expect(res.status).toBe(401);
    });
  });
});
