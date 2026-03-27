/**
 * SCIM 2.0 Routes — Automated user provisioning endpoints
 *
 * SOC2 CC6.2 — Automated provisioning and de-provisioning.
 * ISO 27001 A.9.2.1 — User registration and de-registration via IdP.
 * HIPAA §164.312(a)(1) — Automated access control management.
 *
 * SECURITY:
 * - SCIM routes use dedicated bearer tokens, NOT JWT.
 * - Tokens are SHA-256 hashed and verified via the scim_tokens table.
 * - User deactivation revokes ALL active sessions immediately.
 *
 * Endpoints:
 * GET    /Users       — List users (SCIM bearer auth)
 * GET    /Users/:id   — Get user
 * POST   /Users       — Create user
 * PATCH  /Users/:id   — Update user
 * DELETE /Users/:id   — Deactivate user
 * GET    /Groups      — List groups
 * POST   /Groups      — Create group
 * PATCH  /Groups/:id  — Update group
 */

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { SCIMHandler, SCIMTokenStore } from '@ordr/auth';
import { verifySCIMToken, SCIM_SCHEMAS } from '@ordr/auth';
import { AuthenticationError } from '@ordr/core';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../types.js';

// ─── Dependencies ─────────────────────────────────────────────────

interface SCIMDependencies {
  readonly scimHandler: SCIMHandler;
  readonly tokenStore: SCIMTokenStore;
}

let deps: SCIMDependencies | null = null;

export function configureSCIMRoutes(dependencies: SCIMDependencies): void {
  deps = dependencies;
}

// ─── SCIM Bearer Token Auth Middleware ────────────────────────────

/**
 * SCIM-specific authentication. Uses dedicated bearer tokens, NOT JWT.
 * Sets tenantId from the verified token record.
 */
const scimAuth = createMiddleware<Env & { Variables: { scimTenantId: string } }>(
  async (c, next) => {
    if (!deps) {
      throw new Error('[ORDR:API] SCIM routes not configured');
    }

    const requestId = c.get('requestId');
    const authHeader = c.req.header('authorization');

    if (authHeader === undefined || authHeader.length === 0 || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('SCIM bearer token required', requestId);
    }

    const token = authHeader.slice(7);
    if (token.length === 0) {
      throw new AuthenticationError('Empty bearer token', requestId);
    }

    const tenantId = await verifySCIMToken(token, deps.tokenStore);
    if (tenantId === null) {
      throw new AuthenticationError('Invalid or expired SCIM token', requestId);
    }

    c.set('scimTenantId' as never, tenantId as never);
    await next();
  },
);

// ─── Helper ──────────────────────────────────────────────────────

function getScimTenantId(c: { get(key: string): unknown }): string {
  return c.get('scimTenantId') as string;
}

// ─── Router ───────────────────────────────────────────────────────

const scimRouter = new Hono<Env>();

// Apply SCIM auth to all routes
scimRouter.use('*', scimAuth);

// ─── GET /Users ───────────────────────────────────────────────────

scimRouter.get('/Users', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const filter = c.req.query('filter');
  const startIndexRaw = c.req.query('startIndex');
  const startIndex = startIndexRaw !== undefined ? parseInt(startIndexRaw, 10) : 1;
  const countRaw = c.req.query('count');
  const count = countRaw !== undefined ? parseInt(countRaw, 10) : 100;

  const result = await deps.scimHandler.handleListUsers(tenantId, filter, startIndex, count);

  if (!result.success) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: result.error.message,
        status: result.error.statusCode,
      },
      result.error.statusCode as ContentfulStatusCode,
    );
  }

  return c.json(result.data);
});

// ─── GET /Users/:id ───────────────────────────────────────────────

scimRouter.get('/Users/:id', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const userId = c.req.param('id');

  const result = await deps.scimHandler.handleGetUser(tenantId, userId);

  if (!result.success) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: result.error.message,
        status: result.error.statusCode,
      },
      result.error.statusCode as ContentfulStatusCode,
    );
  }

  return c.json(result.data);
});

// ─── POST /Users ──────────────────────────────────────────────────

scimRouter.post('/Users', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);

  if (body === null) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: 'Invalid JSON body',
        status: 400,
      },
      400,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = await deps.scimHandler.handleCreateUser(tenantId, body);

  if (!result.success) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: result.error.message,
        status: result.error.statusCode,
      },
      result.error.statusCode as ContentfulStatusCode,
    );
  }

  return c.json(result.data, 201);
});

// ─── PATCH /Users/:id ─────────────────────────────────────────────

scimRouter.patch('/Users/:id', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const userId = c.req.param('id');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);

  if (body === null) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: 'Invalid JSON body',
        status: 400,
      },
      400,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = await deps.scimHandler.handleUpdateUser(tenantId, userId, body);

  if (!result.success) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: result.error.message,
        status: result.error.statusCode,
      },
      result.error.statusCode as ContentfulStatusCode,
    );
  }

  return c.json(result.data);
});

// ─── DELETE /Users/:id ────────────────────────────────────────────

scimRouter.delete('/Users/:id', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const userId = c.req.param('id');

  const result = await deps.scimHandler.handleDeactivateUser(tenantId, userId);

  if (!result.success) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: result.error.message,
        status: result.error.statusCode,
      },
      result.error.statusCode as ContentfulStatusCode,
    );
  }

  // SCIM spec: 204 No Content on successful DELETE
  return c.body(null, 204);
});

// ─── GET /Groups ──────────────────────────────────────────────────

scimRouter.get('/Groups', (c): Response => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  // Groups don't use the same handler pattern — call group store directly
  // For now, return an empty list response until group listing is wired
  return c.json({
    schemas: [SCIM_SCHEMAS.LIST],
    totalResults: 0,
    startIndex: 1,
    itemsPerPage: 0,
    Resources: [],
  });
});

// ─── POST /Groups ─────────────────────────────────────────────────

scimRouter.post('/Groups', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);

  if (body === null) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: 'Invalid JSON body',
        status: 400,
      },
      400,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = await deps.scimHandler.handleCreateGroup(tenantId, body);

  if (!result.success) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: result.error.message,
        status: result.error.statusCode,
      },
      result.error.statusCode as ContentfulStatusCode,
    );
  }

  return c.json(result.data, 201);
});

// ─── PATCH /Groups/:id ────────────────────────────────────────────

scimRouter.patch('/Groups/:id', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const groupId = c.req.param('id');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);

  if (body === null) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: 'Invalid JSON body',
        status: 400,
      },
      400,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = await deps.scimHandler.handleUpdateGroup(tenantId, groupId, body);

  if (!result.success) {
    return c.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        detail: result.error.message,
        status: result.error.statusCode,
      },
      result.error.statusCode as ContentfulStatusCode,
    );
  }

  return c.json(result.data);
});

export { scimRouter };
