import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { chatChannels } from './chat-channels.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const messageContentTypeEnum = pgEnum('message_content_type', [
  'text',
  'markdown',
  'file',
  'image',
  'system',
  'code',
]);

// ---------------------------------------------------------------------------
// Table
//
// Internal enterprise chat messages.
//
// SECURITY (CLAUDE.md Rule 6):
// - Content is NOT encrypted at the application layer — messages are
//   INTERNAL operational data, not PHI. If PHI is shared via messaging,
//   the sender is in violation of policy (enforcement is out-of-band).
// - Row-level security enforced via tenant_id (see RLS policies).
// - deletedAt is a soft-delete — message content is replaced by [Message deleted]
//   in MessageService.delete() before persistence. The row itself is retained
//   for audit continuity.
// ---------------------------------------------------------------------------

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    channelId: uuid('channel_id')
      .notNull()
      .references(() => chatChannels.id, { onDelete: 'cascade' }),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    senderId: uuid('sender_id').notNull(),

    senderName: varchar('sender_name', { length: 255 }).notNull(),

    content: text('content').notNull(),

    contentType: messageContentTypeEnum('content_type').notNull().default('text'),

    /** JSON array of MessageAttachment objects. */
    attachments: jsonb('attachments').notNull().default([]),

    /** Reply-to parent message ID (optional, same channel). */
    replyToId: uuid('reply_to_id'),

    /** Thread root message ID (optional). */
    threadId: uuid('thread_id'),

    threadReplyCount: integer('thread_reply_count').notNull().default(0),

    /** JSON array of mentioned user UUIDs. */
    mentions: jsonb('mentions').notNull().default([]),

    /** JSON map: emoji → [userId, ...] */
    reactions: jsonb('reactions').notNull().default({}),

    /** JSON map: userId → ISO timestamp of last read. */
    readBy: jsonb('read_by').notNull().default({}),

    isSystemMessage: boolean('is_system_message').notNull().default(false),

    metadata: jsonb('metadata'),

    editedAt: timestamp('edited_at', { withTimezone: true }),

    /** Soft-delete — content replaced by '[Message deleted]' on delete. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Primary query: list channel messages ordered by time
    index('chat_messages_channel_created_idx').on(table.channelId, table.tenantId, table.createdAt),
    // Unread count queries
    index('chat_messages_tenant_sender_idx').on(table.tenantId, table.senderId),
    // Thread queries
    index('chat_messages_thread_idx').on(table.threadId),
  ],
);
