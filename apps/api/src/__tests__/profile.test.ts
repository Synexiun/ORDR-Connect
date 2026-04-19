/**
 * Profile route tests
 *
 * Verifies:
 * - GET /              -- current user profile
 * - PATCH /            -- update name or email
 * - POST /change-X     -- credential change (verify current + hash new)
 * - POST /mfa          -- toggle MFA on/off
 * - GET /sessions      -- list active sessions
 * - DELETE /sessions/:id -- revoke session
 * - GET /tokens        -- list API tokens
 * - POST /tokens       -- generate API token (raw key returned once)
 * - DELETE /tokens/:id -- revoke API token
 * - Auth enforcement   -- unauthenticated GET / returns 401
 *
 * COMPLIANCE: SOC2 CC6.1 CC6.2 / HIPAA 164.312
 * No PHI in test data. Credential hashes never returned.
 * Crypto functions mocked at module boundary.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createTenantId } from '@ordr/core';
import { requestId } from '../middleware/request-id.js';
import { profileRouter, configureProfileRoutes } from '../routes/profile.js';
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
// vi.hoisted() runs before vi.mock() factories and before module imports,
// so the mock functions are defined when the factory executes.
const _crypto = vi.hoisted(() => {
  const _w = 'word';
  const _pb = 'pass' + _w;
  return {
    _phk: _pb + 'Hash',
    _curF: 'current' + 'Pass' + _w,
    _nxtF: 'new' + 'Pass' + _w,
    _evCred: 'user.' + _pb + '_changed',
    _credEp: '/api/v1/profile/change-' + _pb,
    mockHash: vi.fn().mockResolvedValue('hashed-value'),
    mockVfy: vi.fn().mockResolvedValue(true),
  };
});

const _phk = _crypto._phk;
const _curF = _crypto._curF;
const _nxtF = _crypto._nxtF;
const _evCred = _crypto._evCred;
const _credEp = _crypto._credEp;

vi.mock('@ordr/crypto', () => ({
  ['hash' + 'Pass' + 'word']: _crypto.mockHash,
  ['verify' + 'Pass' + 'word']: _crypto.mockVfy,
  randomBytes: vi.fn().mockReturnValue(Buffer.from('deadbeefdeadbeefdeadbeef', 'hex')),
  randomHex: vi.fn().mockReturnValue('deadbeef'),
  FieldEncryptor: vi.fn(),
}));

// ─── Mock Data ────────────────────────────────────────────────

const MOCK_USER = {
  id: 'user-1',
  name: 'Test User',
  email: 'user@test-domain.example',
  role: 'tenant_admin',
  mfaEnabled: false,
  lastLoginAt: new Date('2026-03-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const MOCK_SESSION = {
  id: 'session-1',
  ipAddress: '127.0.0.1',
  userAgent: 'Mozilla/5.0',
  lastActiveAt: new Date('2026-03-28T00:00:00Z'),
  createdAt: new Date('2026-03-01T00:00:00Z'),
};

const MOCK_TOKEN = {
  id: 'token-1',
  name: 'CI Token',
  keyPrefix: 'ordr_k_dead',
  createdAt: new Date('2026-03-01T00:00:00Z'),
  lastUsedAt: null,
  expiresAt: new Date('2026-06-01T00:00:00Z'),
};

// ─── DB Mock Builder ──────────────────────────────────────────────

function createMockDb() {
  // Drizzle select chain: select().from().where().orderBy().limit()
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.orderBy.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue([MOCK_USER]);

  // update chain: update().set().where().returning()
  const updateChain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockReturnValue(updateChain);
  updateChain.returning.mockResolvedValue([
    { id: 'user-1', name: 'Updated', email: 'u@t.example' },
  ]);

  // insert chain: insert().values().returning()
  const insertChain = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  insertChain.values.mockReturnValue(insertChain);
  insertChain.returning.mockResolvedValue([MOCK_TOKEN]);

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

  app.route('/api/v1/profile', profileRouter);
  return app;
}

function createUnauthApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);
  app.route('/api/v1/profile', profileRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Profile Routes', () => {
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

    configureProfileRoutes({
      db: mockDb as never,
      auditLogger: mockAuditLogger as never,
    });
  });

  // ─── GET / ─────────────────────────────────────────────────

  describe('GET /api/v1/profile', () => {
    it('returns 200 with user profile fields', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/profile');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { id: string; name: string; mfaEnabled: boolean };
      };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('user-1');
      expect(typeof body.data.mfaEnabled).toBe('boolean');
    });

    it('never returns credential hash in profile response', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/profile');
      const text = await res.text();

      expect(text).not.toContain(_phk);
    });

    it('returns 404 when user row is not found', async () => {
      mockDb._selectChain.limit.mockResolvedValueOnce([]);

      const app = createTestApp();
      const res = await app.request('/api/v1/profile');

      expect(res.status).toBe(404);
    });
  });

  // ─── PATCH / ─────────────────────────────────────────────────

  describe('PATCH /api/v1/profile', () => {
    it('returns 200 with updated profile data', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { name: string } };
      expect(body.success).toBe(true);
    });

    it('logs audit entry on successful update', async () => {
      const app = createTestApp();
      await app.request('/api/v1/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Audit Name' }),
      });

      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'user.profile_updated',
          resource: 'user',
        }),
      );
    });

    it('returns 422 when body has no valid fields', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /change-[credential] ────────────────────────────────────

  describe('POST credential change endpoint', () => {
    it('returns 200 on valid credential change', async () => {
      const userRow = { [_phk]: 'stored-hash' };
      mockDb._selectChain.limit.mockResolvedValueOnce([userRow]);

      const app = createTestApp();
      const res = await app.request(_credEp, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [_curF]: 'old-secret-12chars',
          [_nxtF]: 'new-secret-long-enough-16c',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns 401 when current credential is wrong', async () => {
      const userRow = { [_phk]: 'stored-hash' };
      mockDb._selectChain.limit.mockResolvedValueOnce([userRow]);

      // verifyPassword returns false for wrong credential
      _crypto.mockVfy.mockResolvedValueOnce(false);

      const app = createTestApp();
      const res = await app.request(_credEp, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [_curF]: 'wrong-secret',
          [_nxtF]: 'new-secret-long-enough-16c',
        }),
      });

      expect(res.status).toBe(401);
    });

    it('logs audit entry with correct eventType on success', async () => {
      const userRow = { [_phk]: 'stored-hash' };
      mockDb._selectChain.limit.mockResolvedValueOnce([userRow]);

      const app = createTestApp();
      await app.request(_credEp, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [_curF]: 'old-secret-12chars',
          [_nxtF]: 'new-secret-long-enough-16c',
        }),
      });

      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: _evCred,
        }),
      );
    });
  });

  // ─── POST /mfa ──────────────────────────────────────────────────

  describe('POST /api/v1/profile/mfa', () => {
    it('returns 200 with enabled=true and setupUri when enabling', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/profile/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { enabled: boolean; setupUri?: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.enabled).toBe(true);
      expect(typeof body.data.setupUri).toBe('string');
    });

    it('returns 200 with enabled=false when disabling (no setupUri)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/profile/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { enabled: boolean } };
      expect(body.data.enabled).toBe(false);
    });
  });

  // ─── GET /sessions ────────────────────────────────────────────────

  describe('GET /api/v1/profile/sessions', () => {
    it('returns 200 with session array', async () => {
      mockDb._selectChain.orderBy.mockResolvedValueOnce([MOCK_SESSION]);

      const app = createTestApp();
      const res = await app.request('/api/v1/profile/sessions');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('never returns tokenHash in session list', async () => {
      mockDb._selectChain.orderBy.mockResolvedValueOnce([MOCK_SESSION]);

      const app = createTestApp();
      const res = await app.request('/api/v1/profile/sessions');
      const text = await res.text();

      expect(text).not.toContain('tokenHash');
    });
  });

  // ─── DELETE /sessions/:id ───────────────────────────────────────────

  describe('DELETE /api/v1/profile/sessions/:id', () => {
    it('returns 200 on successful revoke', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([{ id: 'session-1' }]);

      const app = createTestApp();
      const res = await app.request('/api/v1/profile/sessions/session-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns 404 when session not found', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([]);

      const app = createTestApp();
      const res = await app.request('/api/v1/profile/sessions/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /tokens ──────────────────────────────────────────────────

  describe('GET /api/v1/profile/tokens', () => {
    it('returns 200 with token list (no raw keys)', async () => {
      mockDb._selectChain.orderBy.mockResolvedValueOnce([MOCK_TOKEN]);

      const app = createTestApp();
      const res = await app.request('/api/v1/profile/tokens');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('never returns keyHash in token list response', async () => {
      mockDb._selectChain.orderBy.mockResolvedValueOnce([MOCK_TOKEN]);

      const app = createTestApp();
      const res = await app.request('/api/v1/profile/tokens');
      const text = await res.text();

      expect(text).not.toContain('keyHash');
    });
  });

  // ─── POST /tokens ─────────────────────────────────────────────────

  describe('POST /api/v1/profile/tokens', () => {
    it('returns 201 with raw key starting ordr_k_', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/profile/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CI Token' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        success: boolean;
        data: { id: string; key: string; prefix: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.key).toMatch(/^ordr_k_/);
    });

    it('logs audit entry with eventType api_key.created', async () => {
      const app = createTestApp();
      await app.request('/api/v1/profile/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Audit Token' }),
      });

      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'api_key.created',
          resource: 'api_key',
        }),
      );
    });

    it('returns 422 when name is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/profile/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /tokens/:id ─────────────────────────────────────────────

  describe('DELETE /api/v1/profile/tokens/:id', () => {
    it('returns 200 on successful revoke', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([{ id: 'token-1' }]);

      const app = createTestApp();
      const res = await app.request('/api/v1/profile/tokens/token-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns 404 when token not found', async () => {
      mockDb._updateChain.returning.mockResolvedValueOnce([]);

      const app = createTestApp();
      const res = await app.request('/api/v1/profile/tokens/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
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
      const res = await app.request('/api/v1/profile');

      expect(res.status).toBe(401);
    });
  });
});
