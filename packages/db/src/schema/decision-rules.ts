import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Table
//
// Tenant-scoped decision rules for the Layer 1 Rules Engine.
// Rules define deterministic conditions and actions for the NBA pipeline.
// ---------------------------------------------------------------------------

export const decisionRules = pgTable(
  'decision_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: varchar('name', { length: 255 }).notNull(),

    description: text('description').notNull().default(''),

    /** Higher priority = evaluated first. Range: 1-100. */
    priority: integer('priority').notNull().default(50),

    /** JSON array of RuleCondition objects (AND logic). */
    conditions: jsonb('conditions').notNull(),

    /** JSON RuleAction object: { type, channel, parameters }. */
    action: jsonb('action').notNull(),

    /** Optional regulatory tie for audit traceability (e.g. 'fdcpa', 'tcpa'). */
    regulation: varchar('regulation', { length: 50 }),

    /** Whether this rule is active. Disabled rules are skipped during evaluation. */
    enabled: boolean('enabled').notNull().default(true),

    /** Terminal rules short-circuit the pipeline (skip ML + LLM). */
    terminal: boolean('terminal').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('decision_rules_tenant_enabled_priority_idx').on(
      table.tenantId,
      table.enabled,
      table.priority,
    ),
    index('decision_rules_tenant_regulation_idx').on(
      table.tenantId,
      table.regulation,
    ),
  ],
);
