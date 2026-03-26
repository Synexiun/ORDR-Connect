import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const customerTypeEnum = pgEnum('customer_type', [
  'individual',
  'company',
]);

export const customerStatusEnum = pgEnum('customer_status', [
  'active',
  'inactive',
  'churned',
]);

export const lifecycleStageEnum = pgEnum('lifecycle_stage', [
  'lead',
  'qualified',
  'opportunity',
  'customer',
  'churning',
  'churned',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Customer's ID in their external system */
    externalId: varchar('external_id', { length: 255 }),

    type: customerTypeEnum('type').notNull(),

    status: customerStatusEnum('status').notNull().default('active'),

    // -- PII fields: field-level encrypted (HIPAA) --

    /** ENCRYPTED -- customer display name */
    name: text('name').notNull(),

    /** ENCRYPTED -- customer email address */
    email: text('email'),

    /** ENCRYPTED -- customer phone number */
    phone: text('phone'),

    metadata: jsonb('metadata').default('{}'),

    /** 0-100 composite health score */
    healthScore: integer('health_score'),

    lifecycleStage: lifecycleStageEnum('lifecycle_stage').default('lead'),

    assignedUserId: uuid('assigned_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('customers_tenant_id_idx').on(table.tenantId),
    uniqueIndex('customers_tenant_external_id_uniq')
      .on(table.tenantId, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`),
    index('customers_tenant_lifecycle_idx').on(table.tenantId, table.lifecycleStage),
  ],
);
