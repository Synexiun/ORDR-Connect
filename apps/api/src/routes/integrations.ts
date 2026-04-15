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
import { INTEGRATION_PROVIDERS, SyncEngine, defaultContactMappings } from '@ordr/integrations';
import type {
  OAuthCredentials,
  IntegrationHealth,
  WebhookPayload,
  OAuthConfig,
  CredentialManagerDeps,
  CrmActivity,
  CrmContact,
  PaginatedResult as IntegrationsPaginatedResult,
  FieldMapping,
  FieldTransform,
} from '@ordr/integrations';
import { ensureFreshCredentials, IntegrationNotConnectedError } from '@ordr/integrations';
import type { ExternalRecord, ExistingOrdrRecord } from '@ordr/integrations';
import type { FieldEncryptor } from '@ordr/crypto';
import type { AuditLogger } from '@ordr/audit';
import { EventProducer, createEventEnvelope, EventType, TOPICS } from '@ordr/events';
import { ValidationError, AuthorizationError, NotFoundError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/auth.js';
import { requireRoleMiddleware } from '../middleware/auth.js';
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
  fetchActivities(
    credentials: OAuthCredentials,
    query: { externalIds?: readonly string[] | undefined },
    pagination: { limit: number; offset: number },
  ): Promise<IntegrationsPaginatedResult<CrmActivity>>;
  pushActivity(credentials: OAuthCredentials, activity: CrmActivity): Promise<string>;
  pushContact(
    credentials: OAuthCredentials,
    contact: CrmContact,
    existingExternalId?: string,
  ): Promise<string>;
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

const listActivitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  customerId: z.string().uuid().optional(),
});

const pushActivityBodySchema = z.object({
  customerId: z.string().uuid(),
  type: z.enum(['task', 'event', 'call', 'email', 'note']),
  subject: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  date: z.string().datetime().optional(),
});

const fieldMappingSchema = z.object({
  entityType: z.enum(['contact', 'deal', 'activity']),
  direction: z.enum(['inbound', 'outbound', 'both']),
  sourceField: z.string().min(1).max(100),
  targetField: z.string().min(1).max(100),
  transform: z.record(z.string(), z.unknown()).optional(),
});

const putFieldMappingsBodySchema = z.object({
  mappings: z.array(fieldMappingSchema).max(200),
});

const listFieldMappingsQuerySchema = z.object({
  direction: z.enum(['inbound', 'outbound', 'both']).optional(),
});

const syncBodySchema = z.object({
  entityType: z.enum(['contact']).default('contact'),
  modifiedAfter: z.string().datetime().optional(),
  conflictResolution: z
    .enum(['source_wins', 'target_wins', 'most_recent', 'manual'])
    .default('source_wins'),
  maxPages: z.coerce.number().int().min(1).max(50).default(10),
});

const syncOutboundBodySchema = z.object({
  entityType: z.enum(['contact']).default('contact'),
  maxPages: z.coerce.number().int().min(1).max(50).default(10),
});

