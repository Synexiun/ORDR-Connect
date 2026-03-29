/**
 * Compliance Dashboard Routes tests
 *
 * SOC2 CC6.1  — Tenant-scoped, role-checked.
 * SOC2 CC7.2  — Compliance monitoring and anomaly detection.
 * ISO 27001 A.5.36 — Compliance with information security policies.
 * HIPAA §164.308(a)(1) — Risk analysis and management.
 *
 * Verifies:
 * - GET /summary → 200 with score, checks, regulations array
 * - GET /violations → 200 paginated list
 * - GET /violations?regulation=HIPAA → 200 filtered to HIPAA only
 * - POST /violations/:id/resolve → 200 with resolved flag and resolvedAt
 * - GET /consent-status → 200 with per-channel consent rates
 * - Auth: unauthenticated GET /summary → 401
 *
 * Note: compliance-dashboard routes use no DB (deterministic seed data),
 * only @ordr/compliance is invoked for rule evaluation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { complianceDashboardRouter } from '../routes/compliance-dashboard.js';
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

// ─── Setup Helpers ───────────────────────────────────────────────

async function setupBillingGate(): Promise<void> {
  const subStore = new InMemorySubscriptionStore();
  await subStore.saveSubscription({
    id: 'sub-test',
    tenant_id: 'tenant-1',
    stripe_subscription_id: 'stripe-test',
    plan_tier: 'enterprise',
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

  app.route('/api/v1/compliance', complianceDashboardRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Compliance Dashboard Routes', () => {
  beforeEach(async () => {
    configureAuth({
      publicKey: 'test-public-key',
      privateKey: 'test-private-key',
      issuer: 'test-issuer',
      audience: 'test-audience',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    await setupBillingGate();
  });

  // ─── GET /summary ─────────────────────────────────────────────

  describe('GET /api/v1/compliance/summary', () => {
    it('returns 200 with score, totalChecks, passingChecks, failingChecks, lastAudit, regulations', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/summary', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          score: number;
          totalChecks: number;
          passingChecks: number;
          failingChecks: number;
          lastAudit: string;
          regulations: Array<{ regulation: string; score: number; ruleCount: number }>;
        };
      };
      expect(body.success).toBe(true);
      expect(typeof body.data.score).toBe('number');
      expect(typeof body.data.totalChecks).toBe('number');
      expect(typeof body.data.passingChecks).toBe('number');
      expect(typeof body.data.failingChecks).toBe('number');
      expect(typeof body.data.lastAudit).toBe('string');
      expect(Array.isArray(body.data.regulations)).toBe(true);
      expect(body.data.regulations.length).toBeGreaterThan(0);
    });

    it('includes all expected regulation codes in the response', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/summary', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as {
        data: { regulations: Array<{ regulation: string }> };
      };
      const regulationCodes = body.data.regulations.map((r) => r.regulation);
      expect(regulationCodes).toContain('HIPAA');
      expect(regulationCodes).toContain('SOC2');
      expect(regulationCodes).toContain('GDPR');
    });

    it('returns passingChecks + failingChecks equal to totalChecks', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/summary', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as {
        data: { totalChecks: number; passingChecks: number; failingChecks: number };
      };
      expect(body.data.passingChecks + body.data.failingChecks).toBe(body.data.totalChecks);
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/compliance/summary');

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /violations ──────────────────────────────────────────

  describe('GET /api/v1/compliance/violations', () => {
    it('returns 200 with data array, total, page, pageSize', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/violations', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: unknown[];
        total: number;
        page: number;
        pageSize: number;
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.total).toBe('number');
      expect(typeof body.page).toBe('number');
      expect(typeof body.pageSize).toBe('number');
    });

    it('defaults to page=1 and pageSize=20', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/violations', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { page: number; pageSize: number };
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
    });

    it('returns only HIPAA violations when regulation=HIPAA filter is applied', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/violations?regulation=HIPAA', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: Array<{ regulation: string }>;
        total: number;
      };
      expect(body.success).toBe(true);
      // Every returned violation must be HIPAA
      for (const violation of body.data) {
        expect(violation.regulation).toBe('HIPAA');
      }
    });

    it('supports pagination via page and pageSize params', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/violations?page=1&pageSize=2', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: unknown[];
        pageSize: number;
      };
      expect(body.pageSize).toBe(2);
      expect(body.data.length).toBeLessThanOrEqual(2);
    });

    it('returns 400 on invalid pageSize (zero)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/violations?pageSize=0', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(400);
    });

    it('returns violations scoped to the authenticated tenant', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/violations', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: Array<{ id: string }> };
      // Violation IDs are prefixed with tenant slice — v-{tenantId[:8]}-NNN
      for (const violation of body.data) {
        expect(violation.id).toMatch(/^v-tenant-1-/);
      }
    });
  });

  // ─── POST /violations/:id/resolve ────────────────────────────

  describe('POST /api/v1/compliance/violations/:id/resolve', () => {
    it('returns 200 with id, resolved:true, resolvedAt, resolvedBy', async () => {
      // Use tenant-1's prefix to match the tenant check in the route
      const violationId = 'v-tenant-1-000';

      const app = createTestApp();
      const res = await app.request(`/api/v1/compliance/violations/${violationId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
        body: JSON.stringify({ note: 'Resolved during audit review' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          id: string;
          resolved: boolean;
          resolvedAt: string;
          resolvedBy: string;
          note: string | null;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(violationId);
      expect(body.data.resolved).toBe(true);
      expect(typeof body.data.resolvedAt).toBe('string');
      expect(body.data.resolvedBy).toBe('user-1');
    });

    it('returns the note from the request body in the response', async () => {
      const violationId = 'v-tenant-1-001';
      const app = createTestApp();
      const res = await app.request(`/api/v1/compliance/violations/${violationId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-token' },
        body: JSON.stringify({ note: 'Reviewed and confirmed compliant' }),
      });

      const body = (await res.json()) as { data: { note: string | null } };
      expect(body.data.note).toBe('Reviewed and confirmed compliant');
    });

    it('returns 404 when violation ID does not belong to the tenant', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/violations/v-othertnt-000/resolve', {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /consent-status ──────────────────────────────────────

  describe('GET /api/v1/compliance/consent-status', () => {
    it('returns 200 with per-channel consent data', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/consent-status', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: Array<{ channel: string; consented: number; total: number; percentage: number }>;
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('includes SMS, Email, Voice, and Chat channels', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/consent-status', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as {
        data: Array<{ channel: string }>;
      };
      const channels = body.data.map((d) => d.channel);
      expect(channels).toContain('SMS');
      expect(channels).toContain('Email');
      expect(channels).toContain('Voice');
      expect(channels).toContain('Chat');
    });

    it('returns numeric consented, total, percentage for each channel', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/compliance/consent-status', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as {
        data: Array<{ consented: unknown; total: unknown; percentage: unknown }>;
      };
      for (const entry of body.data) {
        expect(typeof entry.consented).toBe('number');
        expect(typeof entry.total).toBe('number');
        expect(typeof entry.percentage).toBe('number');
      }
    });

    it('returns deterministic results for the same tenantId across calls', async () => {
      const app = createTestApp();
      const res1 = await app.request('/api/v1/compliance/consent-status', {
        headers: { Authorization: 'Bearer mock-token' },
      });
      const res2 = await app.request('/api/v1/compliance/consent-status', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body1 = (await res1.json()) as { data: unknown[] };
      const body2 = (await res2.json()) as { data: unknown[] };
      expect(body1.data).toEqual(body2.data);
    });
  });
});
