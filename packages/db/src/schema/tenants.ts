import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const planEnum = pgEnum('plan', [
  'free',
  'starter',
  'professional',
  'enterprise',
]);

export const tenantStatusEnum = pgEnum('tenant_status', [
  'active',
  'suspended',
  'deactivated',
]);

export const isolationTierEnum = pgEnum('isolation_tier', [
  'shared',
  'schema',
  'dedicated',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),

  name: varchar('name', { length: 255 }).notNull(),

  slug: varchar('slug', { length: 100 }).unique().notNull(),

  plan: planEnum('plan').notNull().default('free'),

  status: tenantStatusEnum('status').notNull().default('active'),

  isolationTier: isolationTierEnum('isolation_tier').notNull().default('shared'),

  settings: jsonb('settings').default('{}'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
