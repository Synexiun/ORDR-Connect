/**
 * Usage Records — incremental resource consumption events per tenant
 *
 * Written by UsageTracker.flushAll() at regular intervals (default 60s).
 * The getUsageSummary query SUMs quantities filtered by recorded_at within
 * the active billing period.
 *
 * SOC2 CC6.1 — Usage-based quota enforcement backed by durable records.
 * ISO 27001 A.12.1.3 — Capacity management: persistent usage tracking.
 */

import { pgTable, pgEnum, uuid, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const usageResourceEnum = pgEnum('usage_resource', [
  'agents',
  'contacts',
  'messages',
  'api_calls',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const usageRecords = pgTable(
  'usage_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    resource: usageResourceEnum('resource').notNull(),

    /** Number of resource units consumed in this batch */
    quantity: integer('quantity').notNull(),

    /** Start of the window this batch covers */
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),

    /** End of the window this batch covers */
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),

    /** When this record was written to the DB */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_records_tenant_resource_idx').on(t.tenantId, t.resource),
    index('usage_records_tenant_recorded_idx').on(t.tenantId, t.recordedAt),
  ],
);
