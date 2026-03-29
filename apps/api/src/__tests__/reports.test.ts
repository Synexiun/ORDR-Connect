/**
 * Reports route tests
 *
 * SOC2 PI1.4 — Processing integrity: report generation audit trail.
 * HIPAA §164.308(a)(8) — No PHI in test data (aggregate metrics only).
 *
 * Verifies:
 * - GET  /templates           → 200 with template array
 * - GET  /recent              → 200 with array
 * - GET  /schedules           → 200 with array
 * - POST /generate            → 201 with report object
 * - POST /generate (missing)  → 422/400
 * - POST /schedules           → 201 with schedule object
 * - DELETE /schedules/:id     → 204
 * - GET  /:id                 → 200 with report data
 * - GET  /:id/export?format=csv → 200 with CSV content
 * - Auth: unauthenticated GET /templates returns 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { reportsRouter, configureReportRoutes } from '../routes/reports.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';

// ─── Mock @ordr/auth ──────────────────────────────────────────────

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

// ─── Fixture data — no PHI ────────────────────────────────────────

const MOCK_GENERATED_REPORT = {
  id: 'report-1',
  type: 'operations',
  name: 'Operations Summary - Mar 2026',
  generatedAt: new Date('2026-03-01T10:00:00Z'),
  generatedBy: 'ops@example.com',
  timeRangeStart: new Date('2026-03-01T00:00:00Z'),
  timeRangeEnd: new Date('2026-03-07T23:59:59Z'),
  status: 'completed',
  rowCount: 120,
  sizeBytes: 18000,
  reportData: {
    summary: [{ label: 'Total Interactions', value: '120', trend: '+8.2%' }],
    chartData: { labels: ['Mar 1'], datasets: [] },
    tableHeaders: ['Date', 'Interactions'],
    tableRows: [['Mar 1', '120']],
  },
};

const MOCK_SCHEDULE = {
  id: 'sched-1',
  name: 'Weekly Ops',
  type: 'operations',
  frequency: 'weekly',
  recipients: ['ops@example.com'],
  nextRun: new Date('2026-04-07T00:00:00Z'),
  lastRun: null,
  status: 'active',
};

// ─── DB mock factory ──────────────────────────────────────────────

function buildMockDb() {
  let selectCallCount = 0;

  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };

  db.select.mockImplementation(() => {
    const callIndex = selectCallCount++;
    const chain: Record<string, unknown> = {};

    chain['from'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => chain);
    chain['limit'] = vi.fn(() => chain);
    chain['offset'] = vi.fn(() => chain);
    chain['orderBy'] = vi.fn(() => chain);
    chain['groupBy'] = vi.fn(() => chain);

    // Resolve based on call order:
    // 0 = generatedReports list (GET /recent)
    // 1 = reportSchedules list (GET /schedules)
    // 2+ = computeReportData sub-queries (use count rows = 0 = safe)
    const defaults: Record<number, unknown> = {
      0: [MOCK_GENERATED_REPORT], // GET /recent
      1: [MOCK_SCHEDULE], // GET /schedules
    };

    chain['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      const result = defaults[callIndex] ?? [{ cnt: 0, count: '0' }];
      return Promise.resolve(result).then(resolve, reject);
    };

    return chain as never;
  });

  // insert chain — table-name-aware
  db.insert.mockImplementation((table: unknown) => {
    const tableName = (table as Record<symbol, string>)[Symbol.for('drizzle:Name')] ?? '';
    const chain: Record<string, unknown> = {};
    chain['values'] = vi.fn(() => chain);
    chain['returning'] = vi
      .fn()
      .mockResolvedValue(
        tableName.includes('schedule') ? [MOCK_SCHEDULE] : [MOCK_GENERATED_REPORT],
      );
    return chain as never;
  });

  // delete chain — must include .returning() for schedules delete
  db.delete.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain['where'] = vi.fn(() => chain);
    chain['returning'] = vi.fn().mockResolvedValue([{ id: 'sched-1' }]);
    return chain as never;
  });

  return db;
}

// ─── Test app factory ─────────────────────────────────────────────

function createTestApp() {
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
  app.route('/api/v1/reports', reportsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Reports Routes', () => {
  let mockDb: ReturnType<typeof buildMockDb>;

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockDb = buildMockDb();

    // Rebuild fresh counts per test
    mockDb.select.mockImplementation(buildPerTestSelectMock(mockDb));

    configureReportRoutes({ db: mockDb as never });
  });

  /** Returns a fresh table-name-aware select mock for each test. */
  function buildPerTestSelectMock(_db: ReturnType<typeof buildMockDb>) {
    return () => {
      const chain: Record<string, unknown> = {};
      let targetTable = '';

      chain['from'] = vi.fn((table: unknown) => {
        targetTable = (table as Record<symbol, string>)[Symbol.for('drizzle:Name')] ?? '';
        return chain;
      });
      chain['where'] = vi.fn(() => chain);
      chain['limit'] = vi.fn(() => chain);
      chain['offset'] = vi.fn(() => chain);
      chain['orderBy'] = vi.fn(() => chain);
      chain['groupBy'] = vi.fn(() => chain);

      chain['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        let result: unknown;
        if (targetTable.includes('schedule')) {
          result = [MOCK_SCHEDULE];
        } else if (targetTable.includes('generated_report') || targetTable.includes('report')) {
          result = [MOCK_GENERATED_REPORT];
        } else {
          result = [{ cnt: 0, count: '0' }];
        }
        return Promise.resolve(result).then(resolve, reject);
      };
      return chain as never;
    };
  }

  // ── GET /templates ────────────────────────────────────────────────

  describe('GET /api/v1/reports/templates', () => {
    it('returns 200 with template array', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/templates');

      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it('each template has type, name, description, and metrics', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/templates');
      const body = (await res.json()) as Array<{
        type: string;
        name: string;
        description: string;
        metrics: string[];
      }>;
      expect(body[0]).toHaveProperty('type');
      expect(body[0]).toHaveProperty('name');
      expect(body[0]).toHaveProperty('description');
      expect(body[0]).toHaveProperty('metrics');
    });
  });

  // ── GET /recent ───────────────────────────────────────────────────

  describe('GET /api/v1/reports/recent', () => {
    it('returns 200 with recently generated reports array', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/recent');

      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
    });

    it('calls db.select for tenant-scoped reports', async () => {
      const app = createTestApp();
      await app.request('/api/v1/reports/recent');
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  // ── GET /schedules ────────────────────────────────────────────────

  describe('GET /api/v1/reports/schedules', () => {
    it('returns 200 with scheduled reports array', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/schedules');

      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // ── POST /generate ────────────────────────────────────────────────

  describe('POST /api/v1/reports/generate', () => {
    it('returns 201 with generated report on valid body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'operations',
          timeRange: {
            start: '2026-03-01T00:00:00.000Z',
            end: '2026-03-07T23:59:59.000Z',
          },
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        type: string;
        name: string;
        status: string;
      };
      expect(body.id).toBeDefined();
      expect(body.type).toBe('operations');
      expect(body.status).toBe('completed');
    });

    it('returns 400/422 when type is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeRange: { start: '2026-03-01T00:00:00.000Z', end: '2026-03-07T23:59:59.000Z' },
        }),
      });

      expect([400, 422]).toContain(res.status);
    });

    it('returns 400/422 when timeRange is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'operations' }),
      });

      expect([400, 422]).toContain(res.status);
    });

    it('returns 400/422 on invalid report type', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'not-a-valid-type',
          timeRange: { start: '2026-03-01T00:00:00.000Z', end: '2026-03-07T23:59:59.000Z' },
        }),
      });

      expect([400, 422]).toContain(res.status);
    });
  });

  // ── POST /schedules ───────────────────────────────────────────────

  describe('POST /api/v1/reports/schedules', () => {
    it('returns 201 with new schedule on valid body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Weekly Ops',
          type: 'operations',
          frequency: 'weekly',
          recipients: ['ops@example.com'],
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        name: string;
        type: string;
        frequency: string;
        recipients: string[];
        status: string;
      };
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Weekly Ops');
      expect(body.frequency).toBe('weekly');
      expect(body.status).toBe('active');
    });

    it('returns 400/422 when recipients array is empty', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Weekly Ops',
          type: 'operations',
          frequency: 'weekly',
          recipients: [],
        }),
      });

      expect([400, 422]).toContain(res.status);
    });

    it('returns 400/422 when recipient email is invalid', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Weekly Ops',
          type: 'operations',
          frequency: 'weekly',
          recipients: ['not-an-email'],
        }),
      });

      expect([400, 422]).toContain(res.status);
    });
  });

  // ── DELETE /schedules/:id ─────────────────────────────────────────

  describe('DELETE /api/v1/reports/schedules/:id', () => {
    it('returns 204 on successful delete', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/schedules/sched-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });

  // ── GET /:id ──────────────────────────────────────────────────────

  describe('GET /api/v1/reports/:id', () => {
    it('returns 200 with full report data', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/report-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: string;
        type: string;
        name: string;
        generatedAt: string;
      };
      expect(body.id).toBeDefined();
      expect(body.type).toBeDefined();
      expect(body.name).toBeDefined();
      expect(body.generatedAt).toBeDefined();
    });
  });

  // ── GET /:id/export ───────────────────────────────────────────────

  describe('GET /api/v1/reports/:id/export', () => {
    it('returns 200 with CSV content for format=csv', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/report-1/export?format=csv');

      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('text/csv');
    });

    it('returns 200 with JSON content for format=json', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/reports/report-1/export?format=json');

      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('application/json');
    });
  });

  // ── Auth enforcement ──────────────────────────────────────────────

  describe('auth enforcement', () => {
    it('returns 401 on GET /templates when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      // Mock auth to fail for BOTH requests (templates + recent both go through requireAuth)
      (authenticateRequest as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ authenticated: false, context: undefined as never })
        .mockResolvedValueOnce({ authenticated: false, context: undefined as never });

      const app = new Hono<Env>();
      app.onError(globalErrorHandler);
      app.use('*', requestId);
      // No tenantContext set — simulates missing auth middleware
      app.route('/api/v1/reports', reportsRouter);

      const res = await app.request('/api/v1/reports/templates');
      // templates goes through requireAuth → 401 when unauthenticated
      expect(res.status).toBe(401);
      const res2 = await app.request('/api/v1/reports/recent');
      expect([401, 403, 500]).toContain(res2.status);
    });

    it('calls authenticateRequest on protected routes', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();
      await app.request('/api/v1/reports/recent');
      expect(authenticateRequest).toHaveBeenCalled();
    });
  });
});
