import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  real,
  boolean,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const agentActions = pgTable(
  'agent_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    agentId: varchar('agent_id', { length: 255 }).notNull(),

    agentRole: varchar('agent_role', { length: 100 }).notNull(),

    actionType: varchar('action_type', { length: 255 }).notNull(),

    input: jsonb('input').notNull(),

    output: jsonb('output'),

    /** Confidence score: 0.0 (no confidence) to 1.0 (fully confident) */
    confidence: real('confidence').notNull(),

    autonomyLevel: varchar('autonomy_level', { length: 50 }).notNull(),

    approved: boolean('approved'),

    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),

    approvedAt: timestamp('approved_at', { withTimezone: true }),

    /** Agent's reasoning chain for explainability / audit */
    reasoning: text('reasoning'),

    tokenCount: integer('token_count'),

    costUsd: real('cost_usd'),

    durationMs: integer('duration_ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_actions_tenant_id_idx').on(table.tenantId),
    index('agent_actions_agent_id_idx').on(table.tenantId, table.agentId),
    index('agent_actions_created_at_idx').on(table.tenantId, table.createdAt),
  ],
);
