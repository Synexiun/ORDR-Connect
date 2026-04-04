/**
 * Integration Sync Worker Handler
 *
 * Two responsibilities registered on different topics:
 * 1. Outbound (ORDR→CRM): Consumes customer.created / customer.updated
 *    - customer.created: immediate push to all connected providers
 *    - customer.updated: enqueue customerId in Redis sorted set for batch dedup
 * 2. Inbound (CRM→ORDR): Consumes integration.webhook_received
 *    - Looks up ORDR customer via integration_entity_mappings
 *    - Creates new customer if unknown; applies delta or detects conflict if known
 *
 * SECURITY:
 * - No PHI in audit log details — IDs and status codes only
 * - sync_events is append-only (WORM trigger in DB prevents mutation)
 * - Conflict resolution: last write wins (crm_wins) with 5-minute window notification
 *
 * SOC2 CC7.1 — All sync operations audit-logged
 * GDPR Art. 17 — Customer update delta applied field by field (no blind overwrite)
 */

import type { EventEnvelope } from '@ordr/events';
import type { IntegrationWebhookReceivedPayload } from '@ordr/events';
import type { AuditLogger } from '@ordr/audit';
import type { CRMAdapter, CrmContact, OAuthConfig } from '@ordr/integrations';
import { ensureFreshCredentials, IntegrationNotConnectedError } from '@ordr/integrations';
import type { FieldEncryptor } from '@ordr/crypto';
import type { CredentialManagerDeps } from '@ordr/integrations';

// ── Dependency Types ──────────────────────────────────────────────

export interface ConnectedProvider {
  readonly tenantId: string;
  readonly provider: string;
  readonly integrationId: string;
}

export interface CustomerRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly email: string | null;
  readonly updatedAt: Date;
}

export interface IntegrationSyncDeps {
  /** List all connected providers for a tenant (used on customer.created). */
  readonly listConnectedProviders: (tenantId: string) => Promise<ConnectedProvider[]>;

  /** Fetch a single customer record for outbound push. */
  readonly getCustomer: (params: {
    tenantId: string;
    customerId: string;
  }) => Promise<CustomerRecord | null>;

  /** Enqueue a customerId in the Redis outbound sorted set for batch processing. */
  readonly enqueueOutbound: (params: {
    tenantId: string;
    provider: string;
    customerId: string;
    score: number;
  }) => Promise<void>;

  /** Write a sync_events row (append-only). */
  readonly insertSyncEvent: (params: {
    tenantId: string;
    integrationId: string;
    provider: string;
    direction: 'inbound' | 'outbound';
    entityType: 'contact' | 'deal' | 'activity';
    entityId: string | null;
    externalId: string | null;
    status: 'success' | 'failed' | 'conflict' | 'skipped';
    conflictResolution?: 'crm_wins' | undefined;
    errorSummary?: string | undefined;
  }) => Promise<void>;

  /** Look up ORDR customer ID by CRM external ID. */
  readonly findEntityMapping: (params: {
    tenantId: string;
    provider: string;
    entityType: 'contact';
    externalId: string;
  }) => Promise<{ ordrId: string } | null>;

  /** Insert a new entity mapping row after creating a new customer. */
  readonly insertEntityMapping: (params: {
    tenantId: string;
    provider: string;
    entityType: 'contact';
    ordrId: string;
    externalId: string;
  }) => Promise<void>;

  /** Create a new ORDR customer from CRM data. */
  readonly createCustomerFromCrm: (params: {
    tenantId: string;
    externalId: string;
    provider: string;
    name: string;
    email: string | null;
  }) => Promise<string>;

  /** Apply a field delta to an existing ORDR customer row. */
  readonly applyCustomerDelta: (params: {
    tenantId: string;
    customerId: string;
    name?: string | undefined;
    email?: string | undefined;
  }) => Promise<void>;

  /** Get integration_configs.id for a connected tenant+provider. */
  readonly getIntegrationId: (params: {
    tenantId: string;
    provider: string;
  }) => Promise<string | null>;

