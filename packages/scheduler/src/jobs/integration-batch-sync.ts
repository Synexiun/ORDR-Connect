/**
 * Integration Batch Sync Job
 *
 * Drains the Redis outbound sorted set for each connected CRM integration,
 * deduplicates by customerId, then pushes records to the provider.
 *
 * Bulk threshold:
 *   Salesforce — 200 records  (SOAP bulk API limit)
 *   HubSpot    — 100 records  (batch API limit)
 *
 * Token refresh failures skip the tenant and continue — the credential manager
 * will mark the integration as "error" so the operator is notified.
 *
 * Schedule: every 15 minutes
 *
 * SOC2 CC7.2 — All sync operations audit-logged.
 * ISO 27001 A.12.4.1 — Event logging for automated operations.
 * HIPAA §164.312(b) — Audit controls on background tasks.
 */

import type { JobDefinition, JobResult } from '../types.js';
import { createCronExpression } from '../cron-parser.js';
import { ensureFreshCredentials, IntegrationTokenExpiredError } from '@ordr/integrations';
import type {
  CRMAdapter,
  OAuthConfig,
  CredentialManagerDeps,
  OAuthCredentials,
  CrmContact,
} from '@ordr/integrations';
import type { FieldEncryptor } from '@ordr/crypto';

// ── Constants ─────────────────────────────────────────────────────

export const INTEGRATION_BATCH_SYNC_JOB_ID = 'integration-batch-sync';
export const INTEGRATION_BATCH_SYNC_CRON = '*/15 * * * *';

/** Bulk push threshold per provider. */
const BULK_THRESHOLD: Readonly<Record<string, number>> = {
  salesforce: 200,
  hubspot: 100,
} as const;

const DEFAULT_BULK_THRESHOLD = 200;

// ── Domain Types ──────────────────────────────────────────────────

export interface ConnectedIntegration {
  readonly tenantId: string;
  readonly provider: string;
  readonly integrationId: string;
}

export interface OutboundQueueEntry {
  readonly customerId: string;
  readonly score: number;
}

export interface BatchCustomerRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly email: string | null;
  readonly updatedAt: Date;
}

/** Minimal shape for sync_events rows. */
export interface SyncEventRow {
  readonly integrationId: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly customerId: string;
  readonly externalId: string | null;
  readonly status: 'success' | 'failed';
  readonly direction: 'outbound' | 'inbound';
  readonly errorMessage: string | null;
  readonly syncedAt: Date;
}

/**
 * Slim adapter interface used by this job.
 * Full CRMAdapter implementations will satisfy this since the methods are a subset.
 * refreshAccessToken is needed by ensureFreshCredentials.
 */
type BatchSyncAdapter = Pick<CRMAdapter, 'pushContact' | 'bulkPushContacts' | 'refreshAccessToken'>;

// ── Dependency Types ──────────────────────────────────────────────

export interface IntegrationBatchSyncDeps {
  /** Lists all tenants with active CRM connections. */
  readonly listConnectedIntegrations: () => Promise<ReadonlyArray<ConnectedIntegration>>;

  /**
   * Drains all pending entries from the Redis outbound sorted set for a
   * given tenant + provider. Returns entries with their score (timestamp ms).
   */
  readonly drainOutboundQueue: (params: {
    tenantId: string;
    provider: string;
  }) => Promise<ReadonlyArray<OutboundQueueEntry>>;

  /**
   * Fetches full customer records for a set of IDs.
   * Must be tenant-scoped (RLS enforced by caller).
   */
  readonly getCustomers: (params: {
    tenantId: string;
    customerIds: readonly string[];
  }) => Promise<ReadonlyArray<BatchCustomerRecord>>;

  /** Map of provider → adapter (push + bulk + refresh). */
  readonly adapters: ReadonlyMap<string, BatchSyncAdapter>;

  /** Deps for ensureFreshCredentials. */
  readonly credManagerDeps: CredentialManagerDeps;

