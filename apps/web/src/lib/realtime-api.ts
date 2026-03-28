/**
 * Realtime API Service
 *
 * Typed wrappers over /api/v1/realtime admin endpoints.
 * SSE connection itself is handled by useRealtimeEvents hook.
 *
 * SOC2 CC7.2 — Restricted to tenant_admin role.
 * ISO 27001 A.8.16 — Monitoring stream stats for operational visibility.
 * HIPAA §164.312 — No PHI in event payloads; IDs and metadata only.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export interface ChannelStats {
  readonly totalChannels: number;
  readonly activeConnections: number;
  readonly tenants: Record<string, { connections: number; channels: number }>;
}

export type EventCategory =
  | 'agent'
  | 'compliance'
  | 'channel'
  | 'customer'
  | 'audit'
  | 'hitl'
  | 'system'
  | 'billing'
  | 'workflow';

export interface PublishEventParams {
  category: EventCategory;
  type: string;
  data: Record<string, unknown>;
  /** Target specific user IDs, or omit to broadcast to all tenant connections */
  userIds?: string[];
}

export interface PublishResult {
  readonly delivered: number;
  readonly category: EventCategory;
  readonly type: string;
  readonly tenantId: string;
}

// ── API ────────────────────────────────────────────────────────────

export const realtimeApi = {
  /**
   * Get SSE channel statistics (admin only).
   */
  getStats(): Promise<ChannelStats> {
    return apiClient
      .get<{ success: boolean; data: ChannelStats }>('/v1/realtime/stats')
      .then((r) => r.data);
  },

  /**
   * Broadcast or target an event to tenant connections (admin only).
   * CRITICAL: data MUST NOT contain PHI — IDs and metadata only.
   */
  publish(params: PublishEventParams): Promise<PublishResult> {
    return apiClient
      .post<{ success: boolean; data: PublishResult }>('/v1/realtime/publish', params)
      .then((r) => r.data);
  },
};
