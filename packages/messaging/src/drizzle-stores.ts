/**
 * Drizzle-backed persistence for internal enterprise messaging.
 *
 * Replaces InMemoryChannelStore and InMemoryMessageStore with
 * PostgreSQL-backed equivalents so chat data survives pod restarts.
 *
 * SOC2 CC6.3 — All queries are tenant-scoped; no cross-tenant reads.
 * ISO 27001 A.8.3.1 — Message retention at the DB level.
 * HIPAA §164.312(b) — Audit controls: messages are soft-deleted only.
 *
 * SECURITY:
 * - tenantId is ALWAYS part of every WHERE clause.
 * - JSONB columns (reactions, readBy, etc.) are typed via interface casts
 *   after schema-validated writes at the HTTP layer.
 * - Full-text search uses pg_trgm via the GIN index on chat_messages.content.
 */

import { eq, and, desc, lt, sql, ilike } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import type { ChannelStore } from './channel-manager.js';
import type { MessageStore } from './message-store.js';
import type { ChatChannel, ChatMessage, MessageAttachment, PaginatedMessages } from './types.js';

// ─── Row mappers ─────────────────────────────────────────────────

function rowToChannel(row: typeof schema.chatChannels.$inferSelect): ChatChannel {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    type: row.type as ChatChannel['type'],
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.topic !== null ? { topic: row.topic } : {}),
    memberIds: row.memberIds as string[],
    adminIds: row.adminIds as string[],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isArchived: row.isArchived,
    isPinned: row.isPinned,
    ...(row.metadata !== null ? { metadata: row.metadata as Record<string, unknown> } : {}),
  };
}

function rowToMessage(row: typeof schema.chatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    tenantId: row.tenantId,
    senderId: row.senderId,
    senderName: row.senderName,
    content: row.content,
    contentType: row.contentType as ChatMessage['contentType'],
    attachments: row.attachments as MessageAttachment[],
    ...(row.replyToId !== null ? { replyToId: row.replyToId } : {}),
    ...(row.threadId !== null ? { threadId: row.threadId } : {}),
    threadReplyCount: row.threadReplyCount,
    mentions: row.mentions as string[],
    reactions: row.reactions as Record<string, readonly string[]>,
    readBy: row.readBy as Record<string, string>,
    isSystemMessage: row.isSystemMessage,
    ...(row.metadata !== null ? { metadata: row.metadata as Record<string, unknown> } : {}),
    ...(row.editedAt !== null ? { editedAt: row.editedAt } : {}),
    ...(row.deletedAt !== null ? { deletedAt: row.deletedAt } : {}),
    createdAt: row.createdAt,
  };
}

// ─── DrizzleChannelStore ─────────────────────────────────────────

export class DrizzleChannelStore implements ChannelStore {
  constructor(private readonly db: OrdrDatabase) {}

  async get(id: string, tenantId: string): Promise<ChatChannel | undefined> {
    const rows = await this.db
      .select()
      .from(schema.chatChannels)
      .where(and(eq(schema.chatChannels.id, id), eq(schema.chatChannels.tenantId, tenantId)))
      .limit(1);
    return rows[0] !== undefined ? rowToChannel(rows[0]) : undefined;
  }

  async list(tenantId: string, userId: string): Promise<ChatChannel[]> {
    // Return channels the user is a member of OR public/announcement channels.
    // JSONB array containment: member_ids @> '["userId"]'
    const rows = await this.db
      .select()
      .from(schema.chatChannels)
      .where(
        and(eq(schema.chatChannels.tenantId, tenantId), eq(schema.chatChannels.isArchived, false)),
      )
      .orderBy(desc(schema.chatChannels.updatedAt));

    // Filter in-process: public/announcement always visible; private/direct only if member
    return rows
      .map(rowToChannel)
      .filter(
        (ch) => ch.type === 'public' || ch.type === 'announcement' || ch.memberIds.includes(userId),
      );
  }

