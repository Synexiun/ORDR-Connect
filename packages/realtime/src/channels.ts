/**
 * @ordr/realtime — Channel Manager
 *
 * Manages tenant-scoped SSE channels with connection tracking,
 * heartbeats, and automatic cleanup of stale connections.
 *
 * SOC2 CC6.1 — Strict tenant isolation on all channels.
 * ISO 27001 A.9.4.1 — Access restrictions per authenticated session.
 * HIPAA §164.312(d) — Entity authentication for SSE connections.
 *
 * CRITICAL: Events MUST NEVER leak between tenants.
 * Each connection is scoped to (tenantId, userId) from the JWT.
 */

import { randomUUID } from 'node:crypto';
import type {
  EventCategory,
  RealtimeEvent,
  ChannelSubscription,
  SSEConnection,
  ChannelStats,
} from './types.js';

// ─── Connection State ───────────────────────────────────────────

interface ManagedConnection {
  subscription: ChannelSubscription;
  sendFn: (event: RealtimeEvent) => void;
  closeFn: () => void;
  isOpen: boolean;
}

// ─── Channel Manager ────────────────────────────────────────────

export class ChannelManager {
  /** Map: tenantId → Map<subscriptionId → ManagedConnection> */
  private readonly tenantChannels = new Map<string, Map<string, ManagedConnection>>();
  private eventsSent = 0;
  private eventsDropped = 0;
  private readonly startedAt = Date.now();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Heartbeat timeout — connections without heartbeat for this long are pruned */
  private readonly heartbeatTimeoutMs: number;

  constructor(heartbeatTimeoutMs = 60_000) {
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
  }

  /**
   * Register a new SSE connection for a tenant/user.
   * Returns a ChannelSubscription for tracking.
   */
  addConnection(
    tenantId: string,
    userId: string,
    categories: readonly EventCategory[],
    sendFn: (event: RealtimeEvent) => void,
    closeFn: () => void,
  ): ChannelSubscription {
    const subscription: ChannelSubscription = {
      id: randomUUID(),
      tenantId,
      userId,
      categories: categories.length > 0 ? categories : ['customer', 'workflow', 'agent', 'notification', 'billing', 'system'],
      connectedAt: new Date(),
      lastHeartbeatAt: new Date(),
    };

    if (!this.tenantChannels.has(tenantId)) {
      this.tenantChannels.set(tenantId, new Map());
    }

    const tenantMap = this.tenantChannels.get(tenantId)!;
    tenantMap.set(subscription.id, {
      subscription,
      sendFn,
      closeFn,
      isOpen: true,
    });

    return subscription;
  }

  /**
   * Remove a connection by subscription ID.
   */
  removeConnection(tenantId: string, subscriptionId: string): boolean {
    const tenantMap = this.tenantChannels.get(tenantId);
    if (!tenantMap) return false;

    const conn = tenantMap.get(subscriptionId);
    if (!conn) return false;

    conn.isOpen = false;
    conn.closeFn();
    tenantMap.delete(subscriptionId);

    if (tenantMap.size === 0) {
      this.tenantChannels.delete(tenantId);
    }

    return true;
  }

  /**
   * Update heartbeat for a connection.
   */
  heartbeat(tenantId: string, subscriptionId: string): boolean {
    const tenantMap = this.tenantChannels.get(tenantId);
    if (!tenantMap) return false;

    const conn = tenantMap.get(subscriptionId);
    if (!conn || !conn.isOpen) return false;

    conn.subscription = {
      ...conn.subscription,
      lastHeartbeatAt: new Date(),
    };

    return true;
  }

  /**
   * Publish an event to all matching connections within a tenant.
   * CRITICAL: NEVER broadcasts across tenants.
   *
   * @param event - The event to publish
   * @returns Number of connections that received the event
   */
  publish(event: RealtimeEvent): number {
    const tenantMap = this.tenantChannels.get(event.tenantId);
    if (!tenantMap) return 0;

    let delivered = 0;

    for (const conn of tenantMap.values()) {
      if (!conn.isOpen) continue;

      // Category filter
      if (!conn.subscription.categories.includes(event.category)) continue;

      // Target user filter
      if (event.targetUserIds !== undefined && event.targetUserIds.length > 0) {
        if (!event.targetUserIds.includes(conn.subscription.userId)) continue;
      }

      try {
        conn.sendFn(event);
        delivered++;
        this.eventsSent++;
      } catch {
        this.eventsDropped++;
        // Mark as closed on send failure
        conn.isOpen = false;
      }
    }

    return delivered;
  }

  /**
   * Get all active connections for a tenant.
   */
  getConnections(tenantId: string): readonly SSEConnection[] {
    const tenantMap = this.tenantChannels.get(tenantId);
    if (!tenantMap) return [];

    const connections: SSEConnection[] = [];
    for (const conn of tenantMap.values()) {
      if (!conn.isOpen) continue;
      connections.push({
        subscription: conn.subscription,
        send: conn.sendFn,
        close: conn.closeFn,
        isOpen: conn.isOpen,
      });
    }
    return connections;
  }

  /**
   * Get connection count for a specific tenant.
   */
  getConnectionCount(tenantId: string): number {
    const tenantMap = this.tenantChannels.get(tenantId);
    if (!tenantMap) return 0;

    let count = 0;
    for (const conn of tenantMap.values()) {
      if (conn.isOpen) count++;
    }
    return count;
  }

  /**
   * Get overall channel statistics.
   */
  getStats(): ChannelStats {
    const connectionsByTenant: Record<string, number> = {};
    let totalConnections = 0;

    for (const [tenantId, tenantMap] of this.tenantChannels) {
      let count = 0;
      for (const conn of tenantMap.values()) {
        if (conn.isOpen) count++;
      }
      if (count > 0) {
        connectionsByTenant[tenantId] = count;
        totalConnections += count;
      }
    }

    return {
      totalConnections,
      connectionsByTenant,
      eventsSent: this.eventsSent,
      eventsDropped: this.eventsDropped,
      uptime: Date.now() - this.startedAt,
    };
  }

  /**
   * Prune stale connections that haven't sent a heartbeat.
   */
  pruneStaleConnections(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [tenantId, tenantMap] of this.tenantChannels) {
      for (const [subId, conn] of tenantMap) {
        if (!conn.isOpen) {
          tenantMap.delete(subId);
          pruned++;
          continue;
        }

        const elapsed = now - conn.subscription.lastHeartbeatAt.getTime();
        if (elapsed > this.heartbeatTimeoutMs) {
          conn.isOpen = false;
          conn.closeFn();
          tenantMap.delete(subId);
          pruned++;
        }
      }

      if (tenantMap.size === 0) {
        this.tenantChannels.delete(tenantId);
      }
    }

    return pruned;
  }

  /**
   * Start periodic cleanup of stale connections.
   */
  startCleanup(intervalMs = 30_000): void {
    this.stopCleanup();
    this.cleanupInterval = setInterval(() => {
      this.pruneStaleConnections();
    }, intervalMs);
  }

  /**
   * Stop periodic cleanup.
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Close all connections and reset state.
   */
  closeAll(): void {
    this.stopCleanup();
    for (const tenantMap of this.tenantChannels.values()) {
      for (const conn of tenantMap.values()) {
        if (conn.isOpen) {
          conn.isOpen = false;
          conn.closeFn();
        }
      }
    }
    this.tenantChannels.clear();
  }
}
