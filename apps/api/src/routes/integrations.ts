/**
 * Integrations Routes — CRM OAuth and contact/deal sync for Salesforce and HubSpot
 *
 * SOC2 CC6.1 — Access control: auth-enforced, tenant-scoped.
 * ISO 27001 A.12.6.1 — Management of technical vulnerabilities: adapter health checks.
 * HIPAA §164.312(e) — Transmission security: HMAC-verified inbound webhooks.
 *
 * Public route: GET /providers — returns available provider names only, no auth needed.
 * Webhook route: POST /:provider/webhook — HMAC-protected, no JWT required.
 * All other routes require auth.
 * OAuth operations (authorize, callback) require tenant_admin role.
 * Contact delete requires tenant_admin role.
 * Provider adapters are keyed by INTEGRATION_PROVIDERS constants.
 * NEVER log OAuth codes or tokens.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { INTEGRATION_PROVIDERS } from '@ordr/integrations';
import type {
  OAuthCredentials,
  IntegrationHealth,
  WebhookPayload,
  OAuthConfig,
  CredentialManagerDeps,
} from '@ordr/integrations';
import { ensureFreshCredentials, IntegrationNotConnectedError } from '@ordr/integrations';
import type { FieldEncryptor } from '@ordr/crypto';
import type { AuditLogger } from '@ordr/audit';
import { EventProducer, createEventEnvelope, EventType, TOPICS } from '@ordr/events';
import { ValidationError, AuthorizationError, NotFoundError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/auth.js';
import { requireRoleMiddleware } from '../middleware/auth.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { withCredentials } from '../middleware/crm-credentials.js';

// ─── CRMAdapter interface ─────────────────────────────────────────
// NOTE: Extended to include handleWebhook and updated getHealth signature.
// The full package interface (CRMAdapter from @ordr/integrations) will replace
// this in a later phase once all call sites pass credentials.

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
  /** Optional credentials — required in Phase 52 Tasks 15-16 */
  getHealth(credentials?: OAuthCredentials): Promise<IntegrationHealth>;
  /**
   * Process an inbound webhook payload.
   * NOTE: The adapter MUST verify signature internally when credentials are provided.
   * The route layer pre-verifies the signature before calling this method.
   */
  handleWebhook(
    payload: Readonly<Record<string, unknown>>,
    signature: string,
    secret: string,
  ): WebhookPayload;
  /** Required for token refresh (used by withCredentials / ensureFreshCredentials) */
  refreshAccessToken(
    config: OAuthConfig,
    refreshToken: string,
  ): Promise<{ credentials: OAuthCredentials; instanceUrl?: string | undefined }>;
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
  readonly lookupTenantByProvider: (params: {
    provider: string;
    instanceUrl?: string | undefined;
    portalId?: string | undefined;
  }) => Promise<string | null>;
  readonly insertWebhookLog: (params: {
    tenantId: string | null;
    provider: string;
    eventType: string;
    payloadHash: string;
    signatureValid: boolean;
  }) => Promise<string>;
  readonly updateWebhookLogProcessed: (params: { id: string }) => Promise<void>;
  readonly getWebhookSecret: (params: {
    tenantId: string;
    provider: string;
  }) => Promise<string | null>;
  readonly isRecentDuplicateWebhook: (params: {
    provider: string;
    payloadHash: string;
    withinMs: number;
  }) => Promise<boolean>;
  readonly fieldEncryptor: FieldEncryptor;
  readonly credManagerDeps: CredentialManagerDeps;
  readonly oauthConfigs: Map<string, OAuthConfig>;
  readonly eventProducer: EventProducer;
  readonly auditLogger: Pick<AuditLogger, 'log'>;
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

// ─── POST /:provider/webhook — Inbound webhook (no JWT, HMAC-protected) ─────
// SECURITY: Registered BEFORE auth middleware so webhooks don't require a JWT.
// Tenant identity comes from lookupTenantByProvider (DB lookup), NOT from the
// request body (never trust client-supplied tenant_id).
// Returns 200 even on signature failure to prevent retry storms.

