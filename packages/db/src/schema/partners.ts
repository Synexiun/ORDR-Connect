/**
 * Partner Program schema — partner management and payout tracking for ORDR-Connect
 *
 * SOC2 CC6.1 — Access control: partner-scoped data, tier-enforced revenue shares.
 * ISO 27001 A.9.2.3 — Management of privileged access rights for partner API keys.
 * HIPAA §164.312(a)(1) — Access control: partner data is tenant-isolated.
 *
 * Tables:
 * - partners — registered partner accounts with tier and revenue share
 * - partner_payouts — payout records for partner earnings
 *
 * SECURITY:
 * - api_key_hash stores SHA-256 hash only (Rule 2 — NEVER store raw keys)
 * - revenue_share_pct constrained 0–100 via application validation
 * - status enum gates access — only 'active' partners can earn
 * - All state changes require audit logging (Rule 3 — WORM)
 */

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const partnerTierEnum = pgEnum('partner_tier', [
  'silver',
  'gold',
  'platinum',
]);

export const partnerStatusEnum = pgEnum('partner_status', [
  'pending',
  'active',
  'suspended',
]);

export const partnerPayoutStatusEnum = pgEnum('partner_payout_status', [
  'pending',
  'processing',
  'paid',
  'failed',
]);

// ---------------------------------------------------------------------------
// Partners — registered partner accounts
// ---------------------------------------------------------------------------

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Partner display name */
    name: varchar('name', { length: 255 }).notNull(),

    /** Partner contact email — unique */
    email: varchar('email', { length: 255 }).notNull(),

    /** Partner company name */
    company: varchar('company', { length: 255 }).notNull(),

    /** Partner tier — determines revenue share limits and features */
    tier: partnerTierEnum('tier').notNull().default('silver'),

    /** Account status — only active partners earn revenue */
    status: partnerStatusEnum('status').notNull().default('pending'),

    /** Revenue share percentage (0–100) — validated at application layer */
    revenueSharePct: integer('revenue_share_pct').notNull().default(10),

    /** SHA-256 hash of the partner API key (Rule 2 — NEVER store raw key) */
    apiKeyHash: text('api_key_hash'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('partners_email_uniq').on(table.email),
    index('partners_status_idx').on(table.status),
    index('partners_tier_idx').on(table.tier),
  ],
);

// ---------------------------------------------------------------------------
// Partner Payouts — revenue payout records
// ---------------------------------------------------------------------------

export const partnerPayouts = pgTable(
  'partner_payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** FK to partners — which partner receives this payout */
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),

    /** Payout amount in cents (integer for precision — Rule 6 financial data) */
    amountCents: integer('amount_cents').notNull(),

    /** ISO 4217 currency code */
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),

    /** Payout period start */
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),

    /** Payout period end */
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),

    /** Payout lifecycle status */
    status: partnerPayoutStatusEnum('status').notNull().default('pending'),

    /** Timestamp when payout was completed (null if not yet paid) */
    paidAt: timestamp('paid_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('partner_payouts_partner_id_idx').on(table.partnerId),
    index('partner_payouts_status_idx').on(table.status),
    index('partner_payouts_period_idx').on(table.periodStart, table.periodEnd),
  ],
);
