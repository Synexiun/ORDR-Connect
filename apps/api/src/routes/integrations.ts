/**
 * Integrations Routes — CRM OAuth and contact/deal sync for Salesforce and HubSpot
 *
 * SOC2 CC6.1 — Access control: auth-enforced, tenant-scoped.
 * ISO 27001 A.12.6.1 — Management of technical vulnerabilities: adapter health checks.
 *
 * Public route: GET /providers — returns available provider names only, no auth needed.
 * All other routes require auth.
 * OAuth operations (authorize, callback) require tenant_admin role.
 * Contact delete requires tenant_admin role.
 * Provider adapters are keyed by INTEGRATION_PROVIDERS constants.
 * NEVER log OAuth codes or tokens.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { INTEGRATION_PROVIDERS } from '@ordr/integrations';
import type { OAuthCredentials, IntegrationHealth } from '@ordr/integrations';
import { ValidationError, AuthorizationError, NotFoundError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/auth.js';
import { requireRoleMiddleware } from '../middleware/auth.js';

// ─── CRMAdapter interface ─────────────────────────────────────────

interface OAuthAuthorizationResult {
  authorizationUrl: string;
  state: string;
}

interface OAuthTokenResult {
  credentials: OAuthCredentials;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface CRMAdapter {
  getAuthorizationUrl(config: {
    redirectUri: string;
    state: string;
  }): Promise<OAuthAuthorizationResult>;
  exchangeToken(code: string): Promise<OAuthTokenResult>;
  getContact(id: string): Promise<Record<string, unknown>>;
  listContacts(
    query: string,
    pagination: { limit: number; offset: number },
  ): Promise<PaginatedResult<Record<string, unknown>>>;
  upsertContact(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteContact(id: string): Promise<void>;
  getDeal(id: string): Promise<Record<string, unknown>>;
  listDeals(
    query: string,
    pagination: { limit: number; offset: number },
  ): Promise<PaginatedResult<Record<string, unknown>>>;
  getHealth(): Promise<IntegrationHealth>;
}

// ─── Input Schemas ────────────────────────────────────────────────

const authorizeBodySchema = z.object({
  redirectUri: z.string().url(),
  state: z.string().min(1).max(500),
});

const callbackBodySchema = z.object({
  code: z.string().min(1).max(2000),
});

const upsertContactBodySchema = z.object({
  id: z.string().max(200).optional(),
  email: z.string().email().optional(),
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  company: z.string().max(200).optional(),
});

const listContactsQuerySchema = z.object({
  q: z.string().max(500).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const listDealsQuerySchema = z.object({
  q: z.string().max(500).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Dependencies (injected at startup) ───────────────────────────

interface IntegrationDeps {
  readonly adapters: Map<string, CRMAdapter>;
}

let deps: IntegrationDeps | null = null;

export function configureIntegrationRoutes(dependencies: IntegrationDeps): void {
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

function resolveAdapter(providerKey: string, adapters: Map<string, CRMAdapter>): CRMAdapter {
  const adapter = adapters.get(providerKey);
  if (!adapter) {
    throw new NotFoundError(`Integration provider not found: ${providerKey}`);
  }
  return adapter;
}

// ─── Router ───────────────────────────────────────────────────────

const integrationsRouter = new Hono<Env>();

// ─── GET /providers — List available providers (public) ───────────

integrationsRouter.get('/providers', (c): Response => {
  const providers = Object.keys(INTEGRATION_PROVIDERS);
  return c.json({
    success: true as const,
    data: providers,
  });
});

// All subsequent routes require authentication + integrations:read permission
integrationsRouter.use('/:provider*', requireAuth());
integrationsRouter.use('/:provider*', requirePermissionMiddleware('integrations', 'read'));

// ─── GET /:provider — Get integration health ──────────────────────

integrationsRouter.get('/:provider', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

  ensureTenantContext(c);
  const provider = c.req.param('provider');
  const adapter = resolveAdapter(provider, deps.adapters);

  const health = await adapter.getHealth();

  return c.json({
    success: true as const,
    data: health,
    provider,
  });
});

// ─── POST /:provider/authorize — Get OAuth URL (admin only) ───────

integrationsRouter.post(
  '/:provider/authorize',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

    ensureTenantContext(c);
    const requestId = c.get('requestId');
    const provider = c.req.param('provider');
    const adapter = resolveAdapter(provider, deps.adapters);
    const body: unknown = await c.req.json();

    const parsed = authorizeBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid authorize parameters',
        parseZodErrors(parsed.error),
        requestId,
      );
    }

    const result = await adapter.getAuthorizationUrl({
      redirectUri: parsed.data.redirectUri,
      state: parsed.data.state,
    });

    return c.json({
      success: true as const,
      data: result,
      provider,
    });
  },
);

// ─── POST /:provider/callback — Exchange OAuth code (admin only) ──

integrationsRouter.post(
  '/:provider/callback',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

    ensureTenantContext(c);
    const requestId = c.get('requestId');
    const provider = c.req.param('provider');
    const adapter = resolveAdapter(provider, deps.adapters);
    const body: unknown = await c.req.json();

    const parsed = callbackBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid callback parameters',
        parseZodErrors(parsed.error),
        requestId,
      );
    }

    // SECURITY: code is exchanged server-side — never returned to client
    const result = await adapter.exchangeToken(parsed.data.code);

    return c.json({
      success: true as const,
      // Return only non-secret confirmation — credentials stored server-side
      data: { connected: true, provider, expiresAt: result.credentials.expiresAt },
    });
  },
);

// ─── GET /:provider/contacts — List contacts ──────────────────────

integrationsRouter.get('/:provider/contacts', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

  ensureTenantContext(c);
  const requestId = c.get('requestId');
  const provider = c.req.param('provider');
  const adapter = resolveAdapter(provider, deps.adapters);

  const parsed = listContactsQuerySchema.safeParse({
    q: c.req.query('q'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });

  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(parsed.error), requestId);
  }

  const result = await adapter.listContacts(parsed.data.q, {
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });

  return c.json({
    success: true as const,
    data: result.items,
    total: result.total,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    provider,
  });
});

// ─── GET /:provider/contacts/:id — Get a contact ─────────────────

integrationsRouter.get('/:provider/contacts/:id', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

  ensureTenantContext(c);
  const provider = c.req.param('provider');
  const contactId = c.req.param('id');
  const adapter = resolveAdapter(provider, deps.adapters);

  const contact = await adapter.getContact(contactId);

  return c.json({
    success: true as const,
    data: contact,
    provider,
  });
});

// ─── POST /:provider/contacts — Upsert a contact ─────────────────

integrationsRouter.post('/:provider/contacts', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

  ensureTenantContext(c);
  const requestId = c.get('requestId');
  const provider = c.req.param('provider');
  const adapter = resolveAdapter(provider, deps.adapters);
  const body: unknown = await c.req.json();

  const parsed = upsertContactBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid contact data', parseZodErrors(parsed.error), requestId);
  }

  const contact = await adapter.upsertContact(parsed.data);

  return c.json(
    {
      success: true as const,
      data: contact,
      provider,
    },
    200,
  );
});

// ─── DELETE /:provider/contacts/:id — Delete a contact (admin only) ─

integrationsRouter.delete(
  '/:provider/contacts/:id',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

    ensureTenantContext(c);
    const provider = c.req.param('provider');
    const contactId = c.req.param('id');
    const adapter = resolveAdapter(provider, deps.adapters);

    await adapter.deleteContact(contactId);

    return c.json({ success: true as const });
  },
);

// ─── GET /:provider/deals — List deals ───────────────────────────

integrationsRouter.get('/:provider/deals', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

  ensureTenantContext(c);
  const requestId = c.get('requestId');
  const provider = c.req.param('provider');
  const adapter = resolveAdapter(provider, deps.adapters);

  const parsed = listDealsQuerySchema.safeParse({
    q: c.req.query('q'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });

  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(parsed.error), requestId);
  }

  const result = await adapter.listDeals(parsed.data.q, {
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });

  return c.json({
    success: true as const,
    data: result.items,
    total: result.total,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    provider,
  });
});

export { integrationsRouter };
