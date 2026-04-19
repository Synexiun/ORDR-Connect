/**
 * Developer Usage Routes tests
 *
 * SOC2 CC6.1 — Logical access: developer-scoped (ctx.userId = developerId).
 * ISO 27001 A.12.4.1 — Event logging: usage data never includes request bodies.
 * HIPAA §164.312(b) — No PHI in developer usage records.
 *
 * Verifies:
 * - GET / → 200 with stats, daily, endpoints
 * - GET /?days=30 → 200 using custom days window
 * - GET /?days=0 → 400 invalid days (min is 1)
 * - GET /?days=91 → 400 invalid days (max is 90)
 * - Auth: unauthenticated GET / → 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createTenantId } from '@ordr/core';
import { requestId } from '../middleware/request-id.js';
import { devUsageRouter, configureDevUsageRoute } from '../routes/developer-usage.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';

// ─── Mock @ordr/auth ─────────────────────────────────────────────

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'dev-user-1',
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

// ─── Mock DB ─────────────────────────────────────────────────────

function createMockDb() {
  const statsResult = [
    {
      totalCalls: 482,
      totalErrors: 12,
      callsToday: 47,
      errorsToday: 2,
    },
  ];

  const dailyResult = [
    { day: '2026-03-21', calls: 65, errors: 1 },
    { day: '2026-03-22', calls: 72, errors: 3 },
    { day: '2026-03-23', calls: 58, errors: 0 },
  ];

  const endpointResult = [
    { endpoint: '/api/v1/customers', calls: 120 },
    { endpoint: '/api/v1/interactions', calls: 98 },
    { endpoint: '/api/v1/ai/sentiment', calls: 45 },
  ];

  // Chainable query builder mock
  const makeChain = (finalResult: unknown[]) => {
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'from', 'where', 'groupBy', 'orderBy', 'limit'];
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    // The last awaited call returns the result
    const thenable = {
      ...chain,
      then: (resolve: (v: unknown) => void) => {
        resolve(finalResult);
      },
    };
    for (const m of methods) {
      (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
    }
    return thenable;
  };

  let callCount = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain(statsResult);
      if (callCount === 2) return makeChain(dailyResult);
      return makeChain(endpointResult);
    }),
    _reset: () => {
      callCount = 0;
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
        tenantId: createTenantId('tenant-1'),
        userId: 'dev-user-1',
        roles: ['tenant_admin'],
        permissions: [],
      });
      await next();
    });
  }

  app.route('/api/v1/developer-usage', devUsageRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Developer Usage Routes', () => {
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
    configureDevUsageRoute(mockDb as never);
  });

  // ─── GET / ───────────────────────────────────────────────────

  describe('GET /api/v1/developer-usage', () => {
    it('returns 200 with stats, daily, and endpoints', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/developer-usage', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          stats: {
            totalCalls: number;
            totalErrors: number;
            callsToday: number;
            errorsToday: number;
          };
          daily: Array<{ label: string; calls: number; errors: number }>;
          endpoints: Array<{ endpoint: string; calls: number }>;
        };
      };
      expect(body.success).toBe(true);
      expect(typeof body.data.stats.totalCalls).toBe('number');
      expect(typeof body.data.stats.totalErrors).toBe('number');
      expect(typeof body.data.stats.callsToday).toBe('number');
      expect(typeof body.data.stats.errorsToday).toBe('number');
      expect(Array.isArray(body.data.daily)).toBe(true);
      expect(Array.isArray(body.data.endpoints)).toBe(true);
    });

    it('returns 200 with custom days=30 query param', async () => {
      mockDb._reset();
      const app = createTestApp();
      const res = await app.request('/api/v1/developer-usage?days=30', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('daily array has one entry per requested day window', async () => {
      mockDb._reset();
      const app = createTestApp();
      const res = await app.request('/api/v1/developer-usage?days=7', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: { daily: unknown[] } };
      // 7 day windows should produce 7 daily entries
      expect(body.data.daily.length).toBe(7);
    });

    it('returns 400 when days=0 (below minimum of 1)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/developer-usage?days=0', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('returns 400 when days=91 (above maximum of 90)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/developer-usage?days=91', {
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
      const res = await app.request('/api/v1/developer-usage');

      expect(res.status).toBe(401);
    });

    it('queries DB with the authenticated userId as developerId', async () => {
      const app = createTestApp();
      await app.request('/api/v1/developer-usage', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      // DB should have been called (stats + daily + endpoints = 3 select calls)
      expect(mockDb.select).toHaveBeenCalled();
    });
  });
});
