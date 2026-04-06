import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// SCIM Groups
// ---------------------------------------------------------------------------

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),

  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  displayName: text('display_name').notNull(),

  scimExternalId: text('scim_external_id'),

  scimSource: text('scim_source'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
