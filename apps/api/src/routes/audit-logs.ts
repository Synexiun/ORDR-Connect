/**
 * Audit Log Routes — immutable WORM audit trail viewer
 *
 * SOC2 CC7.2 — Monitoring: audit trail provides continuous evidence for TSC
 *   availability, processing integrity, confidentiality, and security criteria.
 * ISO 27001 A.12.4.1 — Event logging: durable, tamper-evident log entries.
 * HIPAA §164.312(b) — Audit controls: authorized access to review audit trail.
 *
 * Endpoints:
 * GET  /              — Paginated audit event list (tenant-scoped)
 * GET  /chain-status  — Total event count + last hash (for chain integrity UI)
 *
 * SECURITY:
 * - tenant_id derived from JWT only — NEVER from client input (Rule 2)
 * - Details were sanitized at write time — no PHI returned (Rule 6)
 * - Reading the audit log is itself audit-logged by the global middleware (Rule 3)
 * - Access restricted to tenant_admin and above (manager/agent/viewer cannot read) (Rule 2)
 * - Pagination max 200 rows per request — prevents bulk exfiltration (Rule 4)
 * - No DELETE/UPDATE endpoints exist — WORM semantics enforced (Rule 3)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, gte, lte, desc, sql, type SQL } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import { auditLogs } from '@ordr/db';
import type { Env } from '../types.js';
import { requireAuth, requireRoleMiddleware } from '../middleware/auth.js';

// ─── Module-level DB ────────────────────────────────────────────

let _db: OrdrDatabase | null = null;

export function configureAuditLogsRoute(db: OrdrDatabase): void {
  _db = db;
}

function getDb(): OrdrDatabase {
  if (_db === null) {
    throw new Error('[ORDR:API] Audit logs route not configured — call configureAuditLogsRoute()');
  }
  return _db;
}

// ─── Input Schemas ───────────────────────────────────────────────

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  eventType: z.string().min(1).max(100).optional(),
  actorType: z.enum(['user', 'agent', 'system']).optional(),
  resource: z.string().min(1).max(255).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

// ─── DTO mapper ──────────────────────────────────────────────────

function rowToDto(row: typeof auditLogs.$inferSelect) {
  return {
    id: row.id,
    sequenceNumber: Number(row.sequenceNumber),
    eventType: row.eventType,
    actorType: row.actorType,
    actorId: row.actorId,
    resource: row.resource,
    resourceId: row.resourceId,
    action: row.action,
    /** details are always PHI-free at write time — safe to return as-is */
    details: row.details as Record<string, unknown>,
    hash: row.hash,
    previousHash: row.previousHash,
    timestamp: row.timestamp.toISOString(),
  };
}

// ─── Router ──────────────────────────────────────────────────────

export const auditLogsRouter = new Hono<Env>();

// All audit log endpoints require authentication + tenant_admin minimum
auditLogsRouter.use('*', requireAuth());
auditLogsRouter.use('*', requireRoleMiddleware('tenant_admin'));

// ── GET / — paginated audit event list ───────────────────────────

auditLogsRouter.get('/', async (c) => {
  const db = getDb();
  const ctx = c.get('tenantContext');
  if (ctx === undefined) return c.json({ error: 'Authentication required' }, 401);

  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', details: parsed.error.issues }, 400);
  }

  const { page, limit, eventType, actorType, resource, from, to } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [eq(auditLogs.tenantId, ctx.tenantId)];
  if (eventType !== undefined) conditions.push(eq(auditLogs.eventType, eventType));
  if (actorType !== undefined) conditions.push(eq(auditLogs.actorType, actorType));
  if (resource !== undefined) conditions.push(eq(auditLogs.resource, resource));
  if (from !== undefined) conditions.push(gte(auditLogs.timestamp, new Date(from)));
  if (to !== undefined) conditions.push(lte(auditLogs.timestamp, new Date(to)));

  const where = and(...conditions);

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<string>`COUNT(*)` })
      .from(auditLogs)
      .where(where),
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.sequenceNumber))
      .limit(limit)
      .offset(offset),
  ]);

  const total = parseInt(countResult[0]?.count ?? '0', 10);

  return c.json({
    events: rows.map(rowToDto),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
});

// ── GET /chain-status — last event + integrity metadata ───────────

auditLogsRouter.get('/chain-status', async (c) => {
  const db = getDb();
  const ctx = c.get('tenantContext');
  if (ctx === undefined) return c.json({ error: 'Authentication required' }, 401);

  const [countResult, lastRows] = await Promise.all([
    db
      .select({ count: sql<string>`COUNT(*)` })
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, ctx.tenantId)),
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, ctx.tenantId))
      .orderBy(desc(auditLogs.sequenceNumber))
      .limit(1),
  ]);

  const total = parseInt(countResult[0]?.count ?? '0', 10);
  const last = lastRows[0];

  return c.json({
    totalEvents: total,
    lastSequence: last !== undefined ? Number(last.sequenceNumber) : 0,
    lastHash: last?.hash ?? '',
    lastTimestamp: last !== undefined ? last.timestamp.toISOString() : null,
  });
});
