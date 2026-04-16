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
 * DELETE /Users/:id   — Deactivate user (cascade)
 * GET    /Groups      — List groups
 * GET    /Groups/:id  — Get group
 * POST   /Groups      — Create group
 * PUT    /Groups/:id  — Full replace group
 * PATCH  /Groups/:id  — Incremental group update (PatchOps)
 * DELETE /Groups/:id  — Delete group
 */

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { SCIMHandler, parseSCIMFilter } from '@ordr/auth';
import type { SCIMTokenStore, SCIMUserRecord, SCIMGroupRecord, SCIMPatchRequest } from '@ordr/auth';
import { sha256 } from '@ordr/crypto';
import { AuthenticationError } from '@ordr/core';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Context } from 'hono';
import type { Env } from '../types.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ─── SCIM Schema URNs (local const — not imported from @ordr/auth) ─

const SCIM_SCHEMAS = {
  USER: 'urn:ietf:params:scim:schemas:core:2.0:User',
  GROUP: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  LIST: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  ERROR: 'urn:ietf:params:scim:api:messages:2.0:Error',
  PATCH: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
} as const;

// ─── Dependencies ─────────────────────────────────────────────────

interface SCIMDependencies {
  readonly scimHandler: SCIMHandler;
  readonly tokenStore: SCIMTokenStore;
}

let deps: SCIMDependencies | null = null;

export function configureSCIMRoutes(dependencies: SCIMDependencies): void {
  deps = dependencies;
}

// ─── SCIM Response Helpers ────────────────────────────────────────

function scimError(c: Context, status: number, detail: string): Response {
  return c.json({ schemas: [SCIM_SCHEMAS.ERROR], detail, status }, status as ContentfulStatusCode);
}

function scimListResponse(
  records: unknown[],
  total: number,
  startIndex: number,
  count: number,
): object {
  return {
    schemas: [SCIM_SCHEMAS.LIST],
    totalResults: total,
    startIndex,
    itemsPerPage: Math.min(records.length, count),
    Resources: records,
  };
}

// ─── SCIM Representation Mappers ──────────────────────────────────

function userToSCIM(user: SCIMUserRecord): object {
  return {
    schemas: [SCIM_SCHEMAS.USER],
    id: user.id,
    externalId: user.externalId ?? undefined,
    userName: user.userName,
    name: { formatted: user.displayName },
    displayName: user.displayName,
    emails: user.emails,
    active: user.active,
    meta: {
      resourceType: 'User',
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
    },
  };
}

function groupToSCIM(group: SCIMGroupRecord): object {
  return {
    schemas: [SCIM_SCHEMAS.GROUP],
    id: group.id,
    externalId: group.externalId ?? undefined,
    displayName: group.displayName,
    members: group.members,
    meta: {
      resourceType: 'Group',
      created: group.createdAt.toISOString(),
      lastModified: group.updatedAt.toISOString(),
    },
  };
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

    const hashed = sha256(token);
    const record = await deps.tokenStore.findByToken(hashed);
    const tenantId = record?.tenantId ?? null;

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
  const filterStr = c.req.query('filter');
  const startIndexRaw = c.req.query('startIndex');
  const startIndexParsed = startIndexRaw !== undefined ? parseInt(startIndexRaw, 10) : 1;
  const startIndex = isNaN(startIndexParsed) ? 1 : startIndexParsed;
  const countRaw = c.req.query('count');
  const countParsed = countRaw !== undefined ? parseInt(countRaw, 10) : 100;
  const count = isNaN(countParsed) ? 100 : countParsed;

  const filter = filterStr !== undefined ? (parseSCIMFilter(filterStr) ?? undefined) : undefined;

  const { records, total } = await deps.scimHandler.listUsers(tenantId, {
    startIndex,
    count,
    ...(filter !== undefined && { filter }),
  });

  return c.json(scimListResponse(records.map(userToSCIM), total, startIndex, count));
});

// ─── GET /Users/:id ───────────────────────────────────────────────

scimRouter.get('/Users/:id', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const userId = c.req.param('id');

  const user = await deps.scimHandler.getUserById(tenantId, userId);

  if (user === null) {
    return scimError(c, 404, `User ${userId} not found`);
  }

  return c.json(userToSCIM(user));
});

// ─── POST /Users ──────────────────────────────────────────────────

