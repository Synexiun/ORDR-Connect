import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { customers } from './customers.js';
import { contacts, contactChannelEnum } from './contacts.js';
import { agentSessions } from './agent-sessions.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const messageDirectionEnum = pgEnum('message_direction', [
  'inbound',
  'outbound',
]);

export const messageStatusEnum = pgEnum('message_status', [
  'pending',
  'queued',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'opted_out',
  'retrying',
  'dlq',
]);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),

    /** null if message was sent manually (not by an agent) */
    agentSessionId: uuid('agent_session_id').references(() => agentSessions.id, {
      onDelete: 'set null',
    }),

    channel: contactChannelEnum('channel').notNull(),

    direction: messageDirectionEnum('direction').notNull(),

    status: messageStatusEnum('status').notNull().default('pending'),

    /**
     * Reference to encrypted content in object store.
     * NEVER store raw PHI in this column -- use content_ref as a pointer only.
     */
    contentRef: text('content_ref'),

    /** SHA-256 of original content for integrity verification */
    contentHash: varchar('content_hash', { length: 64 }),

    /** Provider message ID (Twilio SID, SendGrid ID, etc.) */
    providerMessageId: varchar('provider_message_id', { length: 255 }),

    /** Raw status string from the delivery provider */
    providerStatus: varchar('provider_status', { length: 50 }),

    attemptCount: integer('attempt_count').notNull().default(0),

    maxRetries: integer('max_retries').notNull().default(3),

    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),

    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),

    sentAt: timestamp('sent_at', { withTimezone: true }),

    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    failedAt: timestamp('failed_at', { withTimezone: true }),

    errorCode: varchar('error_code', { length: 50 }),

    errorMessage: text('error_message'),

    /** Provider cost in cents */
    costCents: integer('cost_cents'),

    metadata: jsonb('metadata').default('{}'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('messages_tenant_customer_idx').on(table.tenantId, table.customerId),
    index('messages_tenant_status_idx').on(table.tenantId, table.status),
    index('messages_tenant_channel_direction_idx').on(
      table.tenantId,
      table.channel,
      table.direction,
    ),
    index('messages_tenant_agent_session_idx').on(table.tenantId, table.agentSessionId),
    index('messages_provider_message_id_idx').on(table.providerMessageId),
  ],
);
