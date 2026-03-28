/**
 * Search Index — PostgreSQL tsvector-backed full-text search
 *
 * One row per (tenantId, entityType, entityId) — upsert semantics.
 * The content_vector column is a tsvector assembled by the application
 * layer from PHI-sanitized field values before insert.
 *
 * SOC2 CC6.1 — Every search query is tenant-scoped via tenant_id.
 * HIPAA §164.312 — PHI MUST NOT appear in the index.
 * ISO 27001 A.8.2.3 — Data classification enforced before indexing.
 *
 * SECURITY:
 * - Names → initials only, emails → domain only, phones → last 4 digits
 * - SSN / DOB / diagnosis codes are NEVER indexed
 * - display_title / display_subtitle are PHI-masked strings
 * - GIN index on content_vector enables fast tsvector queries
 */

import { pgTable, pgEnum, uuid, text, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

export const searchEntityTypeEnum = pgEnum('search_entity_type', [
  'customer',
  'interaction',
  'agent-session',
  'workflow',
  'marketplace-agent',
]);

// ---------------------------------------------------------------------------
// search_index — unified search index for all entity types
// ---------------------------------------------------------------------------

export const searchIndex = pgTable(
  'search_index',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entityType: searchEntityTypeEnum('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /**
     * tsvector assembled from sanitized field values.
     * Stored as text so the application layer can write it directly.
     * A generated column would tie us to PostgreSQL-specific DDL in Drizzle.
     */
    contentVector: text('content_vector').notNull().default(''),
    /** PHI-masked display title (e.g. "J. Smith") */
    displayTitle: text('display_title').notNull().default(''),
    /** PHI-masked subtitle (e.g. "customer • @domain.com") */
    displaySubtitle: text('display_subtitle').notNull().default(''),
    /** Non-sensitive metadata stored alongside the entry. */
    metadata: jsonb('metadata').notNull().default('{}'),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Upsert key — one entry per entity per tenant. */
    unique('search_index_tenant_entity_uniq').on(t.tenantId, t.entityType, t.entityId),
    index('search_index_tenant_idx').on(t.tenantId),
    index('search_index_entity_type_idx').on(t.tenantId, t.entityType),
    /**
     * GIN index for full-text search — created in raw SQL in the migration
     * because Drizzle does not yet support `USING gin` syntax directly.
     * The index is named search_index_content_gin in 0009 migration.
     */
    index('search_index_updated_idx').on(t.updatedAt),
  ],
);
