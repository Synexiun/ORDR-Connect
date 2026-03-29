/**
 * Chat Message Store
 * Stores and retrieves chat messages with cursor-based pagination.
 * Messages are immutable after deletion (soft delete).
 *
 * SOC2 CC7.2 — Communications are logged for audit purposes.
 * HIPAA §164.312(b) — Audit controls on PHI access via messaging.
 */
import { randomUUID } from 'node:crypto';
import type { ChatMessage, SendMessageInput, PaginatedMessages } from './types.js';

export interface MessageStore {
  save(message: ChatMessage): Promise<ChatMessage>;
  get(id: string, tenantId: string): Promise<ChatMessage | undefined>;
  list(
    channelId: string,
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedMessages>;
  update(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<ChatMessage, 'content' | 'editedAt' | 'deletedAt' | 'reactions' | 'readBy'>
    >,
  ): Promise<ChatMessage | undefined>;
  countUnread(channelId: string, tenantId: string, userId: string, since: Date): Promise<number>;
  search(tenantId: string, query: string, channelIds?: string[]): Promise<ChatMessage[]>;
}

export class InMemoryMessageStore implements MessageStore {
  private readonly messages = new Map<string, ChatMessage>();
  private readonly channelIndex = new Map<string, string[]>(); // channelId -> messageId[]

  save(message: ChatMessage): Promise<ChatMessage> {
    this.messages.set(message.id, message);
    const idx = this.channelIndex.get(message.channelId) ?? [];
    idx.push(message.id);
    this.channelIndex.set(message.channelId, idx);
    return Promise.resolve(message);
  }

  get(id: string, tenantId: string): Promise<ChatMessage | undefined> {
    const msg = this.messages.get(id);
    return Promise.resolve(msg?.tenantId === tenantId ? msg : undefined);
  }

  list(
    channelId: string,
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedMessages> {
    const ids = this.channelIndex.get(channelId) ?? [];
    let allMessages = ids
      .map((id) => this.messages.get(id))
      .filter((m): m is ChatMessage => m !== undefined && m.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (cursor !== undefined) {
      const cursorIdx = allMessages.findIndex((m) => m.id === cursor);
      if (cursorIdx !== -1) allMessages = allMessages.slice(cursorIdx + 1);
    }

    const page = allMessages.slice(0, limit);
    const lastMsg = page[page.length - 1];
    return Promise.resolve({
      messages: page,
      hasMore: allMessages.length > limit,
      ...(lastMsg !== undefined ? { cursor: lastMsg.id } : {}),
    });
  }

  async update(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<ChatMessage, 'content' | 'editedAt' | 'deletedAt' | 'reactions' | 'readBy'>
    >,
  ): Promise<ChatMessage | undefined> {
    const msg = await this.get(id, tenantId);
    if (msg === undefined) return undefined;
    const updated: ChatMessage = { ...msg, ...patch };
    this.messages.set(id, updated);
    return updated;
  }

  countUnread(channelId: string, tenantId: string, userId: string, since: Date): Promise<number> {
    const ids = this.channelIndex.get(channelId) ?? [];
    let count = 0;
    for (const id of ids) {
      const msg = this.messages.get(id);
      if (msg === undefined || msg.tenantId !== tenantId || msg.senderId === userId) continue;
      if (msg.createdAt < since) continue;
      if (msg.readBy[userId] === undefined) count++;
    }
    return Promise.resolve(count);
  }

  search(tenantId: string, query: string, channelIds?: string[]): Promise<ChatMessage[]> {
    const lq = query.toLowerCase();
    const results: ChatMessage[] = [];
    for (const [, msg] of this.messages) {
      if (msg.tenantId !== tenantId || msg.deletedAt !== undefined) continue;
      if (channelIds !== undefined && !channelIds.includes(msg.channelId)) continue;
      if (msg.content.toLowerCase().includes(lq)) results.push(msg);
    }
    return Promise.resolve(
      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 50),
    );
  }
}

export class MessageService {
  constructor(private readonly store: MessageStore) {}

