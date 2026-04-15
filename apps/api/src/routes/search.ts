/**
 * Search Routes — full-text search, type-ahead suggestions, faceted search, index management
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, auth-enforced.
 * HIPAA §164.312(a)(1) — Access control: sanitize PHI fields before indexing/returning.
 *
 * All routes require auth.
 * Admin operations (index management) require tenant_admin role.
 * Search results are always tenant-scoped — tenantId sourced from JWT.
 * NEVER log raw search queries (may contain PHI).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { SearchEngine, SearchIndexer } from '@ordr/search';
import type {
  SearchFilter,
  SearchSort,
  SearchFacet,
  SearchFacetType,
  SearchableEntityType,
} from '@ordr/search';
import { MAX_SEARCH_LIMIT, SEARCHABLE_ENTITY_TYPES } from '@ordr/search';
import { ValidationError, AuthorizationError } from '@ordr/core';
import type { AuditLogger } from '@ordr/audit';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/auth.js';
import { requireRoleMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ─── Input Schemas ────────────────────────────────────────────────

const searchFilterSchema: z.ZodType<SearchFilter> = z.object({
  field: z.string().min(1).max(100),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between']),
  value: z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]),
}) as z.ZodType<SearchFilter>;

const searchSortSchema: z.ZodType<SearchSort> = z.object({
  field: z.enum(['relevance', 'indexed_at', 'updated_at']),
  direction: z.enum(['asc', 'desc']),
}) as z.ZodType<SearchSort>;

const searchBodySchema = z.object({
  query: z.string().min(1).max(500),
  entityTypes: z.array(z.string().max(100)).optional(),
  filters: z.array(searchFilterSchema).optional(),
  sort: searchSortSchema.optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(20),
  offset: z.number().int().min(0).default(0),
});

const suggestQuerySchema = z.object({
  q: z.string().min(1).max(200),
  entityType: z.string().max(100).optional(),
});

const facetSchema: z.ZodType<SearchFacet> = z.object({
  type: z.enum(['entity_type', 'date_range', 'status'] satisfies [
    SearchFacetType,
    ...SearchFacetType[],
  ]),
  field: z.string().min(1).max(100),
}) as z.ZodType<SearchFacet>;

const facetedSearchBodySchema = z.object({
  facets: z.array(facetSchema).min(1),
  query: z.string().max(500).optional(),
  filters: z.array(searchFilterSchema).optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(20),
  offset: z.number().int().min(0).default(0),
});

const indexEntityBodySchema = z.object({
  entityType: z.enum([...SEARCHABLE_ENTITY_TYPES] as [
    SearchableEntityType,
    ...SearchableEntityType[],
  ]),
  entityId: z.string().min(1).max(200),
  fields: z.record(
    z.object({
      value: z.string(),
      weight: z.enum(['A', 'B', 'C', 'D']),
      isPhi: z.boolean(),
    }),
  ),
  displayTitle: z.string().max(500).optional(),
  displaySubtitle: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Dependencies (injected at startup) ───────────────────────────

interface SearchDeps {
  readonly engine: SearchEngine;
  readonly indexer: SearchIndexer;
  readonly auditLogger?: Pick<AuditLogger, 'log'>;
}

let deps: SearchDeps | null = null;

export function configureSearchRoutes(dependencies: SearchDeps): void {
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

const searchRouter = new Hono<Env>();

// All routes require authentication + search:read permission
searchRouter.use('*', requireAuth());
searchRouter.use('*', requirePermissionMiddleware('search', 'read'));

// ─── POST / — Full-text search ────────────────────────────────────
// SOC2 CC6.1 — Query always scoped to tenantId from JWT.
// HIPAA §164.312 — Results contain only PHI-masked display fields.

searchRouter.post('/', rateLimit('read'), async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Search routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const body: unknown = await c.req.json().catch(() => null);

  const parsed = searchBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid search parameters', parseZodErrors(parsed.error), requestId);
  }

  // Build entity-type filters from convenience field
  const entityFilters: SearchFilter[] = [];
  if (parsed.data.entityTypes && parsed.data.entityTypes.length > 0) {
    entityFilters.push({
      field: 'entity_type',
      operator: 'in',
      value: parsed.data.entityTypes,
    });
  }

  const results = await deps.engine.search(
    parsed.data.query,
    {
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      ...(parsed.data.sort !== undefined ? { sort: parsed.data.sort } : {}),
      filters: [...(parsed.data.filters ?? []), ...entityFilters],
    },
    ctx.tenantId,
  );

  return c.json({
    success: true as const,
    data: results.results,
    total: results.total,
    facets: results.facets,
    took: results.took,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    ...(results.nextCursor !== undefined ? { nextCursor: results.nextCursor } : {}),
    requestId,
  });
});

// ─── GET /suggest — Type-ahead suggestions ────────────────────────
// SOC2 CC6.1 — Results scoped to tenant; no PHI in suggestions.
// HIPAA §164.312 — PHI stripped at index time; suggestions are display-safe.

searchRouter.get('/suggest', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Search routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const parsed = suggestQuerySchema.safeParse({
    q: c.req.query('q'),
    entityType: c.req.query('entityType'),
  });

  if (!parsed.success) {
    throw new ValidationError(
      'Invalid suggestion parameters',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  // Validate entityType is a known entity type; ignore unknown to return empty
  const entityType = parsed.data.entityType as SearchableEntityType | undefined;

  const suggestions = await deps.engine.suggest(parsed.data.q, entityType, ctx.tenantId);

  return c.json({
    success: true as const,
    data: suggestions,
    requestId,
  });
});

// ─── POST /faceted — Faceted search ───────────────────────────────
// SOC2 CC6.1 — Facet aggregations tenant-scoped.

searchRouter.post('/faceted', rateLimit('read'), async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Search routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const body: unknown = await c.req.json().catch(() => null);

  const parsed = facetedSearchBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid faceted search parameters',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  const results = await deps.engine.facetedSearch(
    parsed.data.query ?? '',
    parsed.data.facets,
    {
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      filters: parsed.data.filters ?? [],
    },
    ctx.tenantId,
  );

  return c.json({
    success: true as const,
    data: results.results,
    total: results.total,
    facets: results.facets,
    took: results.took,
    requestId,
  });
});

// ─── POST /index — Index an entity (admin only) ───────────────────
// SOC2 CC6.1 — Index mutations restricted to tenant_admin.
// HIPAA §164.312 — PHI is stripped by indexer before storage.
// ISO 27001 A.8.2.3 — Data classification enforced at index boundary.

searchRouter.post(
  '/index',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Search routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const body: unknown = await c.req.json().catch(() => null);

    const parsed = indexEntityBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid index parameters',
        parseZodErrors(parsed.error),
        requestId,
      );
    }

    const entry = await deps.indexer.indexEntity({
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      tenantId: ctx.tenantId,
      fields: parsed.data.fields,
      ...(parsed.data.displayTitle !== undefined ? { displayTitle: parsed.data.displayTitle } : {}),
      ...(parsed.data.displaySubtitle !== undefined
        ? { displaySubtitle: parsed.data.displaySubtitle }
        : {}),
      ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
    });

    return c.json({ success: true as const, data: entry, requestId }, 201);
  },
);

// ─── DELETE /index/:entityType/:entityId — Remove from index (admin only) ─
// SOC2 CC6.1 — Index deletions restricted to tenant_admin.

searchRouter.delete(
  '/index/:entityType/:entityId',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Search routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const rawEntityType = c.req.param('entityType');
    const entityId = c.req.param('entityId');

    if (!SEARCHABLE_ENTITY_TYPES.includes(rawEntityType as SearchableEntityType)) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'INVALID_ENTITY_TYPE',
            message: `Unknown entity type: ${rawEntityType}`,
            correlationId: requestId,
          },
        },
        400,
      );
    }

    const entityType = rawEntityType as SearchableEntityType;
    const removed = await deps.indexer.removeEntity(entityType, entityId, ctx.tenantId);

    if (deps.auditLogger) {
      await deps.auditLogger.log({
        tenantId: ctx.tenantId,
        eventType: 'search.index_deleted',
        actorType: 'user',
        actorId: ctx.userId,
        resource: 'search_index',
        resourceId: entityId,
        action: 'delete',
        details: { entityType },
        timestamp: new Date(),
      });
    }

    return c.json({ success: true as const, removed, requestId });
  },
);

// ─── POST /reindex/:entityType — Reindex all entities of type (admin only) ─
// SOC2 CC6.1 — Reindex restricted to tenant_admin.
// ISO 27001 A.12.4.1 — Reindex operation audit-logged via indexer.

searchRouter.post(
  '/reindex/:entityType',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('bulk'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Search routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const rawEntityType = c.req.param('entityType');

    if (!SEARCHABLE_ENTITY_TYPES.includes(rawEntityType as SearchableEntityType)) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'INVALID_ENTITY_TYPE',
            message: `Unknown entity type: ${rawEntityType}`,
            correlationId: requestId,
          },
        },
        400,
      );
    }

    const entityType = rawEntityType as SearchableEntityType;
    const count = await deps.indexer.reindexAll(entityType, ctx.tenantId);

    if (deps.auditLogger) {
      await deps.auditLogger.log({
        tenantId: ctx.tenantId,
        eventType: 'search.reindex',
        actorType: 'user',
        actorId: ctx.userId,
        resource: 'search_index',
        resourceId: ctx.tenantId,
        action: 'reindex',
        details: { entityType, reindexed: count },
        timestamp: new Date(),
      });
    }

    return c.json({
      success: true as const,
      data: { reindexed: count, entityType },
      requestId,
    });
  },
);

export { searchRouter };
