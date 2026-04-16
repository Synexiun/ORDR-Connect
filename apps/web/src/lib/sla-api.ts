/**
 * SLA API Service
 *
 * Typed wrappers over /api/v1/sla endpoints.
 *
 * SOC2 CC7.2 — SLA monitoring is a key operational metric.
 * ISO 27001 A.16.1.1 — Responsibilities for information security events.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type SlaChannel = 'sms' | 'email' | 'voice' | 'whatsapp' | 'chat' | 'push' | 'in_app';

export type SlaTier = 'vip' | 'high' | 'standard' | 'low';

export interface SlaPolicy {
  readonly id: string;
  readonly channel: SlaChannel | null;
  readonly priorityTier: SlaTier | null;
  readonly thresholdMinutes: number;
  readonly thresholdLabel: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SlaBreach {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: string;
  readonly acknowledged: boolean;
  readonly acknowledgedAt: string | null;
  readonly metadata: Record<string, string>;
  readonly detectedAt: string;
  readonly actionRoute: string | null;
}

export interface SlaChannelStat {
  readonly channel: string;
  readonly count: number;
  readonly avgHours: number | null;
}

export interface SlaTrendDay {
  readonly day: string;
  readonly count: number;
}

export interface SlaMetrics {
  readonly windowDays: number;
  readonly totalBreaches: number;
  readonly unacknowledged: number;
  readonly activePolicies: number;
  readonly byChannel: SlaChannelStat[];
  readonly trend: SlaTrendDay[];
}

export interface SlaStatus {
  readonly enabled: boolean;
  readonly defaultThresholdHours: number;
  readonly intervalMinutes: number;
  readonly activePolicies: number;
}

export interface CreatePolicyBody {
  channel: SlaChannel | null;
  priorityTier: SlaTier | null;
  thresholdMinutes: number;
  enabled?: boolean;
}

export interface UpdatePolicyBody {
  thresholdMinutes?: number;
  enabled?: boolean;
}

export interface ListBreachesParams {
  acknowledged?: 'true' | 'false';
  channel?: SlaChannel;
  limit?: number;
  offset?: number;
}

// ── API ────────────────────────────────────────────────────────────

export const slaApi = {
  // Policies

  listPolicies(): Promise<SlaPolicy[]> {
    return apiClient
      .get<{ success: boolean; data: SlaPolicy[] }>('/v1/sla/policies')
      .then((r) => r.data);
  },

  createPolicy(body: CreatePolicyBody): Promise<SlaPolicy> {
    return apiClient
      .post<{ success: boolean; data: SlaPolicy }>('/v1/sla/policies', body)
      .then((r) => r.data);
  },

  updatePolicy(id: string, body: UpdatePolicyBody): Promise<SlaPolicy> {
    return apiClient
      .put<{ success: boolean; data: SlaPolicy }>(`/v1/sla/policies/${id}`, body)
      .then((r) => r.data);
  },

  deletePolicy(id: string): Promise<{ id: string }> {
    return apiClient
      .delete<{ success: boolean; data: { id: string } }>(`/v1/sla/policies/${id}`)
      .then((r) => r.data);
  },

  // Breaches

  listBreaches(params: ListBreachesParams = {}): Promise<{
    data: SlaBreach[];
    meta: { total: number; limit: number; offset: number };
  }> {
    const qs = new URLSearchParams();
    if (params.acknowledged !== undefined) qs.set('acknowledged', params.acknowledged);
    if (params.channel !== undefined) qs.set('channel', params.channel);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return apiClient
      .get<{
        success: boolean;
        data: SlaBreach[];
        meta: { total: number; limit: number; offset: number };
      }>(`/v1/sla/breaches${q ? `?${q}` : ''}`)
      .then((r) => ({ data: r.data, meta: r.meta }));
  },

  acknowledgeBreach(id: string): Promise<SlaBreach> {
    return apiClient
      .post<{ success: boolean; data: SlaBreach }>(`/v1/sla/breaches/${id}/acknowledge`)
      .then((r) => r.data);
  },

  // Metrics

  getMetrics(days?: number): Promise<SlaMetrics> {
    const q = days !== undefined ? `?days=${String(days)}` : '';
    return apiClient
      .get<{ success: boolean; data: SlaMetrics }>(`/v1/sla/metrics${q}`)
      .then((r) => r.data);
  },

  // Control

  triggerCheck(): Promise<{ breachesFound: number }> {
    return apiClient
      .post<{ success: boolean; data: { breachesFound: number } }>('/v1/sla/check')
      .then((r) => r.data);
  },

  getStatus(): Promise<SlaStatus> {
    return apiClient
      .get<{ success: boolean; data: SlaStatus }>('/v1/sla/status')
      .then((r) => r.data);
  },
};
