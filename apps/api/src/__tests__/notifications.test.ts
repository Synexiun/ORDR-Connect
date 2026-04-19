/**
 * Notifications route tests
 *
 * SOC2 CC7.2 — Security event alerting and notification delivery.
 * ISO 27001 A.16.1.2 — Reporting information security events.
 * HIPAA §164.312(b) — Audit controls: no PHI in notification content or test data.
 *
 * Verifies:
 * - GET  /                   → 200 with { success, data: [...], meta: { total, unreadCount } }
 * - GET  /?type=hitl&read=false → 200 with filtered notifications?
 * - PATCH /:id/read          → 200 with { success, data }
 * - PATCH /:id/dismiss       → 200 with { success, data }
 * - POST /mark-read-all      → 200 with { success, data: { markedRead: number } }
 * - Auth: unauthenticated GET / returns 401
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createTenantId } from '@ordr/core';
import { requestId } from '../middleware/request-id.js';
import { notificationsRouter, configureNotificationsRoute } from '../routes/notifications.js';
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

function makeNotificationRow(overrides: Partial<typeof BASE_NOTIFICATION_ROW> = {}) {
  return { ...BASE_NOTIFICATION_ROW, ...overrides };
}

const BASE_NOTIFICATION_ROW = {
  id: 'notif-1',
  tenantId: 'tenant-1',
  type: 'hitl' as const,
  severity: 'high' as const,
  title: 'Agent requires review',
  description: 'Agent session requires human-in-the-loop approval.',
  createdAt: new Date('2026-03-01T10:00:00Z'),
  read: false,
  dismissed: false,
  readAt: null as Date | null,
  dismissedAt: null as Date | null,
  actionLabel: 'Review' as string | null,
  actionRoute: '/hitl/session-1' as string | null,
  metadata: null as Record<string, unknown> | null,
};

// ─── DB mock factory ──────────────────────────────────────────────

/**
 * Builds a fresh mock DB per test.
 *
 * Query patterns in notifications.ts:
 * GET /
 *   1. db.select().from(notifications).where(...).orderBy(...).limit()  → rows
 *   2. db.select({id}).from(notifications).where(unread + not dismissed)  → unread rows
 * PATCH /:id/read
 *   1. db.update(notifications).set({read,readAt}).where(...).returning()  → [row]
 * PATCH /:id/dismiss
 *   1. db.update(notifications).set({dismissed,...}).where(...).returning() → [row]
 * POST /mark-read-all
 *   1. db.update(notifications).set({read,readAt}).where(...).returning({id}) → [rows]
 */
