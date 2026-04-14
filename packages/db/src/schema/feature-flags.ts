/**
 * Feature Flags Schema — per-tenant runtime feature gating
 *
 * SOC2 CC6.1  — Tenant-scoped: one row per (tenant_id, flag_name).
 * ISO 27001 A.14.2.5 — Controlled feature rollout without redeployment.
 *
 * Flags are evaluated at request time with an optional rollout percentage
 * for canary / gradual release strategies. All writes are admin-only and
 * audit-logged.
 *
 * SECURITY:
 * - tenant_id is unique per flag — no cross-tenant flag reads (Rule 2)
 * - RLS enforced at DB layer (migration 0020)
 * - No secrets or PHI stored in metadata (Rule 5, Rule 6)
 */

import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  smallint,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: text('tenant_id').notNull(),

    /** Stable identifier — kebab-case convention (e.g., "ai-suggestions") */
    flagName: varchar('flag_name', { length: 100 }).notNull(),

    /** Master on/off switch */
    enabled: boolean('enabled').notNull().default(false),

    /**
     * 0–100: percentage of users that see this flag when enabled.
     * 100 = all users; 0 = nobody (safe off while enabled flag stays set).
     */
    rolloutPct: smallint('rollout_pct').notNull().default(100),

    /** Human-readable description for the admin UI */
    description: text('description'),

    /** Arbitrary JSON for flag-specific config (non-PHI, non-secrets) */
    metadata: jsonb('metadata').notNull().default('{}'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('feature_flags_tenant_name_uniq').on(table.tenantId, table.flagName),
    index('feature_flags_tenant_enabled_idx').on(table.tenantId, table.enabled),
  ],
);