const syncHistoryQuerySchema = z.object({
  entityType: z.enum(['contact', 'deal', 'activity']).optional(),
  status: z.enum(['success', 'failed', 'conflict', 'skipped']).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
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
  readonly listFieldMappings: (params: {
    tenantId: string;
    provider: string;
    direction?: string | undefined;
  }) => Promise<
    Array<{
      id: string;
      entityType: string;
      direction: string;
      sourceField: string;
      targetField: string;
      transform: unknown;
    }>
  >;
  readonly replaceFieldMappings: (params: {
    tenantId: string;
    provider: string;
    mappings: Array<{
      entityType: string;
      direction: string;
      sourceField: string;
      targetField: string;
      transform?: unknown;
    }>;
  }) => Promise<void>;
  readonly getAdapterDefaultMappings: (provider: string) => Array<{
    entityType: string;
    direction: string;
    sourceField: string;
    targetField: string;
  }>;
  readonly disconnectIntegration: (params: { tenantId: string; provider: string }) => Promise<void>;
  readonly getEntityMappingsByExternalIds: (params: {
    tenantId: string;
    provider: string;
    entityType: 'contact' | 'deal' | 'activity';
    externalIds: readonly string[];
  }) => Promise<Array<{ externalId: string; ordrId: string; lastSyncedAt: Date }>>;
  readonly upsertCustomerFromSync: (params: {
    tenantId: string;
    externalId: string;
    ordrEntityId?: string | undefined;
    encryptedFields: {
      readonly name: string;
      readonly email?: string | undefined;
      readonly phone?: string | undefined;
    };
  }) => Promise<string>;
  readonly insertSyncEvent: (params: {
    tenantId: string;
    integrationId: string;
    provider: string;
    direction: 'inbound' | 'outbound';
    entityType: 'contact' | 'deal' | 'activity';
    entityId?: string | undefined;
    externalId?: string | undefined;
    status: 'success' | 'failed' | 'conflict' | 'skipped';
    conflictResolution?: string | undefined;
    errorSummary?: string | undefined;
  }) => Promise<void>;
  readonly upsertEntityMapping: (params: {
    tenantId: string;
    provider: string;
    entityType: 'contact' | 'deal' | 'activity';
    ordrId: string;
    externalId: string;
  }) => Promise<void>;
  readonly updateLastSyncAt: (params: {
    tenantId: string;
    provider: string;
    syncedAt: Date;
  }) => Promise<void>;
  readonly listOrdrContactsForOutbound: (params: {
    tenantId: string;
    limit: number;
    offset: number;
  }) => Promise<
    Array<{
      id: string;
      externalId: string | null;
      name: string;
      email: string | null;
      phone: string | null;
      updatedAt: Date;
    }>
  >;
  readonly getSyncHistory: (params: {
    tenantId: string;
    provider: string;
    entityType?: string | undefined;
    status?: string | undefined;
    direction?: string | undefined;
    limit: number;
    offset: number;
  }) => Promise<{
    items: Array<{
      id: string;
      provider: string;
      direction: string;
      entityType: string;
      entityId: string | null;
      externalId: string | null;
      status: string;
      conflictResolution: string | null;
      errorSummary: string | null;
      syncedAt: string;
    }>;
    total: number;
  }>;
}

let deps: IntegrationDeps | null = null;
let credentialsMiddleware: ReturnType<typeof withCredentials> | null = null;

export function configureIntegrationRoutes(dependencies: IntegrationDeps): void {
  deps = dependencies;
  credentialsMiddleware = withCredentials({
    credManagerDeps: dependencies.credManagerDeps,
    fieldEncryptor: dependencies.fieldEncryptor,
    oauthConfigs: dependencies.oauthConfigs,
    adapters: dependencies.adapters,
  });
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

// ─── Sync helpers ─────────────────────────────────────────────────

/**
 * ORDR fields that contain PHI — used when converting stored DB field mappings
 * (which have no isPhi column) back to FieldMapping objects for the sync engine.
 */
const ORDR_PHI_FIELDS = new Set(['firstName', 'lastName', 'name', 'email', 'phone']);

/**
 * Convert stored integration_field_mappings rows to the FieldMapping[] format
 * expected by applyFieldMappings / SyncEngine.processInbound.
 *
 * Only inbound and bidirectional mappings are returned; outbound-only rows are
 * irrelevant for inbound sync and are filtered out.
 */
function convertFieldMappings(
  stored: Array<{
    entityType: string;
    direction: string;
    sourceField: string;
    targetField: string;
    transform: unknown;
  }>,
): readonly FieldMapping[] {
  return stored
    .filter(
      (m) => m.entityType === 'contact' && (m.direction === 'inbound' || m.direction === 'both'),
    )
    .map(
      (m): FieldMapping => ({
        externalField: m.sourceField,
        ordrField: m.targetField,
        direction: m.direction === 'both' ? 'bidirectional' : 'inbound',
        isPhi: ORDR_PHI_FIELDS.has(m.targetField),
        ...(m.transform !== null &&
          m.transform !== undefined && { transform: m.transform as FieldTransform }),
      }),
    );
}

/**
 * Build the encrypted customer fields for a DB insert from a mapped inbound record.
 *
 * Combines `firstName` + `lastName` → `name` BEFORE encryption (the DB stores a
 * single combined name field).  All other PHI fields are encrypted individually.
 *
 * HIPAA §164.312(a)(2)(iv) — PHI encrypted at application layer before DB write.
 */
function buildEncryptedContactFields(
  record: Readonly<Record<string, unknown>>,
  phiFields: readonly string[],
  enc: FieldEncryptor,
): {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
} {
  const phiSet = new Set(phiFields);
  const firstName =
    phiSet.has('firstName') && typeof record['firstName'] === 'string' ? record['firstName'] : '';
  const lastName =
    phiSet.has('lastName') && typeof record['lastName'] === 'string' ? record['lastName'] : '';
  const nameRaw = `${firstName} ${lastName}`.trim() || 'Unknown';

  const emailRaw =
    phiSet.has('email') && typeof record['email'] === 'string' ? record['email'] : undefined;
  const phoneRaw =
    phiSet.has('phone') && typeof record['phone'] === 'string' ? record['phone'] : undefined;

  return {
    name: enc.encryptField('name', nameRaw),
    ...(emailRaw !== undefined && { email: enc.encryptField('email', emailRaw) }),
    ...(phoneRaw !== undefined && { phone: enc.encryptField('phone', phoneRaw) }),
  };
}

/**
 * Decrypt ORDR customer PHI fields and build a CrmContact for outbound push.
 *
 * Splits `name` (combined) back into `firstName` / `lastName` on the first space.
 * Silently passes through non-string fields (already-null email/phone).
 *
 * HIPAA §164.312(a)(2)(iv) — PHI decrypted only at application layer, in memory,
 * immediately before transmission. Never logged.
 */
function decryptContactFields(
  row: {
    id: string;
    externalId: string | null;
    name: string;
    email: string | null;
    phone: string | null;
  },
  enc: FieldEncryptor,
): CrmContact {
  let firstName = '';
  let lastName = '';
  try {
    const fullName = enc.decryptField('name', row.name);
    const spaceIdx = fullName.indexOf(' ');
    if (spaceIdx === -1) {
      firstName = fullName;
    } else {
      firstName = fullName.slice(0, spaceIdx);
      lastName = fullName.slice(spaceIdx + 1);
    }
  } catch {
    firstName = 'Unknown';
  }

  let email: string | null = null;
  if (row.email !== null) {
    try {
      email = enc.decryptField('email', row.email);
    } catch {
      email = null;
    }
  }

  let phone: string | null = null;
  if (row.phone !== null) {
    try {
      phone = enc.decryptField('phone', row.phone);
    } catch {
      phone = null;
    }
  }

  return {
    externalId: row.externalId ?? '',
    firstName,
    lastName,
    email,
    phone,
    company: null,
    title: null,
    lastModified: new Date(),
    metadata: {},
  };
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

  await deps.eventProducer
    .publish(TOPICS.INTEGRATION_EVENTS, envelope)
    .catch((publishErr: unknown) => {
      console.error('[ORDR:API] Failed to publish integration event:', publishErr);
    });

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

// ─── Credential middleware for activity routes ────────────────────
// Must be registered before the activity route handlers so that
// c.get('crmCredentials') is populated when handlers execute.

integrationsRouter.use('/:provider/activities', async (c, next) => {
  if (!credentialsMiddleware) {
    return c.json({ error: 'routes_not_configured' }, 500 as never);
  }
  return credentialsMiddleware(c as unknown as Parameters<typeof credentialsMiddleware>[0], next);
});

// ─── GET /:provider/activities — List activities ──────────────────

integrationsRouter.get('/:provider/activities', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const provider = c.req.param('provider');
  const adapter = resolveAdapter(provider, deps.adapters);
  const creds = c.get('crmCredentials');
  if (!creds) return c.json({ error: 'credentials_missing' }, 500 as never);

  const parsed = listActivitiesQuerySchema.safeParse({
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
    customerId: c.req.query('customerId'),
  });
  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(parsed.error), requestId);
  }

  const result = await adapter.fetchActivities(
    creds,
    parsed.data.customerId !== undefined ? { externalIds: [parsed.data.customerId] } : {},
    { limit: parsed.data.limit, offset: parsed.data.offset },
  );

  // ctx required for future tenant-scoped activity filtering
  void ctx;

  return c.json({
    success: true as const,
    items: result.data,
    total: result.total,
    hasMore: result.hasMore,
    provider,
  });
});

