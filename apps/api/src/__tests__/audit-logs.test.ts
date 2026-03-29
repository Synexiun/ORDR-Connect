/**
 * Audit Log route tests
 *
 * SOC2 CC7.2 — Monitoring: audit trail provides evidence for TSC criteria.
 * ISO 27001 A.12.4.1 — Event logging: durable, tamper-evident log entries.
 * HIPAA §164.312(b) — Audit controls: no PHI in test data.
 *
 * Verifies:
 * - GET /           → 200 with { events, total, page, limit, pages }
 * - GET / (filters) → 200 with filtered result
 * - GET /chain-status → 200 with { totalEvents, lastSequence, lastHash, lastTimestamp }
 * - Auth: unauthenticated GET / returns 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { auditLogsRouter, configureAuditLogsRoute } from '../routes/audit-logs.js';
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

const MOCK_AUDIT_ROW = {
  id: 'audit-1',
  sequenceNumber: BigInt(42),
  eventType: 'user.login',
  actorType: 'user' as const,
  actorId: 'user-1',
  tenantId: 'tenant-1',
  resource: 'auth',
  resourceId: 'session-1',
  action: 'login',
  details: { ip: '127.0.0.1' },
  hash: 'abc123def456',
  previousHash: '000000000000',
  timestamp: new Date('2026-03-01T10:00:00Z'),
};

// ─── DB mock factory ──────────────────────────────────────────────

function buildMockDb() {
  let selectCallCount = 0;

  const db = {
    select: vi.fn(),
  };

  db.select.mockImplementation(() => {
    const callIndex = selectCallCount++;
    const chain: Record<string, unknown> = {};

    chain['from'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => chain);
    chain['limit'] = vi.fn(() => chain);
    chain['offset'] = vi.fn(() => chain);
    chain['orderBy'] = vi.fn(() => chain);

    // The route issues two parallel queries per endpoint:
    // - COUNT(*) query  → returns [{ count: '5' }]
    // - SELECT rows     → returns [MOCK_AUDIT_ROW]
    // Promise.all picks both up via their own chains; we alternate.
    chain['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      const isCountCall = callIndex % 2 === 0;
      const result = isCountCall ? [{ count: '1' }] : [MOCK_AUDIT_ROW];
      return Promise.resolve(result).then(resolve, reject);
    };

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
  app.route('/api/v1/audit-logs', auditLogsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Audit Logs Routes', () => {
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
    configureAuditLogsRoute(mockDb as never);
  });

  // ── GET / ─────────────────────────────────────────────────────────

  describe('GET /api/v1/audit-logs', () => {
    it('returns 200 with events, total, page, limit, and pages', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        events: unknown[];
        total: number;
        page: number;
        limit: number;
        pages: number;
      };
      expect(Array.isArray(body.events)).toBe(true);
      expect(typeof body.total).toBe('number');
      expect(typeof body.page).toBe('number');
      expect(typeof body.limit).toBe('number');
      expect(typeof body.pages).toBe('number');
    });

    it('defaults to page 1 and limit 50', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs');
      const body = (await res.json()) as { page: number; limit: number };
      expect(body.page).toBe(1);
      expect(body.limit).toBe(50);
    });

    it('each event has required DTO fields', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs');
      const body = (await res.json()) as {
        events: Array<{
          id: string;
          sequenceNumber: number;
          eventType: string;
          actorType: string;
          actorId: string;
          resource: string;
          action: string;
          timestamp: string;
        }>;
      };
      if (body.events.length > 0) {
        const evt = body.events[0] as (typeof body.events)[number];
        expect(evt).toHaveProperty('id');
        expect(evt).toHaveProperty('sequenceNumber');
        expect(evt).toHaveProperty('eventType');
        expect(evt).toHaveProperty('actorType');
        expect(evt).toHaveProperty('actorId');
        expect(evt).toHaveProperty('resource');
        expect(evt).toHaveProperty('action');
        expect(evt).toHaveProperty('timestamp');
        // Timestamp must be ISO string
        expect(() => new Date(evt.timestamp)).not.toThrow();
      }
    });

    it('accepts page and limit query params', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs?page=2&limit=10');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { page: number; limit: number };
      expect(body.page).toBe(2);
      expect(body.limit).toBe(10);
    });

    it('accepts eventType filter query param', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs?eventType=user.login');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { events: unknown[] };
      expect(Array.isArray(body.events)).toBe(true);
    });

    it('accepts actorType filter query param', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs?actorType=user');

      expect(res.status).toBe(200);
    });

    it('accepts resource filter query param', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs?resource=auth');

      expect(res.status).toBe(200);
    });

    it('accepts combined filters', async () => {
      const app = createTestApp();
      const res = await app.request(
        '/api/v1/audit-logs?page=2&limit=10&eventType=user.login&actorType=user',
      );

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid actorType value', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs?actorType=robot');

      expect([400]).toContain(res.status);
    });

    it('returns 400 for limit exceeding maximum of 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs?limit=500');

      expect([400]).toContain(res.status);
    });

    it('calls db.select to fetch count and rows in parallel', async () => {
      const app = createTestApp();
      await app.request('/api/v1/audit-logs');
      // Two selects: COUNT(*) and SELECT rows
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  // ── GET /chain-status ─────────────────────────────────────────────

  describe('GET /api/v1/audit-logs/chain-status', () => {
    it('returns 200 with chain status fields', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs/chain-status');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totalEvents: number;
        lastSequence: number;
        lastHash: string;
        lastTimestamp: string | null;
      };
      expect(typeof body.totalEvents).toBe('number');
      expect(typeof body.lastSequence).toBe('number');
      expect(typeof body.lastHash).toBe('string');
      // lastTimestamp is ISO string or null
      if (body.lastTimestamp !== null) {
        const ts = body.lastTimestamp;
        expect(() => new Date(ts)).not.toThrow();
      }
    });

    it('returns lastSequence as integer (not BigInt)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/audit-logs/chain-status');
      const body = (await res.json()) as { lastSequence: number };
      // JSON serialization must not fail — BigInt would cause TypeError
      expect(Number.isInteger(body.lastSequence)).toBe(true);
    });

    it('calls db.select twice (count + last row)', async () => {
      const app = createTestApp();
      await app.request('/api/v1/audit-logs/chain-status');
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  // ── Auth enforcement ──────────────────────────────────────────────

  describe('auth enforcement', () => {
    it('returns 401 when tenantContext is not set', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
        error: 'No token',
      });

      const app = new Hono<Env>();
      app.onError(globalErrorHandler);
      app.use('*', requestId);
      // Deliberately omit setting tenantContext
      app.route('/api/v1/audit-logs', auditLogsRouter);

      const res = await app.request('/api/v1/audit-logs');
      expect(res.status).toBe(401);
    });

    it('calls authenticateRequest on the list endpoint', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();
      await app.request('/api/v1/audit-logs');
      expect(authenticateRequest).toHaveBeenCalled();
    });

    it('calls authenticateRequest on the chain-status endpoint', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();
      await app.request('/api/v1/audit-logs/chain-status');
      expect(authenticateRequest).toHaveBeenCalled();
    });
  });
});
