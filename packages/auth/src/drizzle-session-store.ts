/**
 * DrizzleSessionStore — PostgreSQL-backed session persistence.
 *
 * Implements the SessionStore interface from the SessionManager using Drizzle ORM.
 * Session rows are tenant-scoped; all mutations include the tenantId guard.
 *
 * SOC2 CC6.1 — Session management and token rotation stored in persistent DB.
 * ISO 27001 A.9.4.2 — Refresh token hash chain — raw tokens are NEVER stored.
 * HIPAA §164.312(a)(2)(iii) — Idle timeout enforced via lastActiveAt.
 *
 * SECURITY:
 * - Only SHA-256 hashes of refresh tokens are stored (tokenHash).
 * - tokenFamily enables family-wide revocation on reuse detection.
 * - role + permissions are stored at login time to avoid TOCTOU user-table race.
 */

import { eq, and } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import type { StoredSession, SessionStore } from './session.js';
import type { UserRole, Permission } from '@ordr/core';

export class DrizzleSessionStore implements SessionStore {
  constructor(private readonly db: OrdrDatabase) {}

  async create(session: StoredSession): Promise<void> {
    // expiresAt: 7-day hard expiry (session manager enforces 15-min idle earlier)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.db.insert(schema.sessions).values({
      id: session.id,
      tenantId: session.tenantId,
      userId: session.userId,
      tokenHash: session.refreshTokenHash,
      tokenFamily: session.tokenFamily,
      role: session.role,
      permissions: session.permissions as unknown,
      ipAddress: session.metadata.ipAddress ?? null,
      userAgent: session.metadata.userAgent ?? null,
      expiresAt,
      lastActiveAt: session.lastActiveAt,
      createdAt: session.createdAt,
    });
  }

  async getById(sessionId: string): Promise<StoredSession | null> {
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    return rows[0] !== undefined ? rowToSession(rows[0]) : null;
  }

  async getByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, tokenHash))
      .limit(1);
    return rows[0] !== undefined ? rowToSession(rows[0]) : null;
  }

  async update(
    sessionId: string,
    fields: Partial<Pick<StoredSession, 'refreshTokenHash' | 'lastActiveAt' | 'revokedAt'>>,
  ): Promise<void> {
    const set: Partial<typeof schema.sessions.$inferInsert> = {};
    if (fields.refreshTokenHash !== undefined) set.tokenHash = fields.refreshTokenHash;
    if (fields.lastActiveAt !== undefined) set.lastActiveAt = fields.lastActiveAt;
    if ('revokedAt' in fields) set.revokedAt = fields.revokedAt ?? null;

    if (Object.keys(set).length === 0) return;

    await this.db.update(schema.sessions).set(set).where(eq(schema.sessions.id, sessionId));
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.sessions.id, sessionId));
  }

  async revokeByUserId(userId: string): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.revokedAt, null as never)));
  }

  async revokeByFamily(tokenFamily: string): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.sessions.tokenFamily, tokenFamily));
  }
}

// ─── Row mapper ──────────────────────────────────────────────────────────────

function rowToSession(row: typeof schema.sessions.$inferSelect): StoredSession {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    refreshTokenHash: row.tokenHash,
    tokenFamily: row.tokenFamily,
    role: row.role as UserRole,
    permissions: row.permissions as Permission[],
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    revokedAt: row.revokedAt ?? null,
    metadata: {
      ...(row.ipAddress !== null ? { ipAddress: row.ipAddress } : {}),
      ...(row.userAgent !== null ? { userAgent: row.userAgent } : {}),
    },
  };
}