// ─── POST /:provider/activities — Push an activity ────────────────

integrationsRouter.post('/:provider/activities', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const provider = c.req.param('provider');
  const adapter = resolveAdapter(provider, deps.adapters);
  const creds = c.get('crmCredentials');
  if (!creds) return c.json({ error: 'credentials_missing' }, 500 as never);

  const body: unknown = await c.req.json();
  const parsed = pushActivityBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid activity data', parseZodErrors(parsed.error), requestId);
  }

  const { subject, type, description, date } = parsed.data;
  const externalId = await adapter.pushActivity(creds, {
    externalId: '',
    type,
    subject,
    description: description ?? null,
    contactExternalId: parsed.data.customerId,
    dealExternalId: null,
    dueDate: date !== undefined ? new Date(date) : null,
    completedAt: null,
    lastModified: new Date(),
    metadata: {},
  });

  await deps.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.created',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'crm_activity',
    resourceId: externalId,
    action: 'created',
    details: { provider, activityExternalId: externalId },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, externalId, provider }, 201);
});

// ─── GET /:provider/field-mappings ────────────────────────────────

integrationsRouter.get('/:provider/field-mappings', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const provider = c.req.param('provider');
  const parsed = listFieldMappingsQuerySchema.safeParse({
    direction: c.req.query('direction'),
  });
  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(parsed.error), requestId);
  }
  const { direction } = parsed.data;

  const stored = await deps.listFieldMappings({
    tenantId: ctx.tenantId,
    provider,
    direction,
  });

  const mappings = stored.length > 0 ? stored : deps.getAdapterDefaultMappings(provider);
  return c.json({ success: true as const, data: mappings, provider });
});