scimRouter.post('/Users', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const body = (await c.req.json().catch(() => null)) as unknown;

  if (body === null || typeof body !== 'object') {
    return scimError(c, 400, 'Invalid JSON body');
  }

  const raw = body as Record<string, unknown>;
  const userName = typeof raw['userName'] === 'string' ? raw['userName'] : null;
  const active = typeof raw['active'] === 'boolean' ? raw['active'] : true;
  const externalId = typeof raw['externalId'] === 'string' ? raw['externalId'] : null;

  // Extract displayName from name.formatted or name.givenName + familyName or userName fallback
  let displayName = '';
  if (typeof raw['displayName'] === 'string') {
    displayName = raw['displayName'];
  } else if (raw['name'] !== null && typeof raw['name'] === 'object') {
    const name = raw['name'] as Record<string, unknown>;
    if (typeof name['formatted'] === 'string') {
      displayName = name['formatted'];
    } else {
      const given = typeof name['givenName'] === 'string' ? name['givenName'] : '';
      const family = typeof name['familyName'] === 'string' ? name['familyName'] : '';
      displayName = `${given} ${family}`.trim();
    }
  }

  const emails = Array.isArray(raw['emails'])
    ? (raw['emails'] as Array<Record<string, unknown>>)
        .filter((e) => typeof e['value'] === 'string')
        .map((e) => ({
          value: e['value'] as string,
          primary: typeof e['primary'] === 'boolean' ? e['primary'] : false,
        }))
    : [];

  if (userName === null) {
    return scimError(c, 400, 'userName is required');
  }

  if (displayName === '') {
    displayName = userName;
  }

  const user = await deps.scimHandler.createUser(tenantId, {
    userName,
    displayName,
    emails,
    active,
    externalId,
    externalSource: null,
  });

  return c.json(userToSCIM(user), 201);
});

// ─── PATCH /Users/:id ─────────────────────────────────────────────
// RFC 7644 §3.5.2: PATCH body MUST be a PatchOp with an Operations array.
// Flat-object PATCH is not spec-compliant and is silently ignored by real IdPs.

scimRouter.patch('/Users/:id', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const userId = c.req.param('id');
  const body = (await c.req.json().catch(() => null)) as unknown;

  if (body === null || typeof body !== 'object') {
    return scimError(c, 400, 'Invalid JSON body');
  }

  const raw = body as Record<string, unknown>;

  // RFC 7644 §3.5.2 — Operations array is required
  if (!Array.isArray(raw['Operations'])) {
    return scimError(c, 400, 'Operations array is required');
  }

  const patchBody = body as SCIMPatchRequest;
  const patch: Partial<SCIMUserRecord> = {};

  for (const op of patchBody.Operations) {
    if (op.op === 'replace' || op.op === 'add') {
      if (op.path === 'userName' && typeof op.value === 'string') {
        patch.userName = op.value;
      } else if (op.path === 'active' && typeof op.value === 'boolean') {
        patch.active = op.value;
      } else if (op.path === 'displayName' && typeof op.value === 'string') {
        patch.displayName = op.value;
      } else if (op.path === 'externalId' && typeof op.value === 'string') {
        patch.externalId = op.value;
      } else if (op.path === 'name.formatted' && typeof op.value === 'string') {
        patch.displayName = op.value;
      } else if (op.path === 'emails' && Array.isArray(op.value)) {
        patch.emails = (op.value as Array<Record<string, unknown>>)
          .filter((e) => typeof e['value'] === 'string')
          .map((e) => ({
            value: e['value'] as string,
            primary: typeof e['primary'] === 'boolean' ? e['primary'] : false,
          }));
      }
    }
  }

  const user = await deps.scimHandler.updateUser(tenantId, userId, patch);

  if (user === null) {
    return scimError(c, 404, `User ${userId} not found`);
  }

  return c.json(userToSCIM(user));
});

// ─── DELETE /Users/:id ────────────────────────────────────────────

scimRouter.delete('/Users/:id', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const userId = c.req.param('id');

  // RFC 7644 §3.6: DELETE on non-existent resource MUST return 404
  const existing = await deps.scimHandler.getUserById(tenantId, userId);
  if (existing === null) {
    return scimError(c, 404, `User ${userId} not found`);
  }

  await deps.scimHandler.deleteUser(tenantId, userId);

  // SCIM spec: 204 No Content on successful DELETE
  return c.body(null, 204);
});

// ─── GET /Groups ──────────────────────────────────────────────────

