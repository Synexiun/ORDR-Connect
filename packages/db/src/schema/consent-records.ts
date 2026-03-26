import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';
import { contacts, contactChannelEnum, consentStatusEnum } from './contacts.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const consentActionEnum = pgEnum('consent_action', [
  'opt_in',
  'opt_out',
  'revoke',
  'renew',
]);

export const consentMethodEnum = pgEnum('consent_method', [
  'sms_keyword',
  'web_form',
  'verbal',
  'written',
  'api',
]);

// ---------------------------------------------------------------------------
// Table
//
// CRITICAL: This table is WORM (Write Once, Read Many).
//   - UPDATE and DELETE triggers MUST be created in migration to enforce
//     immutability. See rls.ts WORM_TRIGGERS for the DDL.
//   - Application code must NEVER issue UPDATE or DELETE on this table.
//   - content_hash provides integrity verification for each record.
// ---------------------------------------------------------------------------

export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** NOT a foreign key -- consent records are independent of tenant lifecycle */
    tenantId: uuid('tenant_id').notNull(),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),

    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),

    channel: contactChannelEnum('channel').notNull(),

    action: consentActionEnum('action').notNull(),

    method: consentMethodEnum('method').notNull(),

    /** Reference to stored consent evidence (e.g., object store path) */
    evidenceRef: text('evidence_ref'),

    /** IP address of the consent origin (IPv4 or IPv6) */
    ipAddress: varchar('ip_address', { length: 45 }),

    /** Browser or application user agent used for consent */
    userAgent: text('user_agent'),

    previousStatus: consentStatusEnum('previous_status').notNull(),

    newStatus: consentStatusEnum('new_status').notNull(),

    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    /** User who recorded the consent change (null for automated) */
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),

    /** SHA-256 hash of the full record for integrity verification */
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
  },
  (table) => [
    index('consent_records_tenant_customer_idx').on(table.tenantId, table.customerId),
    index('consent_records_tenant_contact_idx').on(table.tenantId, table.contactId),
    index('consent_records_tenant_recorded_at_idx').on(table.tenantId, table.recordedAt),
  ],
);
