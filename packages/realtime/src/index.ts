/**
 * @ordr/realtime — Server-Sent Events Real-Time Layer
 *
 * Provides tenant-scoped real-time event streaming via SSE,
 * with channel management, event publishing, and heartbeats.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - Tenant isolation on all channels (CC6.1)
 * - Authenticated connections only (§164.312(d))
 * - PHI never in plaintext event payloads (§164.312(e))
 * - Event publications audit-logged (CC7.2)
 *
 * Usage:
 *   import { ChannelManager, EventPublisher, createSSEHandler } from '@ordr/realtime';
 *
 *   const channels = new ChannelManager();
 *   const publisher = new EventPublisher(channels);
 *   const sse = createSSEHandler(channels);
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  EventCategory,
  RealtimeEvent,
  ChannelSubscription,
  SSEConnection,
  ChannelStats,
  PublishOptions,
} from './types.js';

export { EVENT_CATEGORIES } from './types.js';

// ─── Channel Manager ─────────────────────────────────────────────
export { ChannelManager } from './channels.js';

// ─── Event Publisher ─────────────────────────────────────────────
export { EventPublisher } from './publisher.js';

export type { RealtimeAuditLogger } from './publisher.js';

// ─── SSE Handler ─────────────────────────────────────────────────
export {
  createSSEHandler,
  serializeSSEEvent,
  serializeHeartbeat,
} from './sse-handler.js';

export type { SSEHandlerOptions } from './sse-handler.js';
