/**
 * Integration test — Authentication and authorization flows.
 *
 * Tests JWT creation/verification, role-based access control,
 * API key authentication, rate limiting, SSO (mocked WorkOS),
 * SCIM provisioning, session management, MFA, and token refresh.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  setupTestEnvironment,
  createTestTenant,
  createTestUser,
  getJwtConfig,
} from './setup.js';

// Auth
import {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  loadKeyPair,
  authenticateRequest,
  requireRole,
  requirePermission,
  requireTenant,
  hasRole,
  hasPermission,
  checkAccess,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  SessionManager,
  createApiKey,
  verifyApiKey,
  extractApiKeyPrefix,
  isApiKeyExpired,
  InMemoryRateLimiter,
  AUTH_RATE_LIMIT,
  API_RATE_LIMIT,
  SSOManager,
  InMemorySSOClient,
  InMemorySSOConnectionStore,
  SCIMHandler,
  InMemoryUserStore,
  InMemoryGroupStore,
  InMemorySCIMTokenStore,
  verifySCIMToken,
} from '@ordr/auth';
import type {
  JwtConfig,
  AuthHeaders,
  AccessTokenPayload,
  StoredSession,
  SessionStore,
} from '@ordr/auth';

// Crypto
import { generateKeyPair, sha256, randomToken, randomUUID } from '@ordr/crypto';

// Audit
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import type { AuditEventInput } from '@ordr/audit';

// Core
import type { UserRole, Permission, TenantContext, TenantId } from '@ordr/core';
import { isOk, isErr, createTenantId } from '@ordr/core';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAuditInput(tenantId: string, overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId,
    eventType: overrides?.eventType ?? 'auth.login',
    actorType: overrides?.actorType ?? 'user',
    actorId: overrides?.actorId ?? 'usr-001',
    resource: overrides?.resource ?? 'session',
    resourceId: overrides?.resourceId ?? 'ses-001',
    action: overrides?.action ?? 'login',
    details: overrides?.details ?? {},
    timestamp: overrides?.timestamp ?? new Date('2026-01-15T14:00:00.000Z'),
  };
}

// In-memory session store for testing
function createMockSessionStore(): SessionStore {
  const sessions = new Map<string, StoredSession>();

  return {
    create: async (session: StoredSession) => {
      sessions.set(session.id, session);
    },
    getById: async (sessionId: string) => sessions.get(sessionId) ?? null,
    getByTokenHash: async (tokenHash: string) => {
      for (const s of sessions.values()) {
        if (s.refreshTokenHash === tokenHash) return s;
      }
      return null;
    },
    update: async (sessionId: string, fields: Partial<Pick<StoredSession, 'refreshTokenHash' | 'lastActiveAt' | 'revokedAt'>>) => {
      const existing = sessions.get(sessionId);
      if (existing) {
        sessions.set(sessionId, { ...existing, ...fields });
      }
    },
    revoke: async (sessionId: string) => {
      const existing = sessions.get(sessionId);
      if (existing) {
        sessions.set(sessionId, { ...existing, revokedAt: new Date() });
      }
    },
    revokeByUserId: async (userId: string) => {
      for (const [id, s] of sessions) {
        if (s.userId === userId) {
          sessions.set(id, { ...s, revokedAt: new Date() });
        }
      }
    },
    revokeByFamily: async (family: string) => {
      for (const [id, s] of sessions) {
        if (s.tokenFamily === family) {
          sessions.set(id, { ...s, revokedAt: new Date() });
        }
      }
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Auth Flow — End-to-End', () => {
  let jwtConfig: JwtConfig;
  let auditStore: InMemoryAuditStore;
  let auditLogger: AuditLogger;

  beforeAll(async () => {
    await setupTestEnvironment();
    jwtConfig = getJwtConfig();
  });

  beforeEach(() => {
    auditStore = new InMemoryAuditStore();
    auditLogger = new AuditLogger(auditStore);
  });

  // ── JWT Authentication ─────────────────────────────────────────

  describe('JWT token lifecycle', () => {
    it('creates and verifies access token with correct claims', async () => {
      const token = await createAccessToken(jwtConfig, {
        sub: 'usr-001',
        tid: 'tnt-001',
        role: 'tenant_admin' as UserRole,
        permissions: ROLE_PERMISSIONS['tenant_admin'],
      });

      const payload = await verifyAccessToken(jwtConfig, token);
      expect(payload.sub).toBe('usr-001');
      expect(payload.tid).toBe('tnt-001');
      expect(payload.role).toBe('tenant_admin');
      expect(payload.jti).toBeTruthy();
    });

    it('creates and verifies refresh token', async () => {
      const family = randomUUID();
      const token = await createRefreshToken(jwtConfig, {
        sub: 'usr-001',
        tid: 'tnt-001',
        family,
      });

      const payload = await verifyRefreshToken(jwtConfig, token);
      expect(payload.sub).toBe('usr-001');
      expect(payload.tid).toBe('tnt-001');
      expect(payload.family).toBe(family);
    });

    it('rejects token signed with wrong key', async () => {
      const { privateKey: wrongPriv, publicKey: wrongPub } = generateKeyPair();
      const wrongConfig = await loadKeyPair(wrongPriv, wrongPub);

      const token = await createAccessToken(wrongConfig, {
        sub: 'usr-hack',
        tid: 'tnt-hack',
        role: 'super_admin' as UserRole,
        permissions: [],
      });

      // Verify with the correct config should fail
      await expect(verifyAccessToken(jwtConfig, token)).rejects.toThrow();
    });

    it('each token has unique jti (JWT ID)', async () => {
      const t1 = await createAccessToken(jwtConfig, {
        sub: 'usr-001',
        tid: 'tnt-001',
        role: 'viewer' as UserRole,
        permissions: [],
      });

      const t2 = await createAccessToken(jwtConfig, {
        sub: 'usr-001',
        tid: 'tnt-001',
        role: 'viewer' as UserRole,
        permissions: [],
      });

      const p1 = await verifyAccessToken(jwtConfig, t1);
      const p2 = await verifyAccessToken(jwtConfig, t2);
      expect(p1.jti).not.toBe(p2.jti);
    });

    it('invalid credentials return 401 (auth failure)', async () => {
      const headers: AuthHeaders = {
        authorization: 'Bearer invalid-garbage-token',
      };

      const result = await authenticateRequest(headers, jwtConfig);
      expect(result.authenticated).toBe(false);
    });

    it('missing auth results in failure', async () => {
      const result = await authenticateRequest({}, jwtConfig);
      expect(result.authenticated).toBe(false);
    });
  });

  // ── RBAC ───────────────────────────────────────────────────────

  describe('Role-based access control', () => {
    it('role hierarchy is correctly ordered', () => {
      expect(ROLE_HIERARCHY['super_admin']).toBeGreaterThan(ROLE_HIERARCHY['tenant_admin']);
      expect(ROLE_HIERARCHY['tenant_admin']).toBeGreaterThan(ROLE_HIERARCHY['manager']);
      expect(ROLE_HIERARCHY['manager']).toBeGreaterThan(ROLE_HIERARCHY['agent']);
      expect(ROLE_HIERARCHY['agent']).toBeGreaterThan(ROLE_HIERARCHY['viewer']);
    });

    it('hasRole checks role hierarchy correctly', () => {
      expect(hasRole('tenant_admin' as UserRole, 'manager' as UserRole)).toBe(true);
      expect(hasRole('viewer' as UserRole, 'tenant_admin' as UserRole)).toBe(false);
    });

    it('admin can access admin routes', () => {
      const ctx: TenantContext = {
        tenantId: 'tnt-001' as TenantId,
        userId: 'usr-001',
        roles: ['tenant_admin'],
        permissions: [],
      };

      expect(() => requireRole(ctx, 'manager' as UserRole)).not.toThrow();
    });

    it('viewer cannot modify resources', () => {
      const ctx: TenantContext = {
        tenantId: 'tnt-001' as TenantId,
        userId: 'usr-viewer',
        roles: ['viewer'],
        permissions: [],
      };

      expect(() => requireRole(ctx, 'manager' as UserRole)).toThrow();
    });

    it('super_admin has global scope permissions', () => {
      const perms = ROLE_PERMISSIONS['super_admin'];
      const globalPerms = perms.filter((p) => p.scope === 'global');
      expect(globalPerms.length).toBeGreaterThan(0);
    });

    it('viewer permissions are read-only scoped', () => {
      const perms = ROLE_PERMISSIONS['viewer'];
      const writePerms = perms.filter(
        (p) => p.action === 'create' || p.action === 'update' || p.action === 'delete',
      );
      expect(writePerms.length).toBe(0);
    });
  });

  // ── API Key Authentication ─────────────────────────────────────

  describe('API key authentication', () => {
    it('creates API key with correct format', () => {
      const result = createApiKey('tnt-001', 'usr-001', 'Test Key', []);
      expect(result.key).toMatch(/^ordr_/);
      expect(result.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.keyPrefix.length).toBe(12);
    });

    it('verifies API key against stored hash', () => {
      const result = createApiKey('tnt-001', 'usr-001', 'Verify Key', []);
      const isValid = verifyApiKey(result.key, result.keyHash);
      expect(isValid).toBe(true);
    });

    it('rejects wrong API key', () => {
      const result = createApiKey('tnt-001', 'usr-001', 'Wrong Key', []);
      const isValid = verifyApiKey('ordr_wrong-key-value', result.keyHash);
      expect(isValid).toBe(false);
    });

    it('extracts key prefix correctly', () => {
      const result = createApiKey('tnt-001', 'usr-001', 'Prefix Key', []);
      const prefix = extractApiKeyPrefix(result.key);
      expect(prefix).toBe(result.keyPrefix);
    });

    it('detects expired API key', () => {
      const pastDate = new Date('2025-01-01');
      expect(isApiKeyExpired(pastDate)).toBe(true);

      const futureDate = new Date('2027-01-01');
      expect(isApiKeyExpired(futureDate)).toBe(false);
    });

    it('API key with null expiry never expires', () => {
      expect(isApiKeyExpired(null)).toBe(false);
    });
  });

  // ── Rate Limiting ──────────────────────────────────────────────

  describe('Rate limiting', () => {
    it('rate limiter allows requests within limit', async () => {
      const limiter = new InMemoryRateLimiter();
      const result = await limiter.check('tnt-001:usr-001', AUTH_RATE_LIMIT);
      expect(result.allowed).toBe(true);
    });

    it('rate limiter blocks after exceeding limit', async () => {
      const limiter = new InMemoryRateLimiter();
      const key = 'tnt-001:usr-flood';
      const config = { ...AUTH_RATE_LIMIT, maxRequests: 3 };

      await limiter.check(key, config);
      await limiter.check(key, config);
      await limiter.check(key, config);
      const result = await limiter.check(key, config);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('API rate limit is configured', () => {
      expect(API_RATE_LIMIT.maxRequests).toBeGreaterThan(0);
      expect(API_RATE_LIMIT.windowMs).toBeGreaterThan(0);
    });
  });

  // ── SSO (Mocked WorkOS) ────────────────────────────────────────

  describe('SSO login flow (mocked WorkOS)', () => {
    it('SSO connection store saves and retrieves connections', async () => {
      const connectionStore = new InMemorySSOConnectionStore();

      await connectionStore.create({
        id: 'conn-001',
        tenantId: 'tnt-001',
        name: 'Test SSO',
        type: 'saml',
        provider: 'okta',
        status: 'active',
        enforceSso: false,
        metadata: 'https://okta.example.com/metadata',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const retrieved = await connectionStore.getById('tnt-001', 'conn-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test SSO');
    });

    it('SSO connection listing filters by tenant', async () => {
      const connectionStore = new InMemorySSOConnectionStore();

      await connectionStore.create({
        id: 'conn-a',
        tenantId: 'tnt-a',
        name: 'SSO A',
        type: 'saml',
        provider: 'okta',
        status: 'active',
        enforceSso: false,
        metadata: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await connectionStore.create({
        id: 'conn-b',
        tenantId: 'tnt-b',
        name: 'SSO B',
        type: 'oidc',
        provider: 'google',
        status: 'active',
        enforceSso: false,
        metadata: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const tenantAConns = await connectionStore.listByTenant('tnt-a');
      expect(tenantAConns).toHaveLength(1);
      expect(tenantAConns[0]!.name).toBe('SSO A');
    });
  });

  // ── SCIM Provisioning ──────────────────────────────────────────

  describe('SCIM provisioning', () => {
    it('SCIM handler creates user from provisioning data', async () => {
      const userStore = new InMemoryUserStore();
      const groupStore = new InMemoryGroupStore();
      const sessionRevoker = { revokeByUserId: async (_userId: string) => {} };

      const handler = new SCIMHandler({
        userStore,
        groupStore,
        sessionRevoker,
        auditLogger,
      });

      const result = await handler.handleCreateUser('tnt-scim', {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'scim.user@example.com',
        name: { givenName: 'SCIM', familyName: 'User' },
        emails: [{ value: 'scim.user@example.com', primary: true }],
        active: true,
        externalId: 'ext-scim-001',
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.userName).toBe('scim.user@example.com');
      }
    });

    it('SCIM token verification works with hashed tokens', async () => {
      const tokenStore = new InMemorySCIMTokenStore();
      const rawToken = 'test-scim-bearer-token';
      const tokenHash = sha256(rawToken);

      tokenStore.addToken({
        id: 'tok-001',
        tenantId: 'tnt-scim',
        tokenHash,
        description: 'Test SCIM token',
        expiresAt: new Date(Date.now() + 86400000),
        lastUsedAt: null,
      });

      const tenantId = await verifySCIMToken(rawToken, tokenStore);
      expect(tenantId).toBe('tnt-scim');
    });

    it('SCIM deactivation revokes sessions', async () => {
      const userStore = new InMemoryUserStore();
      const groupStore = new InMemoryGroupStore();
      let sessionsRevoked = false;
      const sessionRevoker = { revokeByUserId: async (_userId: string) => { sessionsRevoked = true; } };

      const handler = new SCIMHandler({
        userStore,
        groupStore,
        sessionRevoker,
        auditLogger,
      });

      // Create user first
      const createResult = await handler.handleCreateUser('tnt-scim', {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'deactivate@example.com',
        name: { givenName: 'To', familyName: 'Deactivate' },
        emails: [{ value: 'deactivate@example.com', primary: true }],
        active: true,
        externalId: 'ext-deactivate-001',
      });

      expect(isOk(createResult)).toBe(true);
      if (isOk(createResult)) {
        const deactivateResult = await handler.handleDeactivateUser('tnt-scim', createResult.data.id);
        expect(isOk(deactivateResult)).toBe(true);
        expect(sessionsRevoked).toBe(true);
      }
    });
  });

  // ── Session Management ─────────────────────────────────────────

  describe('Session management', () => {
    it('creates session with refresh token', async () => {
      const store = createMockSessionStore();
      const sessionManager = new SessionManager(store, jwtConfig);

      const session = await sessionManager.createSession(
        'usr-001',
        'tnt-001',
        'tenant_admin' as UserRole,
        ROLE_PERMISSIONS['tenant_admin'],
        { ipAddress: '127.0.0.1' },
      );

      expect(session.sessionId).toBeTruthy();
      expect(session.refreshToken).toBeTruthy();
    });

    it('revokes session', async () => {
      const store = createMockSessionStore();
      const sessionManager = new SessionManager(store, jwtConfig);

      const session = await sessionManager.createSession(
        'usr-002',
        'tnt-001',
        'viewer' as UserRole,
        ROLE_PERMISSIONS['viewer'],
      );

      await sessionManager.revokeSession(session.sessionId);
      const stored = await store.getById(session.sessionId);
      expect(stored?.revokedAt).not.toBeNull();
    });

    it('revokes all sessions for a user', async () => {
      const store = createMockSessionStore();
      const sessionManager = new SessionManager(store, jwtConfig);

      const s1 = await sessionManager.createSession(
        'usr-multi',
        'tnt-001',
        'agent' as UserRole,
        ROLE_PERMISSIONS['agent'],
      );

      const s2 = await sessionManager.createSession(
        'usr-multi',
        'tnt-001',
        'agent' as UserRole,
        ROLE_PERMISSIONS['agent'],
      );

      await sessionManager.revokeAllUserSessions('usr-multi');

      const stored1 = await store.getById(s1.sessionId);
      const stored2 = await store.getById(s2.sessionId);
      expect(stored1?.revokedAt).not.toBeNull();
      expect(stored2?.revokedAt).not.toBeNull();
    });

    it('checks HIPAA idle timeout', async () => {
      const store = createMockSessionStore();
      const sessionManager = new SessionManager(store, jwtConfig);

      const session = await sessionManager.createSession(
        'usr-idle',
        'tnt-001',
        'viewer' as UserRole,
        ROLE_PERMISSIONS['viewer'],
      );

      // Just-created session should not be idle
      const isIdle = await sessionManager.checkIdleTimeout(session.sessionId);
      expect(isIdle).toBe(false);

      // Non-existent session should be considered idle/expired
      const nonExistent = await sessionManager.checkIdleTimeout('non-existent');
      expect(nonExistent).toBe(true);
    });
  });

  // ── MFA Verification ───────────────────────────────────────────

  describe('MFA verification (mocked)', () => {
    it('logs MFA verification event to audit', async () => {
      const tenant = await createTestTenant('mfa-test');

      await auditLogger.log(makeAuditInput(tenant.id, {
        eventType: 'auth.mfa_verified',
        actorId: 'usr-mfa-001',
        action: 'mfa_totp_verified',
        details: { method: 'totp', deviceId: 'dev-001' },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.eventType).toBe('auth.mfa_verified');
    });

    it('failed MFA is logged separately', async () => {
      const tenant = await createTestTenant('mfa-fail');

      await auditLogger.log(makeAuditInput(tenant.id, {
        eventType: 'auth.failed',
        action: 'mfa_verification_failed',
        details: { method: 'totp', attempts: 3 },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.eventType).toBe('auth.failed');
    });
  });

  // ── Token Refresh ──────────────────────────────────────────────

  describe('Token refresh flow', () => {
    it('refreshes session and rotates tokens', async () => {
      const store = createMockSessionStore();
      const sessionManager = new SessionManager(store, jwtConfig);

      const original = await sessionManager.createSession(
        'usr-refresh',
        'tnt-001',
        'agent' as UserRole,
        ROLE_PERMISSIONS['agent'],
      );

      const refreshed = await sessionManager.refreshSession(original.refreshToken);
      expect(refreshed.accessToken).toBeTruthy();
      expect(refreshed.newRefreshToken).not.toBe(original.refreshToken);
      expect(refreshed.sessionId).toBe(original.sessionId);
    });
  });

  // ── Auth Audit Trail ───────────────────────────────────────────

  describe('Authentication audit trail', () => {
    it('login success logged', async () => {
      const tenant = await createTestTenant('auth-audit');

      await auditLogger.log(makeAuditInput(tenant.id, {
        eventType: 'auth.login',
        action: 'login_success',
        details: { method: 'password', mfa: true },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.eventType).toBe('auth.login');
    });

    it('login failure logged', async () => {
      const tenant = await createTestTenant('auth-failure');

      await auditLogger.log(makeAuditInput(tenant.id, {
        eventType: 'auth.failed',
        action: 'login_failed',
        details: { reason: 'invalid_credentials', attempt: 3 },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.eventType).toBe('auth.failed');
    });

    it('full auth flow audit chain integrity', async () => {
      const tenant = await createTestTenant('auth-chain');

      const steps = [
        { eventType: 'auth.login' as const, action: 'login_attempt' },
        { eventType: 'auth.mfa_verified' as const, action: 'mfa_check' },
        { eventType: 'auth.login' as const, action: 'session_created' },
        { eventType: 'data.read' as const, action: 'access_resource' },
        { eventType: 'auth.logout' as const, action: 'logout' },
      ];

      for (const step of steps) {
        await auditLogger.log(makeAuditInput(tenant.id, {
          eventType: step.eventType,
          action: step.action,
        }));
      }

      const integrity = await auditLogger.verifyIntegrity(tenant.id);
      expect(integrity.valid).toBe(true);
      expect(integrity.totalEvents).toBe(5);
    });
  });
});
