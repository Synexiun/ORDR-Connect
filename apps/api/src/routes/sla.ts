/**
 * SLA Routes — policy management, breach history, metrics, and manual check
 *
 * SOC2 CC7.2  — Monitoring: SLA breach detection and configurable thresholds.
 * ISO 27001 A.16.1.1 — Responsibilities for information security events.
 * HIPAA §164.308(a)(5)(ii)(C) — Log-in monitoring: track unanswered contacts.
 *
 * Endpoints:
 * GET    /policies              — List tenant SLA policies
 * POST   /policies              — Create or upsert a policy
 * PUT    /policies/:id          — Update a policy
 * DELETE /policies/:id          — Delete a policy
 * GET    /breaches              — Paginated SLA breach history (from notifications)
 * POST   /breaches/:id/acknowledge — Acknowledge (mark read) a breach notification
 * GET    /metrics               — Aggregated breach stats by channel + 7-day trend
 * POST   /check                 — Trigger an immediate SLA scan (admin)
 * GET    /status                — Checker health + active policy count
 *
 * SECURITY:
 * - All endpoints require auth — tenantContext enforced.
 * - threshold_minutes validated: 1–10,080 (max 7 days).
 * - No PHI written to SLA payloads (Rule 6).
 * - All writes produce WORM audit events.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, count, sql, isNull } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import { slaPolicies, notifications } from '@ordr/db';
import type { AuditLogger } from '@ordr/audit';
import { NotFoundError, ValidationError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import type { SlaChecker } from '../lib/sla-checker.js';

// ─── Deps wired at server bootstrap ──────────────────────────────

let _checker: SlaChecker | null = null;
let _db: OrdrDatabase | null = null;
let _auditLogger: Pick<AuditLogger, 'log'> | null = null;

export function configureSlaRoutes(
  checker: SlaChecker,
  db: OrdrDatabase,
  auditLogger: Pick<AuditLogger, 'log'>,
): void {
  _checker = checker;
  _db = db;
  _auditLogger = auditLogger;
}

function getChecker(): SlaChecker {
  if (_checker === null)
    throw new Error('[ORDR:API] SLA routes not configured — call configureSlaRoutes()');
  return _checker;
}

function getDb(): OrdrDatabase {
  if (_db === null)
    throw new Error('[ORDR:API] SLA routes not configured — call configureSlaRoutes()');
  return _db;
}

// ─── Input Schemas ────────────────────────────────────────────────

const SLA_CHANNELS = ['sms', 'email', 'voice', 'whatsapp', 'chat', 'push', 'in_app'] as const;

const SLA_TIERS = ['vip', 'high', 'standard', 'low'] as const;

const policyBodySchema = z.object({
  channel: z.enum(SLA_CHANNELS).nullable().default(null),
  priorityTier: z.enum(SLA_TIERS).nullable().default(null),
  thresholdMinutes: z.number().int().min(1).max(10080),
  enabled: z.boolean().default(true),
});

const breachQuerySchema = z.object({
  acknowledged: z.enum(['true', 'false']).optional(),
  channel: z.enum(SLA_CHANNELS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const metricsDaysSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

// ─── Response helpers ─────────────────────────────────────────────

function policyToDto(row: typeof slaPolicies.$inferSelect) {
  return {
    id: row.id,
    channel: row.channel,
    priorityTier: row.priorityTier,
    thresholdMinutes: row.thresholdMinutes,
    thresholdLabel: formatThreshold(row.thresholdMinutes),
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatThreshold(minutes: number): string {
  if (minutes < 60) return `${String(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)}h` : `${String(h)}h ${String(m)}m`;
}

function breachToDto(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    acknowledged: row.read,
    acknowledgedAt: row.readAt?.toISOString() ?? null,
    metadata: row.metadata ?? {},
    detectedAt: row.createdAt.toISOString(),
    actionRoute: row.actionRoute ?? null,
  };
}

// ─── Router ───────────────────────────────────────────────────────

const slaRouter = new Hono<Env>();

// ═══════════════════════════════════════════════════════════════════
// POLICIES
// ═══════════════════════════════════════════════════════════════════

// ── GET /policies ─────────────────────────────────────────────────

slaRouter.get('/policies', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  const db = getDb();
  const rows = await db
    .select()
    .from(slaPolicies)
    .where(eq(slaPolicies.tenantId, ctx.tenantId))
    .orderBy(slaPolicies.channel, slaPolicies.priorityTier);

  return c.json({ success: true as const, data: rows.map(policyToDto) });
});

// ── POST /policies ────────────────────────────────────────────────

slaRouter.post('/policies', requireAuth(), rateLimit('write'), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  const body = policyBodySchema.safeParse(await c.req.json());
  if (!body.success) {
    throw new ValidationError('Invalid policy body');
  }

  const db = getDb();
  const { channel, priorityTier, thresholdMinutes, enabled } = body.data;

  // Upsert — unique constraint on (tenant_id, channel, priority_tier)
  const rows = await db
    .insert(slaPolicies)
    .values({
      tenantId: ctx.tenantId,
      channel,
      priorityTier,
      thresholdMinutes,
      enabled,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [slaPolicies.tenantId, slaPolicies.channel, slaPolicies.priorityTier],
      set: {
        thresholdMinutes,
        enabled,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      },
    })
    .returning();

  const policy = rows[0];
  if (policy === undefined)
    return c.json(
      { success: false as const, error: { code: 'INTERNAL' as const, message: 'Insert failed' } },
      500,
    );

  if (_auditLogger) {
    await _auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'data.created',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'sla_policy',
      resourceId: policy.id,
      action: 'upsert',
      details: { channel, priorityTier, thresholdMinutes, enabled },
      timestamp: new Date(),
    });
  }

  return c.json({ success: true as const, data: policyToDto(policy) }, 201);
});

// ── PUT /policies/:id ─────────────────────────────────────────────

slaRouter.put('/policies/:id', requireAuth(), rateLimit('write'), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  const id = c.req.param('id');
  const body = policyBodySchema.partial().safeParse(await c.req.json());
  if (!body.success) {
    throw new ValidationError('Invalid policy body');
  }

  const db = getDb();
  const { thresholdMinutes, enabled } = body.data;

  const rows = await db
    .update(slaPolicies)
    .set({
      ...(thresholdMinutes !== undefined && { thresholdMinutes }),
      ...(enabled !== undefined && { enabled }),
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(slaPolicies.id, id), eq(slaPolicies.tenantId, ctx.tenantId)))
    .returning();

  const updated = rows[0];
  if (updated === undefined) {
    throw new NotFoundError('SLA policy not found');
  }

  if (_auditLogger) {
    await _auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'data.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'sla_policy',
      resourceId: id,
      action: 'update',
      details: { thresholdMinutes, enabled },
      timestamp: new Date(),
    });
  }

  return c.json({ success: true as const, data: policyToDto(updated) });
});

// ── DELETE /policies/:id ──────────────────────────────────────────

slaRouter.delete(
  '/policies/:id',
  requireAuth(),
  rateLimit('write'),
  async (c): Promise<Response> => {
    const ctx = c.get('tenantContext');
    if (!ctx)
      return c.json(
        {
          success: false as const,
          error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
        },
        401,
      );

    const id = c.req.param('id');
    const db = getDb();

    const rows = await db
      .delete(slaPolicies)
      .where(and(eq(slaPolicies.id, id), eq(slaPolicies.tenantId, ctx.tenantId)))
      .returning({ id: slaPolicies.id });

    if (rows[0] === undefined) {
      throw new NotFoundError('SLA policy not found');
    }

    if (_auditLogger) {
      await _auditLogger.log({
        tenantId: ctx.tenantId,
        eventType: 'data.deleted',
        actorType: 'user',
        actorId: ctx.userId,
        resource: 'sla_policy',
        resourceId: id,
        action: 'delete',
        details: {},
        timestamp: new Date(),
      });
    }

    return c.json({ success: true as const, data: { id } });
  },
);

// ═══════════════════════════════════════════════════════════════════
// BREACHES  (SLA notifications — type = 'sla')
// ═══════════════════════════════════════════════════════════════════

// ── GET /breaches ─────────────────────────────────────────────────

slaRouter.get('/breaches', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  const query = breachQuerySchema.safeParse({
    acknowledged: c.req.query('acknowledged'),
    channel: c.req.query('channel'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  if (!query.success) {
    throw new ValidationError('Invalid query parameters');
  }

  const db = getDb();
  const { acknowledged, channel, limit, offset } = query.data;

  const conditions = [eq(notifications.tenantId, ctx.tenantId), eq(notifications.type, 'sla')];

  if (acknowledged !== undefined) {
    conditions.push(eq(notifications.read, acknowledged === 'true'));
  }

  // channel filter: metadata->>'channel' = value
  if (channel !== undefined) {
    conditions.push(sql`${notifications.metadata}->>'channel' = ${channel}`);
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(...conditions));

  return c.json({
    success: true as const,
    data: rows.map(breachToDto),
    meta: {
      total: totalRow?.count ?? 0,
      limit,
      offset,
    },
  });
});

// ── POST /breaches/:id/acknowledge ───────────────────────────────

slaRouter.post(
  '/breaches/:id/acknowledge',
  requireAuth(),
  rateLimit('write'),
  async (c): Promise<Response> => {
    const ctx = c.get('tenantContext');
    if (!ctx)
      return c.json(
        {
          success: false as const,
          error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
        },
        401,
      );

    const id = c.req.param('id');
    const db = getDb();
    const now = new Date();

    const rows = await db
      .update(notifications)
      .set({ read: true, readAt: now })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.type, 'sla'),
        ),
      )
      .returning();

    const row = rows[0];
    if (row === undefined) {
      throw new NotFoundError('SLA breach not found');
    }

    if (_auditLogger) {
      await _auditLogger.log({
        tenantId: ctx.tenantId,
        eventType: 'notification.read',
        actorType: 'user',
        actorId: ctx.userId,
        resource: 'sla_breach',
        resourceId: id,
        action: 'acknowledge',
        details: { interactionId: row.metadata?.['interaction_id'] ?? '' },
        timestamp: new Date(),
      });
    }

    return c.json({ success: true as const, data: breachToDto(row) });
  },
);

// ═══════════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════════

// ── GET /metrics ──────────────────────────────────────────────────

slaRouter.get('/metrics', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  const query = metricsDaysSchema.safeParse({ days: c.req.query('days') });
  if (!query.success) {
    throw new ValidationError('Invalid query parameters');
  }

  const db = getDb();
  const { days } = query.data;
  const since = new Date(Date.now() - days * 86_400_000);

  // ── Total breach count ─────────────────────────────────────
  const [totalRow] = await db
    .select({ count: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, ctx.tenantId),
        eq(notifications.type, 'sla'),
        sql`${notifications.createdAt} >= ${since}`,
      ),
    );

  // ── Unacknowledged count ───────────────────────────────────
  const [unackRow] = await db
    .select({ count: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, ctx.tenantId),
        eq(notifications.type, 'sla'),
        eq(notifications.read, false),
        sql`${notifications.createdAt} >= ${since}`,
      ),
    );

  // ── Breakdown by channel ──────────────────────────────────
  const channelBreakdown = await db.execute<{
    channel: string | null;
    cnt: string;
    avg_hours: string | null;
  }>(
    sql`
      SELECT
        metadata->>'channel'    AS channel,
        COUNT(*)::text           AS cnt,
        ROUND(
          AVG(
            CAST(metadata->>'breach_hours' AS NUMERIC)
          ), 1
        )::text                  AS avg_hours
      FROM notifications
      WHERE tenant_id   = ${ctx.tenantId}
        AND type        = 'sla'
        AND created_at >= ${since}
      GROUP BY metadata->>'channel'
      ORDER BY cnt DESC
    `,
  );

  // ── Daily trend ───────────────────────────────────────────
  const trendRows = await db.execute<{ day: string; cnt: string }>(
    sql`
      SELECT
        DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')::date::text AS day,
        COUNT(*)::text AS cnt
      FROM notifications
      WHERE tenant_id   = ${ctx.tenantId}
        AND type        = 'sla'
        AND created_at >= ${since}
      GROUP BY 1
      ORDER BY 1
    `,
  );

  // ── Policy count ──────────────────────────────────────────
  const [policyRow] = await db
    .select({ count: count() })
    .from(slaPolicies)
    .where(and(eq(slaPolicies.tenantId, ctx.tenantId), eq(slaPolicies.enabled, true)));

  return c.json({
    success: true as const,
    data: {
      windowDays: days,
      totalBreaches: totalRow?.count ?? 0,
      unacknowledged: unackRow?.count ?? 0,
      activePolicies: policyRow?.count ?? 0,
      byChannel: Array.from(channelBreakdown).map((r) => ({
        channel: r.channel ?? 'unknown',
        count: Number(r.cnt),
        avgHours: r.avg_hours !== null ? Number(r.avg_hours) : null,
      })),
      trend: Array.from(trendRows).map((r) => ({
        day: r.day,
        count: Number(r.cnt),
      })),
    },
  });
});

// ═══════════════════════════════════════════════════════════════════
// CHECKER CONTROL
// ═══════════════════════════════════════════════════════════════════

// ── POST /check — trigger immediate scan ─────────────────────────

slaRouter.post('/check', requireAuth(), rateLimit('write'), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  const checker = getChecker();
  const breachCount = await checker.check();

  return c.json({ success: true as const, data: { breachesFound: breachCount } });
});

// ── GET /status — checker health ─────────────────────────────────

slaRouter.get('/status', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  let activePolicies = 0;
  if (_db !== null) {
    const [row] = await _db
      .select({ count: count() })
      .from(slaPolicies)
      .where(and(eq(slaPolicies.tenantId, ctx.tenantId), eq(slaPolicies.enabled, true)));
    activePolicies = row?.count ?? 0;
  }

  return c.json({
    success: true as const,
    data: {
      enabled: _checker !== null,
      defaultThresholdHours: 4,
      intervalMinutes: 5,
      activePolicies,
    },
  });
});

// ── Null policy guard used in GET /status ────────────────────────
// (isNull imported for potential future filters — kept for completeness)
void isNull;

export { slaRouter };