// ─── PUT /:provider/field-mappings ────────────────────────────────

integrationsRouter.put(
  '/:provider/field-mappings',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Integration routes not configured');
    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const provider = c.req.param('provider');

    const body: unknown = await c.req.json();
    const parsed = putFieldMappingsBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid field mappings', parseZodErrors(parsed.error), requestId);
    }

    await deps.replaceFieldMappings({
      tenantId: ctx.tenantId,
      provider,
      mappings: parsed.data.mappings,
    });

    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'config.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'integration_field_mappings',
      resourceId: `${ctx.tenantId}:${provider}`,
      action: 'replaced',
      details: { provider, count: parsed.data.mappings.length },
      timestamp: new Date(),
    });

    return c.json({ success: true as const, provider });
  },
);

// ─── POST /:provider/sync — Trigger a full inbound batch sync ────────────────
//
// Pulls contacts from the CRM (optionally filtered to `modifiedAfter`), runs
// the SyncEngine to compute create/update/skip/conflict actions, encrypts PHI,
// upserts ORDR customers, writes sync_events, and returns a summary.
//
// HIPAA §164.312(a)(2)(iv) — PHI encrypted via FieldEncryptor before any DB write.
// SOC2 CC6.1  — tenant-scoped; integration must be connected before sync is allowed.
// ISO 27001 A.8.2.3 — all sync outcomes written to sync_events for audit trail.

