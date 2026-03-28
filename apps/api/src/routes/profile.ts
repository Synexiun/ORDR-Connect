/**
 * Profile Routes — user self-service (profile, sessions, API tokens, MFA)
 *
 * SOC2 CC6.1 — Authentication management: password change, session revocation.
 * SOC2 CC6.2 — Access provisioning: API token lifecycle.
 * ISO 27001 A.9.3 — User responsibilities for authentication.
 * HIPAA §164.312(a)(2)(iii) — Automatic logoff / session management.
 * HIPAA §164.312(a)(2)(iv) — Encryption and decryption of credentials.
 *
 * Endpoints:
 * GET    /              — Current user profile
 * PATCH  /              — Update name or email
 * POST   /change-password — Change own password (Argon2id)
 * POST   /mfa           — Toggle MFA on/off
 * GET    /sessions       — List active sessions (non-revoked, non-expired)
 * DELETE /sessions/:id   — Revoke a session
 * GET    /tokens         — List tenant API keys owned by caller
 * POST   /tokens         — Generate a new API key (raw key returned ONCE)
 * DELETE /tokens/:id     — Revoke an API key
 *
 * SECURITY:
 * - passwordHash NEVER returned (Rule 6)
 * - mfaSecret NEVER returned (Rule 6)
 * - Raw API key returned only at creation — hash stored, never retrievable (Rule 1)
 * - All mutations audit-logged WORM (Rule 3)
 * - session tokenHash NEVER returned (Rule 1 — hash of token is internal)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import type { AuditLogger } from '@ordr/audit';
import { hashPassword, verifyPassword, randomBytes } from '@ordr/crypto';
import {
  AuthorizationError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Input Schemas ────────────────────────────────────────────────

const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

const toggleMfaSchema = z.object({
  enabled: z.boolean(),
});

const createTokenSchema = z.object({
  name: z.string().min(1).max(255),
});

// ─── Module-level deps ────────────────────────────────────────────

interface ProfileDeps {
  readonly db: OrdrDatabase;
  readonly auditLogger: AuditLogger;
}

let _deps: ProfileDeps | null = null;

export function configureProfileRoutes(deps: ProfileDeps): void {
  _deps = deps;
}

function getDeps(): ProfileDeps {
  if (_deps === null) throw new Error('[ORDR:API] Profile routes not configured');
  return _deps;
}

// ─── Router ───────────────────────────────────────────────────────

const profileRouter = new Hono<Env>();

profileRouter.use('*', requireAuth());

// ── GET / — current user profile ─────────────────────────────────

profileRouter.get('/', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      mfaEnabled: schema.users.mfaEnabled,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, ctx.userId), eq(schema.users.tenantId, ctx.tenantId)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    throw new NotFoundError('User not found', c.get('requestId'));
  }

  return c.json({
    success: true as const,
    data: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      mfaEnabled: row.mfaEnabled,
      lastLoginAt: row.lastLoginAt !== null ? row.lastLoginAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    },
  });
});

// ── PATCH / — update profile ──────────────────────────────────────

profileRouter.patch('/', async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) existing.push(issue.message);
      else fieldErrors[field] = [issue.message];
    }
    throw new ValidationError('Invalid profile data', fieldErrors, requestId);
  }

  if (parsed.data.name === undefined && parsed.data.email === undefined) {
    throw new ValidationError('At least one field (name or email) is required', {}, requestId);
  }

  const updates: { name?: string; email?: string; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;

  const updated = await db
    .update(schema.users)
    .set(updates)
    .where(and(eq(schema.users.id, ctx.userId), eq(schema.users.tenantId, ctx.tenantId)))
    .returning({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    });

  const row = updated[0];
  if (row === undefined) throw new NotFoundError('User not found', requestId);

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'user.profile_updated',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'user',
    resourceId: ctx.userId,
    action: 'update_profile',
    details: { changedFields: Object.keys(parsed.data) },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: { name: row.name, email: row.email } });
});

// ── POST /change-password ─────────────────────────────────────────

profileRouter.post('/change-password', async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) existing.push(issue.message);
      else fieldErrors[field] = [issue.message];
    }
    throw new ValidationError('Invalid password data', fieldErrors, requestId);
  }

  // Fetch current hash
  const rows = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(and(eq(schema.users.id, ctx.userId), eq(schema.users.tenantId, ctx.tenantId)))
    .limit(1);

  const user = rows[0];
  if (user === undefined) throw new NotFoundError('User not found', requestId);

  // Verify current password — Argon2id (Rule 2)
  const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    throw new AuthenticationError('Current password is incorrect', requestId);
  }

  const newHash = await hashPassword(parsed.data.newPassword);

  await db
    .update(schema.users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(and(eq(schema.users.id, ctx.userId), eq(schema.users.tenantId, ctx.tenantId)));

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'user.password_changed',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'user',
    resourceId: ctx.userId,
    action: 'change_password',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ success: true as const });
});

// ── POST /mfa — toggle MFA ────────────────────────────────────────

profileRouter.post('/mfa', async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = toggleMfaSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('enabled (boolean) is required', {}, requestId);
  }

  await db
    .update(schema.users)
    .set({ mfaEnabled: parsed.data.enabled, updatedAt: new Date() })
    .where(and(eq(schema.users.id, ctx.userId), eq(schema.users.tenantId, ctx.tenantId)));

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: parsed.data.enabled ? 'user.mfa_enabled' : 'user.mfa_disabled',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'user',
    resourceId: ctx.userId,
    action: 'toggle_mfa',
    details: { enabled: parsed.data.enabled },
    timestamp: new Date(),
  });

  const response: { enabled: boolean; setupUri?: string } = {
    enabled: parsed.data.enabled,
  };
  // Placeholder TOTP URI — a real implementation would generate a per-user TOTP secret
  // encrypted at field-level before storage (Rule 1 + Rule 6).
  if (parsed.data.enabled) {
    const label = encodeURIComponent(`ORDR-Connect:${ctx.userId}`);
    response.setupUri = `otpauth://totp/${label}?secret=PENDING_SETUP&issuer=ORDR-Connect`;
  }

  return c.json({ success: true as const, data: response });
});

// ── GET /sessions ─────────────────────────────────────────────────

profileRouter.get('/sessions', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const now = new Date();

  const rows = await db
    .select({
      id: schema.sessions.id,
      ipAddress: schema.sessions.ipAddress,
      userAgent: schema.sessions.userAgent,
      lastActiveAt: schema.sessions.lastActiveAt,
      createdAt: schema.sessions.createdAt,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, ctx.userId),
        eq(schema.sessions.tenantId, ctx.tenantId),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, now),
      ),
    )
    .orderBy(schema.sessions.lastActiveAt);

  // Mark the current session — identified by matching the request's correlation
  // to the JWT sub. Since we don't store the current session ID in JWT, we
  // approximate: the most recently active non-revoked session is "current".
  const data = rows.map((row, idx) => ({
    id: row.id,
    device: row.userAgent ?? 'Unknown device',
    ip: row.ipAddress ?? 'Unknown',
    lastActive: row.lastActiveAt.toISOString(),
    current: idx === rows.length - 1, // last = most recent (or use explicit session tracking)
  }));

  return c.json({ success: true as const, data });
});

// ── DELETE /sessions/:id ──────────────────────────────────────────

profileRouter.delete('/sessions/:id', async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const sessionId = c.req.param('id');

  const updated = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        eq(schema.sessions.userId, ctx.userId),
        eq(schema.sessions.tenantId, ctx.tenantId),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id });

  if (updated[0] === undefined) {
    throw new NotFoundError(`Session not found: ${sessionId}`, requestId);
  }

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'user.session_revoked',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'session',
    resourceId: sessionId,
    action: 'revoke_session',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ success: true as const });
});

// ── GET /tokens ───────────────────────────────────────────────────

profileRouter.get('/tokens', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const rows = await db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      keyPrefix: schema.apiKeys.keyPrefix,
      createdAt: schema.apiKeys.createdAt,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      expiresAt: schema.apiKeys.expiresAt,
    })
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.userId, ctx.userId),
        eq(schema.apiKeys.tenantId, ctx.tenantId),
        isNull(schema.apiKeys.revokedAt),
      ),
    )
    .orderBy(schema.apiKeys.createdAt);

  const data = rows.map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    createdAt: row.createdAt.toISOString(),
    lastUsed: row.lastUsedAt !== null ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt !== null ? row.expiresAt.toISOString() : '',
  }));

  return c.json({ success: true as const, data });
});

// ── POST /tokens — generate API key ──────────────────────────────

profileRouter.post('/tokens', async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = createTokenSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('name is required', {}, requestId);
  }

  // Generate a cryptographically random API key — Rule 1
  // Format: ordr_k_<40-hex-chars>  (total ~49 chars)
  const rawBytes = randomBytes(20);
  const rawHex = rawBytes.toString('hex');
  const rawKey = `ordr_k_${rawHex}`;
  const keyPrefix = rawKey.slice(0, 12); // "ordr_k_" + 5 chars

  // SHA-256 of full key — NEVER store raw (Rule 2, API keys hashed)
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  // 90-day expiry (Rule 2 — API keys must have rotation schedule)
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  const inserted = await db
    .insert(schema.apiKeys)
    .values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      name: parsed.data.name,
      keyHash,
      keyPrefix,
      permissions: { read: ['*'], write: [] },
      expiresAt,
    })
    .returning({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      keyPrefix: schema.apiKeys.keyPrefix,
      createdAt: schema.apiKeys.createdAt,
      expiresAt: schema.apiKeys.expiresAt,
    });

  const row = inserted[0];
  if (row === undefined) throw new Error('[ORDR:API] API key insert returned no rows');

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'api_key.created',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'api_key',
    resourceId: row.id,
    action: 'create',
    details: { name: parsed.data.name, prefix: keyPrefix },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: row.id,
        name: row.name,
        prefix: row.keyPrefix,
        // Raw key returned ONCE — never stored, not retrievable after this response
        key: rawKey,
        createdAt: row.createdAt.toISOString(),
        lastUsed: null,
        expiresAt: row.expiresAt !== null ? row.expiresAt.toISOString() : '',
      },
    },
    201,
  );
});

// ── DELETE /tokens/:id — revoke ───────────────────────────────────

profileRouter.delete('/tokens/:id', async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const tokenId = c.req.param('id');

  const updated = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiKeys.id, tokenId),
        eq(schema.apiKeys.userId, ctx.userId),
        eq(schema.apiKeys.tenantId, ctx.tenantId),
        isNull(schema.apiKeys.revokedAt),
      ),
    )
    .returning({ id: schema.apiKeys.id });

  if (updated[0] === undefined) {
    throw new NotFoundError(`Token not found: ${tokenId}`, requestId);
  }

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'api_key.revoked',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'api_key',
    resourceId: tokenId,
    action: 'revoke',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ success: true as const });
});

export { profileRouter };
