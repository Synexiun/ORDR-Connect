import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';
import { agentSessions } from './agent-sessions.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'refunded',
  'disputed',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'ach',
  'credit_card',
  'debit_card',
  'wire',
  'check',
  'other',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const paymentRecords = pgTable(
  'payment_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    /** null if payment was not initiated by an agent session */
    agentSessionId: uuid('agent_session_id').references(() => agentSessions.id, {
      onDelete: 'set null',
    }),

    /** ID from the external payment processor */
    externalPaymentId: varchar('external_payment_id', { length: 255 }),

    amountCents: integer('amount_cents').notNull(),

    currency: varchar('currency', { length: 3 }).notNull().default('USD'),

    status: paymentStatusEnum('status').notNull().default('pending'),

    paymentMethod: paymentMethodEnum('payment_method').notNull(),

    /** If this payment is part of a payment plan */
    paymentPlanId: varchar('payment_plan_id', { length: 255 }),

    dueDate: date('due_date'),

    paidAt: timestamp('paid_at', { withTimezone: true }),

    referenceNumber: varchar('reference_number', { length: 255 }),

    /** ENCRYPTED -- reference to encrypted notes (NEVER store raw notes with PHI) */
    notesRef: text('notes_ref'),

    metadata: jsonb('metadata').default('{}'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payment_records_tenant_customer_idx').on(table.tenantId, table.customerId),
    index('payment_records_tenant_status_idx').on(table.tenantId, table.status),
    index('payment_records_tenant_due_date_idx').on(table.tenantId, table.dueDate),
    index('payment_records_external_payment_id_idx').on(table.externalPaymentId),
  ],
);
