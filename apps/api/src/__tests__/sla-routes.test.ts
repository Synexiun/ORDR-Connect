/**
 * SLA Routes tests — SLA breach status and manual check trigger
 *
 * SOC2 CC7.2 — Monitoring: SLA breach detection and alerting.
 * ISO 27001 A.16.1.1 — Information security event reporting.
 *
 * Verifies:
 * - POST /check → 200 with { success: true, data: { breachesFound: number } }
 * - GET /status → 200 with { enabled, thresholdHours, intervalMinutes }
 * - Auth: unauthenticated POST /check → 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { slaRouter, configureSlaRoutes } from '../routes/sla.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';

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

// ─── Mock SlaChecker ─────────────────────────────────────────────

function createMockChecker(breachCount = 3) {
  return {
    check: vi.fn().mockResolvedValue(breachCount),
    start: vi.fn(),
    stop: vi.fn(),
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
        userId: 'user-1',
        roles: ['tenant_admin'],
        permissions: [],
      });
      await next();
    });
  }

  app.route('/api/v1/sla', slaRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('SLA Routes', () => {
  let mockChecker: ReturnType<typeof createMockChecker>;

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-public-key',
      privateKey: 'test-private-key',
      issuer: 'test-issuer',
      audience: 'test-audience',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockChecker = createMockChecker();
    configureSlaRoutes(mockChecker as never);
  });

  // ─── POST /check ─────────────────────────────────────────────

  describe('POST /api/v1/sla/check', () => {
    it('returns 200 with breachesFound count', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/sla/check', {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { breachesFound: number };
      };
      expect(body.success).toBe(true);
      expect(typeof body.data.breachesFound).toBe('number');
      expect(body.data.breachesFound).toBe(3);
    });

    it('calls checker.check() exactly once per request', async () => {
      const app = createTestApp();
      await app.request('/api/v1/sla/check', {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(mockChecker.check).toHaveBeenCalledTimes(1);
    });

    it('returns breachesFound: 0 when checker finds no breaches', async () => {
      configureSlaRoutes(createMockChecker(0) as never);

      const app = createTestApp();
      const res = await app.request('/api/v1/sla/check', {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { breachesFound: number } };
      expect(body.data.breachesFound).toBe(0);
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/sla/check', { method: 'POST' });

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /status ─────────────────────────────────────────────

  describe('GET /api/v1/sla/status', () => {
    it('returns 200 with enabled, thresholdHours, intervalMinutes', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/sla/status', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { enabled: boolean; thresholdHours: number; intervalMinutes: number };
      };
      expect(body.success).toBe(true);
      expect(typeof body.data.enabled).toBe('boolean');
      expect(typeof body.data.thresholdHours).toBe('number');
      expect(typeof body.data.intervalMinutes).toBe('number');
    });

    it('returns enabled:true when checker is configured', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/sla/status', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: { enabled: boolean } };
      // Checker was configured in beforeEach
      expect(body.data.enabled).toBe(true);
    });

    it('returns correct threshold and interval defaults', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/sla/status', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as {
        data: { thresholdHours: number; intervalMinutes: number };
      };
      expect(body.data.thresholdHours).toBe(4);
      expect(body.data.intervalMinutes).toBe(5);
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/sla/status');

      expect(res.status).toBe(401);
    });
  });
});
