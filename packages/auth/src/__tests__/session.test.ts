import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { importPKCS8, importSPKI } from 'jose';
import type { JwtConfig } from '../jwt.js';
import type { StoredSession, SessionStore, SessionMetadata } from '../session.js';
import { SessionManager } from '../session.js';
import type { UserRole, Permission } from '@ordr/core';
import { AuthenticationError } from '@ordr/core';

// ─── Test Key Pair ─────────────────────────────────────────────────

let jwtConfig: JwtConfig;

beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const privKey = await importPKCS8(privateKey, 'RS256');
  const pubKey = await importSPKI(publicKey, 'RS256');

  jwtConfig = {
    privateKey: privKey,
    publicKey: pubKey,
    accessTokenTtl: 900,
    refreshTokenTtl: 604_800,
    issuer: 'ordr-connect-test',
    audience: 'ordr-connect-test',
  };
});

// ─── In-Memory Session Store (Test Double) ─────────────────────────

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, StoredSession>();

  async create(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async getById(sessionId: string): Promise<StoredSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async getByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === tokenHash && session.revokedAt === null) {
        return session;
      }
    }
    return null;
  }

  async update(
    sessionId: string,
    fields: Partial<Pick<StoredSession, 'refreshTokenHash' | 'lastActiveAt' | 'revokedAt'>>,
  ): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.sessions.set(sessionId, { ...existing, ...fields });
    }
  }

  async revoke(sessionId: string): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.sessions.set(sessionId, { ...existing, revokedAt: new Date() });
    }
  }

  async revokeByUserId(userId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.set(id, { ...session, revokedAt: new Date() });
      }
    }
  }

  async revokeByFamily(tokenFamily: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.tokenFamily === tokenFamily) {
        this.sessions.set(id, { ...session, revokedAt: new Date() });
      }
    }
  }

  // Test helper: get all sessions
  getAll(): StoredSession[] {
    return Array.from(this.sessions.values());
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('SessionManager', () => {
  let store: InMemorySessionStore;
  let manager: SessionManager;

  const testRole: UserRole = 'agent';
  const testPermissions: Permission[] = [
    { resource: 'customers', action: 'read', scope: 'own' },
    { resource: 'interactions', action: 'create', scope: 'own' },
  ];

  beforeEach(() => {
    store = new InMemorySessionStore();
    manager = new SessionManager(store, jwtConfig);
  });

  // ─── createSession ────────────────────────────────────────────

  describe('createSession', () => {
    it('should return a sessionId and refreshToken', async () => {
      const result = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.refreshToken).toBeDefined();
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken.split('.')).toHaveLength(3); // JWT format
    });

    it('should store the session with a hashed refresh token', async () => {
      const result = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      const storedSession = await store.getById(result.sessionId);
      expect(storedSession).not.toBeNull();
      expect(storedSession?.userId).toBe('user-001');
      expect(storedSession?.tenantId).toBe('tenant-001');
      expect(storedSession?.refreshTokenHash).toBeDefined();
      // Hash should NOT equal the raw token
      expect(storedSession?.refreshTokenHash).not.toBe(result.refreshToken);
    });

    it('should store session metadata', async () => {
      const metadata: SessionMetadata = {
        ipAddress: '192.168.1.1',
        userAgent: 'TestAgent/1.0',
        deviceId: 'device-abc',
      };

      const result = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
        metadata,
      );

      const storedSession = await store.getById(result.sessionId);
      expect(storedSession?.metadata.ipAddress).toBe('192.168.1.1');
      expect(storedSession?.metadata.userAgent).toBe('TestAgent/1.0');
      expect(storedSession?.metadata.deviceId).toBe('device-abc');
    });

    it('should generate unique session IDs', async () => {
      const result1 = await manager.createSession('user-1', 'tenant-1', testRole, testPermissions);
      const result2 = await manager.createSession('user-1', 'tenant-1', testRole, testPermissions);

      expect(result1.sessionId).not.toBe(result2.sessionId);
    });
  });

  // ─── refreshSession ───────────────────────────────────────────

  describe('refreshSession', () => {
    it('should return a new access token and rotated refresh token', async () => {
      const { refreshToken } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      const result = await manager.refreshSession(refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(result.accessToken.split('.')).toHaveLength(3); // JWT format
      expect(result.newRefreshToken).toBeDefined();
      expect(result.newRefreshToken).not.toBe(refreshToken); // Rotated
      expect(result.sessionId).toBeDefined();
    });

    it('should invalidate the old refresh token after rotation', async () => {
      const { refreshToken } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      // First refresh — should succeed
      const result = await manager.refreshSession(refreshToken);
      expect(result.newRefreshToken).toBeDefined();

      // Second use of the OLD token — should detect reuse and revoke family
      await expect(manager.refreshSession(refreshToken)).rejects.toThrow(AuthenticationError);
    });

    it('should detect token reuse and revoke entire family', async () => {
      const { refreshToken, sessionId } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      // First refresh succeeds
      const { newRefreshToken } = await manager.refreshSession(refreshToken);

      // Attacker tries to reuse the original token
      await expect(manager.refreshSession(refreshToken)).rejects.toThrow(
        /reuse detected/i,
      );

      // After reuse detection, even the legitimate new token should fail
      // because the entire family was revoked
      await expect(manager.refreshSession(newRefreshToken)).rejects.toThrow(AuthenticationError);
    });

    it('should reject an invalid refresh token', async () => {
      await expect(manager.refreshSession('not-a-valid-jwt')).rejects.toThrow(
        AuthenticationError,
      );
    });

    it('should reject a revoked session refresh', async () => {
      const { refreshToken, sessionId } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      await manager.revokeSession(sessionId);

      await expect(manager.refreshSession(refreshToken)).rejects.toThrow(AuthenticationError);
    });
  });

  // ─── Idle Timeout ─────────────────────────────────────────────

  describe('idle timeout (HIPAA 15-minute)', () => {
    it('should NOT be idle immediately after creation', async () => {
      const { sessionId } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      const isIdle = await manager.checkIdleTimeout(sessionId);
      expect(isIdle).toBe(false);
    });

    it('should be idle after 15 minutes of inactivity', async () => {
      const { sessionId } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      // Simulate time passage by directly updating lastActiveAt
      const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000);
      await store.update(sessionId, { lastActiveAt: sixteenMinutesAgo });

      const isIdle = await manager.checkIdleTimeout(sessionId);
      expect(isIdle).toBe(true);
    });

    it('should NOT be idle if touched within 15 minutes', async () => {
      const { sessionId } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      // Simulate 14 minutes of idle time
      const fourteenMinutesAgo = new Date(Date.now() - 14 * 60 * 1000);
      await store.update(sessionId, { lastActiveAt: fourteenMinutesAgo });

      // Touch the session (reset idle timer)
      await manager.touchSession(sessionId);

      const isIdle = await manager.checkIdleTimeout(sessionId);
      expect(isIdle).toBe(false);
    });

    it('should report idle for a non-existent session', async () => {
      const isIdle = await manager.checkIdleTimeout('non-existent-session');
      expect(isIdle).toBe(true);
    });

    it('should report idle for a revoked session', async () => {
      const { sessionId } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      await manager.revokeSession(sessionId);

      const isIdle = await manager.checkIdleTimeout(sessionId);
      expect(isIdle).toBe(true);
    });

    it('should reject refresh if session is idle', async () => {
      const { sessionId, refreshToken } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      // Simulate 16 minutes of idle time
      const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000);
      await store.update(sessionId, { lastActiveAt: sixteenMinutesAgo });

      await expect(manager.refreshSession(refreshToken)).rejects.toThrow(
        /inactivity/i,
      );
    });
  });

  // ─── Revocation ───────────────────────────────────────────────

  describe('revocation', () => {
    it('should revoke a single session', async () => {
      const { sessionId } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      await manager.revokeSession(sessionId);

      const session = await store.getById(sessionId);
      expect(session?.revokedAt).not.toBeNull();
    });

    it('should revoke all sessions for a user', async () => {
      await manager.createSession('user-001', 'tenant-001', testRole, testPermissions);
      await manager.createSession('user-001', 'tenant-001', testRole, testPermissions);
      await manager.createSession('user-002', 'tenant-001', testRole, testPermissions);

      await manager.revokeAllUserSessions('user-001');

      const allSessions = store.getAll();
      const user1Sessions = allSessions.filter((s) => s.userId === 'user-001');
      const user2Sessions = allSessions.filter((s) => s.userId === 'user-002');

      // All user-001 sessions should be revoked
      for (const s of user1Sessions) {
        expect(s.revokedAt).not.toBeNull();
      }

      // user-002 session should remain active
      for (const s of user2Sessions) {
        expect(s.revokedAt).toBeNull();
      }
    });

    it('should make revoked session invalid for refresh', async () => {
      const { sessionId, refreshToken } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      await manager.revokeSession(sessionId);

      await expect(manager.refreshSession(refreshToken)).rejects.toThrow(AuthenticationError);
    });
  });

  // ─── touchSession ─────────────────────────────────────────────

  describe('touchSession', () => {
    it('should update lastActiveAt timestamp', async () => {
      const { sessionId } = await manager.createSession(
        'user-001',
        'tenant-001',
        testRole,
        testPermissions,
      );

      const before = await store.getById(sessionId);
      const beforeTime = before?.lastActiveAt.getTime() ?? 0;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await manager.touchSession(sessionId);

      const after = await store.getById(sessionId);
      const afterTime = after?.lastActiveAt.getTime() ?? 0;

      expect(afterTime).toBeGreaterThanOrEqual(beforeTime);
    });
  });
});
