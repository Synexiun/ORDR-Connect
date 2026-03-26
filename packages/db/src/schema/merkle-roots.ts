import {
  pgTable,
  uuid,
  bigint,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Table
//
// Stores Merkle tree root hashes for audit log batch verification.
// Each batch covers a contiguous range of audit log sequence numbers
// for a single tenant. Used for SOC2 tamper-evidence proofs.
// ---------------------------------------------------------------------------

export const merkleRoots = pgTable(
  'merkle_roots',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id').notNull(),

    /** First sequence number in the batch (inclusive) */
    batchStart: bigint('batch_start', { mode: 'bigint' }).notNull(),

    /** Last sequence number in the batch (inclusive) */
    batchEnd: bigint('batch_end', { mode: 'bigint' }).notNull(),

    /** Merkle tree root hash of the batch */
    root: text('root').notNull(),

    /** Number of audit log entries in this batch */
    eventCount: integer('event_count').notNull(),

    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('merkle_roots_tenant_batch_start_uniq').on(table.tenantId, table.batchStart),
  ],
);
