/**
 * Session Management — HIPAA-compliant session lifecycle
 *
 * HIPAA §164.312(a)(2)(iii) — Automatic logoff after period of inactivity.
 * SOC2 CC6.1 — Session management and token rotation.
 * ISO 27001 A.9.4.2 — Secure log-on procedures.
 *
 * Security features:
 * - Refresh token rotation with family-based reuse detection
 * - 15-minute idle timeout (HIPAA requirement)
 * - Hash-only token storage (raw tokens never persisted)
 * - Full session revocation (single + all user sessions)
 */

import type { JwtConfig } from './jwt.js';
import { createAccessToken, createRefreshToken, verifyRefreshToken } from './jwt.js';
import type { UserRole, Permission } from '@ordr/core';
import { AuthenticationError } from '@ordr/core';
import { sha256, randomUUID, randomToken } from '@ordr/crypto';

// ─── Constants ─────────────────────────────────────────────────────

/** HIPAA §164.312(a)(2)(iii) — 15-minute idle timeout */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

// ─── Session Store Interface ───────────────────────────────────────

export interface StoredSession {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly refreshTokenHash: string;
  readonly tokenFamily: string;
  readonly role: UserRole;
  readonly permissions: readonly Permission[];
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly revokedAt: Date | null;
  readonly metadata: SessionMetadata;
}

export interface SessionMetadata {
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly deviceId?: string;
}

/**
 * SessionStore interface — implemented by the persistence layer (Drizzle/Redis).
 * The auth package defines the contract; the db/cache packages provide implementations.
 */
export interface SessionStore {
  create(session: StoredSession): Promise<void>;
  getById(sessionId: string): Promise<StoredSession | null>;
  getByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  update(sessionId: string, fields: Partial<Pick<StoredSession, 'refreshTokenHash' | 'lastActiveAt' | 'revokedAt'>>): Promise<void>;
  revoke(sessionId: string): Promise<void>;
  revokeByUserId(userId: string): Promise<void>;
  revokeByFamily(tokenFamily: string): Promise<void>;
}

// ─── Session Manager ───────────────────────────────────────────────

export class SessionManager {
  private readonly store: SessionStore;
  private readonly jwtConfig: JwtConfig;

  constructor(store: SessionStore, jwtConfig: JwtConfig) {
    this.store = store;
    this.jwtConfig = jwtConfig;
  }

  /**
   * Creates a new authenticated session.
   *
   * Generates a refresh token, hashes it for storage, and persists the
   * session record. The raw refresh token is returned to the client (once)
   * and NEVER stored.
   *
   * @returns sessionId for management + refreshToken for the client
   */
  async createSession(
    userId: string,
    tenantId: string,
    role: UserRole,
    permissions: readonly Permission[],
    metadata: SessionMetadata = {},
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const sessionId = randomUUID();
    const tokenFamily = randomUUID();
    const jti = randomUUID();

    const refreshToken = await createRefreshToken(this.jwtConfig, {
      sub: userId,
      tid: tenantId,
      family: tokenFamily,
      jti,
    });

    const refreshTokenHash = sha256(refreshToken);
    const now = new Date();

    const session: StoredSession = {
      id: sessionId,
      userId,
      tenantId,
      refreshTokenHash,
      tokenFamily,
      role,
      permissions,
      createdAt: now,
      lastActiveAt: now,
      revokedAt: null,
      metadata,
    };

    await this.store.create(session);

    return { sessionId, refreshToken };
  }

  /**
   * Refreshes a session by rotating the refresh token.
   *
   * Token rotation flow:
   * 1. Verify the refresh token's signature and claims
   * 2. Look up the session by token hash
   * 3. If the token hash is not found but the family exists,
   *    this is a reuse attack — revoke the entire family
   * 4. Issue a new access token + new refresh token
   * 5. Update the stored hash to the new token
   *
   * @returns New access token and rotated refresh token
   * @throws AuthenticationError on invalid/revoked/reused tokens
   */
  async refreshSession(
    refreshToken: string,
  ): Promise<{ accessToken: string; newRefreshToken: string; sessionId: string }> {
    // Step 1: Verify JWT signature and claims
    const claims = await verifyRefreshToken(this.jwtConfig, refreshToken).catch(() => {
      throw new AuthenticationError('Invalid refresh token');
    });

    const tokenHash = sha256(refreshToken);

    // Step 2: Look up session by token hash
    const session = await this.store.getByTokenHash(tokenHash);

    if (!session) {
      // Step 3: Possible token reuse — revoke entire family
      await this.store.revokeByFamily(claims.family);
      throw new AuthenticationError('Refresh token reuse detected — all sessions in family revoked');
    }

    // Check if session is revoked
    if (session.revokedAt !== null) {
      throw new AuthenticationError('Session has been revoked');
    }

    // Check idle timeout
    if (this.isIdle(session.lastActiveAt)) {
      await this.store.revoke(session.id);
      throw new AuthenticationError('Session expired due to inactivity');
    }

    // Step 4: Issue new tokens
    const newJti = randomUUID();
    const newRefreshToken = await createRefreshToken(this.jwtConfig, {
      sub: claims.sub,
      tid: claims.tid,
      family: claims.family,
      jti: newJti,
    });

    const accessToken = await createAccessToken(this.jwtConfig, {
      sub: session.userId,
      tid: session.tenantId,
      role: session.role,
      permissions: session.permissions,
    });

    // Step 5: Rotate — update stored hash to new token
    const newTokenHash = sha256(newRefreshToken);
    await this.store.update(session.id, {
      refreshTokenHash: newTokenHash,
      lastActiveAt: new Date(),
    });

    return { accessToken, newRefreshToken, sessionId: session.id };
  }

  /**
   * Revokes a single session, making its refresh token invalid.
   */
  async revokeSession(sessionId: string): Promise<void> {
    await this.store.revoke(sessionId);
  }

  /**
   * Revokes ALL sessions for a user (e.g., password change, account compromise).
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.store.revokeByUserId(userId);
  }

  /**
   * Checks whether a session has exceeded the HIPAA idle timeout (15 minutes).
   *
   * @returns true if the session is idle (should be terminated)
   */
  async checkIdleTimeout(sessionId: string): Promise<boolean> {
    const session = await this.store.getById(sessionId);
    if (!session) {
      return true; // Non-existent session is effectively expired
    }
    if (session.revokedAt !== null) {
      return true;
    }
    return this.isIdle(session.lastActiveAt);
  }

  /**
   * Updates the session's lastActiveAt timestamp.
   * Called on every authenticated request to reset the idle timer.
   */
  async touchSession(sessionId: string): Promise<void> {
    await this.store.update(sessionId, {
      lastActiveAt: new Date(),
    });
  }

  /**
   * Internal helper: checks if a session has been idle for > 15 minutes.
   */
  private isIdle(lastActiveAt: Date): boolean {
    const elapsed = Date.now() - lastActiveAt.getTime();
    return elapsed > IDLE_TIMEOUT_MS;
  }
}