integrationsRouter.post('/:provider/webhook', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

  const provider = c.req.param('provider');
  if (!deps.adapters.has(provider)) {
    // Always return 200 to prevent retry storms from webhook providers
    return c.json({ received: true }, 200);
  }

  // 1. Read raw body as text BEFORE any JSON parsing
  const rawBody = await c.req.text();
  const payloadHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');

  let parsedPayload: Record<string, unknown>;
  try {
    parsedPayload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  // 1b. Salesforce replay prevention — reject duplicate payloads within 10 minutes
  // HIPAA §164.312(e)(2)(i): integrity control prevents replay attacks.
  // Checked before tenant lookup to fail fast on known duplicates.
  if (provider === 'salesforce') {
    const isDuplicate = await deps.isRecentDuplicateWebhook({
      provider,
      payloadHash,
      withinMs: 10 * 60 * 1000,
    });
    if (isDuplicate) {
      return c.json({ received: true }, 200);
    }
  }

  // 2. Determine tenant from provider-specific identifier in payload
  const instanceUrl =
    typeof parsedPayload['instance_url'] === 'string' ? parsedPayload['instance_url'] : undefined;
  const portalId =
    typeof parsedPayload['portalId'] === 'string' ? parsedPayload['portalId'] : undefined;

  const resolvedTenantId = await deps.lookupTenantByProvider({ provider, instanceUrl, portalId });

  // 3. Verify HMAC signature using raw body bytes (timing-safe comparison)
  let signatureValid = false;
  if (resolvedTenantId !== null) {
    const encryptedSecret = await deps.getWebhookSecret({
      tenantId: resolvedTenantId,
      provider,
    });
    if (encryptedSecret !== null) {
      const webhookSecret = deps.fieldEncryptor.decryptField('webhook_secret', encryptedSecret);
      const signatureHeader =
        provider === 'salesforce'
          ? (c.req.header('x-salesforce-signature') ?? '')
          : (c.req.header('x-hubspot-signature-v3') ?? '');

      if (provider === 'hubspot') {
        // Replay prevention: reject requests older than 5 minutes
        const tsHeader = c.req.header('x-hubspot-request-timestamp') ?? '';
        const tsMs = Number(tsHeader);
        const ageMs = Date.now() - tsMs;
        if (!isNaN(tsMs) && ageMs <= 5 * 60 * 1000) {
          const method = c.req.method;
          const url = c.req.url;
          const toSign = method + url + rawBody + tsHeader;
          const computed = createHmac('sha256', webhookSecret).update(toSign, 'utf8').digest('hex');
          const sigBuf = Buffer.from(signatureHeader, 'hex');
          const compBuf = Buffer.from(computed, 'hex');
          if (sigBuf.length > 0 && sigBuf.length === compBuf.length) {
            signatureValid = timingSafeEqual(sigBuf, compBuf);
          }
        }
      } else {
        // Salesforce: HMAC-SHA256 of raw body, base64-encoded
        const computed = createHmac('sha256', webhookSecret)
          .update(rawBody, 'utf8')
          .digest('base64');
        const sigValue = signatureHeader.startsWith('sha256=')
          ? signatureHeader.slice(7)
          : signatureHeader;
        const sigBuf = Buffer.from(sigValue, 'base64');
        const compBuf = Buffer.from(computed, 'base64');
        if (sigBuf.length > 0 && sigBuf.length === compBuf.length) {
          signatureValid = timingSafeEqual(sigBuf, compBuf);
        }
      }
    }
  }

  // 4. Log webhook receipt regardless of signature validity
  const eventType =
    typeof parsedPayload['event_type'] === 'string'
      ? parsedPayload['event_type']
      : typeof parsedPayload['subscriptionType'] === 'string'
        ? parsedPayload['subscriptionType']
        : 'unknown';

  const webhookLogId = await deps.insertWebhookLog({
    tenantId: resolvedTenantId,
    provider,
    eventType,
    payloadHash,
    signatureValid,
  });

  // 5. If invalid: return 200 to prevent retry storm; emit compliance audit events
  if (!signatureValid) {
    if (resolvedTenantId !== null) {
      await deps.auditLogger.log({
        tenantId: resolvedTenantId,
        eventType: 'integration.webhook_invalid_signature',
        actorType: 'system',
        actorId: 'api',
        resource: 'webhook_logs',
        resourceId: webhookLogId,
        action: 'signature_invalid',
        details: { provider, webhook_log_id: webhookLogId },
        timestamp: new Date(),
      });
      await deps.auditLogger.log({
        tenantId: resolvedTenantId,
        eventType: 'compliance.violation',
        actorType: 'system',
        actorId: 'api',
        resource: 'webhook_logs',
        resourceId: webhookLogId,
        action: 'invalid_webhook_signature',
        details: { provider },
        timestamp: new Date(),
      });
    } else {
      // COMPLIANCE NOTE: tenantId is null (unknown sender) — auditLogger requires a valid
      // tenant UUID FK. The immutable record for this event is the webhook_log DB row
      // (payloadHash stored, signatureValid=false). Security alert logged to application
      // observability pipeline for SIEM ingestion.
      // HIPAA §164.312(e): integrity control record = webhook_log row id: ${webhookLogId}
      console.error(
        `[ORDR:SECURITY:WEBHOOK] Invalid signature unknown-tenant: provider=${provider} webhookLogId=${webhookLogId}`,
      );
    }
    return c.json({ received: true }, 200);
  }

  // 6. Normalize via adapter + publish to Kafka
  // resolvedTenantId is guaranteed non-null here: signatureValid===true requires a valid secret
  // which in turn requires resolvedTenantId !== null (see signature check block above)
  const verifiedTenantId = resolvedTenantId as string;

  const adapter = deps.adapters.get(provider);
  if (!adapter) {
    return c.json({ error: 'unknown_provider' }, 404);
  }
  // Pass empty signature/secret: route layer has already verified the signature above
  const webhookPayload = adapter.handleWebhook(parsedPayload, '', '');

  const envelopeId = randomUUID();
  // SECURITY: webhook route runs before auth middleware; at runtime requestId may be
  // absent if requestId middleware is not applied globally (Env types it as string, but
  // this route bypasses auth middleware). Cast to unknown first so the nullish coalesce
  // is evaluated at runtime — guaranteeing a defined correlationId in the Kafka envelope.
  const correlationId = (c.get('requestId') as string | undefined) ?? envelopeId;

  const envelope = createEventEnvelope(
    EventType.INTEGRATION_WEBHOOK_RECEIVED,
    verifiedTenantId,
    {
      tenantId: verifiedTenantId,
      provider,
      entityType: webhookPayload.entityType,
      externalId: webhookPayload.entityId,
      eventType: webhookPayload.eventType,
      webhookLogId,
    },
    {
      correlationId,
      causationId: envelopeId,
      source: 'api',
      version: 1,
    },
  );

  await deps.eventProducer.publish(TOPICS.INTEGRATION_EVENTS, envelope);

  // 7. Mark log as processed
  await deps.updateWebhookLogProcessed({ id: webhookLogId });

  // 8. Emit audit event
  await deps.auditLogger.log({
    tenantId: verifiedTenantId,
    eventType: 'integration.webhook_received',
    actorType: 'system',
    actorId: 'api',
    resource: 'webhook_logs',
    resourceId: webhookLogId,
    action: 'received',
    details: { provider, entity_type: webhookPayload.entityType },
    timestamp: new Date(),
  });

  return c.json({ received: true }, 200);
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

// ─── POST /:provider/webhook/test — Verify connectivity (JWT-required) ────────
// Registered after auth middleware so it requires valid JWT + integrations:read.

integrationsRouter.post('/:provider/webhook/test', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');

  const ctx = ensureTenantContext(c);
  const provider = c.req.param('provider');
  const adapter = resolveAdapter(provider, deps.adapters);

  const oauthConfig = deps.oauthConfigs.get(provider);
  if (!oauthConfig) {
    return c.json({ valid: false, error: 'unknown_provider' }, 404);
  }

  try {
    const credentials = await ensureFreshCredentials(
      deps.credManagerDeps,
      ctx.tenantId,
      provider,
      adapter,
      oauthConfig,
      deps.fieldEncryptor,
    );
    const start = Date.now();
    const health = await adapter.getHealth(credentials);
    return c.json({
      valid: health.status !== 'error' && health.status !== 'disconnected',
      provider,
      latencyMs: Date.now() - start,
    });
  } catch (err: unknown) {
    if (err instanceof IntegrationNotConnectedError) {
      return c.json({ valid: false, error: 'integration_not_connected' }, 403);
    }
    return c.json({ valid: false, error: 'connectivity_check_failed' }, 200);
  }
});

export { integrationsRouter };
