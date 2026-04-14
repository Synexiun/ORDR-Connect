import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const violationRegulationEnum = pgEnum('violation_regulation', [
  'HIPAA',
  'FDCPA',
  'TCPA',
  'GDPR',
  'SOC2',
  'ISO27001',
]);

export const violationSeverityEnum = pgEnum('violation_severity', [
  'critical',
  'high',
  'medium',
  'low',
]);

// ── Table ─────────────────────────────────────────────────────────────────────
//
// Partial WORM: core fields (rule_name, regulation, severity, description,
// customer_id, detected_at, tenant_id) are immutable after insert.
// Resolution fields (resolved, resolved_at, resolved_by, resolution_note)
// are mutable so operators can acknowledge violations.
// DELETE and TRUNCATE are fully blocked by DB triggers (see migration 0021).

export const complianceViolations = pgTable(
  'compliance_violations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    ruleName: varchar('rule_name', { length: 255 }).notNull(),

    regulation: violationRegulationEnum('regulation').notNull(),

    severity: violationSeverityEnum('severity').notNull(),

    description: text('description').notNull(),

    /** Nullable — system-level violations have no specific customer. */
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),

    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),

    // ── Resolution fields (mutable) ────────────────────────────────────────
    resolved: boolean('resolved').notNull().default(false),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    /** userId of the operator who resolved this violation. */
    resolvedBy: varchar('resolved_by', { length: 255 }),

    resolutionNote: text('resolution_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cv_tenant_idx').on(table.tenantId),
    index('cv_tenant_detected').on(table.tenantId, table.detectedAt),
    index('cv_tenant_regulation').on(table.tenantId, table.regulation),
    index('cv_tenant_resolved').on(table.tenantId, table.resolved),
  ],
);
