import {
  pgTable,
  uuid,
  integer,
  boolean,
  time,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';
import { contacts } from './contacts.js';
import { contactChannelEnum } from './contacts.js';

// ---------------------------------------------------------------------------
// Table — channel_preferences
//
// Stores per-customer, per-channel routing preferences including priority,
// preferred contact, and do-not-contact time windows.
//
// RLS: tenant_id is required and enforced at the database level.
// ---------------------------------------------------------------------------

export const channelPreferences = pgTable(
  'channel_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    channel: contactChannelEnum('channel').notNull(),

    /** 1-5, where 1 = most preferred */
    priority: integer('priority').notNull().default(3),

    /** Which contact record to use for this channel */
    contactId: uuid('contact_id')
      .references(() => contacts.id, { onDelete: 'set null' }),

    enabled: boolean('enabled').notNull().default(true),

    /** Earliest time to contact customer (in their timezone) */
    doNotContactBefore: time('do_not_contact_before'),

    /** Latest time to contact customer (in their timezone) */
    doNotContactAfter: time('do_not_contact_after'),

    /** Customer's timezone for DNC window calculation */
    timezone: varchar('timezone', { length: 50 }).notNull().default('America/New_York'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('channel_prefs_tenant_customer_idx').on(table.tenantId, table.customerId),
    uniqueIndex('channel_prefs_tenant_customer_channel_uniq').on(
      table.tenantId,
      table.customerId,
      table.channel,
    ),
  ],
);