  /** OAuth configs per provider. */
  readonly oauthConfigs: ReadonlyMap<string, OAuthConfig>;

  /** Field encryptor for token decryption. */
  readonly fieldEncryptor: FieldEncryptor;

  /** Persists a sync event row. */
  readonly insertSyncEvent: (row: SyncEventRow) => Promise<void>;

  /** Updates last_sync_at for the integration. */
  readonly updateLastSyncAt: (params: { integrationId: string; syncedAt: Date }) => Promise<void>;

  readonly auditLogger: {
    log: (event: {
      tenantId: string;
      eventType: string;
      actorType: string;
      actorId: string;
      resource: string;
      resourceId: string;
      action: string;
      details: Record<string, unknown>;
      timestamp: Date;
    }) => Promise<void>;
  };
}

// ── Job Definition ────────────────────────────────────────────────

export function createIntegrationBatchSyncDefinition(): Omit<
  JobDefinition,
  'createdAt' | 'updatedAt'
> {
  return {
    id: INTEGRATION_BATCH_SYNC_JOB_ID,
    name: 'Integration Batch Sync',
    description: 'Drains outbound queue and pushes customer records to connected CRM integrations.',
    cronExpression: createCronExpression(INTEGRATION_BATCH_SYNC_CRON),
    jobType: INTEGRATION_BATCH_SYNC_JOB_ID,
    payloadTemplate: {},
    isActive: true,
    priority: 'normal',
    retryPolicy: {
      maxRetries: 3,
      baseDelayMs: 30_000,
      maxDelayMs: 600_000,
    },
  };
}

// ── Handler Factory ───────────────────────────────────────────────

/**
 * Deduplicates outbound queue entries by customerId, keeping the entry
 * with the highest score (most recently queued).
 */
function deduplicateByCustomerId(
  entries: ReadonlyArray<OutboundQueueEntry>,
): Map<string, OutboundQueueEntry> {
  const byId = new Map<string, OutboundQueueEntry>();

  for (const entry of entries) {
    const existing = byId.get(entry.customerId);
    if (existing === undefined || entry.score > existing.score) {
      byId.set(entry.customerId, entry);
    }
  }

  return byId;
}

/**
 * Converts a BatchCustomerRecord to the CrmContact shape expected by adapters.
 * CrmContact requires non-optional string fields; we derive them from the name.
 */
function toContact(customer: BatchCustomerRecord): CrmContact {
  const parts = customer.name.split(' ');
  const firstName = parts[0] ?? customer.name;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';

  return {
    externalId: customer.id,
    firstName,
    lastName,
    email: customer.email,
    phone: null,
    company: null,
    title: null,
    lastModified: customer.updatedAt,
    metadata: {},
  };
}

