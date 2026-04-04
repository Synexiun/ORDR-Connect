/**
 * DSR (Data Subject Request) schema — GDPR Art. 12, 15, 17, 20
 *
 * SOC2 CC6.1 — RLS enforced at DB level (dsr_tenant_isolation policy).
 * GDPR Art. 12 — 30-day deadline tracked in deadline_at.
 * HIPAA §164.524 — right of access applies to any PHI held.
 */

import { pgTable, pgEnum, uuid, text, bigint, timestamp, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';

// ── Enums ─────────────────────────────────────────────────────────

export const dsrTypeEnum = pgEnum('dsr_type', ['access', 'erasure', 'portability']);

export const dsrStatusEnum = pgEnum('dsr_status', [
  'pending',
  'approved',
  'processing',
  'completed',
  'rejected',
  'cancelled',
  'failed',
]);

// ── Tables ────────────────────────────────────────────────────────

export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),

    type: dsrTypeEnum('type').notNull(),

    status: dsrStatusEnum('status').notNull().default('pending'),

    /** Actor ID of the tenant admin who submitted the request */
    requestedBy: text('requested_by').notNull(),

    /** Required for erasure type; optional for access/portability */
    reason: text('reason'),

    /** GDPR Art. 12 — created_at + 30 days */
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),

    completedAt: timestamp('completed_at', { withTimezone: true }),

    rejectionReason: text('rejection_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_dsr_tenant_status').on(t.tenantId, t.status),
    index('idx_dsr_customer').on(t.customerId),
    index('idx_dsr_deadline').on(t.deadlineAt),
  ],
);

export const dsrExports = pgTable(
  'dsr_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    dsrId: uuid('dsr_id')
      .notNull()
      .references(() => dataSubjectRequests.id, { onDelete: 'cascade' }),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** S3 object key: dsr-exports/{tenantId}/{dsrId}/{exportId}.json.enc */
    s3Key: text('s3_key').notNull(),

    s3Bucket: text('s3_bucket').notNull(),

    /** Presigned URL window — object auto-deleted after this */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),

    /** SHA-256 of the AES-256-GCM ciphertext — verified before issuing presigned URL */
    checksumSha256: text('checksum_sha256').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_dsr_exports_dsr_id').on(t.dsrId)],
);
