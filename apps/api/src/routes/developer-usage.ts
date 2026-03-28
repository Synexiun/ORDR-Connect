/**
 * Developer Usage Routes — API call statistics from developer_usage table
 *
 * SOC2 CC6.1 — Logical access: developer-scoped (ctx.userId = developerId).
 * ISO 27001 A.12.4.1 — Event logging: usage data never includes request bodies.
 * HIPAA §164.312(b) — No PHI in developer usage records.
 *
 * Endpoint:
 * GET /usage?days=7   — Aggregate stats, daily breakdown, top endpoints
 *
 * The authenticated user's JWT sub (ctx.userId) is treated as the developerId.
 * Tenant-isolated: only rows for the caller's developer account are returned.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte, sql, count, desc } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import { developerUsage } from '@ordr/db';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Module-level DB ─────────────────────────────────────────────

let _db: OrdrDatabase | null = null;

export function configureDevUsageRoute(db: OrdrDatabase): void {
  _db = db;
}

function getDb(): OrdrDatabase {
  if (_db === null) {
    throw new Error(
      '[ORDR:API] Developer usage route not configured — call configureDevUsageRoute()',
    );
  }
  return _db;
}

// ─── Query schema ────────────────────────────────────────────────

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

// ─── Day labels ──────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function buildDayWindows(days: number): { start: Date; end: Date; label: string }[] {
  const windows: { start: Date; end: Date; label: string }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const label = days <= 7 ? (DAY_LABELS[d.getDay()] ?? String(d.getDate())) : String(d.getDate());
    windows.push({ start: dayStart, end: dayEnd, label });
  }
  return windows;
}

// ─── Router ──────────────────────────────────────────────────────

const devUsageRouter = new Hono<Env>();

// ── GET / ─────────────────────────────────────────────────────────

devUsageRouter.get('/', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  const query = querySchema.safeParse({ days: c.req.query('days') });
  if (!query.success)
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR' as const, message: 'Invalid query parameters' },
      },
      400,
    );

  const { days } = query.data;
  const developerId = ctx.userId;
  const db = getDb();

  const windowStart = new Date(Date.now() - days * 86_400_000);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  // ── Aggregate stats ──

  const statsRows = await db
    .select({
      totalCalls: count(),
      totalErrors: sql<number>`COUNT(CASE WHEN ${developerUsage.statusCode} >= 400 THEN 1 END)::int`,
      callsToday: sql<number>`COUNT(CASE WHEN ${developerUsage.timestamp} >= ${dayStart} THEN 1 END)::int`,
      errorsToday: sql<number>`COUNT(CASE WHEN ${developerUsage.timestamp} >= ${dayStart} AND ${developerUsage.statusCode} >= 400 THEN 1 END)::int`,
    })
    .from(developerUsage)
    .where(eq(developerUsage.developerId, developerId));

  const statsRow = statsRows[0];
  const stats = {
    totalCalls: statsRow?.totalCalls ?? 0,
    totalErrors: statsRow?.totalErrors ?? 0,
    callsToday: statsRow?.callsToday ?? 0,
    errorsToday: statsRow?.errorsToday ?? 0,
  };

  // ── Daily breakdown ──

  const windows = buildDayWindows(days);

  const dailyRows = await db
    .select({
      day: sql<string>`DATE(${developerUsage.timestamp})`,
      calls: count(),
      errors: sql<number>`COUNT(CASE WHEN ${developerUsage.statusCode} >= 400 THEN 1 END)::int`,
    })
    .from(developerUsage)
    .where(
      and(eq(developerUsage.developerId, developerId), gte(developerUsage.timestamp, windowStart)),
    )
    .groupBy(sql`DATE(${developerUsage.timestamp})`)
    .orderBy(sql`DATE(${developerUsage.timestamp})`);

  // Build a lookup by date string then map to the expected window labels
  const dailyByDate = new Map(dailyRows.map((r) => [r.day, r]));

  const daily = windows.map(({ start, label }) => {
    const key = start.toISOString().slice(0, 10);
    const row = dailyByDate.get(key);
    return {
      label,
      calls: row?.calls ?? 0,
      errors: row?.errors ?? 0,
    };
  });

  // ── Top endpoints ──

  const endpointRows = await db
    .select({
      endpoint: developerUsage.endpoint,
      calls: count(),
    })
    .from(developerUsage)
    .where(
      and(eq(developerUsage.developerId, developerId), gte(developerUsage.timestamp, windowStart)),
    )
    .groupBy(developerUsage.endpoint)
    .orderBy(desc(count()))
    .limit(10);

  const endpoints = endpointRows.map((r) => ({
    endpoint: r.endpoint,
    calls: r.calls,
  }));

  return c.json({
    success: true as const,
    data: { stats, daily, endpoints },
  });
});

export { devUsageRouter };
