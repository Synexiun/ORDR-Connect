import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const contactChannelEnum = pgEnum('contact_channel', [
  'sms',
  'email',
  'voice',
  'whatsapp',
  'mail',
]);

export const consentStatusEnum = pgEnum('consent_status', [
  'opted_in',
  'opted_out',
  'unknown',
  'revoked',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    channel: contactChannelEnum('channel').notNull(),

    /** ENCRYPTED -- phone number, email address, or other contact value */
    value: text('value').notNull(),

    /** SHA-256 hash of the contact value for lookup without decryption */
    valueHash: varchar('value_hash', { length: 64 }),

    /** Contact label: 'primary', 'work', 'home', etc. */
    label: varchar('label', { length: 50 }),

    isPrimary: boolean('is_primary').notNull().default(false),

    consentStatus: consentStatusEnum('consent_status').notNull().default('unknown'),

    consentUpdatedAt: timestamp('consent_updated_at', { withTimezone: true }),

    verified: boolean('verified').notNull().default(false),

    verifiedAt: timestamp('verified_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('contacts_tenant_customer_idx').on(table.tenantId, table.customerId),
    index('contacts_tenant_value_hash_idx').on(table.tenantId, table.valueHash),
    index('contacts_tenant_channel_consent_idx').on(
      table.tenantId,
      table.channel,
      table.consentStatus,
    ),
  ],
);
