/**
 * Subscriptions — plan tier and billing period per tenant
 *
 * Each row represents one subscription lifecycle. A tenant may have
 * multiple rows (previous cancelled + current active). Queries should
 * filter on status = 'active' | 'trialing' for enforcement purposes.
 *
 * The stripe_subscription_id is field-encrypted (AES-256-GCM).
 *
 * SOC2 CC6.1 — Plan-based access enforced from subscription status.
 * ISO 27001 A.8.2.3 — Financial data encrypted at field level.
 * HIPAA §164.312(b) — Subscription changes logged in audit trail.
 */

import {
  pgTable,
  pgEnum,
  varchar,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { planEnum } from './tenants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'trialing',
  'past_due',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const subscriptions = pgTable(
  'subscriptions',
  {
    /** Stripe subscription ID (sub_xxx) — used as PK for direct Stripe correlation */
    id: varchar('id', { length: 255 }).primaryKey(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** AES-256-GCM encrypted Stripe subscription ID */
    stripeSubscriptionId: text('stripe_subscription_id').notNull(),

    planTier: planEnum('plan_tier').notNull().default('free'),

    status: subscriptionStatusEnum('status').notNull().default('active'),

    currentPeriodStart: timestamp('current_period_start', {
      withTimezone: true,
    }).notNull(),

    currentPeriodEnd: timestamp('current_period_end', {
      withTimezone: true,
    }).notNull(),

    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_tenant_status_idx').on(t.tenantId, t.status),
    index('subscriptions_period_end_idx').on(t.currentPeriodEnd),
  ],
);

// Re-export for convenience — callers that import subscriptions also often need planEnum
export { planEnum };
