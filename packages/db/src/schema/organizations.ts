import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: varchar('name', { length: 255 }).notNull(),

    /** Self-referencing FK — null means root organization */
    parentId: uuid('parent_id'),

    slug: varchar('slug', { length: 100 }).notNull(),

    metadata: jsonb('metadata').default('{}'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('organizations_tenant_id_idx').on(table.tenantId),
    index('organizations_tenant_parent_idx').on(table.tenantId, table.parentId),
    uniqueIndex('organizations_tenant_slug_uniq').on(table.tenantId, table.slug),
  ],
);
