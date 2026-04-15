/**
 * Custom Roles Routes — tenant-specific role management
 *
 * SOC2 CC6.2 — Management of access rights (audit-logged).
 * SOC2 CC6.3 — Role-based authorization with least privilege.
 * ISO 27001 A.9.2.3 — Management of privileged access rights.
 * HIPAA §164.312(a)(1) — Fine-grained access control.
 *
 * Endpoints:
 * GET    /            — List custom roles (auth required)
 * POST   /            — Create custom role (admin only)
 * GET    /:id         — Get role detail
 * PATCH  /:id         — Update role (admin only)
 * DELETE /:id         — Delete role (admin only)
 * POST   /:id/assign  — Assign role to user (admin only)
 * POST   /:id/revoke  — Revoke role from user (admin only)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { CustomRoleManager } from '@ordr/auth';
import { AuthenticationError, ValidationError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requireRoleMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { jsonErr } from '../lib/http.js';

// ─── Input Schemas ────────────────────────────────────────────────

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  baseRole: z.enum(['super_admin', 'tenant_admin', 'manager', 'agent', 'viewer']),
  permissions: z.array(
    z.object({
      resource: z.string().min(1),
      action: z.enum(['create', 'read', 'update', 'delete', 'execute']),
      scope: z.enum(['own', 'team', 'tenant', 'global']),
    }),
  ),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  permissions: z
    .array(
      z.object({
        resource: z.string().min(1),
        action: z.enum(['create', 'read', 'update', 'delete', 'execute']),
        scope: z.enum(['own', 'team', 'tenant', 'global']),
      }),
    )
    .optional(),
});

const assignRevokeSchema = z.object({
  userId: z.string().min(1),
});

// ─── Dependencies ─────────────────────────────────────────────────

interface RoleDependencies {
  readonly roleManager: CustomRoleManager;
}

let deps: RoleDependencies | null = null;

export function configureRoleRoutes(dependencies: RoleDependencies): void {
  deps = dependencies;
}

// ─── Router ───────────────────────────────────────────────────────

const rolesRouter = new Hono<Env>();

// All routes require authentication
rolesRouter.use('*', requireAuth());

// ─── GET / ────────────────────────────────────────────────────────

rolesRouter.get('/', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] Role routes not configured');
  }

  const ctx = c.get('tenantContext');
  if (!ctx) {
    const requestId = c.get('requestId');
    throw new AuthenticationError('Authentication required', requestId);
  }

  const result = await deps.roleManager.listRoles(ctx.tenantId);

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  return c.json({
    success: true as const,
    data: result.data,
  });
});

// ─── POST / ───────────────────────────────────────────────────────

rolesRouter.post(
  '/',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c): Promise<Response> => {
    if (!deps) {
      throw new Error('[ORDR:API] Role routes not configured');
    }

    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = createRoleSchema.safeParse(body);

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
      throw new ValidationError('Invalid role data', fieldErrors, requestId);
    }

    const result = await deps.roleManager.createRole(ctx.tenantId, ctx.userId, parsed.data);

    if (!result.success) {
      return jsonErr(c, result.error);
    }

    return c.json(
      {
        success: true as const,
        data: result.data,
      },
      201,
    );
  },
);

// ─── GET /:id ─────────────────────────────────────────────────────

rolesRouter.get('/:id', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] Role routes not configured');
  }

  const ctx = c.get('tenantContext');
  if (!ctx) {
    const requestId = c.get('requestId');
    throw new AuthenticationError('Authentication required', requestId);
  }

  const roleId = c.req.param('id');
  const result = await deps.roleManager.getRole(ctx.tenantId, roleId);

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  return c.json({
    success: true as const,
    data: result.data,
  });
});

// ─── PATCH /:id ───────────────────────────────────────────────────

rolesRouter.patch(
  '/:id',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c): Promise<Response> => {
    if (!deps) {
      throw new Error('[ORDR:API] Role routes not configured');
    }

    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    const roleId = c.req.param('id');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = updateRoleSchema.safeParse(body);

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

    const result = await deps.roleManager.updateRole(ctx.tenantId, roleId, ctx.userId, {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.permissions !== undefined ? { permissions: parsed.data.permissions } : {}),
    });

    if (!result.success) {
      return jsonErr(c, result.error);
    }

    return c.json({
      success: true as const,
      data: result.data,
    });
  },
);

// ─── DELETE /:id ──────────────────────────────────────────────────

rolesRouter.delete(
  '/:id',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c): Promise<Response> => {
    if (!deps) {
      throw new Error('[ORDR:API] Role routes not configured');
    }

    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    const roleId = c.req.param('id');
    const result = await deps.roleManager.deleteRole(ctx.tenantId, roleId, ctx.userId);

    if (!result.success) {
      return jsonErr(c, result.error);
    }

    return c.json({ success: true as const });
  },
);

// ─── POST /:id/assign ────────────────────────────────────────────

rolesRouter.post(
  '/:id/assign',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c): Promise<Response> => {
    if (!deps) {
      throw new Error('[ORDR:API] Role routes not configured');
    }

    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    const roleId = c.req.param('id');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = assignRevokeSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('userId is required', {}, requestId);
    }

    const result = await deps.roleManager.assignRole(
      ctx.tenantId,
      parsed.data.userId,
      roleId,
      ctx.userId,
    );

    if (!result.success) {
      return jsonErr(c, result.error);
    }

    return c.json({ success: true as const });
  },
);

// ─── POST /:id/revoke ────────────────────────────────────────────

rolesRouter.post(
  '/:id/revoke',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c): Promise<Response> => {
    if (!deps) {
      throw new Error('[ORDR:API] Role routes not configured');
    }

    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    const roleId = c.req.param('id');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = assignRevokeSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('userId is required', {}, requestId);
    }

    const result = await deps.roleManager.revokeRole(
      ctx.tenantId,
      parsed.data.userId,
      roleId,
      ctx.userId,
    );

    if (!result.success) {
      return jsonErr(c, result.error);
    }

    return c.json({ success: true as const });
  },
);

export { rolesRouter };
