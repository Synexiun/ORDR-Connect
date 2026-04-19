/**
 * Auth Routes tests — login, refresh, logout, profile
 *
 * SOC2 CC6.1 — Authentication management.
 * ISO 27001 A.9.4.2 — Secure log-on procedures.
 * HIPAA §164.312(d) — Person or entity authentication.
 *
 * Verifies:
 * - POST /login (valid creds) → 200 with tokens
 * - POST /login (invalid body) → 400 validation error
 * - POST /login (user not found) → 401
 * - POST /refresh (valid token) → 200 with new tokens
 * - POST /refresh (missing token) → 400 validation error
 * - POST /logout (authenticated) → 200
 * - GET /me (authenticated) → 200 with user context
 * - GET /me (unauthenticated) → 401
 *
 * Note: /login and /refresh are unauthenticated endpoints.
 *       /logout and /me require requireAuth().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createTenantId } from '@ordr/core';
import { requestId } from '../middleware/request-id.js';
import { authRouter, configureAuthRoutes } from '../routes/auth.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';

// ─── Test credentials (non-secret test fixtures) ─────────────────

const TEST_EMAIL = 'admin@example.com';
const TEST_CREDENTIAL = 'ValidTestCredential1!';
const TEST_HASH = '$bcrypt$mockHashForTesting';

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
  createAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
  InMemoryRateLimiter: vi.fn().mockImplementation(() => ({
    check: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date(Date.now() + 60_000) }),
  })),
  AUTH_RATE_LIMIT: { maxRequests: 5, windowMs: 15 * 60_000 },
}));

// ─── Mock @ordr/crypto ───────────────────────────────────────────

vi.mock('@ordr/crypto', () => ({
  verifyPassword: vi.fn().mockResolvedValue(true),
  FieldEncryptor: vi.fn(),
}));

// ─── Mock User Fixture ───────────────────────────────────────────

const MOCK_USER = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: TEST_EMAIL,
  name: 'Admin User',
  role: 'tenant_admin',
  passwordHash: TEST_HASH,
  status: 'active',
  failedLoginAttempts: 0,
  lockedUntil: null,
};

// ─── Helpers ─────────────────────────────────────────────────────

const TEST_JWT_CONFIG = {
  publicKey: 'test-public-key',
  privateKey: 'test-private-key',
  issuer: 'test-issuer',
  audience: 'test-audience',
  accessTokenTtl: 3600,
  refreshTokenTtl: 86400,
} as never;

function createMockSessionManager() {
  return {
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      refreshToken: 'mock-refresh-token',
    }),
    refreshSession: vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      newRefreshToken: 'new-refresh-token',
    }),
    revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
    revokeSession: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestApp(withTenantContext = true): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  if (withTenantContext) {
    app.use('*', async (c, next) => {
      c.set('tenantContext', {
        tenantId: createTenantId('tenant-1'),
        userId: 'user-1',
        roles: ['tenant_admin'],
        permissions: [],
      });
      await next();
    });
  }

  app.route('/api/v1/auth', authRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Auth Routes', () => {
  let mockSessionManager: ReturnType<typeof createMockSessionManager>;
  let auditLogger: AuditLogger;

  beforeEach(() => {
    configureAuth(TEST_JWT_CONFIG);

    mockSessionManager = createMockSessionManager();
    auditLogger = new AuditLogger(new InMemoryAuditStore());

    configureAuthRoutes({
      jwtConfig: TEST_JWT_CONFIG,
      sessionManager: mockSessionManager as never,
      auditLogger,
      findUserByEmail: vi.fn().mockResolvedValue(MOCK_USER),
      updateLoginAttempts: vi.fn().mockResolvedValue(undefined),
      resetLoginAttempts: vi.fn().mockResolvedValue(undefined),
    });
  });

  // ─── POST /login ─────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('returns 200 with accessToken, refreshToken, tokenType, expiresIn on valid credentials', async () => {
      const app = createTestApp();
      // Attempt with incorrect field name first, then correct one
      await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, credential: TEST_CREDENTIAL }),
      });

      // Re-issue with correct field name expected by loginSchema
      const res2 = await createTestApp().request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_CREDENTIAL }),
      });

      expect(res2.status).toBe(200);
      const body = (await res2.json()) as {
        success: boolean;
        data: {
          accessToken: string;
          refreshToken: string;
          tokenType: string;
          expiresIn: number;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.accessToken).toBeTruthy();
      expect(body.data.refreshToken).toBeTruthy();
      expect(body.data.tokenType).toBe('Bearer');
      expect(typeof body.data.expiresIn).toBe('number');
    });

    it('calls createSession with userId, tenantId, role', async () => {
      const app = createTestApp();
      await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_CREDENTIAL }),
      });

      expect(mockSessionManager.createSession).toHaveBeenCalledWith(
        'user-1',
        'tenant-1',
        'tenant_admin',
        [],
        expect.any(Object),
      );
    });

    it('returns 400 on missing email field', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: TEST_CREDENTIAL }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('returns 400 on invalid email format', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: TEST_CREDENTIAL }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 on missing credential field', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 401 when user is not found', async () => {
      configureAuthRoutes({
        jwtConfig: TEST_JWT_CONFIG,
        sessionManager: mockSessionManager as never,
        auditLogger,
        findUserByEmail: vi.fn().mockResolvedValue(null),
        updateLoginAttempts: vi.fn().mockResolvedValue(undefined),
        resetLoginAttempts: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'unknown@example.com', password: TEST_CREDENTIAL }),
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('returns 401 when credential verification fails', async () => {
      const { verifyPassword } = await import('@ordr/crypto');
      vi.mocked(verifyPassword).mockResolvedValueOnce(false);

      const app = createTestApp();
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_CREDENTIAL }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 401 for a locked account', async () => {
      configureAuthRoutes({
        jwtConfig: TEST_JWT_CONFIG,
        sessionManager: mockSessionManager as never,
        auditLogger,
        findUserByEmail: vi.fn().mockResolvedValue({
          ...MOCK_USER,
          lockedUntil: new Date(Date.now() + 10 * 60_000),
        }),
        updateLoginAttempts: vi.fn().mockResolvedValue(undefined),
        resetLoginAttempts: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_CREDENTIAL }),
      });

      expect(res.status).toBe(401);
    });

    it('does NOT require Authorization header — login is a public endpoint', async () => {
      // No pre-seeded tenantContext; the handler itself should be reachable
      const app = createTestApp(false);
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_CREDENTIAL }),
      });

      // 200 confirms the handler was reached without an auth gate bouncing it
      expect(res.status).toBe(200);
    });
  });

  // ─── POST /refresh ───────────────────────────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    it('returns 200 with new accessToken and refreshToken', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'valid-refresh-token' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { accessToken: string; refreshToken: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.accessToken).toBeTruthy();
      expect(body.data.refreshToken).toBeTruthy();
    });

    it('returns 400 on empty body (missing refreshToken field)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('returns 401 when session manager detects token reuse', async () => {
      const { AuthenticationError } = await import('@ordr/core');
      mockSessionManager.refreshSession.mockRejectedValueOnce(
        new AuthenticationError('Token reuse detected'),
      );

      const app = createTestApp();
      const res = await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'reused-token' }),
      });

      expect(res.status).toBe(401);
    });

    it('does NOT require Authorization header — refresh is a public endpoint', async () => {
      const app = createTestApp(false);
      const res = await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'valid-refresh-token' }),
      });

      expect(res.status).toBe(200);
    });
  });

  // ─── POST /logout ────────────────────────────────────────────

  describe('POST /api/v1/auth/logout', () => {
    it('returns 200 with { success: true } when authenticated', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-token',
        },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('calls revokeAllUserSessions with the userId from tenant context', async () => {
      const app = createTestApp();
      await app.request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(mockSessionManager.revokeAllUserSessions).toHaveBeenCalledWith('user-1');
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/auth/logout', { method: 'POST' });

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /me ─────────────────────────────────────────────────

  describe('GET /api/v1/auth/me', () => {
    it('returns 200 with userId and tenantId when authenticated', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/auth/me', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { userId: string; tenantId: string; roles: string[]; permissions: unknown[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe('user-1');
      expect(body.data.tenantId).toBe('tenant-1');
      expect(Array.isArray(body.data.roles)).toBe(true);
      expect(Array.isArray(body.data.permissions)).toBe(true);
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/auth/me');

      expect(res.status).toBe(401);
    });
  });
});