integrationsRouter.post(
  '/:provider/sync',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Integration routes not configured');
    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const provider = c.req.param('provider');
    const adapter = resolveAdapter(provider, deps.adapters);

    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = syncBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid sync parameters', parseZodErrors(parsed.error), requestId);
    }
    const { entityType, modifiedAfter, conflictResolution, maxPages } = parsed.data;

    // Verify the integration is connected (also retrieves the integration_id for sync_events)
    const integrationConfig = await deps.credManagerDeps.getIntegrationConfig({
      tenantId: ctx.tenantId,
      provider,
    });
    if (!integrationConfig) {
      throw new NotFoundError(`Integration not connected: ${provider}`);
    }

    // Resolve field mappings: stored tenant config → adapter defaults → package defaults
    const storedMappings = await deps.listFieldMappings({ tenantId: ctx.tenantId, provider });
    const contactMappings: readonly FieldMapping[] =
      storedMappings.length > 0 ? convertFieldMappings(storedMappings) : defaultContactMappings();

    // ── Step 1: Fetch contacts from CRM with pagination ────────────────────────
    const externalRecords: ExternalRecord[] = [];
    const PAGE_SIZE = 200;
    for (let page = 0; page < maxPages; page++) {
      const result = await adapter.listContacts(
        modifiedAfter !== undefined ? `modifiedAfter:${modifiedAfter}` : '',
        { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      );
      for (const item of result.items) {
        const rawId = item['id'] ?? item['externalId'];
        const externalId =
          typeof rawId === 'string'
            ? rawId
            : typeof rawId === 'number'
              ? rawId.toString()
              : `unknown_${page}_${externalRecords.length}`;
        const updatedAtRaw = item['updatedAt'] ?? item['lastModified'] ?? item['updated_at'];
        const externalUpdatedAt =
          typeof updatedAtRaw === 'string'
            ? new Date(updatedAtRaw)
            : updatedAtRaw instanceof Date
              ? updatedAtRaw
              : new Date();
        externalRecords.push({ externalId, rawRecord: item, externalUpdatedAt });
      }
      if (result.items.length < PAGE_SIZE) break;
    }

    // ── Step 2: Load existing entity mappings ──────────────────────────────────
    // We pass record:{} (no plaintext PHI comparison) and use entity-mapping
    // timestamps only. This means existing records are always treated as 'update'
    // rather than 'skip', which is safe and PHI-compliant.
    const externalIds = externalRecords.map((r) => r.externalId);
    const existingMappings =
      externalIds.length > 0
        ? await deps.getEntityMappingsByExternalIds({
            tenantId: ctx.tenantId,
            provider,
            entityType,
            externalIds,
          })
        : [];

    const existingByExtId = new Map<string, ExistingOrdrRecord>();
    for (const m of existingMappings) {
      existingByExtId.set(m.externalId, {
        ordrEntityId: m.ordrId,
        record: {},
        updatedAt: m.lastSyncedAt,
        lastSyncedAt: m.lastSyncedAt,
      });
    }

    // ── Step 3: Run sync engine ────────────────────────────────────────────────
    const syncEngine = new SyncEngine();
    const syncResult = syncEngine.processInbound(
      externalRecords,
      existingByExtId,
      contactMappings,
      conflictResolution,
    );

    // ── Step 4: Process each result — encrypt PHI, upsert, write events ────────
    let errors = 0;
    for (const record of syncResult.records) {
      if (record.action === 'skip') {
        await deps.insertSyncEvent({
          tenantId: ctx.tenantId,
          integrationId: integrationConfig.id,
          provider,
          direction: 'inbound',
          entityType,
          entityId: record.ordrEntityId ?? undefined,
          externalId: record.externalId,
          status: 'skipped',
        });
        continue;
      }

      if (record.record === null) continue;

      try {
        // Encrypt PHI fields before any DB write (HIPAA §164.312(a)(2)(iv))
        const encryptedFields = buildEncryptedContactFields(
          record.record,
          record.phiFields,
          deps.fieldEncryptor,
        );

        const ordrId = await deps.upsertCustomerFromSync({
          tenantId: ctx.tenantId,
          externalId: record.externalId,
          ordrEntityId: record.ordrEntityId ?? undefined,
          encryptedFields,
        });

        await deps.upsertEntityMapping({
          tenantId: ctx.tenantId,
          provider,
          entityType,
          ordrId,
          externalId: record.externalId,
        });

        await deps.insertSyncEvent({
          tenantId: ctx.tenantId,
          integrationId: integrationConfig.id,
          provider,
          direction: 'inbound',
          entityType,
          entityId: ordrId,
          externalId: record.externalId,
          status: record.action === 'conflict' ? 'conflict' : 'success',
          conflictResolution: record.action === 'conflict' ? conflictResolution : undefined,
          errorSummary:
            record.manualFields.length > 0
              ? `Manual review required: ${record.manualFields.join(', ')}`
              : undefined,
        });
      } catch (err) {
        errors++;
        await deps
          .insertSyncEvent({
            tenantId: ctx.tenantId,
            integrationId: integrationConfig.id,
            provider,
            direction: 'inbound',
            entityType,
            externalId: record.externalId,
            status: 'failed',
            errorSummary:
              err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
          })
          .catch(() => undefined);
      }
    }

    // ── Step 5: Update lastSyncAt + audit log ─────────────────────────────────
    const syncedAt = new Date();
    await deps.updateLastSyncAt({ tenantId: ctx.tenantId, provider, syncedAt });

    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: errors > 0 ? 'integration.sync_failed' : 'integration.sync_completed',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'customers',
      resourceId: `${ctx.tenantId}:${provider}`,
      action: 'inbound_sync',
      details: {
        provider,
        entityType,
        fetched: externalRecords.length,
        created: syncResult.created,
        updated: syncResult.updated,
        skipped: syncResult.skipped,
        conflictsDetected: syncResult.conflictsDetected,
        conflictsResolved: syncResult.conflictsResolved,
        conflictsQueued: syncResult.conflictsQueued,
        errors,
      },
      timestamp: syncedAt,
    });

    return c.json({
      success: true as const,
      data: {
        provider,
        entityType,
        fetched: externalRecords.length,
        created: syncResult.created,
        updated: syncResult.updated,
        skipped: syncResult.skipped,
        conflictsDetected: syncResult.conflictsDetected,
        conflictsResolved: syncResult.conflictsResolved,
        conflictsQueued: syncResult.conflictsQueued,
        errors,
      },
    });
  },
);

