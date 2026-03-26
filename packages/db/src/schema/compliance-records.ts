import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const complianceResultEnum = pgEnum('compliance_result', [
  'pass',
  'fail',
  'warning',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const complianceRecords = pgTable(
  'compliance_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    customerId: uuid('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),

    /**
     * Regulation identifier:
     * 'hipaa' | 'fdcpa' | 'tcpa' | 'gdpr' | 'ccpa' | 'fec' | 'respa'
     */
    regulation: varchar('regulation', { length: 50 }).notNull(),

    ruleId: varchar('rule_id', { length: 255 }).notNull(),

    action: varchar('action', { length: 255 }).notNull(),

    result: complianceResultEnum('result').notNull(),

    details: jsonb('details').notNull(),

    enforcedAt: timestamp('enforced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('compliance_records_tenant_id_idx').on(table.tenantId),
    index('compliance_records_tenant_regulation_idx').on(table.tenantId, table.regulation),
    index('compliance_records_enforced_at_idx').on(table.tenantId, table.enforcedAt),
  ],
);
