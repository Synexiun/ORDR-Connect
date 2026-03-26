/**
 * Organization Routes — org hierarchy management
 *
 * SOC2 CC6.3 — Organizational access control hierarchy.
 * ISO 27001 A.6.1.1 — Information security roles and responsibilities.
 * HIPAA §164.312(a)(1) — Organizational access control.
 *
 * Endpoints:
 * GET    /            — List organizations (auth required)
 * POST   /            — Create organization (admin only)
 * GET    /:id         — Get organization detail
 * PATCH  /:id         — Update organization (admin only)
 * DELETE /:id         — Delete organization (admin only)
 * GET    /:id/hierarchy — Get organization tree
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { OrganizationManager } from '@ordr/auth';
import type { AuditLogger } from '@ordr/audit';
import {
  AuthenticationError,
  ValidationError,
} from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requireRoleMiddleware } from '../middleware/auth.js';

// ─── Input Schemas ────────────────────────────────────────────────

const createOrgSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  parentId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Dependencies ─────────────────────────────────────────────────

interface OrgDependencies {
  readonly orgManager: OrganizationManager;
  readonly auditLogger: AuditLogger;
}

let deps: OrgDependencies | null = null;

export function configureOrgRoutes(dependencies: OrgDependencies): void {
  deps = dependencies;
}

// ─── Router ───────────────────────────────────────────────────────

const organizationsRouter = new Hono<Env>();

// All routes require authentication
organizationsRouter.use('*', requireAuth());

// ─── GET / ────────────────────────────────────────────────────────

organizationsRouter.get('/', async (c) => {
  if (!deps) {
    throw new Error('[ORDR:API] Organization routes not configured');
  }

  const ctx = c.get('tenantContext');
  if (!ctx) {
    const requestId = c.get('requestId') ?? 'unknown';
    throw new AuthenticationError('Authentication required', requestId);
  }

  const parentId = c.req.query('parentId');
  const result = await deps.orgManager.listOrganizations(ctx.tenantId, parentId);

  if (!result.success) {
    return c.json(result.error.toSafeResponse(), result.error.statusCode);
  }

  return c.json({
    success: true as const,
    data: result.data,
  });
});

// ─── POST / ───────────────────────────────────────────────────────

organizationsRouter.post(
  '/',
  requireRoleMiddleware('tenant_admin'),
  async (c) => {
    if (!deps) {
      throw new Error('[ORDR:API] Organization routes not configured');
    }

    const requestId = c.get('requestId') ?? 'unknown';
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createOrgSchema.safeParse(body);

    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.');
        const existing = fieldErrors[field];
        if (existing) {
          existing.push(issue.message);
        } else {
          fieldErrors[field] = [issue.message];
        }
      }
      throw new ValidationError('Invalid organization data', fieldErrors, requestId);
    }

    const result = await deps.orgManager.createOrganization(ctx.tenantId, parsed.data);

    if (!result.success) {
      return c.json(result.error.toSafeResponse(), result.error.statusCode);
    }

    // Audit log
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'organization.created',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'organization',
      resourceId: result.data.id,
      action: 'create',
      details: { name: parsed.data.name, slug: parsed.data.slug },
      timestamp: new Date(),
    });

    return c.json({
      success: true as const,
      data: result.data,
    }, 201);
  },
);

// ─── GET /:id ─────────────────────────────────────────────────────

organizationsRouter.get('/:id', async (c) => {
  if (!deps) {
    throw new Error('[ORDR:API] Organization routes not configured');
  }

  const ctx = c.get('tenantContext');
  if (!ctx) {
    const requestId = c.get('requestId') ?? 'unknown';
    throw new AuthenticationError('Authentication required', requestId);
  }

  const orgId = c.req.param('id');
  const result = await deps.orgManager.getOrganization(ctx.tenantId, orgId);

  if (!result.success) {
    return c.json(result.error.toSafeResponse(), result.error.statusCode);
  }

  return c.json({
    success: true as const,
    data: result.data,
  });
});

// ─── PATCH /:id ───────────────────────────────────────────────────

organizationsRouter.patch(
  '/:id',
  requireRoleMiddleware('tenant_admin'),
  async (c) => {
    if (!deps) {
      throw new Error('[ORDR:API] Organization routes not configured');
    }

    const requestId = c.get('requestId') ?? 'unknown';
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    const orgId = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const parsed = updateOrgSchema.safeParse(body);

    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.');
        const existing = fieldErrors[field];
        if (existing) {
          existing.push(issue.message);
        } else {
          fieldErrors[field] = [issue.message];
        }
      }
      throw new ValidationError('Invalid update data', fieldErrors, requestId);
    }

    const result = await deps.orgManager.updateOrganization(
      ctx.tenantId,
      orgId,
      parsed.data,
    );

    if (!result.success) {
      return c.json(result.error.toSafeResponse(), result.error.statusCode);
    }

    return c.json({
      success: true as const,
      data: result.data,
    });
  },
);

// ─── DELETE /:id ──────────────────────────────────────────────────

organizationsRouter.delete(
  '/:id',
  requireRoleMiddleware('tenant_admin'),
  async (c) => {
    if (!deps) {
      throw new Error('[ORDR:API] Organization routes not configured');
    }

    const requestId = c.get('requestId') ?? 'unknown';
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    const orgId = c.req.param('id');
    const result = await deps.orgManager.deleteOrganization(ctx.tenantId, orgId);

    if (!result.success) {
      return c.json(result.error.toSafeResponse(), result.error.statusCode);
    }

    // Audit log
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'organization.deleted',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'organization',
      resourceId: orgId,
      action: 'delete',
      details: {},
      timestamp: new Date(),
    });

    return c.json({ success: true as const });
  },
);

// ─── GET /:id/hierarchy ──────────────────────────────────────────

organizationsRouter.get('/:id/hierarchy', async (c) => {
  if (!deps) {
    throw new Error('[ORDR:API] Organization routes not configured');
  }

  const ctx = c.get('tenantContext');
  if (!ctx) {
    const requestId = c.get('requestId') ?? 'unknown';
    throw new AuthenticationError('Authentication required', requestId);
  }

  const orgId = c.req.param('id');
  const result = await deps.orgManager.getOrgHierarchy(ctx.tenantId, orgId);

  if (!result.success) {
    return c.json(result.error.toSafeResponse(), result.error.statusCode);
  }

  return c.json({
    success: true as const,
    data: result.data,
  });
});

export { organizationsRouter };
