/**
 * Workflow Routes — definition templates, instance lifecycle management
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, auth-enforced.
 * ISO 27001 A.12.4.1 — Event logging: all state changes correlated by requestId.
 *
 * All mutating routes require auth.
 * Instances are tenant-isolated — tenantId always sourced from JWT context.
 * NEVER log workflow payloads directly (may contain PII/PHI).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkflowEngine, WorkflowInstanceStore } from '@ordr/workflow';
import { BUILTIN_TEMPLATES } from '@ordr/workflow';
import { ValidationError, AuthorizationError, NotFoundError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ─── Input Schemas ────────────────────────────────────────────────

const startInstanceSchema = z.object({
  definitionId: z.string().min(1).max(200),
  context: z.object({
    entityType: z.string().min(1).max(100),
    entityId: z.string().min(1).max(200),
    tenantId: z.string().min(1).max(200),
    variables: z.record(z.unknown()).default({}),
    correlationId: z.string().min(1).max(200),
    initiatedBy: z.string().min(1).max(200),
  }),
});

const listInstancesQuerySchema = z.object({
  status: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const cancelInstanceSchema = z.object({
  reason: z.string().min(1).max(500),
});

// ─── Dependencies (injected at startup) ───────────────────────────

interface WorkflowDeps {
  readonly engine: WorkflowEngine;
  readonly instanceStore: WorkflowInstanceStore;
}

let deps: WorkflowDeps | null = null;

export function configureWorkflowRoutes(dependencies: WorkflowDeps): void {
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

const workflowRouter = new Hono<Env>();

// All routes require authentication + workflow:read permission
workflowRouter.use('*', requireAuth());
workflowRouter.use('*', requirePermissionMiddleware('workflow', 'read'));

// ─── GET /definitions — List built-in templates ───────────────────

workflowRouter.get('/definitions', (c): Response => {
  // No deps needed — BUILTIN_TEMPLATES is a static registry
  const templates = Object.values(BUILTIN_TEMPLATES);

  return c.json({
    success: true as const,
    data: templates,
    total: templates.length,
  });
});

// ─── POST /instances — Start a workflow instance ──────────────────

workflowRouter.post('/instances', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Workflow routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const body: unknown = await c.req.json();

  const parsed = startInstanceSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid workflow start parameters',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  const instance = await deps.engine.startWorkflow(
    parsed.data.definitionId,
    parsed.data.context,
    ctx.tenantId,
  );

  return c.json({ success: true as const, data: instance }, 201);
});

// ─── GET /instances — List instances for tenant ───────────────────

workflowRouter.get('/instances', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Workflow routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const parsed = listInstancesQuerySchema.safeParse({
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });

  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(parsed.error), requestId);
  }

  const instances = await deps.instanceStore.list(ctx.tenantId, {
    ...(parsed.data.status !== undefined
      ? { status: parsed.data.status as import('@ordr/workflow').WorkflowStatus }
      : {}),
  });

  const page = instances.slice(0, parsed.data.limit);

  return c.json({
    success: true as const,
    data: page,
    total: page.length,
  });
});

// ─── GET /instances/:id — Get a specific instance ─────────────────

workflowRouter.get('/instances/:id', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Workflow routes not configured');

  const ctx = ensureTenantContext(c);
  const instanceId = c.req.param('id');

  const instance = await deps.instanceStore.getById(ctx.tenantId, instanceId);

  if (!instance) {
    throw new NotFoundError(`Workflow instance not found: ${instanceId}`);
  }

  return c.json({ success: true as const, data: instance });
});

// ─── PUT /instances/:id/pause — Pause a running instance ──────────

workflowRouter.put('/instances/:id/pause', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Workflow routes not configured');

  const ctx = ensureTenantContext(c);
  const instanceId = c.req.param('id');

  const instance = await deps.engine.pauseWorkflow(ctx.tenantId, instanceId);

  return c.json({ success: true as const, data: instance });
});

// ─── PUT /instances/:id/resume — Resume a paused instance ─────────

workflowRouter.put('/instances/:id/resume', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Workflow routes not configured');

  const ctx = ensureTenantContext(c);
  const instanceId = c.req.param('id');

  const instance = await deps.engine.resumeWorkflow(ctx.tenantId, instanceId);

  return c.json({ success: true as const, data: instance });
});

// ─── DELETE /instances/:id — Cancel an instance ───────────────────

workflowRouter.delete('/instances/:id', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Workflow routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const instanceId = c.req.param('id');
  const body: unknown = await c.req.json();

  const parsed = cancelInstanceSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid cancel parameters', parseZodErrors(parsed.error), requestId);
  }

  const instance = await deps.engine.cancelWorkflow(ctx.tenantId, instanceId, parsed.data.reason);

  return c.json({ success: true as const, data: instance });
});

export { workflowRouter };
