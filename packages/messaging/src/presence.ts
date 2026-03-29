/**
 * Presence Manager
 * Tracks user online/offline/away status per tenant.
 * Status is ephemeral (in-memory). For production, use Redis.
 */
import type { PresenceRecord, PresenceStatus, TypingIndicator } from './types.js';

export class PresenceManager {
  private readonly presence = new Map<string, PresenceRecord>(); // userId:tenantId -> record
  private readonly typing = new Map<string, TypingIndicator>(); // userId:channelId -> indicator
  private readonly TYPING_TIMEOUT_MS = 5000;

  private key(userId: string, tenantId: string): string {
    return `${tenantId}:${userId}`;
  }

  setStatus(
    userId: string,
    tenantId: string,
    status: PresenceStatus,
    statusMessage?: string,
    activeChannelId?: string,
  ): PresenceRecord {
    const record: PresenceRecord = {
      userId,
      tenantId,
      status,
      lastSeen: new Date(),
      ...(statusMessage !== undefined ? { statusMessage } : {}),
      ...(activeChannelId !== undefined ? { activeChannelId } : {}),
    };
    this.presence.set(this.key(userId, tenantId), record);
    return record;
  }

  getStatus(userId: string, tenantId: string): PresenceRecord {
    return (
      this.presence.get(this.key(userId, tenantId)) ?? {
        userId,
        tenantId,
        status: 'offline' as const,
        lastSeen: new Date(0),
      }
    );
  }

  getOnlineUsers(tenantId: string): PresenceRecord[] {
    const results: PresenceRecord[] = [];
    for (const [, record] of this.presence) {
      if (
        record.tenantId === tenantId &&
        (record.status === 'online' || record.status === 'away')
      ) {
        results.push(record);
      }
    }
    return results;
  }

  markOffline(userId: string, tenantId: string): void {
    const existing = this.presence.get(this.key(userId, tenantId));
    if (existing !== undefined) {
      this.presence.set(this.key(userId, tenantId), {
        ...existing,
        status: 'offline',
        lastSeen: new Date(),
      });
    }
  }

  startTyping(channelId: string, userId: string, userName: string): void {
    this.typing.set(`${userId}:${channelId}`, {
      channelId,
      userId,
      userName,
      startedAt: Date.now(),
    });
  }

  stopTyping(channelId: string, userId: string): void {
    this.typing.delete(`${userId}:${channelId}`);
  }

  getTypingUsers(channelId: string): TypingIndicator[] {
    const now = Date.now();
    const results: TypingIndicator[] = [];
    for (const [, ind] of this.typing) {
      if (ind.channelId === channelId && now - ind.startedAt < this.TYPING_TIMEOUT_MS) {
        results.push(ind);
      }
    }
    return results;
  }

  purgeStaleTyping(): void {
    const now = Date.now();
    for (const [key, ind] of this.typing) {
      if (now - ind.startedAt >= this.TYPING_TIMEOUT_MS) this.typing.delete(key);
    }
  }
}
