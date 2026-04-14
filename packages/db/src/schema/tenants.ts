import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  smallint,
  boolean,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const planEnum = pgEnum('plan', ['free', 'starter', 'professional', 'enterprise']);

export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'deactivated']);

export const isolationTierEnum = pgEnum('isolation_tier', ['shared', 'schema', 'dedicated']);

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

  /** Phase 57 — first-run wizard state */
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  onboardingStep: smallint('onboarding_step').notNull().default(0),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