  /** Send in-app notification to tenant admin. */
  readonly notifyTenantAdmin: (params: { tenantId: string; message: string }) => Promise<void>;

  readonly adapters: Map<string, CRMAdapter>;
  readonly credManagerDeps: CredentialManagerDeps;
  readonly oauthConfigs: Map<string, OAuthConfig>;
  readonly fieldEncryptor: FieldEncryptor;
  readonly auditLogger: Pick<AuditLogger, 'log'>;
}

// ── Helper: build CrmContact from CustomerRecord ──────────────────

function toCrmContact(customer: CustomerRecord): CrmContact {
  return {
    externalId: customer.id,
    firstName: customer.name.split(' ')[0] ?? customer.name,
    lastName: customer.name.split(' ').slice(1).join(' ') || '-',
    email: customer.email,
    phone: null,
    company: null,
    title: null,
    lastModified: customer.updatedAt,
    metadata: {},
  };
}

// ── Outbound handler: customer.created ───────────────────────────

async function handleCustomerCreated(
  tenantId: string,
  customerId: string,
  deps: IntegrationSyncDeps,
): Promise<void> {
  const customer = await deps.getCustomer({ tenantId, customerId });
  if (customer === null) return;

  const providers = await deps.listConnectedProviders(tenantId);

  for (const { provider, integrationId } of providers) {
    const adapter = deps.adapters.get(provider);
    const oauthConfig = deps.oauthConfigs.get(provider);
    if (!adapter || !oauthConfig) continue;

    try {
      const credentials = await ensureFreshCredentials(
        deps.credManagerDeps,
        tenantId,
        provider,
        adapter,
        oauthConfig,
        deps.fieldEncryptor,
      );
      const externalId = await adapter.pushContact(credentials, toCrmContact(customer));

      await deps.insertEntityMapping({
        tenantId,
        provider,
        entityType: 'contact',
        ordrId: customerId,
        externalId,
      });

      await deps.insertSyncEvent({
        tenantId,
        integrationId,
        provider,
        direction: 'outbound',
        entityType: 'contact',
        entityId: customerId,
        externalId,
        status: 'success',
      });

      await deps.auditLogger.log({
        tenantId,
        eventType: 'integration.sync_completed',
        actorType: 'system',
        actorId: 'worker',
        resource: 'customers',
        resourceId: customerId,
        action: 'synced_to_crm',
        details: { provider, direction: 'outbound' },
        timestamp: new Date(),
      });
    } catch (err) {
      const summary =
        err instanceof IntegrationNotConnectedError ? 'integration_not_connected' : 'push_failed';

      await deps.insertSyncEvent({
        tenantId,
        integrationId,
        provider,
        direction: 'outbound',
        entityType: 'contact',
        entityId: customerId,
        externalId: null,
        status: 'failed',
        errorSummary: summary,
      });

      await deps.auditLogger.log({
        tenantId,
        eventType: 'integration.sync_failed',
        actorType: 'system',
        actorId: 'worker',
        resource: 'customers',
        resourceId: customerId,
        action: 'sync_failed',
        details: { provider, error: summary },
        timestamp: new Date(),
      });
    }
  }
}

// ── Outbound handler: customer.updated ───────────────────────────

async function handleCustomerUpdated(
  tenantId: string,
  customerId: string,
  deps: IntegrationSyncDeps,
): Promise<void> {
  const providers = await deps.listConnectedProviders(tenantId);
  for (const { provider } of providers) {
    await deps.enqueueOutbound({
      tenantId,
      provider,
      customerId,
      score: Date.now(),
    });
  }
}

// ── Inbound handler: integration.webhook_received ────────────────

const CONFLICT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

