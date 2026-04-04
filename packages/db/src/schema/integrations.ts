/**
 * Integration schema — Drizzle ORM definitions for Phase 52 tables.
 *
 * SOC2 CC6.1 — RLS policies defined in migration 0012.
 * Five tables: integration_configs, sync_events (WORM), webhook_logs,
 * integration_field_mappings, integration_entity_mappings.
 */

import { pgTable, pgEnum, uuid, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';

// ── Enums ─────────────────────────────────────────────────────────

export const integrationProviderEnum = pgEnum('integration_provider', ['salesforce', 'hubspot']);

export const integrationConfigStatusEnum = pgEnum('integration_config_status', [
  'connected',
  'disconnected',
  'error',
  'rate_limited',
]);

export const syncEventDirectionEnum = pgEnum('sync_event_direction', ['inbound', 'outbound']);

export const syncEventStatusEnum = pgEnum('sync_event_status', [
  'success',
  'failed',
  'conflict',
  'skipped',
]);

export const integrationEntityTypeEnum = pgEnum('integration_entity_type', [
  'contact',
  'deal',
  'activity',
]);

export const fieldMappingDirectionEnum = pgEnum('field_mapping_direction', [
  'inbound',
  'outbound',
  'both',
]);

// ── Tables ────────────────────────────────────────────────────────

export const integrationConfigs = pgTable(
  'integration_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: integrationProviderEnum('provider').notNull(),
    status: integrationConfigStatusEnum('status').notNull().default('disconnected'),
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    webhookSecretEnc: text('webhook_secret_enc'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes').array(),
    instanceUrl: text('instance_url'),
    settings: jsonb('settings').notNull().default({}),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_integration_configs_tenant').on(t.tenantId),
    index('idx_integration_configs_status').on(t.tenantId, t.status),
  ],
);

export const syncEvents = pgTable(
  'sync_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrationConfigs.id, { onDelete: 'cascade' }),
    provider: integrationProviderEnum('provider').notNull(),
    direction: syncEventDirectionEnum('direction').notNull(),
    entityType: integrationEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id'),
    externalId: text('external_id'),
    status: syncEventStatusEnum('status').notNull(),
    conflictResolution: text('conflict_resolution'),
    errorSummary: text('error_summary'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sync_events_tenant_provider').on(t.tenantId, t.provider),
    index('idx_sync_events_entity').on(t.entityId),
    index('idx_sync_events_synced_at').on(t.syncedAt),
  ],
);

export const webhookLogs = pgTable(
  'webhook_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    provider: integrationProviderEnum('provider').notNull(),
    eventType: text('event_type').notNull(),
    payloadHash: text('payload_hash').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    processed: boolean('processed').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_webhook_logs_tenant').on(t.tenantId, t.receivedAt),
    index('idx_webhook_logs_unprocessed')
      .on(t.processed, t.receivedAt)
      .where(sql`processed = false`),
  ],
);

export const integrationFieldMappings = pgTable(
  'integration_field_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: integrationProviderEnum('provider').notNull(),
    entityType: integrationEntityTypeEnum('entity_type').notNull(),
    direction: fieldMappingDirectionEnum('direction').notNull(),
    sourceField: text('source_field').notNull(),
    targetField: text('target_field').notNull(),
    transform: jsonb('transform'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_field_mappings_tenant_provider').on(t.tenantId, t.provider, t.entityType)],
);

export const integrationEntityMappings = pgTable(
  'integration_entity_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: integrationProviderEnum('provider').notNull(),
    entityType: integrationEntityTypeEnum('entity_type').notNull(),
    ordrId: uuid('ordr_id').notNull(),
    externalId: text('external_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_entity_mappings_lookup').on(t.tenantId, t.provider, t.entityType, t.externalId),
    index('idx_entity_mappings_ordr_id').on(t.ordrId),
  ],
);