  async send(input: SendMessageInput): Promise<ChatMessage> {
    const now = new Date();
    // Detect @mentions — e.g. @userId patterns
    const mentionPattern = /@([a-f0-9-]{36})/g;
    const detectedMentions: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = mentionPattern.exec(input.content)) !== null) {
      const capture = m[1];
      if (capture !== undefined) detectedMentions.push(capture);
    }

    const message: ChatMessage = {
      id: randomUUID(),
      channelId: input.channelId,
      tenantId: input.tenantId,
      senderId: input.senderId,
      senderName: input.senderName,
      content: input.content,
      contentType: input.contentType ?? 'text',
      attachments: [],
      ...(input.replyToId !== undefined ? { replyToId: input.replyToId } : {}),
      mentions: [...new Set([...(input.mentions ?? []), ...detectedMentions])],
      reactions: {},
      readBy: { [input.senderId]: now.toISOString() },
      isSystemMessage: false,
      createdAt: now,
    };
    return this.store.save(message);
  }

  async edit(
    id: string,
    tenantId: string,
    requesterId: string,
    newContent: string,
  ): Promise<ChatMessage> {
    const msg = await this.store.get(id, tenantId);
    if (msg === undefined) throw new Error('Message not found');
    if (msg.senderId !== requesterId) throw new Error('Can only edit own messages');
    if (msg.deletedAt !== undefined) throw new Error('Cannot edit deleted message');
    const updated = await this.store.update(id, tenantId, {
      content: newContent,
      editedAt: new Date(),
    });
    if (updated === undefined) throw new Error('Update failed');
    return updated;
  }

  async delete(
    id: string,
    tenantId: string,
    requesterId: string,
    isAdmin = false,
  ): Promise<ChatMessage> {
    const msg = await this.store.get(id, tenantId);
    if (msg === undefined) throw new Error('Message not found');
    if (!isAdmin && msg.senderId !== requesterId) throw new Error('Can only delete own messages');
    const updated = await this.store.update(id, tenantId, {
      deletedAt: new Date(),
      content: '[Message deleted]',
    });
    if (updated === undefined) throw new Error('Delete failed');
    return updated;
  }

  async addReaction(
    messageId: string,
    tenantId: string,
    userId: string,
    emoji: string,
  ): Promise<ChatMessage> {
    const msg = await this.store.get(messageId, tenantId);
    if (msg === undefined) throw new Error('Message not found');
    const existing = msg.reactions[emoji] ?? [];
    const reactions = {
      ...msg.reactions,
      [emoji]: existing.includes(userId) ? existing : [...existing, userId],
    };
    const updated = await this.store.update(messageId, tenantId, { reactions });
    if (updated === undefined) throw new Error('Reaction update failed');
    return updated;
  }

  async removeReaction(
    messageId: string,
    tenantId: string,
    userId: string,
    emoji: string,
  ): Promise<ChatMessage> {
    const msg = await this.store.get(messageId, tenantId);
    if (msg === undefined) throw new Error('Message not found');
    const reactions = {
      ...msg.reactions,
      [emoji]: (msg.reactions[emoji] ?? []).filter((id) => id !== userId),
    };
    const updated = await this.store.update(messageId, tenantId, { reactions });
    if (updated === undefined) throw new Error('Reaction update failed');
    return updated;
  }

  async markRead(
    channelId: string,
    tenantId: string,
    userId: string,
    messageIds: string[],
  ): Promise<void> {
    const readAt = new Date().toISOString();
    await Promise.all(
      messageIds.map(async (id) => {
        const msg = await this.store.get(id, tenantId);
        if (msg !== undefined && msg.channelId === channelId) {
          await this.store.update(id, tenantId, { readBy: { ...msg.readBy, [userId]: readAt } });
        }
      }),
    );
  }

  async list(
    channelId: string,
    tenantId: string,
    limit = 50,
    cursor?: string,
  ): Promise<PaginatedMessages> {
    return this.store.list(channelId, tenantId, limit, cursor);
  }

  async search(tenantId: string, query: string, channelIds?: string[]): Promise<ChatMessage[]> {
    return this.store.search(tenantId, query, channelIds);
  }
}
