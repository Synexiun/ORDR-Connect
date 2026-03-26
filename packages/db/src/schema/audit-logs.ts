import {
  pgTable,
  pgEnum,
  uuid,
  bigint,
  varchar,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const actorTypeEnum = pgEnum('actor_type', [
  'user',
  'agent',
  'system',
]);

// ---------------------------------------------------------------------------
// Table
//
// CRITICAL: This table is WORM (Write Once, Read Many).
//   - UPDATE and DELETE triggers MUST be created in migration to enforce
//     immutability. See rls.ts WORM_TRIGGERS for the DDL.
//   - Application code must NEVER issue UPDATE or DELETE on this table.
//   - Hash chain: each row's `hash` is SHA-256(previousHash + event data).
//   - Merkle roots are stored in `merkle_roots` for batch verification.
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Per-tenant monotonically increasing sequence number */
    sequenceNumber: bigint('sequence_number', { mode: 'bigint' }).notNull(),

    /** NOT a foreign key -- audit logs are independent of tenant lifecycle */
    tenantId: uuid('tenant_id').notNull(),

    eventType: varchar('event_type', { length: 100 }).notNull(),

    actorType: actorTypeEnum('actor_type').notNull(),

    actorId: varchar('actor_id', { length: 255 }).notNull(),

    resource: varchar('resource', { length: 255 }).notNull(),

    resourceId: varchar('resource_id', { length: 255 }).notNull(),

    action: varchar('action', { length: 100 }).notNull(),

    /** NEVER contains PHI -- sanitize before writing */
    details: jsonb('details').notNull().default('{}'),

    /** Hash of the previous audit log entry (chain integrity) */
    previousHash: text('previous_hash').notNull(),

    /** SHA-256(previousHash + serialized event data) */
    hash: text('hash').notNull(),

    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('audit_logs_tenant_seq_uniq').on(table.tenantId, table.sequenceNumber),
    index('audit_logs_tenant_event_type_idx').on(table.tenantId, table.eventType),
    index('audit_logs_tenant_timestamp_idx').on(table.tenantId, table.timestamp),
  ],
);