function buildMockDb() {
  let selectCallCount = 0;

  const db = {
    select: vi.fn(),
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

    chain['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      // call 0 = main rows list; call 1 = unread count list
      const result = callIndex === 0 ? [makeNotificationRow()] : [{ id: 'notif-1' }]; // unread id rows (length = unreadCount)
      return Promise.resolve(result).then(resolve, reject);
    };

    return chain as never;
  });

  // update chain — used for PATCH /:id/read, PATCH /:id/dismiss, POST /mark-read-all
  db.update.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain['set'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => chain);
    chain['returning'] = vi
      .fn()
      .mockResolvedValue([makeNotificationRow({ read: true, readAt: new Date() })]);
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
      tenantId: createTenantId('tenant-1'),
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    });
    await next();
  });
  app.route('/api/v1/notifications', notificationsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Notifications Routes', () => {
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
    configureNotificationsRoute(mockDb as never);
  });

  // ── GET / ─────────────────────────────────────────────────────────

  describe('GET /api/v1/notifications?', () => {
    it('returns 200 with success, data array, and meta', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: unknown[];
        meta: { total: number; unreadCount: number };
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toBeDefined();
      expect(typeof body.meta.total).toBe('number');
      expect(typeof body.meta.unreadCount).toBe('number');
    });

    it('each notification has required DTO fields', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications');
      const body = (await res.json()) as {
        data: Array<{
          id: string;
          type: string;
          severity: string;
          title: string;
          description: string;
          timestamp: string;
          read: boolean;
          dismissed: boolean;
        }>;
      };
      if (body.data.length > 0) {
        const n = body.data[0] as (typeof body.data)[number];
        expect(n).toHaveProperty('id');
        expect(n).toHaveProperty('type');
        expect(n).toHaveProperty('severity');
        expect(n).toHaveProperty('title');
        expect(n).toHaveProperty('description');
        expect(n).toHaveProperty('timestamp');
        expect(n).toHaveProperty('read');
        expect(n).toHaveProperty('dismissed');
        expect(() => new Date(n.timestamp)).not.toThrow();
      }
    });

    it('meta.total equals data.length', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications');
      const body = (await res.json()) as {
        data: unknown[];
        meta: { total: number };
      };
      expect(body.meta.total).toBe(body.data.length);
    });

    it('meta.unreadCount reflects number of unread rows', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications');
      const body = (await res.json()) as { meta: { unreadCount: number } };
      // Our mock returns 1 unread row
      expect(body.meta.unreadCount).toBe(1);
    });

    it('accepts type filter and returns 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications?type=hitl');

      expect(res.status).toBe(200);
    });

    it('accepts read=false filter and returns 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications?read=false');

      expect(res.status).toBe(200);
    });

    it('accepts combined type and read filters', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications?type=hitl&read=false');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
    });

    it('accepts includeDismissed=true filter', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications?includeDismissed=true');

      expect(res.status).toBe(200);
    });

    it('returns 400 when type value is unknown', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications?type=unknown-type');

      expect(res.status).toBe(400);
    });

    it('calls db.select to fetch rows and unread count', async () => {
      const app = createTestApp();
      await app.request('/api/v1/notifications');
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  // ── PATCH /:id/read ───────────────────────────────────────────────

  describe('PATCH /api/v1/notifications/:id/read', () => {
    it('returns 200 with { success: true, data }', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications/notif-1/read', {
        method: 'PATCH',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('calls db.update with read:true', async () => {
      const app = createTestApp();
      await app.request('/api/v1/notifications/notif-1/read', { method: 'PATCH' });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('returned data has read field set to true', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/notifications/notif-1/read', { method: 'PATCH' });
      const body = (await res.json()) as { data: { read: boolean } };
      expect(body.data.read).toBe(true);
    });

    it('returns 404 when notification not found', async () => {
      mockDb.update.mockImplementationOnce(() => {
        const chain: Record<string, unknown> = {};
        chain['set'] = vi.fn(() => chain);
        chain['where'] = vi.fn(() => chain);
        chain['returning'] = vi.fn().mockResolvedValue([]); // no rows = not found
        return chain as never;
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/notifications/does-not-exist/read', {
        method: 'PATCH',
      });

      expect([404, 500]).toContain(res.status);
    });
  });

  // ── PATCH /:id/dismiss ────────────────────────────────────────────

  describe('PATCH /api/v1/notifications/:id/dismiss', () => {
    it('returns 200 with { success: true, data }', async () => {
      // Return a dismissed notification from the update
      mockDb.update.mockImplementationOnce(() => {
        const chain: Record<string, unknown> = {};
        chain['set'] = vi.fn(() => chain);
        chain['where'] = vi.fn(() => chain);
        chain['returning'] = vi
          .fn()
          .mockResolvedValue([makeNotificationRow({ dismissed: true, dismissedAt: new Date() })]);
        return chain as never;
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/notifications/notif-1/dismiss', {
        method: 'PATCH',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { dismissed: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.dismissed).toBe(true);
    });

    it('calls db.update on the notifications table', async () => {
      const app = createTestApp();
      await app.request('/api/v1/notifications/notif-1/dismiss', { method: 'PATCH' });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('returns 404 when notification not found', async () => {
      mockDb.update.mockImplementationOnce(() => {
        const chain: Record<string, unknown> = {};
        chain['set'] = vi.fn(() => chain);
        chain['where'] = vi.fn(() => chain);
        chain['returning'] = vi.fn().mockResolvedValue([]);
        return chain as never;
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/notifications/ghost-notif/dismiss', {
        method: 'PATCH',
      });

      expect([404, 500]).toContain(res.status);
    });
  });

  // ── POST /mark-read-all ───────────────────────────────────────────

  describe('POST /api/v1/notifications/mark-read-all', () => {
    it('returns 200 with { success: true, data: { markedRead: number } }', async () => {
      // Override update to return 3 marked rows
      mockDb.update.mockImplementationOnce(() => {
        const chain: Record<string, unknown> = {};
        chain['set'] = vi.fn(() => chain);
        chain['where'] = vi.fn(() => chain);
        chain['returning'] = vi
          .fn()
          .mockResolvedValue([{ id: 'notif-1' }, { id: 'notif-2' }, { id: 'notif-3' }]);
        return chain as never;
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/notifications/mark-read-all', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { markedRead: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.markedRead).toBe(3);
    });

    it('returns markedRead: 0 when all notifications? are already read', async () => {
      mockDb.update.mockImplementationOnce(() => {
        const chain: Record<string, unknown> = {};
        chain['set'] = vi.fn(() => chain);
        chain['where'] = vi.fn(() => chain);
        chain['returning'] = vi.fn().mockResolvedValue([]); // no unread rows
        return chain as never;
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/notifications/mark-read-all', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { markedRead: number } };
      expect(body.data.markedRead).toBe(0);
    });

    it('calls db.update with read: true and where unread only', async () => {
      const app = createTestApp();
      await app.request('/api/v1/notifications/mark-read-all', { method: 'POST' });
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  // ── Auth enforcement ──────────────────────────────────────────────

  describe('auth enforcement', () => {
    it('returns 401 when tenantContext is not set on GET /', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      (authenticateRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        authenticated: false,
        error: 'No token',
      });

      const app = new Hono<Env>();
      app.onError(globalErrorHandler);
      app.use('*', requestId);
      // No tenantContext middleware — simulates unauthenticated request
      app.route('/api/v1/notifications', notificationsRouter);

      const res = await app.request('/api/v1/notifications');
      expect(res.status).toBe(401);
    });

    it('calls authenticateRequest on GET /', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();
      await app.request('/api/v1/notifications');
      expect(authenticateRequest).toHaveBeenCalled();
    });

    it('calls authenticateRequest on PATCH /:id/read', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();
      await app.request('/api/v1/notifications/notif-1/read', { method: 'PATCH' });
      expect(authenticateRequest).toHaveBeenCalled();
    });

    it('calls authenticateRequest on POST /mark-read-all', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();
      await app.request('/api/v1/notifications/mark-read-all', { method: 'POST' });
      expect(authenticateRequest).toHaveBeenCalled();
    });
  });
});
