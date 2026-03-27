/**
 * Analytics Routes — dashboard summary, channel/agent/compliance metrics, trends
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, role-checked.
 * ISO 27001 A.9.4.1 — Information access restriction.
 * HIPAA §164.312(a)(1) — Access control: aggregated metrics only, no raw PHI.
 *
 * All routes require auth + analytics:read permission.
 * All filter by tenantId from JWT — no cross-tenant analytics access.
 * NEVER log query parameters (PII/PHI risk).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AnalyticsQueries } from '@ordr/analytics';
import type { RealTimeCounters } from '@ordr/analytics';
import { METRIC_NAMES, GRANULARITIES } from '@ordr/analytics';
import type { MetricName } from '@ordr/analytics';
import { ValidationError, AuthorizationError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/auth.js';
import { jsonErr } from '../lib/http.js';

// ─── Input Schemas ───────────────────────────────────────────────

const timeRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  granularity: z.enum(GRANULARITIES).default('day'),
});

const trendParamSchema = z.object({
  metric: z.enum([
    'delivery',
    'agent_performance',
    'compliance',
    'customer_engagement',
    'response-rate',
    'response-time',
  ] as const),
});

const trendQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  granularity: z.enum(GRANULARITIES).default('day'),
  channel: z.string().max(100).optional(),
  agentRole: z.string().max(100).optional(),
  regulation: z.string().max(100).optional(),
});

const realTimeQuerySchema = z.object({
  metrics: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val.length === 0) return [...METRIC_NAMES];
      return val
        .split(',')
        .filter((m): m is MetricName => (METRIC_NAMES as readonly string[]).includes(m));
    }),
});

// ─── Dependencies (injected at startup) ──────────────────────────

interface AnalyticsDependencies {
  readonly queries: AnalyticsQueries;
  readonly realTimeCounters: RealTimeCounters;
}

let deps: AnalyticsDependencies | null = null;

export function configureAnalyticsRoutes(dependencies: AnalyticsDependencies): void {
  deps = dependencies;
}

// ─── Helpers ─────────────────────────────────────────────────────

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthorizationError('Tenant context required');
  }
  return ctx;
}

function parseZodErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.');
    const existing = fieldErrors[field];
    if (existing) {
      existing.push(issue.message);
    } else {
      fieldErrors[field] = [issue.message];
    }
  }
  return fieldErrors;
}

// ─── Router ──────────────────────────────────────────────────────

const analyticsRouter = new Hono<Env>();

// All routes require authentication + analytics:read permission
analyticsRouter.use('*', requireAuth());
analyticsRouter.use('*', requirePermissionMiddleware('analytics', 'read'));

// ─── GET /dashboard — Dashboard summary ──────────────────────────

analyticsRouter.get('/dashboard', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Analytics routes not configured');

  const ctx = ensureTenantContext(c);
  const result = await deps.queries.getDashboardSummary(ctx.tenantId);

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  return c.json({
    success: true as const,
    data: result.data,
  });
});

// ─── GET /channels — Channel metrics with time range ─────────────

analyticsRouter.get('/channels', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Analytics routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const parsed = timeRangeSchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
    granularity: c.req.query('granularity'),
  });

  if (!parsed.success) {
    throw new ValidationError(
      'Invalid time range parameters',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  const result = await deps.queries.getChannelMetrics(ctx.tenantId, parsed.data);

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  return c.json({
    success: true as const,
    data: result.data,
    timeRange: {
      from: parsed.data.from.toISOString(),
      to: parsed.data.to.toISOString(),
      granularity: parsed.data.granularity,
    },
  });
});

// ─── GET /agents — Agent performance metrics ─────────────────────

analyticsRouter.get('/agents', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Analytics routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const parsed = timeRangeSchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
    granularity: c.req.query('granularity'),
  });

  if (!parsed.success) {
    throw new ValidationError(
      'Invalid time range parameters',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  const result = await deps.queries.getAgentMetrics(ctx.tenantId, parsed.data);

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  return c.json({
    success: true as const,
    data: result.data,
    timeRange: {
      from: parsed.data.from.toISOString(),
      to: parsed.data.to.toISOString(),
      granularity: parsed.data.granularity,
    },
  });
});

// ─── GET /compliance — Compliance metrics ────────────────────────

analyticsRouter.get('/compliance', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Analytics routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const parsed = timeRangeSchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
    granularity: c.req.query('granularity'),
  });

  if (!parsed.success) {
    throw new ValidationError(
      'Invalid time range parameters',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  const result = await deps.queries.getComplianceMetrics(ctx.tenantId, parsed.data);

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  return c.json({
    success: true as const,
    data: result.data,
    timeRange: {
      from: parsed.data.from.toISOString(),
      to: parsed.data.to.toISOString(),
      granularity: parsed.data.granularity,
    },
  });
});

// ─── GET /trends/:metric — Trend data for specific metric ────────

analyticsRouter.get('/trends/:metric', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Analytics routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const paramParsed = trendParamSchema.safeParse({
    metric: c.req.param('metric'),
  });

  if (!paramParsed.success) {
    throw new ValidationError('Invalid trend metric', parseZodErrors(paramParsed.error), requestId);
  }

  const queryParsed = trendQuerySchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
    granularity: c.req.query('granularity'),
    channel: c.req.query('channel'),
    agentRole: c.req.query('agentRole'),
    regulation: c.req.query('regulation'),
  });

  if (!queryParsed.success) {
    throw new ValidationError(
      'Invalid trend query parameters',
      parseZodErrors(queryParsed.error),
      requestId,
    );
  }

  const timeRange = {
    from: queryParsed.data.from,
    to: queryParsed.data.to,

    granularity: queryParsed.data.granularity,
  };

  let result;
  switch (paramParsed.data.metric) {
    case 'delivery':
      result = await deps.queries.getDeliveryTrend(
        ctx.tenantId,
        timeRange,
        queryParsed.data.channel,
      );
      break;
    case 'agent_performance':
      result = await deps.queries.getAgentPerformanceTrend(
        ctx.tenantId,
        timeRange,
        queryParsed.data.agentRole,
      );
      break;
    case 'compliance':
      result = await deps.queries.getComplianceTrend(
        ctx.tenantId,
        timeRange,
        queryParsed.data.regulation,
      );
      break;
    case 'customer_engagement':
    case 'response-rate':
      result = await deps.queries.getCustomerEngagementTrend(ctx.tenantId, timeRange);
      break;
    case 'response-time':
      result = await deps.queries.getAgentPerformanceTrend(
        ctx.tenantId,
        timeRange,
        queryParsed.data.agentRole,
      );
      break;
  }

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  // Normalise MetricValue[] → TrendPoint[] so the frontend receives { date, value } tuples.
  const trendPoints = result.data.map((v) => ({
    date:
      v.timestamp instanceof Date
        ? v.timestamp.toISOString().split('T')[0]
        : String(v.timestamp).split('T')[0],
    value: v.value,
  }));

  return c.json({
    success: true as const,
    data: trendPoints,
    metric: paramParsed.data.metric,
    timeRange: {
      from: timeRange.from.toISOString(),
      to: timeRange.to.toISOString(),

      granularity: timeRange.granularity,
    },
  });
});

// ─── GET /real-time — Current real-time counters ─────────────────

analyticsRouter.get('/real-time', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Analytics routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const parsed = realTimeQuerySchema.safeParse({
    metrics: c.req.query('metrics'),
  });

  if (!parsed.success) {
    throw new ValidationError('Invalid metrics parameter', parseZodErrors(parsed.error), requestId);
  }

  const metricsToFetch = parsed.data.metrics;
  if (metricsToFetch.length === 0) {
    return c.json({
      success: true as const,
      data: {},
    });
  }

  const counters = await deps.realTimeCounters.getMultiple(ctx.tenantId, metricsToFetch);

  return c.json({
    success: true as const,
    data: counters,
    timestamp: new Date().toISOString(),
  });
});

export { analyticsRouter };
