/**
 * Chat Channel Manager
 * Creates, manages, and archives chat channels.
 * Enforces tenant isolation and permission checks.
 *
 * SOC2 CC6.3 — Logical access controls on internal communications.
 * ISO 27001 A.8.3.1 — Management of removable media: message retention.
 */
import { randomUUID } from 'node:crypto';
import type { ChatChannel, CreateChannelInput } from './types.js';

export interface ChannelStore {
  get(id: string, tenantId: string): Promise<ChatChannel | undefined>;
  list(tenantId: string, userId: string): Promise<ChatChannel[]>;
  create(channel: ChatChannel): Promise<ChatChannel>;
  update(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        ChatChannel,
        'name' | 'description' | 'topic' | 'isArchived' | 'isPinned' | 'memberIds' | 'adminIds'
      >
    >,
  ): Promise<ChatChannel | undefined>;
  addMember(channelId: string, tenantId: string, userId: string): Promise<void>;
  removeMember(channelId: string, tenantId: string, userId: string): Promise<void>;
  delete(id: string, tenantId: string): Promise<void>;
  findDirect(tenantId: string, userIdA: string, userIdB: string): Promise<ChatChannel | undefined>;
}

export class InMemoryChannelStore implements ChannelStore {
  private readonly channels = new Map<string, ChatChannel>();

  get(id: string, tenantId: string): Promise<ChatChannel | undefined> {
    const ch = this.channels.get(id);
    return Promise.resolve(ch?.tenantId === tenantId ? ch : undefined);
  }

  list(tenantId: string, userId: string): Promise<ChatChannel[]> {
    const results: ChatChannel[] = [];
    for (const [, ch] of this.channels) {
      if (ch.tenantId !== tenantId || ch.isArchived) continue;
      if (ch.type === 'public' || ch.type === 'announcement' || ch.memberIds.includes(userId)) {
        results.push(ch);
      }
    }
    return Promise.resolve(results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
  }

  create(channel: ChatChannel): Promise<ChatChannel> {
    this.channels.set(channel.id, channel);
    return Promise.resolve(channel);
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
    const existing = await this.get(id, tenantId);
    if (existing === undefined) return undefined;
    const updated: ChatChannel = { ...existing, ...patch, updatedAt: new Date() };
    this.channels.set(id, updated);
    return updated;
  }

  async addMember(channelId: string, tenantId: string, userId: string): Promise<void> {
    const ch = await this.get(channelId, tenantId);
    if (ch === undefined) return;
    if (!ch.memberIds.includes(userId)) {
      await this.update(channelId, tenantId, { memberIds: [...ch.memberIds, userId] });
    }
  }

  async removeMember(channelId: string, tenantId: string, userId: string): Promise<void> {
    const ch = await this.get(channelId, tenantId);
    if (ch === undefined) return;
    await this.update(channelId, tenantId, {
      memberIds: ch.memberIds.filter((id) => id !== userId),
    });
  }

  delete(id: string, tenantId: string): Promise<void> {
    const ch = this.channels.get(id);
    if (ch?.tenantId === tenantId) this.channels.delete(id);
    return Promise.resolve();
  }

  findDirect(tenantId: string, userIdA: string, userIdB: string): Promise<ChatChannel | undefined> {
    for (const [, ch] of this.channels) {
      if (ch.tenantId !== tenantId || ch.type !== 'direct') continue;
      if (
        ch.memberIds.includes(userIdA) &&
        ch.memberIds.includes(userIdB) &&
        ch.memberIds.length === 2
      ) {
        return Promise.resolve(ch);
      }
    }
    return Promise.resolve(undefined);
  }
}

export class ChannelManager {
  constructor(private readonly store: ChannelStore) {}

  async create(input: CreateChannelInput): Promise<ChatChannel> {
    // For direct channels, check if one already exists
    if (input.type === 'direct' && input.memberIds.length === 2) {
      const [memberA, memberB] = input.memberIds;
      if (memberA !== undefined && memberB !== undefined) {
        const existing = await this.store.findDirect(input.tenantId, memberA, memberB);
        if (existing !== undefined) return existing;
      }
    }
    const now = new Date();
    const channel: ChatChannel = {
      id: randomUUID(),
      tenantId: input.tenantId,
      name: input.name,
      type: input.type,
      ...(input.description !== undefined ? { description: input.description } : {}),
      memberIds: [...new Set([...input.memberIds, input.createdBy])],
      adminIds: [input.createdBy],
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      isPinned: false,
    };
    return this.store.create(channel);
  }

  async getForUser(tenantId: string, userId: string): Promise<ChatChannel[]> {
    return this.store.list(tenantId, userId);
  }

  async get(id: string, tenantId: string): Promise<ChatChannel | undefined> {
    return this.store.get(id, tenantId);
  }

  async addMember(
    channelId: string,
    tenantId: string,
    userId: string,
    requesterId: string,
  ): Promise<void> {
    const ch = await this.store.get(channelId, tenantId);
    if (ch === undefined) throw new Error('Channel not found');
    if (!ch.adminIds.includes(requesterId)) throw new Error('Only admins can add members');
    await this.store.addMember(channelId, tenantId, userId);
  }

  async removeMember(
    channelId: string,
    tenantId: string,
    userId: string,
    requesterId: string,
  ): Promise<void> {
    const ch = await this.store.get(channelId, tenantId);
    if (ch === undefined) throw new Error('Channel not found');
    if (userId !== requesterId && !ch.adminIds.includes(requesterId))
      throw new Error('Insufficient permissions');
    await this.store.removeMember(channelId, tenantId, userId);
  }

  async archive(channelId: string, tenantId: string, requesterId: string): Promise<void> {
    const ch = await this.store.get(channelId, tenantId);
    if (ch === undefined) throw new Error('Channel not found');
    if (!ch.adminIds.includes(requesterId)) throw new Error('Only admins can archive channels');
    await this.store.update(channelId, tenantId, { isArchived: true });
  }
}
