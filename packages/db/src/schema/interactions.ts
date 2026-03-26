import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  real,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const channelEnum = pgEnum('channel', [
  'email',
  'sms',
  'voice',
  'ivr',
  'slack',
  'chat',
  'calendar',
  'webhook',
]);

export const directionEnum = pgEnum('direction', [
  'inbound',
  'outbound',
]);

export const interactionTypeEnum = pgEnum('interaction_type', [
  'message',
  'call',
  'meeting',
  'note',
  'task',
  'system',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const interactions = pgTable(
  'interactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    /** null if agent-initiated (no human operator) */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    /** null if human-initiated (no AI agent) */
    agentId: varchar('agent_id', { length: 255 }),

    channel: channelEnum('channel').notNull(),

    direction: directionEnum('direction').notNull(),

    type: interactionTypeEnum('type').notNull(),

    subject: text('subject'),

    /** ENCRYPTED -- may contain PHI (Protected Health Information) */
    content: text('content'),

    /** SHA-256 of original content for integrity verification */
    contentHash: text('content_hash'),

    /** Sentiment score: -1.0 (negative) to 1.0 (positive) */
    sentiment: real('sentiment'),

    metadata: jsonb('metadata').default('{}'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('interactions_tenant_customer_idx').on(table.tenantId, table.customerId),
    index('interactions_tenant_created_at_idx').on(table.tenantId, table.createdAt),
  ],
);
