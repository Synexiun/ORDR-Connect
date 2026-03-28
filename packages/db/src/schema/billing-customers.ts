/**
 * Billing Customers — Stripe customer identities per tenant
 *
 * Stores the mapping between ORDR tenants and Stripe customer objects.
 * The stripe_customer_id is field-encrypted (AES-256-GCM) before storage.
 *
 * PCI DSS Req 3.3 — Sensitive data masked; card data never stored here.
 * SOC2 CC6.1 — Billing customer access controlled by tenant RLS.
 * ISO 27001 A.8.2.3 — Restricted data encrypted at field level.
 */

import { pgTable, uuid, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const billingCustomers = pgTable(
  'billing_customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** AES-256-GCM encrypted Stripe customer ID (cus_xxx) */
    stripeCustomerId: text('stripe_customer_id').notNull(),

    /** Billing contact email — not PHI, but CONFIDENTIAL */
    email: varchar('email', { length: 255 }).notNull(),

    /** Billing contact name */
    name: varchar('name', { length: 255 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('billing_customers_tenant_id_uidx').on(t.tenantId)],
);
