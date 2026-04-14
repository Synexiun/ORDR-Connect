import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const channelTypeEnum = pgEnum('channel_type', [
  'public',
  'private',
  'direct',
  'announcement',
  'thread',
]);

// ---------------------------------------------------------------------------
// Table
//
// Internal enterprise messaging channels.
// SOC2 CC6.3 — Logical access: tenant isolation via tenant_id.
// ISO 27001 A.8.3.1 — Message retention governed per-tenant policy.
// HIPAA §164.312(a)(1) — Access controls prevent cross-tenant reads.
// ---------------------------------------------------------------------------

export const chatChannels = pgTable(
  'chat_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 255 }).notNull(),

    type: channelTypeEnum('type').notNull().default('public'),

    description: text('description'),

    topic: text('topic'),

    /** JSON array of user UUIDs who are members of this channel. */
    memberIds: jsonb('member_ids').notNull().default([]),

    /** JSON array of user UUIDs with admin rights. */
    adminIds: jsonb('admin_ids').notNull().default([]),

    createdBy: uuid('created_by').notNull(),

    isArchived: boolean('is_archived').notNull().default(false),

    isPinned: boolean('is_pinned').notNull().default(false),

    /** Arbitrary channel metadata (e.g. linked customer ID, integration refs). */
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_channels_tenant_archived_idx').on(table.tenantId, table.isArchived),
    index('chat_channels_tenant_type_idx').on(table.tenantId, table.type),
  ],
);
