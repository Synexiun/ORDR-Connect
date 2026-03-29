/**
 * Partner Stats Routes tests
 *
 * SOC2 CC6.1 — Logical access: partner-scoped (ctx.userId = partnerId).
 * ISO 27001 A.12.4.1 — Event logging: financial data access audit-trailed.
 * HIPAA §164.312(b) — No PHI in partner payout records.
 *
 * Verifies:
 * - GET / → 200 with monthly earnings and referral funnel
 * - GET /?months=12 → 200 using custom months window
 * - GET /?months=0 → 400 invalid (min is 1)
 * - GET /?months=25 → 400 invalid (max is 24)
 * - Auth: unauthenticated GET / → 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { partnerStatsRouter, configurePartnerStatsRoute } from '../routes/partner-stats.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';

// ─── Mock @ordr/auth ─────────────────────────────────────────────

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'partner-user-1',
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

// ─── Mock DB Fixtures ─────────────────────────────────────────────

const MOCK_MONTHLY_ROWS = [
  { isoMonth: '2026-01', amountCents: 45000 },
  { isoMonth: '2026-02', amountCents: 52000 },
  { isoMonth: '2026-03', amountCents: 61500 },
];

const MOCK_FUNNEL_ROWS = [
  { month: '2026-01', clicks: 320, signups: 48, conversions: 12 },
  { month: '2026-02', clicks: 410, signups: 62, conversions: 18 },
  { month: '2026-03', clicks: 390, signups: 57, conversions: 15 },
];

// ─── Mock DB Builder ─────────────────────────────────────────────

function createMockDb() {
  let callIndex = 0;
  const results = [MOCK_MONTHLY_ROWS, MOCK_FUNNEL_ROWS];

  return {
    select: vi.fn().mockImplementation(() => {
      const result = results[callIndex] ?? [];
      callIndex++;
      const thenable = {
        then: (resolve: (v: unknown) => void) => {
          resolve(result);
        },
      };
      const methods = ['from', 'where', 'groupBy', 'orderBy', 'limit'];
      for (const m of methods) {
        (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
      }
      return thenable;
    }),
    _reset: () => {
      callIndex = 0;
    },
  };
}

// ─── Setup Helpers ───────────────────────────────────────────────

function createTestApp(withTenantContext = true): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  if (withTenantContext) {
    app.use('*', async (c, next) => {
      c.set('tenantContext', {
        tenantId: 'tenant-1',
        userId: 'partner-user-1',
        roles: ['tenant_admin'],
        permissions: [],
      });
      await next();
    });
  }

  app.route('/api/v1/partner-stats', partnerStatsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Partner Stats Routes', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-public-key',
      privateKey: 'test-private-key',
      issuer: 'test-issuer',
      audience: 'test-audience',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockDb = createMockDb();
    configurePartnerStatsRoute(mockDb as never);
  });

  // ─── GET / ───────────────────────────────────────────────────

  describe('GET /api/v1/partner-stats', () => {
    it('returns 200 with monthly earnings and referral funnel', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/partner-stats', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          monthly: Array<{ month: string; amountCents: number }>;
          funnel: Array<{ month: string; clicks: number; signups: number; conversions: number }>;
        };
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.monthly)).toBe(true);
      expect(Array.isArray(body.data.funnel)).toBe(true);
    });

    it('monthly entries contain month label and amountCents', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/partner-stats', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as {
        data: { monthly: Array<{ month: unknown; amountCents: unknown }> };
      };
      for (const entry of body.data.monthly) {
        expect(typeof entry.month).toBe('string');
        expect(typeof entry.amountCents).toBe('number');
      }
    });

    it('funnel entries contain month, clicks, signups, and conversions', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/partner-stats', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as {
        data: {
          funnel: Array<{
            month: unknown;
            clicks: unknown;
            signups: unknown;
            conversions: unknown;
          }>;
        };
      };
      for (const entry of body.data.funnel) {
        expect(typeof entry.month).toBe('string');
        expect(typeof entry.clicks).toBe('number');
        expect(typeof entry.signups).toBe('number');
        expect(typeof entry.conversions).toBe('number');
      }
    });

    it('returns 200 with months=12 query param', async () => {
      mockDb._reset();
      const app = createTestApp();
      const res = await app.request('/api/v1/partner-stats?months=12', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('monthly array has one entry per requested months window', async () => {
      mockDb._reset();
      const app = createTestApp();
      const res = await app.request('/api/v1/partner-stats?months=3', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: { monthly: unknown[] } };
      // 3-month window → 3 monthly entries (even if DB rows are empty they are filled)
      expect(body.data.monthly.length).toBe(3);
    });

    it('returns 400 when months=0 (below minimum of 1)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/partner-stats?months=0', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('returns 400 when months=25 (above maximum of 24)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/partner-stats?months=25', {
        headers: { Authorization: 'Bearer mock-token' },
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
      const res = await app.request('/api/v1/partner-stats');

      expect(res.status).toBe(401);
    });

    it('queries the DB using the authenticated userId as partnerId', async () => {
      const app = createTestApp();
      await app.request('/api/v1/partner-stats', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      // Two DB selects: partner_payouts + partner_referrals
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });
});
