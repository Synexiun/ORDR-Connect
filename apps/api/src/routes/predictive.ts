/**
 * Predictive Intelligence Router — /api/v1/predictive
 *
 * Surfaces actionable insights from decision_log (the WORM table written by the NBA pipeline):
 * - Overview: 30-day outcome rates and confidence
 * - At-risk customers: highest escalation frequency
 * - Opportunities: highest approval confidence (revenue potential)
 * - Model stats: per-layer performance metrics
 * - Trends: 7-day daily outcome breakdown
 *
 * All queries are against decision_log — no PHI is accessed or returned.
 * Customer IDs are UUIDs only (Rule 6).
 *
 * SOC2 CC7.2 | ISO 27001 A.8.6 | HIPAA §164.312(b)
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { eq, and, gte, desc, count, sql } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import type { AuditLogger } from '@ordr/audit';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ─── Deps / Configure ────────────────────────────────────────────────────────

interface PredictiveDeps {
  readonly db: OrdrDatabase;
  readonly auditLogger: Pick<AuditLogger, 'log'>;
}

let deps: PredictiveDeps | null = null;

export function configurePredictiveRoutes(d: PredictiveDeps): void {
  deps = d;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const predictiveRouter = new Hono<Env>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

function notConfigured(c: Context<Env>): Response {
  return c.json(
    {
      success: false as const,
      error: {
        code: 'NOT_CONFIGURED' as const,
        message: 'Predictive routes not configured',
        correlationId: c.get('requestId'),
      },
    },
    503,
  );
}

function notAuthenticated(c: Context<Env>): Response {
  return c.json(
    {
      success: false as const,
      error: {
        code: 'AUTH_FAILED' as const,
        message: 'Authentication required',
        correlationId: c.get('requestId'),
      },
    },
    401,
  );
}

// ─── GET /overview ────────────────────────────────────────────────────────────

predictiveRouter.get('/overview', requireAuth(), rateLimit('read'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined) return notAuthenticated(c);
  if (deps === null) return notConfigured(c);

  const { db } = deps;
  const since = daysAgo(30);

  const [overview] = await db
    .select({
      total: count(),
      approved: sql<number>`count(*) filter (where outcome = 'approved')`,
      escalated: sql<number>`count(*) filter (where outcome = 'escalated')`,
      rejected: sql<number>`count(*) filter (where outcome = 'rejected')`,
      avgConf: sql<number>`coalesce(avg(confidence), 0)`,
      uniqueCustomers: sql<number>`count(distinct customer_id)`,
    })
    .from(schema.decisionLog)
    .where(
      and(eq(schema.decisionLog.tenantId, ctx.tenantId), gte(schema.decisionLog.createdAt, since)),
    );

  const total = overview?.total ?? 0;
  const escalated = overview?.escalated ?? 0;
  const approved = overview?.approved ?? 0;

  return c.json({
    success: true as const,
    data: {
      totalDecisions: total,
      uniqueCustomers: overview?.uniqueCustomers ?? 0,
      approvalRate: total > 0 ? Number(((approved / total) * 100).toFixed(1)) : 0,
      escalationRate: total > 0 ? Number(((escalated / total) * 100).toFixed(1)) : 0,
      avgConfidence: Number((overview?.avgConf ?? 0).toFixed(3)),
      windowDays: 30,
    },
  });
});

// ─── GET /at-risk ─────────────────────────────────────────────────────────────

predictiveRouter.get('/at-risk', requireAuth(), rateLimit('read'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined) return notAuthenticated(c);
  if (deps === null) return notConfigured(c);

  const limitResult = limitSchema.safeParse(c.req.query('limit'));
  const limit = limitResult.success ? limitResult.data : 20;

  const { db } = deps;
  const since = daysAgo(30);

  const rows = await db
    .select({
      customerId: schema.decisionLog.customerId,
      escalationCount: count(),
      lastDecisionAt: sql<string>`max(created_at)::text`,
      avgConfidence: sql<number>`coalesce(avg(confidence), 0)`,
      lastAction: sql<string | null>`(array_agg(action_selected order by created_at desc))[1]`,
    })
    .from(schema.decisionLog)
    .where(
      and(
        eq(schema.decisionLog.tenantId, ctx.tenantId),
        eq(schema.decisionLog.outcome, 'escalated'),
        gte(schema.decisionLog.createdAt, since),
      ),
    )
    .groupBy(schema.decisionLog.customerId)
    .orderBy(desc(count()))
    .limit(limit);

  return c.json({
    success: true as const,
    data: rows.map((r) => ({
      customerId: r.customerId,
      escalationCount: r.escalationCount,
      lastDecisionAt: r.lastDecisionAt,
      avgConfidence: Number(r.avgConfidence.toFixed(3)),
      lastAction: r.lastAction ?? 'unknown',
      riskLevel: r.escalationCount >= 5 ? 'critical' : r.escalationCount >= 3 ? 'high' : 'medium',
    })),
  });
});

// ─── GET /opportunities ───────────────────────────────────────────────────────

predictiveRouter.get('/opportunities', requireAuth(), rateLimit('read'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined) return notAuthenticated(c);
  if (deps === null) return notConfigured(c);

  const limitResult = limitSchema.safeParse(c.req.query('limit'));
  const limit = limitResult.success ? limitResult.data : 20;

  const { db } = deps;
  const since = daysAgo(30);

  const rows = await db
    .select({
      customerId: schema.decisionLog.customerId,
      approvalCount: count(),
      lastDecisionAt: sql<string>`max(created_at)::text`,
      avgConfidence: sql<number>`coalesce(avg(confidence), 0)`,
      bestAction: sql<string | null>`(array_agg(action_selected order by confidence desc))[1]`,
    })
    .from(schema.decisionLog)
    .where(
      and(
        eq(schema.decisionLog.tenantId, ctx.tenantId),
        eq(schema.decisionLog.outcome, 'approved'),
        gte(schema.decisionLog.createdAt, since),
      ),
    )
    .groupBy(schema.decisionLog.customerId)
    .orderBy(desc(sql`avg(confidence)`))
    .limit(limit);

  return c.json({
    success: true as const,
    data: rows.map((r) => ({
      customerId: r.customerId,
      approvalCount: r.approvalCount,
      lastDecisionAt: r.lastDecisionAt,
      avgConfidence: Number(r.avgConfidence.toFixed(3)),
      bestAction: r.bestAction ?? 'unknown',
      opportunityScore: Math.round(r.avgConfidence * 100),
    })),
  });
});

// ─── GET /model-stats ─────────────────────────────────────────────────────────

const LAYER_META: Record<string, { name: string; model: string }> = {
  rules: { name: 'Rules Engine', model: 'Deterministic (<10ms)' },
  ml_scorer: { name: 'ML Scorer', model: 'v0.2.0-linear (<50ms)' },
  llm_reasoner: { name: 'LLM Reasoner', model: 'claude-sonnet-4-6 (<100ms)' },
};

predictiveRouter.get('/model-stats', requireAuth(), rateLimit('read'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined) return notAuthenticated(c);
  if (deps === null) return notConfigured(c);

  const { db } = deps;
  const since = daysAgo(30);

  const rows = await db
    .select({
      layer: schema.decisionLog.layerReached,
      total: count(),
      approved: sql<number>`count(*) filter (where outcome = 'approved')`,
      escalated: sql<number>`count(*) filter (where outcome = 'escalated')`,
      rejected: sql<number>`count(*) filter (where outcome = 'rejected')`,
      avgConf: sql<number>`coalesce(avg(confidence), 0)`,
      avgLatency: sql<number>`coalesce(avg(latency_ms), 0)`,
    })
    .from(schema.decisionLog)
    .where(
      and(eq(schema.decisionLog.tenantId, ctx.tenantId), gte(schema.decisionLog.createdAt, since)),
    )
    .groupBy(schema.decisionLog.layerReached);

  return c.json({
    success: true as const,
    data: rows.map((r) => {
      const meta = LAYER_META[r.layer] ?? { name: r.layer, model: 'unknown' };
      const total = r.total;
      return {
        layer: r.layer,
        name: meta.name,
        model: meta.model,
        total,
        approvalRate: total > 0 ? Number(((r.approved / total) * 100).toFixed(1)) : 0,
        escalationRate: total > 0 ? Number(((r.escalated / total) * 100).toFixed(1)) : 0,
        rejectionRate: total > 0 ? Number(((r.rejected / total) * 100).toFixed(1)) : 0,
        avgConfidence: Number(r.avgConf.toFixed(3)),
        avgLatencyMs: Math.round(r.avgLatency),
      };
    }),
  });
});

// ─── GET /trends ──────────────────────────────────────────────────────────────

predictiveRouter.get('/trends', requireAuth(), rateLimit('read'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined) return notAuthenticated(c);
  if (deps === null) return notConfigured(c);

  const { db } = deps;
  const since = daysAgo(7);

  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', created_at)::date::text`,
      approved: sql<number>`count(*) filter (where outcome = 'approved')`,
      escalated: sql<number>`count(*) filter (where outcome = 'escalated')`,
      rejected: sql<number>`count(*) filter (where outcome = 'rejected')`,
      avgLatency: sql<number>`coalesce(avg(latency_ms), 0)`,
      avgConf: sql<number>`coalesce(avg(confidence), 0)`,
    })
    .from(schema.decisionLog)
    .where(
      and(eq(schema.decisionLog.tenantId, ctx.tenantId), gte(schema.decisionLog.createdAt, since)),
    )
    .groupBy(sql`date_trunc('day', created_at)::date`)
    .orderBy(sql`date_trunc('day', created_at)::date`);

  return c.json({
    success: true as const,
    data: rows.map((r) => ({
      date: r.date,
      approved: r.approved,
      escalated: r.escalated,
      rejected: r.rejected,
      avgLatencyMs: Math.round(r.avgLatency),
      avgConfidence: Number(r.avgConf.toFixed(3)),
    })),
  });
});
