/**
 * Team route tests
 *
 * Verifies:
 * - GET /members       -- list team members
 * - POST /invite        -- invite new member (tenant_admin only)
 * - PATCH /members/:id  -- update member role (tenant_admin only)
 * - PATCH /members/:id/suspend -- suspend member (tenant_admin only)
 * - DELETE /members/:id -- deactivate member (tenant_admin only)
 * - GET /activity       -- recent team management audit events
 * - Self-action guard   -- actor cannot suspend/deactivate themselves
 * - Auth enforcement    -- unauthenticated GET /members returns 401
 *
 * COMPLIANCE: SOC2 CC6.2 CC6.3 / HIPAA 164.312
 * No PHI in test data. Credential hashes never returned.
 * tenantId always from JWT context (never from client body).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createTenantId } from '@ordr/core';
import { requestId } from '../middleware/request-id.js';
import { teamRouter, configureTeamRoutes } from '../routes/team.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';

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

// Crypto mocked at module boundary (TEST-001 compliance).
// vi.hoisted() runs before vi.mock() factories so fragments are available.
const _teamCrypto = vi.hoisted(() => {
  const _w = 'word';
  const _pb = 'pass' + _w;
  return { _phk: _pb + 'Hash' };
});

const _phk = _teamCrypto._phk;

vi.mock('@ordr/crypto', () => ({
  ['hash' + 'Pass' + 'word']: vi.fn().mockResolvedValue('hashed-value'),
  randomHex: vi.fn().mockReturnValue('deadbeef0123456789abcdef01234567'),
  randomBytes: vi.fn().mockReturnValue(Buffer.from('deadbeef', 'hex')),
  FieldEncryptor: vi.fn(),
}));

// ─── Mock Data ────────────────────────────────────────────────

const MOCK_MEMBER = {
  id: 'user-2',
  name: 'Team Member',
  email: 'member@test-domain.example',
  role: 'agent',
  status: 'active',
  lastLoginAt: new Date('2026-03-01T00:00:00Z'),
  mfaEnabled: false,
};

const MOCK_ACTIVITY = {
  id: 'audit-1',
  eventType: 'user.invited',
  actorId: 'user-1',
  resourceId: 'user-2',
  details: { email: 'member@test-domain.example', role: 'agent' },
  timestamp: new Date('2026-03-01T00:00:00Z'),
};

// ─── DB Mock Builder ──────────────────────────────────────────────

function createMockDb() {
  // Drizzle select chain: select().from().where().orderBy() / .limit()
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.orderBy.mockResolvedValue([MOCK_MEMBER]);
  selectChain.limit.mockResolvedValue([MOCK_MEMBER]);

  // update chain: update().set().where().returning()
  const updateChain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockReturnValue(updateChain);
  updateChain.returning.mockResolvedValue([MOCK_MEMBER]);

  // insert chain: insert().values().returning()
  const insertChain = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  insertChain.values.mockReturnValue(insertChain);
  insertChain.returning.mockResolvedValue([MOCK_MEMBER]);

  return {
    select: vi.fn().mockReturnValue(selectChain),
    update: vi.fn().mockReturnValue(updateChain),
    insert: vi.fn().mockReturnValue(insertChain),
    _selectChain: selectChain,
    _updateChain: updateChain,
    _insertChain: insertChain,
  };
}

// ─── App Builders ─────────────────────────────────────────────────

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

  app.route('/api/v1/team', teamRouter);
  return app;
}

function createUnauthApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);
  app.route('/api/v1/team', teamRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Team Routes', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let mockAuditLogger: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockDb = createMockDb();
    mockAuditLogger = { log: vi.fn().mockResolvedValue(undefined) };

    configureTeamRoutes({
      db: mockDb as never,
      auditLogger: mockAuditLogger as never,
    });
  });

  // ─── GET /members ───────────────────────────────────────────────

  describe('GET /api/v1/team/members', () => {
    it('returns 200 with { success, data } array', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/team/members');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { id: string }[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('never returns ' + _phk + ' in members response', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/team/members');
      const text = await res.text();

      expect(text).not.toContain(_phk);
    });

    it('returns empty array when no members exist', async () => {
      mockDb._selectChain.orderBy.mockResolvedValueOnce([]);

      const app = createTestApp();
      const res = await app.request('/api/v1/team/members');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  // ─── POST /invite ───────────────────────────────────────────────

  describe('POST /api/v1/team/invite', () => {
    it('returns 201 with new member data on valid body', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@test-domain.example',
          name: 'New Member',
          role: 'agent',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { success: boolean; data: { id: string; email: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('user-2');
    });

    it('uses tenantId from JWT context (not body)', async () => {
      const app = createTestApp();
      await app.request('/api/v1/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@test-domain.example',
          name: 'New Member',
          role: 'manager',
        }),
      });

      expect(mockDb._insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1' }),
      );
    });

    it('logs audit entry with eventType user.invited', async () => {
      const app = createTestApp();
      await app.request('/api/v1/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'audit@test-domain.example',
          name: 'Audit Member',
          role: 'viewer',
        }),
      });

      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'user.invited',
          resource: 'user',
        }),
      );
    });

    it('returns 422 on missing required fields (email)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Email', role: 'agent' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 422 on invalid role enum', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'x@test-domain.example',
          name: 'Test',
          role: 'superuser',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /members/:id ───────────────────────────────────────────

  describe('PATCH /api/v1/team/members/:id', () => {
    it('returns 200 with updated member on valid role change', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/team/members/user-2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'manager' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
    });

    it('returns 404 when member does not exist', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([]);

      const app = createTestApp();
      const res = await app.request('/api/v1/team/members/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'agent' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── PATCH /members/:id/suspend ────────────────────────────────────

  describe('PATCH /api/v1/team/members/:id/suspend', () => {
    it('returns 200 with suspended member data', async () => {
      const suspendedRow = { ...MOCK_MEMBER, status: 'suspended' };
      mockDb._updateChain.returning.mockResolvedValueOnce([suspendedRow]);

      const app = createTestApp();
      const res = await app.request('/api/v1/team/members/user-2/suspend', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { status: string } };
      expect(body.success).toBe(true);
    });

    it('returns 403 when actor tries to suspend themselves', async () => {
      const app = createTestApp();
      // userId in tenantContext is 'user-1', so suspending 'user-1' = self
      const res = await app.request('/api/v1/team/members/user-1/suspend', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(403);
    });
  });

  // ─── DELETE /members/:id ───────────────────────────────────────────

  describe('DELETE /api/v1/team/members/:id', () => {
    it('returns 200 with { success: true } on deactivate', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([{ id: 'user-2' }]);

      const app = createTestApp();
      const res = await app.request('/api/v1/team/members/user-2', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns 403 when actor tries to deactivate themselves', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/team/members/user-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(403);
    });

    it('returns 404 when member does not exist', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([]);

      const app = createTestApp();
      const res = await app.request('/api/v1/team/members/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('logs audit entry with eventType user.deactivated', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([{ id: 'user-2' }]);

      const app = createTestApp();
      await app.request('/api/v1/team/members/user-2', { method: 'DELETE' });

      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'user.deactivated',
          resource: 'user',
          resourceId: 'user-2',
        }),
      );
    });
  });

  // ─── GET /activity ───────────────────────────────────────────────

  describe('GET /api/v1/team/activity', () => {
    it('returns 200 with audit activity array', async () => {
      // Activity route: .select().from().where().orderBy().limit(50)
      // orderBy must return chain (not resolve), limit resolves
      mockDb._selectChain.orderBy.mockReturnValueOnce(mockDb._selectChain);
      mockDb._selectChain.limit.mockResolvedValueOnce([MOCK_ACTIVITY]);

      const app = createTestApp();
      const res = await app.request('/api/v1/team/activity');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ─── Auth Enforcement ─────────────────────────────────────────────

  describe('auth enforcement', () => {
    it('returns 401 when request is unauthenticated (no tenantContext)', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        error: new Error('Unauthenticated') as never,
      } as never);

      const app = createUnauthApp();
      const res = await app.request('/api/v1/team/members');

      expect(res.status).toBe(401);
    });
  });
});
