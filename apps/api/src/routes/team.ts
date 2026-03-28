/**
 * Team Routes — tenant member management
 *
 * SOC2 CC6.2 — User access management (provisioning, suspension, removal).
 * SOC2 CC6.3 — Role-based authorization with least privilege.
 * ISO 27001 A.9.2 — User access management lifecycle.
 * HIPAA §164.312(a)(2)(i) — Unique user identification.
 *
 * Endpoints:
 * GET    /members           — List team members (auth required)
 * POST   /invite            — Invite new member (tenant_admin only)
 * PATCH  /members/:id       — Update member role (tenant_admin only)
 * PATCH  /members/:id/suspend — Suspend member (tenant_admin only)
 * DELETE /members/:id       — Deactivate member (tenant_admin only)
 * GET    /activity          — Recent team management audit events
 *
 * SECURITY:
 * - tenant_id from JWT — NEVER from client input (Rule 2)
 * - No PHI in responses — passwordHash NEVER returned (Rule 6)
 * - All mutations audit-logged WORM (Rule 3)
 * - Actors cannot suspend/deactivate themselves
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, ne, desc, like } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import type { AuditLogger } from '@ordr/audit';
import { hashPassword, randomHex } from '@ordr/crypto';
import { AuthorizationError, ValidationError, NotFoundError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requireRoleMiddleware } from '../middleware/auth.js';

// ─── Types ────────────────────────────────────────────────────────

interface TeamMemberResponse {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly status: 'active' | 'invited' | 'suspended';
  readonly lastActive: string;
  readonly mfaEnabled: boolean;
}

// ─── Input Schemas ────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(255),
  role: z.enum(['tenant_admin', 'manager', 'agent', 'viewer']),
});

const updateRoleSchema = z.object({
  role: z.enum(['tenant_admin', 'manager', 'agent', 'viewer']),
});

// ─── Helpers ──────────────────────────────────────────────────────

function toMemberResponse(row: {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly lastLoginAt: Date | null;
  readonly mfaEnabled: boolean;
}): TeamMemberResponse {
  // Map DB status → frontend status:
  // active + no prior login → 'invited'
  // active + has logged in  → 'active'
  // suspended               → 'suspended'
  const frontendStatus: 'active' | 'invited' | 'suspended' =
    row.status === 'suspended' ? 'suspended' : row.lastLoginAt === null ? 'invited' : 'active';

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: frontendStatus,
    lastActive: row.lastLoginAt !== null ? row.lastLoginAt.toISOString() : '',
    mfaEnabled: row.mfaEnabled,
  };
}

// ─── Module-level deps ────────────────────────────────────────────

interface TeamDeps {
  readonly db: OrdrDatabase;
  readonly auditLogger: AuditLogger;
}

let _deps: TeamDeps | null = null;

export function configureTeamRoutes(deps: TeamDeps): void {
  _deps = deps;
}

function getDeps(): TeamDeps {
  if (_deps === null) throw new Error('[ORDR:API] Team routes not configured');
  return _deps;
}

// ─── Router ───────────────────────────────────────────────────────

const teamRouter = new Hono<Env>();

teamRouter.use('*', requireAuth());

// ── GET /members ──────────────────────────────────────────────────

teamRouter.get('/members', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      status: schema.users.status,
      lastLoginAt: schema.users.lastLoginAt,
      mfaEnabled: schema.users.mfaEnabled,
    })
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, ctx.tenantId), ne(schema.users.status, 'deactivated')))
    .orderBy(schema.users.name);

  return c.json({
    success: true as const,
    data: rows.map(toMemberResponse),
  });
});

// ── POST /invite ──────────────────────────────────────────────────

teamRouter.post('/invite', requireRoleMiddleware('tenant_admin'), async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) existing.push(issue.message);
      else fieldErrors[field] = [issue.message];
    }
    throw new ValidationError('Invalid invite data', fieldErrors, requestId);
  }

  // Generate a secure temporary password — user must reset on first login
  const tempPassword = randomHex(16);
  const passwordHash = await hashPassword(tempPassword);

  const inserted = await db
    .insert(schema.users)
    .values({
      tenantId: ctx.tenantId,
      email: parsed.data.email,
      name: parsed.data.name,
      role: parsed.data.role,
      passwordHash,
      status: 'active',
      mfaEnabled: false,
    })
    .returning({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      status: schema.users.status,
      lastLoginAt: schema.users.lastLoginAt,
      mfaEnabled: schema.users.mfaEnabled,
    });

  const row = inserted[0];
  if (row === undefined) {
    throw new Error('[ORDR:API] User insert returned no rows');
  }

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'user.invited',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'user',
    resourceId: row.id,
    action: 'invite',
    details: { email: parsed.data.email, role: parsed.data.role },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: toMemberResponse(row),
    },
    201,
  );
});

// ── PATCH /members/:id — update role ─────────────────────────────

teamRouter.patch(
  '/members/:id',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db, auditLogger } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    const memberId = c.req.param('id');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('role is required', {}, requestId);
    }

    const updated = await db
      .update(schema.users)
      .set({ role: parsed.data.role, updatedAt: new Date() })
      .where(
        and(
          eq(schema.users.id, memberId),
          eq(schema.users.tenantId, ctx.tenantId),
          ne(schema.users.status, 'deactivated'),
        ),
      )
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        status: schema.users.status,
        lastLoginAt: schema.users.lastLoginAt,
        mfaEnabled: schema.users.mfaEnabled,
      });

    const row = updated[0];
    if (row === undefined) {
      throw new NotFoundError(`User not found: ${memberId}`, requestId);
    }

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'user.role_changed',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'user',
      resourceId: memberId,
      action: 'update_role',
      details: { newRole: parsed.data.role },
      timestamp: new Date(),
    });

    return c.json({ success: true as const, data: toMemberResponse(row) });
  },
);

// ── PATCH /members/:id/suspend ────────────────────────────────────

teamRouter.patch(
  '/members/:id/suspend',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db, auditLogger } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    const memberId = c.req.param('id');

    // Actors cannot suspend themselves
    if (memberId === ctx.userId) {
      return c.json(
        {
          success: false as const,
          error: { code: 'FORBIDDEN' as const, message: 'Cannot suspend your own account' },
        },
        403,
      );
    }

    const updated = await db
      .update(schema.users)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(
        and(
          eq(schema.users.id, memberId),
          eq(schema.users.tenantId, ctx.tenantId),
          ne(schema.users.status, 'deactivated'),
        ),
      )
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        status: schema.users.status,
        lastLoginAt: schema.users.lastLoginAt,
        mfaEnabled: schema.users.mfaEnabled,
      });

    const row = updated[0];
    if (row === undefined) {
      throw new NotFoundError(`User not found: ${memberId}`, requestId);
    }

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'user.suspended',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'user',
      resourceId: memberId,
      action: 'suspend',
      details: {},
      timestamp: new Date(),
    });

    return c.json({ success: true as const, data: toMemberResponse(row) });
  },
);

// ── DELETE /members/:id — deactivate ─────────────────────────────

teamRouter.delete(
  '/members/:id',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db, auditLogger } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    const memberId = c.req.param('id');

    if (memberId === ctx.userId) {
      return c.json(
        {
          success: false as const,
          error: { code: 'FORBIDDEN' as const, message: 'Cannot deactivate your own account' },
        },
        403,
      );
    }

    const updated = await db
      .update(schema.users)
      .set({ status: 'deactivated', updatedAt: new Date() })
      .where(
        and(
          eq(schema.users.id, memberId),
          eq(schema.users.tenantId, ctx.tenantId),
          ne(schema.users.status, 'deactivated'),
        ),
      )
      .returning({ id: schema.users.id });

    if (updated[0] === undefined) {
      throw new NotFoundError(`User not found: ${memberId}`, requestId);
    }

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'user.deactivated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'user',
      resourceId: memberId,
      action: 'deactivate',
      details: {},
      timestamp: new Date(),
    });

    return c.json({ success: true as const });
  },
);

// ── GET /activity ─────────────────────────────────────────────────

teamRouter.get('/activity', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const rows = await db
    .select({
      id: schema.auditLogs.id,
      eventType: schema.auditLogs.eventType,
      actorId: schema.auditLogs.actorId,
      resourceId: schema.auditLogs.resourceId,
      details: schema.auditLogs.details,
      timestamp: schema.auditLogs.timestamp,
    })
    .from(schema.auditLogs)
    .where(
      and(eq(schema.auditLogs.tenantId, ctx.tenantId), like(schema.auditLogs.eventType, 'user.%')),
    )
    .orderBy(desc(schema.auditLogs.timestamp))
    .limit(50);

  type ActivityRow = {
    readonly id: string;
    readonly eventType: string;
    readonly actorId: string;
    readonly resourceId: string;
    readonly details: unknown;
    readonly timestamp: Date;
  };

  const data = rows.map((row: ActivityRow) => ({
    id: row.id,
    action: row.eventType.replace('user.', '').replace(/_/g, ' '),
    actor: row.actorId,
    target: row.resourceId,
    timestamp: row.timestamp.toISOString(),
  }));

  return c.json({ success: true as const, data });
});

export { teamRouter };
