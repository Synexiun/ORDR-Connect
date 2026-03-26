import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  real,
  jsonb,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const agentSessionStatusEnum = pgEnum('agent_session_status', [
  'active',
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);

export const autonomyLevelEnum = pgEnum('autonomy_level', [
  'rule_based',
  'router',
  'supervised',
  'autonomous',
  'full_autonomy',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Agent role identifier: 'collections', 'support_triage', etc. */
    agentRole: varchar('agent_role', { length: 50 }).notNull(),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    status: agentSessionStatusEnum('status').notNull().default('active'),

    autonomyLevel: autonomyLevelEnum('autonomy_level').notNull(),

    /** The Kafka event ID that triggered this session */
    triggerEventId: varchar('trigger_event_id', { length: 255 }),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),

    completedAt: timestamp('completed_at', { withTimezone: true }),

    totalActions: integer('total_actions').notNull().default(0),

    approvedActions: integer('approved_actions').notNull().default(0),

    rejectedActions: integer('rejected_actions').notNull().default(0),

    /** Total LLM cost for this session in cents */
    totalCostCents: integer('total_cost_cents').notNull().default(0),

    totalTokens: integer('total_tokens').notNull().default(0),

    /** Average confidence score across all actions in this session */
    confidenceAvg: real('confidence_avg'),

    /** Session outcome: 'payment_received', 'escalated', 'no_response', etc. */
    outcome: varchar('outcome', { length: 100 }),

    outcomeMetadata: jsonb('outcome_metadata').default('{}'),

    /** Error details if session failed */
    errorDetails: text('error_details'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_sessions_tenant_customer_idx').on(table.tenantId, table.customerId),
    index('agent_sessions_tenant_status_idx').on(table.tenantId, table.status),
    index('agent_sessions_tenant_role_idx').on(table.tenantId, table.agentRole),
    index('agent_sessions_tenant_started_at_idx').on(table.tenantId, table.startedAt),
  ],
);