export function createIntegrationBatchSyncHandler(deps: IntegrationBatchSyncDeps) {
  return async (_payload: Record<string, unknown>): Promise<JobResult> => {
    const startMs = Date.now();
    let totalProcessed = 0;
    let totalFailed = 0;

    const integrations = await deps.listConnectedIntegrations();

    for (const integration of integrations) {
      const { tenantId, provider, integrationId } = integration;

      const adapter = deps.adapters.get(provider);
      const oauthConfig = deps.oauthConfigs.get(provider);

      if (adapter === undefined || oauthConfig === undefined) {
        // Provider not configured in this runtime — skip silently.
        continue;
      }

      // ── 1. Ensure fresh credentials ───────────────────────────

      let credentials: OAuthCredentials;
      try {
        credentials = await ensureFreshCredentials(
          deps.credManagerDeps,
          tenantId,
          provider,
          adapter,
          oauthConfig,
          deps.fieldEncryptor,
        );
      } catch (err) {
        if (err instanceof IntegrationTokenExpiredError) {
          // Token refresh failed — credential manager already updated status.
          // Log and skip this tenant.
          await deps.auditLogger.log({
            tenantId,
            eventType: 'integration.token_expired',
            actorType: 'system',
            actorId: 'scheduler',
            resource: 'integration_configs',
            resourceId: integrationId,
            action: 'skip_on_token_expired',
            details: { provider },
            timestamp: new Date(),
          });
          continue;
        }
        throw err;
      }

      // ── 2. Drain outbound queue ───────────────────────────────

      const rawEntries = await deps.drainOutboundQueue({ tenantId, provider });

      if (rawEntries.length === 0) {
        continue;
      }

      // ── 3. Deduplicate by customerId ──────────────────────────

      const deduped = deduplicateByCustomerId(rawEntries);
      const customerIds = Array.from(deduped.keys());

      // ── 4. Fetch customer records ─────────────────────────────

      const customers = await deps.getCustomers({ tenantId, customerIds });

      if (customers.length === 0) {
        continue;
      }

      // ── 5. Push records (bulk or individual) ──────────────────

      const bulkThreshold = BULK_THRESHOLD[provider] ?? DEFAULT_BULK_THRESHOLD;
      const syncedAt = new Date();

      if (customers.length > bulkThreshold && typeof adapter.bulkPushContacts === 'function') {
        // ── Bulk path ─────────────────────────────────────────────
        const contacts = customers.map(toContact);

        let externalIdMap: ReadonlyMap<string, string>;
        try {
          externalIdMap = await adapter.bulkPushContacts(credentials, contacts);
        } catch (bulkErr) {
          // If bulk fails, record all as failed.
          for (const customer of customers) {
            await deps.insertSyncEvent({
              integrationId,
              tenantId,
              provider,
              customerId: customer.id,
              externalId: null,
              status: 'failed',
              direction: 'outbound',
              errorMessage: bulkErr instanceof Error ? bulkErr.message : 'Bulk push failed',
              syncedAt,
            });
            totalFailed++;
          }
          continue;
        }

        for (const customer of customers) {
          const externalId = externalIdMap.get(customer.id) ?? null;
          await deps.insertSyncEvent({
            integrationId,
            tenantId,
            provider,
            customerId: customer.id,
            externalId,
            status: externalId !== null ? 'success' : 'failed',
            direction: 'outbound',
            errorMessage: null,
            syncedAt,
          });
          if (externalId !== null) {
            totalProcessed++;
          } else {
            totalFailed++;
          }
        }
      } else {
        // ── Individual path ───────────────────────────────────────
        for (const customer of customers) {
          const contact = toContact(customer);

          try {
            const externalId = await adapter.pushContact(credentials, contact);
            await deps.insertSyncEvent({
              integrationId,
              tenantId,
              provider,
              customerId: customer.id,
              externalId,
              status: 'success',
              direction: 'outbound',
              errorMessage: null,
              syncedAt,
            });
            totalProcessed++;
          } catch (pushErr) {
            await deps.insertSyncEvent({
              integrationId,
              tenantId,
              provider,
              customerId: customer.id,
              externalId: null,
              status: 'failed',
              direction: 'outbound',
              errorMessage: pushErr instanceof Error ? pushErr.message : 'Push failed',
              syncedAt,
            });
            totalFailed++;
          }
        }
      }

      // ── 6. Update last_sync_at ────────────────────────────────

      await deps.updateLastSyncAt({ integrationId, syncedAt });

      await deps.auditLogger.log({
        tenantId,
        eventType: 'integration.batch_sync_completed',
        actorType: 'system',
        actorId: 'scheduler',
        resource: 'integration_configs',
        resourceId: integrationId,
        action: 'batch_sync',
        details: {
          provider,
          recordsProcessed: customers.length,
        },
        timestamp: syncedAt,
      });
    }

    return {
      success: true,
      data: { processed: totalProcessed, failed: totalFailed },
      durationMs: Date.now() - startMs,
    };
  };
}