scimRouter.get('/Groups', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const startIndexRaw = c.req.query('startIndex');
  const startIndexParsed = startIndexRaw !== undefined ? parseInt(startIndexRaw, 10) : 1;
  const startIndex = isNaN(startIndexParsed) ? 1 : startIndexParsed;
  const countRaw = c.req.query('count');
  const countParsed = countRaw !== undefined ? parseInt(countRaw, 10) : 100;
  const count = isNaN(countParsed) ? 100 : countParsed;

  const { records, total } = await deps.scimHandler.listGroups(tenantId, { startIndex, count });

  return c.json(scimListResponse(records.map(groupToSCIM), total, startIndex, count));
});

// ─── GET /Groups/:id ──────────────────────────────────────────────

scimRouter.get('/Groups/:id', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const groupId = c.req.param('id');

  const group = await deps.scimHandler.getGroupById(tenantId, groupId);

  if (group === null) {
    return scimError(c, 404, `Group ${groupId} not found`);
  }

  return c.json(groupToSCIM(group));
});

// ─── POST /Groups ─────────────────────────────────────────────────

scimRouter.post('/Groups', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const body = (await c.req.json().catch(() => null)) as unknown;

  if (body === null || typeof body !== 'object') {
    return scimError(c, 400, 'Invalid JSON body');
  }

  const raw = body as Record<string, unknown>;
  const displayName = typeof raw['displayName'] === 'string' ? raw['displayName'] : null;

  if (displayName === null) {
    return scimError(c, 400, 'displayName is required');
  }

  const memberIds = Array.isArray(raw['members'])
    ? (raw['members'] as Array<Record<string, unknown>>)
        .filter((m) => typeof m['value'] === 'string')
        .map((m) => m['value'] as string)
    : [];

  const group = await deps.scimHandler.createGroup(
    tenantId,
    {
      displayName,
      externalId: null,
      externalSource: null,
    },
    memberIds,
  );

  return c.json(groupToSCIM(group), 201);
});

// ─── PUT /Groups/:id ──────────────────────────────────────────────

scimRouter.put('/Groups/:id', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const groupId = c.req.param('id');
  const body = (await c.req.json().catch(() => null)) as unknown;

  if (body === null || typeof body !== 'object') {
    return scimError(c, 400, 'Invalid JSON body');
  }

  const raw = body as Record<string, unknown>;
  const displayName = typeof raw['displayName'] === 'string' ? raw['displayName'] : null;

  if (displayName === null) {
    return scimError(c, 400, 'displayName is required');
  }

  const memberIds = Array.isArray(raw['members'])
    ? (raw['members'] as Array<Record<string, unknown>>)
        .filter((m) => typeof m['value'] === 'string')
        .map((m) => m['value'] as string)
    : [];

  const group = await deps.scimHandler.updateGroup(tenantId, groupId, { displayName }, memberIds);

  if (group === null) {
    return scimError(c, 404, `Group ${groupId} not found`);
  }

  return c.json(groupToSCIM(group));
});

// ─── PATCH /Groups/:id ────────────────────────────────────────────

scimRouter.patch('/Groups/:id', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const groupId = c.req.param('id');
  const body = (await c.req.json().catch(() => null)) as unknown;

  if (body === null || typeof body !== 'object') {
    return scimError(c, 400, 'Invalid JSON body');
  }

  const raw2 = body as Record<string, unknown>;
  if (!Array.isArray(raw2['Operations'])) {
    return scimError(c, 400, 'Operations array is required');
  }
  const patchBody = body as SCIMPatchRequest;

  const group = await deps.scimHandler.patchGroup(tenantId, groupId, patchBody);

  if (group === null) {
    return scimError(c, 404, `Group ${groupId} not found`);
  }

  return c.json(groupToSCIM(group));
});

// ─── DELETE /Groups/:id ───────────────────────────────────────────

scimRouter.delete('/Groups/:id', rateLimit('write'), async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SCIM routes not configured');
  }

  const tenantId = getScimTenantId(c);
  const groupId = c.req.param('id');

  // RFC 7644 §3.6: DELETE on non-existent resource MUST return 404
  const existing = await deps.scimHandler.getGroupById(tenantId, groupId);
  if (existing === null) {
    return scimError(c, 404, `Group ${groupId} not found`);
  }

  await deps.scimHandler.deleteGroup(tenantId, groupId);

  return c.body(null, 204);
});

export { scimRouter };
