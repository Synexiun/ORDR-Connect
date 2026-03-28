/**
 * Partner Stats Routes — monthly earnings from partner_payouts table
 *
 * SOC2 CC6.1 — Logical access: partner-scoped (ctx.userId = partnerId).
 * ISO 27001 A.12.4.1 — Event logging: financial data access audit-trailed.
 * HIPAA §164.312(b) — No PHI in partner payout records.
 *
 * Endpoints:
 * GET /stats   — Monthly earnings breakdown (last N months) + referral funnel
 *
 * The authenticated user's JWT sub (ctx.userId) is treated as the partnerId.
 * Tenant-isolated: only rows where partner_payouts.partner_id = caller's id.
 *
 * Referral funnel (clicks/signups/conversions) is backed by partner_referrals table.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte, sql, sum } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import { partnerPayouts, partnerReferrals } from '@ordr/db';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Module-level DB ─────────────────────────────────────────────

let _db: OrdrDatabase | null = null;

export function configurePartnerStatsRoute(db: OrdrDatabase): void {
  _db = db;
}

function getDb(): OrdrDatabase {
  if (_db === null) {
    throw new Error(
      '[ORDR:API] Partner stats route not configured — call configurePartnerStatsRoute()',
    );
  }
  return _db;
}

// ─── Query schema ────────────────────────────────────────────────

const querySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

// ─── Month window builder ────────────────────────────────────────

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function buildMonthWindows(count: number): { start: Date; isoMonth: string; label: string }[] {
  const windows: { start: Date; isoMonth: string; label: string }[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const isoMonth = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = MONTH_LABELS[d.getMonth()] ?? String(d.getMonth() + 1);
    windows.push({ start: d, isoMonth, label });
  }
  return windows;
}

// ─── Router ──────────────────────────────────────────────────────

const partnerStatsRouter = new Hono<Env>();

// ── GET / ─────────────────────────────────────────────────────────

partnerStatsRouter.get('/', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  const query = querySchema.safeParse({ months: c.req.query('months') });
  if (!query.success)
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR' as const, message: 'Invalid query parameters' },
      },
      400,
    );

  const { months } = query.data;
  const partnerId = ctx.userId;
  const db = getDb();

  const windows = buildMonthWindows(months);
  const windowStart = windows[0]?.start ?? new Date(Date.now() - months * 30 * 86_400_000);

  // ── Monthly earnings from partner_payouts ──

  const monthlyRows = await db
    .select({
      isoMonth: sql<string>`TO_CHAR(${partnerPayouts.periodStart}, 'YYYY-MM')`,
      amountCents: sum(partnerPayouts.amountCents),
    })
    .from(partnerPayouts)
    .where(
      and(eq(partnerPayouts.partnerId, partnerId), gte(partnerPayouts.periodStart, windowStart)),
    )
    .groupBy(sql`TO_CHAR(${partnerPayouts.periodStart}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${partnerPayouts.periodStart}, 'YYYY-MM')`);

  const monthlyByKey = new Map(monthlyRows.map((r) => [r.isoMonth, r]));

  const monthly = windows.map(({ isoMonth, label }) => {
    const row = monthlyByKey.get(isoMonth);
    return {
      month: label,
      amountCents:
        row?.amountCents !== null && row?.amountCents !== undefined ? Number(row.amountCents) : 0,
    };
  });

  // ── Referral funnel from partner_referrals ──

  const funnelRows = await db
    .select({
      month: partnerReferrals.month,
      clicks: partnerReferrals.clicks,
      signups: partnerReferrals.signups,
      conversions: partnerReferrals.conversions,
    })
    .from(partnerReferrals)
    .where(
      and(
        eq(partnerReferrals.partnerId, partnerId),
        gte(partnerReferrals.month, windows[0]?.isoMonth ?? ''),
      ),
    )
    .orderBy(partnerReferrals.month);

  const funnelByMonth = new Map(funnelRows.map((r) => [r.month, r]));

  const funnel = windows.map(({ isoMonth, label }) => {
    const row = funnelByMonth.get(isoMonth);
    return {
      month: label,
      clicks: row?.clicks ?? 0,
      signups: row?.signups ?? 0,
      conversions: row?.conversions ?? 0,
    };
  });

  return c.json({
    success: true as const,
    data: { monthly, funnel },
  });
});

export { partnerStatsRouter };