  async create(channel: ChatChannel): Promise<ChatChannel> {
    await this.db.insert(schema.chatChannels).values({
      id: channel.id,
      tenantId: channel.tenantId,
      name: channel.name,
      type: channel.type,
      description: channel.description ?? null,
      topic: channel.topic ?? null,
      memberIds: channel.memberIds as unknown,
      adminIds: channel.adminIds as unknown,
      createdBy: channel.createdBy,
      isArchived: channel.isArchived,
      isPinned: channel.isPinned,
      metadata: (channel.metadata as unknown) ?? null,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    });
    return channel;
  }

  async update(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        ChatChannel,
        'name' | 'description' | 'topic' | 'isArchived' | 'isPinned' | 'memberIds' | 'adminIds'
      >
    >,
  ): Promise<ChatChannel | undefined> {
    const set: Partial<typeof schema.chatChannels.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (patch.name !== undefined) set.name = patch.name;
    if ('description' in patch) set.description = patch.description ?? null;
    if ('topic' in patch) set.topic = patch.topic ?? null;
    if (patch.isArchived !== undefined) set.isArchived = patch.isArchived;
    if (patch.isPinned !== undefined) set.isPinned = patch.isPinned;
    if (patch.memberIds !== undefined) set.memberIds = patch.memberIds as unknown;
    if (patch.adminIds !== undefined) set.adminIds = patch.adminIds as unknown;

    await this.db
      .update(schema.chatChannels)
      .set(set)
      .where(and(eq(schema.chatChannels.id, id), eq(schema.chatChannels.tenantId, tenantId)));

    return this.get(id, tenantId);
  }

  async addMember(channelId: string, tenantId: string, userId: string): Promise<void> {
    // Atomic append using PostgreSQL JSONB concatenation if not already present
    await this.db.execute(
      sql`UPDATE chat_channels
          SET member_ids = member_ids || ${JSON.stringify([userId])}::jsonb,
              updated_at = NOW()
          WHERE id = ${channelId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND NOT (member_ids @> ${JSON.stringify([userId])}::jsonb)`,
    );
  }

  async removeMember(channelId: string, tenantId: string, userId: string): Promise<void> {
    // Remove userId from the JSONB array using a subquery filter
    await this.db.execute(
      sql`UPDATE chat_channels
          SET member_ids = (
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements_text(member_ids) AS elem
            WHERE elem != ${userId}
          ),
          updated_at = NOW()
          WHERE id = ${channelId}::uuid
            AND tenant_id = ${tenantId}::uuid`,
    );
  }

  async delete(id: string, tenantId: string): Promise<void> {
    await this.db
      .delete(schema.chatChannels)
      .where(and(eq(schema.chatChannels.id, id), eq(schema.chatChannels.tenantId, tenantId)));
  }

  async findDirect(
    tenantId: string,
    userIdA: string,
    userIdB: string,
  ): Promise<ChatChannel | undefined> {
    const rows = await this.db
      .select()
      .from(schema.chatChannels)
      .where(
        and(
          eq(schema.chatChannels.tenantId, tenantId),
          eq(schema.chatChannels.type, 'direct'),
          // Both users must be in memberIds, and the channel must have exactly 2 members
          sql`${schema.chatChannels.memberIds} @> ${JSON.stringify([userIdA])}::jsonb`,
          sql`${schema.chatChannels.memberIds} @> ${JSON.stringify([userIdB])}::jsonb`,
          sql`jsonb_array_length(${schema.chatChannels.memberIds}) = 2`,
        ),
      )
      .limit(1);
    return rows[0] !== undefined ? rowToChannel(rows[0]) : undefined;
  }
}

// ─── DrizzleMessageStore ─────────────────────────────────────────

export class DrizzleMessageStore implements MessageStore {
  constructor(private readonly db: OrdrDatabase) {}

