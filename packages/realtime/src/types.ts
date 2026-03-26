/**
 * @ordr/realtime — Type definitions for SSE-based real-time layer
 *
 * SOC2 CC6.1 — All SSE connections are tenant-scoped and authenticated.
 * ISO 27001 A.13.1.1 — Network controls: SSE over HTTPS only.
 * HIPAA §164.312(e) — Transmission security for event payloads.
 *
 * PHI MUST be tokenized in event payloads — never plaintext.
 * All event emissions are audit-logged.
 */

// ─── Event Categories ──────────────────────────────────────────

export const EVENT_CATEGORIES = [
  'customer',
  'workflow',
  'agent',
  'notification',
  'billing',
  'system',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

// ─── Real-Time Event ────────────────────────────────────────────

export interface RealtimeEvent {
  /** Unique event identifier */
  readonly id: string;
  /** Tenant scope (REQUIRED — no cross-tenant leaks) */
  readonly tenantId: string;
  /** Event category for routing */
  readonly category: EventCategory;
  /** Specific event type (e.g., "customer.updated", "workflow.step_completed") */
  readonly type: string;
  /** Event payload (MUST NOT contain plaintext PHI) */
  readonly data: Readonly<Record<string, unknown>>;
  /** ISO 8601 timestamp */
  readonly timestamp: string;
  /** Optional: target specific user IDs (empty = broadcast to tenant) */
  readonly targetUserIds?: readonly string[];
}

// ─── Channel Subscription ───────────────────────────────────────

export interface ChannelSubscription {
  /** Unique subscription ID */
  readonly id: string;
  /** Tenant ID (from authenticated JWT) */
  readonly tenantId: string;
  /** User ID (from authenticated JWT) */
  readonly userId: string;
  /** Event categories subscribed to */
  readonly categories: readonly EventCategory[];
  /** When the subscription was created */
  readonly connectedAt: Date;
  /** Last heartbeat/keep-alive timestamp */
  readonly lastHeartbeatAt: Date;
}

// ─── SSE Connection ─────────────────────────────────────────────

export interface SSEConnection {
  /** Subscription metadata */
  readonly subscription: ChannelSubscription;
  /** Send an event to this connection */
  readonly send: (event: RealtimeEvent) => void;
  /** Close this connection */
  readonly close: () => void;
  /** Whether the connection is still open */
  readonly isOpen: boolean;
}

// ─── Channel Stats ──────────────────────────────────────────────

export interface ChannelStats {
  readonly totalConnections: number;
  readonly connectionsByTenant: Readonly<Record<string, number>>;
  readonly eventsSent: number;
  readonly eventsDropped: number;
  readonly uptime: number;
}

// ─── Publisher Options ──────────────────────────────────────────

export interface PublishOptions {
  /** Target specific user IDs (empty = broadcast to tenant) */
  readonly targetUserIds?: readonly string[];
  /** Event categories to filter on */
  readonly categories?: readonly EventCategory[];
}