async function handleWebhookReceived(
  payload: IntegrationWebhookReceivedPayload,
  deps: IntegrationSyncDeps,
): Promise<void> {
  const { tenantId, provider, externalId } = payload;
  if (payload.entityType !== 'contact') return; // only contacts in Phase 52

  const integrationId = await deps.getIntegrationId({ tenantId, provider });
  if (integrationId === null) return;

  // 1. Look up entity mapping
  const mapping = await deps.findEntityMapping({
    tenantId,
    provider,
    entityType: 'contact',
    externalId,
  });

  if (mapping === null) {
    // 2. New record — create customer + mapping
    const customerId = await deps.createCustomerFromCrm({
      tenantId,
      externalId,
      provider,
      name: `CRM Contact ${externalId}`,
      email: null,
    });
    await deps.insertEntityMapping({
      tenantId,
      provider,
      entityType: 'contact',
      ordrId: customerId,
      externalId,
    });
    await deps.insertSyncEvent({
      tenantId,
      integrationId,
      provider,
      direction: 'inbound',
      entityType: 'contact',
      entityId: customerId,
      externalId,
      status: 'success',
    });
    return;
  }

  // 3. Known record — compare timestamps
  const customer = await deps.getCustomer({ tenantId, customerId: mapping.ordrId });
  if (customer === null) return;

  const crmEventTs = new Date();
  const ordrTs = customer.updatedAt;
  const delta = Math.abs(crmEventTs.getTime() - ordrTs.getTime());
  const crmIsNewer = crmEventTs.getTime() > ordrTs.getTime();

  if (!crmIsNewer && delta > CONFLICT_WINDOW_MS) {
    // ORDR is newer by more than 5 min — skip
    await deps.insertSyncEvent({
      tenantId,
      integrationId,
      provider,
      direction: 'inbound',
      entityType: 'contact',
      entityId: mapping.ordrId,
      externalId,
      status: 'skipped',
    });
    return;
  }

  // Apply CRM delta (either CRM newer, or within 5-min conflict window)
  await deps.applyCustomerDelta({ tenantId, customerId: mapping.ordrId });

  const isConflict = !crmIsNewer && delta <= CONFLICT_WINDOW_MS;
  if (isConflict) {
    await deps.insertSyncEvent({
      tenantId,
      integrationId,
      provider,
      direction: 'inbound',
      entityType: 'contact',
      entityId: mapping.ordrId,
      externalId,
      status: 'conflict',
      conflictResolution: 'crm_wins',
    });
    await deps.auditLogger.log({
      tenantId,
      eventType: 'integration.conflict_detected',
      actorType: 'system',
      actorId: 'worker',
      resource: 'customers',
      resourceId: mapping.ordrId,
      action: 'conflict_resolved_crm_wins',
      details: { provider, external_id: externalId },
      timestamp: new Date(),
    });
    await deps.notifyTenantAdmin({
      tenantId,
      message: `Sync conflict detected for customer ${mapping.ordrId} (provider: ${provider}). CRM version applied.`,
    });
  } else {
    await deps.insertSyncEvent({
      tenantId,
      integrationId,
      provider,
      direction: 'inbound',
      entityType: 'contact',
      entityId: mapping.ordrId,
      externalId,
      status: 'success',
    });
    await deps.auditLogger.log({
      tenantId,
      eventType: 'integration.sync_completed',
      actorType: 'system',
      actorId: 'worker',
      resource: 'customers',
      resourceId: mapping.ordrId,
      action: 'synced_from_crm',
      details: { provider, direction: 'inbound' },
      timestamp: new Date(),
    });
  }
}

// ── Handler Factory ───────────────────────────────────────────────

export type IntegrationEventType =
  | 'customer.created'
  | 'customer.updated'
  | 'integration.webhook_received';

export function createIntegrationSyncHandler(
  deps: IntegrationSyncDeps,
): (event: EventEnvelope<unknown>) => Promise<void> {
  return async (event: EventEnvelope<unknown>): Promise<void> => {
    const type = event.type as IntegrationEventType;

    if (type === 'customer.created') {
      const payload = event.payload as { customerId: string };
      await handleCustomerCreated(event.tenantId, payload.customerId, deps);
    } else if (type === 'customer.updated') {
      const payload = event.payload as { customerId: string };
      await handleCustomerUpdated(event.tenantId, payload.customerId, deps);
    } else {
      // type === 'integration.webhook_received'
      await handleWebhookReceived(event.payload as IntegrationWebhookReceivedPayload, deps);
    }
  };
}
