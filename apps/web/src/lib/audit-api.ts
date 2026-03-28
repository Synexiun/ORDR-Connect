/**
 * Audit Log API Helpers
 *
 * Provides typed access to the immutable WORM audit trail endpoint.
 *
 * COMPLIANCE:
 * - SOC2 CC7.2 — Audit log read access for monitoring and review.
 * - HIPAA §164.312(b) — Audit controls: no PHI in any log field.
 * - All requests include X-Request-Id correlation header (see apiClient).
 * - Details field is always PHI-free (sanitized at write time by the API).
 */

import { apiClient } from './api';

// ─── Types ───────────────────────────────────────────────────────

export type AuditActorType = 'user' | 'agent' | 'system';

export interface AuditLogEvent {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly eventType: string;
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly resource: string;
  readonly resourceId: string;
  readonly action: string;
  readonly details: Record<string, unknown>;
  readonly hash: string;
  readonly previousHash: string;
  readonly timestamp: string;
}

export interface AuditLogsResponse {
  readonly events: AuditLogEvent[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly pages: number;
}

export interface AuditChainStatus {
  readonly totalEvents: number;
  readonly lastSequence: number;
  readonly lastHash: string;
  readonly lastTimestamp: string | null;
}

export interface FetchAuditLogsParams {
  readonly page?: number;
  readonly limit?: number;
  readonly eventType?: string;
  readonly actorType?: AuditActorType;
  readonly resource?: string;
  readonly from?: string;
  readonly to?: string;
}

// ─── API Functions ───────────────────────────────────────────────

export async function fetchAuditLogs(
  params: FetchAuditLogsParams = {},
): Promise<AuditLogsResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.eventType !== undefined) query.set('eventType', params.eventType);
  if (params.actorType !== undefined) query.set('actorType', params.actorType);
  if (params.resource !== undefined) query.set('resource', params.resource);
  if (params.from !== undefined) query.set('from', params.from);
  if (params.to !== undefined) query.set('to', params.to);
  const qs = query.toString();
  return apiClient.get<AuditLogsResponse>(`/v1/audit-logs${qs.length > 0 ? `?${qs}` : ''}`);
}

export async function fetchAuditChainStatus(): Promise<AuditChainStatus> {
  return apiClient.get<AuditChainStatus>('/v1/audit-logs/chain-status');
}
