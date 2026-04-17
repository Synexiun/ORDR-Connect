import {
  pgTable,
  uuid,
  varchar,
  real,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Table — decision_log
//
// One row per NBAPipeline.evaluate() call. Captures the final per-decision
// summary — outcome, layer reached, latency, confidence, and compliance gate
// results. The companion decision_audit table captures per-layer detail.
//
// CRITICAL: This table is WORM (Write Once, Read Many).
//   - UPDATE and DELETE are blocked by DB triggers.
//   - customerId stores the tokenized UUID — NEVER raw PII/PHI.
//
// SOC2 CC6.1 | ISO 27001 A.8.15 | HIPAA §164.312(b)
// ---------------------------------------------------------------------------

export const decisionLog = pgTable(
  'decision_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** NOT a foreign key — log records outlive tenant lifecycle */
    tenantId: uuid('tenant_id').notNull(),

    /** Tokenized customer reference — NO PHI */
    customerId: varchar('customer_id', { length: 255 }).notNull(),

    /**
     * Logical decision category.
     * Examples: 'nba' | 'compliance' | 'routing' | 'fraud'
     */
    decisionType: varchar('decision_type', { length: 50 }).notNull(),

    /**
     * Final outcome of the pipeline evaluation.
     * 'approved'   — action cleared compliance, returned to caller
     * 'rejected'   — compliance gate blocked the action
     * 'escalated'  — confidence < 0.7, routed to HITL queue
     * 'deferred'   — no viable action found, decision deferred
     */
    outcome: varchar('outcome', { length: 20 }).notNull(),

    /**
     * Which layer produced the final decision.
     * 'rules'       — Layer 1 terminal rule match
     * 'ml_scorer'   — Layer 2 ML scoring (confidence ≥ 0.8)
     * 'llm_reasoner'— Layer 3 LLM reasoning
     */
    layerReached: varchar('layer_reached', { length: 20 }).notNull(),

    /** The action selected (e.g. 'send_sms', 'escalate_to_human') */
    actionSelected: varchar('action_selected', { length: 100 }).notNull(),

    /** Final composite confidence score (0.0–1.0) */
    confidence: real('confidence').notNull(),

    /** Total pipeline wall-clock duration in milliseconds */
    latencyMs: integer('latency_ms').notNull(),

    /**
     * Compliance-safe reasoning summary — no PHI, customer IDs only.
     * Derived from the winning layer's output.
     */
    reasoning: varchar('reasoning', { length: 1000 }).notNull().default(''),

    /**
     * ID of the rule that fired (Layer 1 only). Null for ML/LLM decisions.
     * References decision_rules.id — stored as string, not FK (rules can be deleted).
     */
    ruleId: uuid('rule_id'),

    /** Actor who triggered the evaluation (user ID or agent ID) */
    actorId: varchar('actor_id', { length: 255 }).notNull().default('system'),

    /** Per-gate compliance results: [{ruleId, regulation, passed}] */
    complianceGates: jsonb('compliance_gates').notNull().default('[]'),

    /** References to decision_audit rows for this decision */
    auditEntryIds: jsonb('audit_entry_ids').notNull().default('[]'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('decision_log_tenant_created_at_idx').on(table.tenantId, table.createdAt),
    index('decision_log_tenant_type_idx').on(table.tenantId, table.decisionType),
    index('decision_log_tenant_outcome_idx').on(table.tenantId, table.outcome),
    index('decision_log_customer_idx').on(table.customerId),
  ],
);
