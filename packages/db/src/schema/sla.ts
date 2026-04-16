/**
 * @ordr/db — SLA Policy schema
 *
 * Configurable per-tenant SLA breach thresholds.
 * Resolution order: (channel + tier) > channel-only > tier-only > global.
 *
 * SOC2 CC7.2  — Monitoring: SLA enforcement with configurable thresholds.
 * ISO 27001 A.16.1.1 — Information security event responsibilities.
 * HIPAA §164.308(a)(5)(ii)(C) — Log-in monitoring requirements.
 */

import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const slaPolicies = pgTable(
  'sla_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * Null = wildcard (matches any channel).
     * Values: 'sms' | 'email' | 'voice' | 'whatsapp' | 'chat' | 'push' | 'in_app'
     */
    channel: varchar('channel', { length: 50 }),

    /**
     * Null = wildcard (matches any priority tier).
     * Values: 'vip' | 'high' | 'standard' | 'low'
     */
    priorityTier: varchar('priority_tier', { length: 50 }),

    /** Breach threshold in minutes. Range: 1–10,080 (1 week). */
    thresholdMinutes: integer('threshold_minutes').notNull(),

    enabled: boolean('enabled').notNull().default(true),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One policy per channel × priority_tier combination per tenant
    unique('sla_policies_unique_scope')
      .on(t.tenantId, t.channel, t.priorityTier)
      .nullsNotDistinct(),
    check('sla_threshold_range', sql`threshold_minutes BETWEEN 1 AND 10080`),
  ],
);
