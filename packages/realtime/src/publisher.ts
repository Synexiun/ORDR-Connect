/**
 * @ordr/realtime — Event Publisher
 *
 * High-level API for publishing real-time events to connected clients.
 * Wraps the ChannelManager and adds event construction, validation,
 * and optional audit logging.
 *
 * SOC2 CC7.2 — All published events can be audit-logged.
 * ISO 27001 A.12.4.1 — Event logging for real-time operations.
 * HIPAA §164.312(c) — Integrity controls on event payloads.
 */

import { randomUUID } from 'node:crypto';
import type { ChannelManager } from './channels.js';
import type {
  EventCategory,
  RealtimeEvent,
  PublishOptions,
} from './types.js';
import { EVENT_CATEGORIES } from './types.js';

// ─── Audit Logger Interface ─────────────────────────────────────

export interface RealtimeAuditLogger {
  log(entry: {
    readonly eventType: string;
    readonly tenantId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }): Promise<void>;
}

// ─── Event Publisher ────────────────────────────────────────────

export class EventPublisher {
  private readonly channelManager: ChannelManager;
  private readonly auditLogger: RealtimeAuditLogger | undefined;

  constructor(channelManager: ChannelManager, auditLogger?: RealtimeAuditLogger) {
    this.channelManager = channelManager;
    this.auditLogger = auditLogger;
  }

  /**
   * Publish an event to all matching connections within a tenant.
   *
   * @param tenantId - Tenant scope (REQUIRED)
   * @param category - Event category
   * @param type - Specific event type string
   * @param data - Event payload (MUST NOT contain plaintext PHI)
   * @param options - Optional: target user IDs, etc.
   * @returns Number of connections that received the event
   */
  async publish(
    tenantId: string,
    category: EventCategory,
    type: string,
    data: Readonly<Record<string, unknown>>,
    options?: PublishOptions,
  ): Promise<number> {
    this.validateTenantId(tenantId);
    this.validateCategory(category);

    const event: RealtimeEvent = {
      id: randomUUID(),
      tenantId,
      category,
      type,
      data,
      timestamp: new Date().toISOString(),
      targetUserIds: options?.targetUserIds,
    };

    const delivered = this.channelManager.publish(event);

    if (this.auditLogger) {
      await this.auditLogger.log({
        eventType: 'realtime.event_published',
        tenantId,
        resource: 'realtime_events',
        resourceId: event.id,
        action: 'publish',
        details: {
          category,
          type,
          delivered,
          targetUserIds: options?.targetUserIds ?? [],
        },
        timestamp: new Date(),
      });
    }

    return delivered;
  }

  /**
   * Publish a pre-built RealtimeEvent directly.
   */
  async publishEvent(event: RealtimeEvent): Promise<number> {
    this.validateTenantId(event.tenantId);
    this.validateCategory(event.category);

    return this.channelManager.publish(event);
  }

  /**
   * Publish a notification event to specific users.
   */
  async notifyUsers(
    tenantId: string,
    userIds: readonly string[],
    type: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<number> {
    return this.publish(tenantId, 'notification', type, data, {
      targetUserIds: userIds,
    });
  }

  /**
   * Publish a system-wide event to all users in a tenant.
   */
  async broadcastToTenant(
    tenantId: string,
    type: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<number> {
    return this.publish(tenantId, 'system', type, data);
  }

  // ── Validation ────────────────────────────────────────────────

  private validateTenantId(tenantId: string): void {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new Error('[ORDR:Realtime] tenantId is required for all event publications');
    }
  }

  private validateCategory(category: EventCategory): void {
    if (!EVENT_CATEGORIES.includes(category)) {
      throw new Error(`[ORDR:Realtime] Invalid event category: ${category}`);
    }
  }
}
