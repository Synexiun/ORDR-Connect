/**
 * key_rotation_jobs — concurrency guard + progress tracker for DEK re-wrap
 *
 * One row per active rotation job. Prevents duplicate concurrent re-wraps
 * on multi-replica worker deployments. Stores keyset cursor for idempotent
 * resume after crash.
 *
 * Rule 3 — WORM audit events accompany every job state change.
 * Rule 1 — Key rotation automated at ≤90 day cycle.
 */

import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const keyRotationJobs = pgTable('key_rotation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** Name of the secret key being rotated, e.g. 'ENCRYPTION_MASTER_KEY' */
  keyName: text('key_name').notNull(),

  /** Vault KV v2 version being replaced */
  oldVersion: integer('old_version').notNull(),

  /** Vault KV v2 version being written */
  newVersion: integer('new_version').notNull(),

  /** 'running' | 'completed' | 'failed' */
  status: text('status').notNull().default('running'),

  /** Total rows to process — null until counted after job insert */
  rowsTotal: integer('rows_total'),

  /** Rows successfully re-wrapped */
  rowsDone: integer('rows_done').notNull().default(0),

  /** Keyset cursor — UUID of last successfully processed encrypted_fields row */
  lastProcessedId: uuid('last_processed_id'),

  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),

  completedAt: timestamp('completed_at', { withTimezone: true }),
});
