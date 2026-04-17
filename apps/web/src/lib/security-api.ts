/**
 * Security Events API Service
 *
 * Typed wrappers over /api/v1/security-events endpoints.
 * Covers: event list, stats, resolve, false-positive, investigate.
 *
 * SECURITY:
 * - Source IPs stored as SHA-256 hashes only (GDPR Art. 5(1)(c)) — Rule 6
 * - Actor IDs are internal UUIDs, never email or name — Rule 6
 * - All status mutations carry X-Request-Id for WORM audit — Rule 3
 * - No PHI appears in event records — Rule 6
 *
 * SOC 2 CC7.1, CC7.3 | ISO 27001 A.8.16 | HIPAA §164.312(b)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type SecurityEventSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type SecurityEventType =
  | 'auth_attack'
  | 'brute_force'
  | 'privilege_escalation'
  | 'dlp_violation'
  | 'anomaly_detected'
  | 'honeypot_trigger'
  | 'injection_attempt'
  | 'data_exfiltration'
  | 'policy_violation'
  | 'geo_anomaly';

export type SecurityEventStatus = 'open' | 'investigating' | 'resolved' | 'false_positive';

export interface SecurityEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly severity: SecurityEventSeverity;
  readonly type: SecurityEventType;
  readonly status: SecurityEventStatus;
  readonly title: string;
  readonly description: string;
  /** SHA-256(IP) — GDPR data minimisation, never plaintext */
  readonly sourceIpHash: string | null;
  readonly userAgent: string | null;
  readonly affectedResource: string | null;
  /** Internal user UUID — never email/name */
  readonly actorId: string | null;
  readonly ruleId: string | null;
  readonly detectedAt: string;
  readonly resolvedAt: string | null;
  readonly resolutionNotes: string | null;
}

export interface SecurityEventStats {
  readonly openCritical: number;
  readonly openHigh: number;
  readonly resolvedToday: number;
  readonly avgResolutionHours: number;
}

export interface ListSecurityEventsParams {
  severity?: SecurityEventSeverity;
  type?: SecurityEventType;
  status?: SecurityEventStatus;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface ListSecurityEventsResponse {
  readonly items: SecurityEvent[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const securityApi = {
  async listEvents(params: ListSecurityEventsParams = {}): Promise<ListSecurityEventsResponse> {
    const q = new URLSearchParams();
    if (params.severity !== undefined) q.set('severity', params.severity);
    if (params.type !== undefined) q.set('type', params.type);
    if (params.status !== undefined) q.set('status', params.status);
    if (params.from !== undefined) q.set('from', params.from);
    if (params.to !== undefined) q.set('to', params.to);
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 20));
    return apiClient.get<ListSecurityEventsResponse>(`/security-events?${q}`);
  },

  async getStats(): Promise<SecurityEventStats> {
    return apiClient.get<SecurityEventStats>('/security-events/stats');
  },

  async markInvestigating(id: string): Promise<void> {
    return apiClient.post(`/security-events/${id}/investigate`, {});
  },

  async resolve(id: string, notes: string): Promise<void> {
    return apiClient.post(`/security-events/${id}/resolve`, { notes });
  },

  async markFalsePositive(id: string, notes: string): Promise<void> {
    return apiClient.post(`/security-events/${id}/false-positive`, { notes });
  },
};