  async save(message: ChatMessage): Promise<ChatMessage> {
    await this.db.insert(schema.chatMessages).values({
      id: message.id,
      channelId: message.channelId,
      tenantId: message.tenantId,
      senderId: message.senderId,
      senderName: message.senderName,
      content: message.content,
      contentType: message.contentType,
      attachments: message.attachments as unknown,
      replyToId: message.replyToId ?? null,
      threadId: message.threadId ?? null,
      threadReplyCount: message.threadReplyCount ?? 0,
      mentions: message.mentions as unknown,
      reactions: message.reactions as unknown,
      readBy: message.readBy as unknown,
      isSystemMessage: message.isSystemMessage,
      metadata: (message.metadata as unknown) ?? null,
      editedAt: message.editedAt ?? null,
      deletedAt: message.deletedAt ?? null,
      createdAt: message.createdAt,
    });
    return message;
  }

  async get(id: string, tenantId: string): Promise<ChatMessage | undefined> {
    const rows = await this.db
      .select()
      .from(schema.chatMessages)
      .where(and(eq(schema.chatMessages.id, id), eq(schema.chatMessages.tenantId, tenantId)))
      .limit(1);
    return rows[0] !== undefined ? rowToMessage(rows[0]) : undefined;
  }

  async list(
    channelId: string,
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedMessages> {
    // Cursor = message ID; fetch messages created before that message
    let cursorDate: Date | undefined;
    if (cursor !== undefined) {
      const cursorRow = await this.get(cursor, tenantId);
      cursorDate = cursorRow?.createdAt;
    }

    const rows = await this.db
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.channelId, channelId),
          eq(schema.chatMessages.tenantId, tenantId),
          cursorDate !== undefined ? lt(schema.chatMessages.createdAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(schema.chatMessages.createdAt))
      .limit(limit + 1); // fetch one extra to determine hasMore

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(rowToMessage);
    const lastMsg = page[page.length - 1];

    return {
      messages: page,
      hasMore,
      ...(lastMsg !== undefined && hasMore ? { cursor: lastMsg.id } : {}),
    };
  }

  async update(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<ChatMessage, 'content' | 'editedAt' | 'deletedAt' | 'reactions' | 'readBy'>
    >,
  ): Promise<ChatMessage | undefined> {
    const set: Partial<typeof schema.chatMessages.$inferInsert> = {};
    if (patch.content !== undefined) set.content = patch.content;
    if ('editedAt' in patch) set.editedAt = patch.editedAt ?? null;
    if ('deletedAt' in patch) set.deletedAt = patch.deletedAt ?? null;
    if (patch.reactions !== undefined) set.reactions = patch.reactions as unknown;
    if (patch.readBy !== undefined) set.readBy = patch.readBy as unknown;

    if (Object.keys(set).length === 0) return this.get(id, tenantId);

    await this.db
      .update(schema.chatMessages)
      .set(set)
      .where(and(eq(schema.chatMessages.id, id), eq(schema.chatMessages.tenantId, tenantId)));

    return this.get(id, tenantId);
  }

  async countUnread(
    channelId: string,
    tenantId: string,
    userId: string,
    since: Date,
  ): Promise<number> {
    // Count messages the user hasn't read: NOT in readBy map AND created after since
    const [row] = await this.db.execute<{ cnt: string }>(
      sql`SELECT COUNT(*) as cnt
          FROM chat_messages
          WHERE channel_id = ${channelId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND sender_id != ${userId}::uuid
            AND created_at >= ${since.toISOString()}
            AND deleted_at IS NULL
            AND NOT (read_by ? ${userId})`,
    );
    return row !== undefined ? Number(row.cnt) : 0;
  }

  async search(tenantId: string, query: string, channelIds?: string[]): Promise<ChatMessage[]> {
    // Use pg_trgm-based ilike for search (simpler than plainto_tsquery; avoids syntax errors)
    const rows = await this.db
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.tenantId, tenantId),
          ilike(schema.chatMessages.content, `%${query}%`),
          // Only search non-deleted messages
          sql`${schema.chatMessages.deletedAt} IS NULL`,
          channelIds !== undefined && channelIds.length > 0
            ? sql`${schema.chatMessages.channelId} = ANY(${channelIds}::uuid[])`
            : undefined,
        ),
      )
      .orderBy(desc(schema.chatMessages.createdAt))
      .limit(50);

    return rows.map(rowToMessage);
  }
}