// ─── POST /:provider/sync/outbound — Trigger outbound batch sync ──────────────
//
// Fetches all ORDR customers (paginated), decrypts PHI fields, applies outbound
// field mappings via SyncEngine.processOutbound(), and pushes each contact to the
// CRM via adapter.pushContact().  Uses entity mappings to route create vs update.
//
// HIPAA §164.312(a)(2)(iv) — PHI decrypted in memory only; never logged.
// SOC2 CC6.1  — tenant-scoped; integration must be connected.
// ISO 27001 A.8.2.3 — all push outcomes written to sync_events.

integrationsRouter.post(
  '/:provider/sync/outbound',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Integration routes not configured');
    const enc = deps.fieldEncryptor; // capture for closure safety (module-level let)
    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');
    const provider = c.req.param('provider');
    const adapter = resolveAdapter(provider, deps.adapters);

    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = syncOutboundBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid sync parameters', parseZodErrors(parsed.error), requestId);
    }
    const { entityType, maxPages } = parsed.data;

    // Verify integration is connected and get credentials
    const integrationConfig = await deps.credManagerDeps.getIntegrationConfig({
      tenantId: ctx.tenantId,
      provider,
    });
    if (!integrationConfig) {
      throw new NotFoundError(`Integration not connected: ${provider}`);
    }
    const oauthConfig = deps.oauthConfigs.get(provider);
    if (!oauthConfig) {
      throw new NotFoundError(`OAuth config not found: ${provider}`);
    }
    const credentials = await ensureFreshCredentials(
      deps.credManagerDeps,
      ctx.tenantId,
      provider,
      adapter,
      oauthConfig,
      deps.fieldEncryptor,
    );

    // Resolve outbound field mappings
    const storedMappings = await deps.listFieldMappings({ tenantId: ctx.tenantId, provider });
    const outboundMappings: readonly FieldMapping[] =
      storedMappings.length > 0
        ? storedMappings
            .filter(
              (m) =>
                m.entityType === 'contact' &&
                (m.direction === 'outbound' || m.direction === 'both'),
            )
            .map(
              (m): FieldMapping => ({
                externalField: m.targetField,
                ordrField: m.sourceField,
                direction: m.direction === 'both' ? 'bidirectional' : 'outbound',
                isPhi: ORDR_PHI_FIELDS.has(m.sourceField),
                ...(m.transform !== null &&
                  m.transform !== undefined && { transform: m.transform as FieldTransform }),
              }),
            )
        : defaultContactMappings().filter(
            (m) => m.direction === 'outbound' || m.direction === 'bidirectional',
          );

    // Fetch ORDR customers, decrypt PHI, build OrdrRecord[]
    const PAGE_SIZE = 200;
    let pushed = 0;
    let pushErrors = 0;

    for (let page = 0; page < maxPages; page++) {
      const rows = await deps.listOrdrContactsForOutbound({
        tenantId: ctx.tenantId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (rows.length === 0) break;

      const ordrRecords = rows.map((row) => {
        const contact = decryptContactFields(row, enc);
        return {
          ordrEntityId: row.id,
          externalId: row.externalId ?? undefined,
          record: {
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            updatedAt: row.updatedAt.toISOString(),
          } as Record<string, unknown>,
        };
      });

      const syncEngine = new SyncEngine();
      const outboundResult = syncEngine.processOutbound(ordrRecords, outboundMappings);

      for (const result of outboundResult.records) {
        try {
          const contact: CrmContact = {
            externalId: result.externalId ?? '',
            firstName:
              typeof result.crmRecord['firstName'] === 'string'
                ? result.crmRecord['firstName']
                : '',
            lastName:
              typeof result.crmRecord['lastName'] === 'string' ? result.crmRecord['lastName'] : '',
            email: typeof result.crmRecord['email'] === 'string' ? result.crmRecord['email'] : null,
            phone: typeof result.crmRecord['phone'] === 'string' ? result.crmRecord['phone'] : null,
            company: null,
            title: null,
            lastModified: new Date(),
            metadata: {},
          };

          const externalId = await adapter.pushContact(credentials, contact, result.externalId);

          await deps.upsertEntityMapping({
            tenantId: ctx.tenantId,
            provider,
            entityType,
            ordrId: result.ordrEntityId,
            externalId,
          });

          await deps.insertSyncEvent({
            tenantId: ctx.tenantId,
            integrationId: integrationConfig.id,
            provider,
            direction: 'outbound',
            entityType,
            entityId: result.ordrEntityId,
            externalId,
            status: 'success',
          });
          pushed++;
        } catch (err) {
          pushErrors++;
          await deps
            .insertSyncEvent({
              tenantId: ctx.tenantId,
              integrationId: integrationConfig.id,
              provider,
              direction: 'outbound',
              entityType,
              entityId: result.ordrEntityId,
              externalId: result.externalId,
              status: 'failed',
              errorSummary:
                err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
            })
            .catch(() => undefined);
        }
      }

      if (rows.length < PAGE_SIZE) break;
    }

    const syncedAt = new Date();
    await deps.updateLastSyncAt({ tenantId: ctx.tenantId, provider, syncedAt });

    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: pushErrors > 0 ? 'integration.sync_failed' : 'integration.sync_completed',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'customers',
      resourceId: `${ctx.tenantId}:${provider}`,
      action: 'outbound_sync',
      details: { provider, entityType, pushed, errors: pushErrors },
      timestamp: syncedAt,
    });

    return c.json({
      success: true as const,
      data: { provider, entityType, pushed, errors: pushErrors },
    });
  },
);

