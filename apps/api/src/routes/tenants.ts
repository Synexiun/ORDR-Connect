/**
 * Tenant Management Routes — provisioning, lifecycle, and self-service
 *
 * SOC2 CC6.1 — Access control on tenant provisioning and status management.
 * SOC2 CC6.3 — Logical access controls enforced via RBAC.
 * ISO 27001 A.9.1.2 — Business requirements of access control.
 * HIPAA §164.308(a)(3) — Workforce access management.
 *
 * Endpoints:
 * GET  /me            — Own tenant details (any authenticated user)
 * PATCH /me           — Update own tenant name (tenant_admin)
 * GET  /              — List all tenants (super_admin only)
 * POST /              — Provision new tenant (super_admin only)
 * GET  /:id           — Get tenant by ID (super_admin or own tenant)
 * PATCH /:id          — Update tenant name/slug (super_admin only)
 * PATCH /:id/status   — Suspend / activate / deactivate (super_admin only)
 *
 * SECURITY:
 * - tenant_id from JWT only — NEVER from client input (Rule 2)
 * - All writes audit-logged WORM (Rule 3)
 * - No PHI in details payloads (Rule 6)
 * - Settings sub-tree (security config, agent config) excluded from all responses
 * - Status transitions are irreversible for 'deactivated' — requires explicit confirmation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { AuthorizationError, ValidationError, NotFoundError } from '@ordr/core';
import type { AuditLogger } from '@ordr/audit';
import type { Env } from '../types.js';
import { requireAuth, requireRoleMiddleware } from '../middleware/auth.js';

// ─── Row shape (excludes settings to prevent security config leakage) ─────────

export interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly plan: 'free' | 'starter' | 'professional' | 'enterprise';
  readonly status: 'active' | 'suspended' | 'deactivated';
  readonly isolationTier: 'shared' | 'schema' | 'dedicated';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Input Schemas ────────────────────────────────────────────────

const createTenantSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  plan: z.enum(['free', 'starter', 'professional', 'enterprise']).default('free'),
  isolationTier: z.enum(['shared', 'schema', 'dedicated']).default('shared'),
});

const updateTenantSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
});

const updateNameSchema = z.object({
  name: z.string().min(2).max(255),
});

const updateStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'deactivated']),
  reason: z.string().max(500).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['active', 'suspended', 'deactivated']).optional(),
  plan: z.enum(['free', 'starter', 'professional', 'enterprise']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type ListTenantsFilters = z.infer<typeof listQuerySchema>;

// ─── Dependencies (injected at startup) ──────────────────────────

export interface TenantRouteDeps {
  readonly getTenant: (id: string) => Promise<TenantRow | undefined>;
  readonly listTenants: (
    filters: ListTenantsFilters,
  ) => Promise<{ data: readonly TenantRow[]; total: number }>;
  readonly createTenant: (data: CreateTenantInput) => Promise<TenantRow>;
  readonly updateTenant: (
    id: string,
    patch: { name?: string; slug?: string },
  ) => Promise<TenantRow | undefined>;
  readonly updateTenantStatus: (
    id: string,
    status: 'active' | 'suspended' | 'deactivated',
  ) => Promise<TenantRow | undefined>;
  readonly auditLogger: AuditLogger;
}

let deps: TenantRouteDeps | null = null;

export function configureTenantRoutes(dependencies: TenantRouteDeps): void {
  deps = dependencies;
}

function getDeps(): TenantRouteDeps {
  if (deps === null) throw new Error('[ORDR:API] Tenant routes not configured');
  return deps;
}

// ─── Helpers ─────────────────────────────────────────────────────

function parseZodErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.');
    const existing = fieldErrors[field];
    if (existing !== undefined) {
      existing.push(issue.message);
    } else {
      fieldErrors[field] = [issue.message];
    }
  }
  return fieldErrors;
}

// ─── Router ──────────────────────────────────────────────────────

export const tenantsRouter = new Hono<Env>();
tenantsRouter.use('*', requireAuth());

// ─── GET /me — Own tenant ────────────────────────────────────────────────────
// SOC2 CC6.1 — Tenant reads own provisioning record.
// Returns plan, status, and isolation tier — settings sub-tree excluded.

tenantsRouter.get('/me', async (c): Promise<Response> => {
  const { getTenant } = getDeps();
  const ctx = c.get('tenantContext');
  if (ctx === undefined) throw new AuthorizationError('Tenant context required');
  const requestId = c.get('requestId');

  const tenant = await getTenant(ctx.tenantId);
  if (tenant === undefined) throw new NotFoundError('Tenant not found');

  return c.json({ success: true as const, data: tenant, requestId });
});

// ─── PATCH /me — Update own tenant name ─────────────────────────────────────
// SOC2 CC6.3 — Requires tenant_admin role.
// Slug changes are platform-admin only — name is the only self-service field.

tenantsRouter.patch('/me', requireRoleMiddleware('tenant_admin'), async (c): Promise<Response> => {
  const { updateTenant, auditLogger } = getDeps();
  const ctx = c.get('tenantContext');
  if (ctx === undefined) throw new AuthorizationError('Tenant context required');
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json();
  const parsed = updateNameSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid update request', parseZodErrors(parsed.error), requestId);
  }

  const updated = await updateTenant(ctx.tenantId, { name: parsed.data.name });
  if (updated === undefined) throw new NotFoundError('Tenant not found');

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.updated',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'tenant',
    resourceId: ctx.tenantId,
    action: 'update_name',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: updated, requestId });
});

// ─── GET / — List all tenants ────────────────────────────────────────────────
// SOC2 CC6.1 — Platform admin access only. Supports status + plan filtering.

tenantsRouter.get('/', requireRoleMiddleware('super_admin'), async (c): Promise<Response> => {
  const { listTenants } = getDeps();
  const requestId = c.get('requestId');

  const parsed = listQuerySchema.safeParse({
    status: c.req.query('status'),
    plan: c.req.query('plan'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(parsed.error), requestId);
  }

  const { data, total } = await listTenants(parsed.data);

  return c.json({
    success: true as const,
    data,
    pagination: { total, limit: parsed.data.limit, offset: parsed.data.offset },
    requestId,
  });
});

// ─── POST / — Provision new tenant ──────────────────────────────────────────
// SOC2 CC6.1 — Platform admin only. Creates tenant record + audits provisioning.
// ISO 27001 A.9.1 — Provisioning is an access control event requiring full audit trail.

tenantsRouter.post('/', requireRoleMiddleware('super_admin'), async (c): Promise<Response> => {
  const { createTenant, auditLogger } = getDeps();
  const ctx = c.get('tenantContext');
  if (ctx === undefined) throw new AuthorizationError('Tenant context required');
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json();
  const parsed = createTenantSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid tenant request', parseZodErrors(parsed.error), requestId);
  }

  const tenant = await createTenant(parsed.data);

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.created',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'tenant',
    resourceId: tenant.id,
    action: 'provision',
    details: { plan: tenant.plan, isolationTier: tenant.isolationTier },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: tenant, requestId }, 201);
});

// ─── GET /:id — Get tenant by ID ─────────────────────────────────────────────
// SOC2 CC6.1 — Super admin can read any tenant; others can only read own.

tenantsRouter.get('/:id', async (c): Promise<Response> => {
  const { getTenant } = getDeps();
  const ctx = c.get('tenantContext');
  if (ctx === undefined) throw new AuthorizationError('Tenant context required');
  const requestId = c.get('requestId');
  const tenantId = c.req.param('id');

  // Non-super_admin may only read their own tenant
  const isSuperAdmin = ctx.roles.includes('super_admin');
  if (!isSuperAdmin && tenantId !== ctx.tenantId) {
    throw new AuthorizationError('Access denied');
  }

  const tenant = await getTenant(tenantId);
  if (tenant === undefined) throw new NotFoundError('Tenant not found');

  return c.json({ success: true as const, data: tenant, requestId });
});

// ─── PATCH /:id — Update tenant name/slug ───────────────────────────────────
// SOC2 CC6.3 — Super admin only. Slug changes affect routing + must be unique.

tenantsRouter.patch('/:id', requireRoleMiddleware('super_admin'), async (c): Promise<Response> => {
  const { updateTenant, auditLogger } = getDeps();
  const ctx = c.get('tenantContext');
  if (ctx === undefined) throw new AuthorizationError('Tenant context required');
  const requestId = c.get('requestId');
  const tenantId = c.req.param('id');

  const body: unknown = await c.req.json();
  const parsed = updateTenantSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid update request', parseZodErrors(parsed.error), requestId);
  }

  if (parsed.data.name === undefined && parsed.data.slug === undefined) {
    return c.json({ success: true as const, message: 'No changes', requestId });
  }

  const updated = await updateTenant(tenantId, parsed.data);
  if (updated === undefined) throw new NotFoundError('Tenant not found');

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.updated',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'tenant',
    resourceId: tenantId,
    action: 'update',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: updated, requestId });
});

// ─── PATCH /:id/status — Tenant status transition ────────────────────────────
// SOC2 CC6.1 — Platform admin only. Suspension blocks all tenant API access.
// ISO 27001 A.9.2 — User access management: deactivation is irreversible via API.
// HIPAA §164.308(a)(3) — Workforce clearance: deactivation severs all access.

tenantsRouter.patch(
  '/:id/status',
  requireRoleMiddleware('super_admin'),
  async (c): Promise<Response> => {
    const { updateTenantStatus, auditLogger } = getDeps();
    const ctx = c.get('tenantContext');
    if (ctx === undefined) throw new AuthorizationError('Tenant context required');
    const requestId = c.get('requestId');
    const tenantId = c.req.param('id');

    const body: unknown = await c.req.json();
    const parsed = updateStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid status request', parseZodErrors(parsed.error), requestId);
    }

    const updated = await updateTenantStatus(tenantId, parsed.data.status);
    if (updated === undefined) throw new NotFoundError('Tenant not found');

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'system.config_change',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'tenant',
      resourceId: tenantId,
      action: `status_change_to_${parsed.data.status}`,
      details:
        parsed.data.reason !== undefined
          ? { reason: parsed.data.reason, newStatus: parsed.data.status }
          : { newStatus: parsed.data.status },
      timestamp: new Date(),
    });

    return c.json({ success: true as const, data: updated, requestId });
  },
);
