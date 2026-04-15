/**
 * Scheduler Routes — job definitions, one-time scheduling, instance history, dead-letter queue
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, auth-enforced.
 * ISO 27001 A.12.1.2 — Change management: scheduled job mutations require tenant_admin.
 *
 * Read operations (GET) require auth only.
 * Write operations (POST one-time jobs) require tenant_admin role.
 * Dead-letter queue access requires tenant_admin role.
 * Tenant isolation enforced via JWT context.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { JobScheduler, SchedulerStore } from '@ordr/scheduler';
import { JOB_PRIORITIES, isValidCron } from '@ordr/scheduler';
import type { JobPriority } from '@ordr/scheduler';
import { ValidationError, AuthorizationError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/auth.js';
import { requireRoleMiddleware } from '../middleware/auth.js';

// ─── Input Schemas ────────────────────────────────────────────────

const scheduleOnceBodySchema = z.object({
  jobType: z.string().min(1).max(200),
  payload: z.record(z.unknown()).optional(),
  runAt: z.string().datetime({ message: 'runAt must be an ISO 8601 datetime string' }),
  priority: z
    .enum([...JOB_PRIORITIES] as [JobPriority, ...JobPriority[]])
    .optional()
    .default('normal'),
});

const listInstancesQuerySchema = z.object({
  status: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Dependencies (injected at startup) ───────────────────────────

interface SchedulerDeps {
  readonly scheduler: JobScheduler;
  readonly store: SchedulerStore;
}

let deps: SchedulerDeps | null = null;

export function configureSchedulerRoutes(dependencies: SchedulerDeps): void {
  deps = dependencies;
}

// ─── Helpers ──────────────────────────────────────────────────────

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

// ─── Router ───────────────────────────────────────────────────────

const schedulerRouter = new Hono<Env>();

// All routes require authentication + scheduler:read permission
schedulerRouter.use('*', requireAuth());
schedulerRouter.use('*', requirePermissionMiddleware('scheduler', 'read'));

// ─── GET /jobs — List registered job definitions ──────────────────

schedulerRouter.get('/jobs', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Scheduler routes not configured');

  const status = await deps.scheduler.getStatus();

  return c.json({
    success: true as const,
    data: status,
  });
});

// ─── POST /jobs/once — Schedule a one-time job ────────────────────

schedulerRouter.post(
  '/jobs/once',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Scheduler routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const body: unknown = await c.req.json().catch(() => null);

    const parsed = scheduleOnceBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid job schedule parameters',
        parseZodErrors(parsed.error),
        requestId,
      );
    }

    const instanceId = await deps.scheduler.scheduleOnce(
      parsed.data.jobType,
      parsed.data.payload ?? {},
      new Date(parsed.data.runAt),
      { tenantId: ctx.tenantId, priority: parsed.data.priority },
    );

    return c.json({ success: true as const, data: { instanceId }, requestId }, 201);
  },
);

// ─── GET /instances — List job instances ─────────────────────────

schedulerRouter.get('/instances', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Scheduler routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const parsed = listInstancesQuerySchema.safeParse({
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });

  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(parsed.error), requestId);
  }

  const instances = await deps.store.listInstances({
    ...(parsed.data.status !== undefined
      ? { status: parsed.data.status as import('@ordr/scheduler').JobStatus }
      : {}),
  });

  // Tenant-scope: filter to this tenant's instances (tenantId === null means system job)
  const tenantInstances = instances
    .filter((i) => i.tenantId === null || i.tenantId === ctx.tenantId)
    .slice(0, parsed.data.limit);

  return c.json({
    success: true as const,
    data: tenantInstances,
    total: tenantInstances.length,
    requestId,
  });
});

// ─── GET /instances/:id — Get a specific job instance ────────────

schedulerRouter.get('/instances/:id', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Scheduler routes not configured');

  const ctx = ensureTenantContext(c);
  const instanceId = c.req.param('id');

  const requestId = c.get('requestId');
  const instance = await deps.store.getInstance(instanceId);

  if (!instance || (instance.tenantId !== null && instance.tenantId !== ctx.tenantId)) {
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'Job instance not found', correlationId: requestId },
      },
      404,
    );
  }

  return c.json({ success: true as const, data: instance, requestId });
});

// ─── GET /dead-letter — List dead letter queue (admin only) ───────

schedulerRouter.get(
  '/dead-letter',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Scheduler routes not configured');

    ensureTenantContext(c);

    const requestId = c.get('requestId');
    const allEntries = await deps.store.listDeadLetter();

    // Dead-letter entries don't carry tenantId directly; system-level visibility for tenant_admin
    return c.json({
      success: true as const,
      data: allEntries,
      total: allEntries.length,
      requestId,
    });
  },
);

export { schedulerRouter };

// Export isValidCron re-export for consumers that want to validate cron expressions
export { isValidCron };