// ─── GET /:provider/sync/history — Paginated sync event history ───────────────
//
// Queries sync_events for a given provider with optional filters.
// Useful for debugging sync issues, monitoring conflict rates, and SOC 2 evidence.
//
// SOC2 CC7.2 — Monitoring: surfacing sync event history for operators.
// ISO 27001 A.8.2.3 — Auditable: all sync outcomes queryable.

integrationsRouter.get('/:provider/sync/history', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Integration routes not configured');
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const provider = c.req.param('provider');

  const parsed = syncHistoryQuerySchema.safeParse({
    entityType: c.req.query('entityType'),
    status: c.req.query('status'),
    direction: c.req.query('direction'),
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });
  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(parsed.error), requestId);
  }
  const { entityType, status, direction, limit, offset } = parsed.data;

  const history = await deps.getSyncHistory({
    tenantId: ctx.tenantId,
    provider,
    entityType,
    status,
    direction,
    limit,
    offset,
  });

  return c.json({
    success: true as const,
    data: history.items,
    meta: { total: history.total, limit, offset, provider },
  });
});

// ─── DELETE /:provider — Disconnect integration ───────────────────

integrationsRouter.delete(
  '/:provider',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) throw new Error('[ORDR:API] Integration routes not configured');
    const ctx = ensureTenantContext(c);
    const provider = c.req.param('provider');

    await deps.disconnectIntegration({ tenantId: ctx.tenantId, provider });

    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'integration.disconnected',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'integration_configs',
      resourceId: `${ctx.tenantId}:${provider}`,
      action: 'disconnected',
      details: { provider },
      timestamp: new Date(),
    });

    return new Response(null, { status: 204 });
  },
);

export { integrationsRouter };
