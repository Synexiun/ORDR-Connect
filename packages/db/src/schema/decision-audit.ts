import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  real,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Table
//
// CRITICAL: This table is WORM (Write Once, Read Many).
//   - UPDATE and DELETE triggers MUST be created in migration to enforce
//     immutability. See rls.ts WORM_TRIGGERS for the DDL.
//   - Application code must NEVER issue UPDATE or DELETE on this table.
//   - inputSummary and outputSummary MUST NEVER contain PHI — use
//     tokenized customer references only.
// ---------------------------------------------------------------------------

export const decisionAudit = pgTable(
  'decision_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** NOT a foreign key — audit logs are independent of tenant lifecycle */
    tenantId: uuid('tenant_id').notNull(),

    decisionId: uuid('decision_id').notNull(),

    /** Tokenized customer reference — NO PHI */
    customerId: varchar('customer_id', { length: 255 }).notNull(),

    /** Which layer produced this audit entry: 'rules' | 'ml' | 'llm' */
    layer: varchar('layer', { length: 20 }).notNull(),

    /** Summary of input to this layer — NO PHI */
    inputSummary: text('input_summary').notNull(),

    /** Summary of output from this layer — NO PHI */
    outputSummary: text('output_summary').notNull(),

    /** Evaluation duration in milliseconds */
    durationMs: integer('duration_ms').notNull(),

    /** Score produced by this layer (0.0-1.0) */
    score: real('score').notNull(),

    /** Confidence of this layer's output (0.0-1.0) */
    confidence: real('confidence').notNull(),

    /** The action selected after this layer */
    actionSelected: varchar('action_selected', { length: 100 }).notNull(),

    /** Additional metadata (NO PHI) */
    metadata: jsonb('metadata').notNull().default('{}'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('decision_audit_tenant_customer_idx').on(
      table.tenantId,
      table.customerId,
    ),
    index('decision_audit_tenant_created_at_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    index('decision_audit_decision_id_idx').on(
      table.decisionId,
    ),
  ],
);
