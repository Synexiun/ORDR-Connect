/**
 * Campaigns API Service
 *
 * Typed wrappers over /api/v1/campaigns endpoints.
 * Covers: campaign CRUD, scheduling, pause/resume/cancel,
 * per-campaign delivery metrics, and compliance gate config.
 *
 * SECURITY:
 * - All campaigns are tenant-scoped via JWT — Rule 2
 * - Campaign mutations WORM-logged with actor identity — Rule 3
 * - Message content must pass compliance engine before dispatch — Rule 9
 * - PHI must not appear in campaign names or descriptions — Rule 6
 * - Mass communication requires human-in-the-loop gate for >10K recipients — Rule 9
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.25 | HIPAA §164.312(a)(1) | TCPA 47 U.S.C. § 227
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CampaignChannel = 'sms' | 'email' | 'voice' | 'push' | 'in_app';

export type ComplianceGate = 'tcpa' | 'can_spam' | 'gdpr' | 'casl' | 'ccpa' | 'hipaa';

export interface CampaignDeliveryStats {
  readonly targeted: number;
  readonly suppressed: number;
  readonly sent: number;
  readonly delivered: number;
  readonly failed: number;
  readonly complianceBlocked: number;
  readonly deliveryRate: number;
}

export interface Campaign {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly segmentId: string;
  readonly segmentName: string;
  readonly channels: CampaignChannel[];
  readonly status: CampaignStatus;
  readonly complianceGates: ComplianceGate[];
  readonly templateId: string | null;
  readonly scheduledAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly delivery: CampaignDeliveryStats;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface CampaignStats {
  readonly activeCampaigns: number;
  readonly totalSentToday: number;
  readonly avgDeliveryRate: number;
  readonly complianceFlagsToday: number;
}

export interface CreateCampaignBody {
  readonly name: string;
  readonly description: string;
  readonly segmentId: string;
  readonly channels: CampaignChannel[];
  readonly complianceGates: ComplianceGate[];
  readonly templateId: string | null;
  readonly scheduledAt: string | null;
}

export interface UpdateCampaignBody {
  readonly name?: string;
  readonly description?: string;
  readonly channels?: CampaignChannel[];
  readonly complianceGates?: ComplianceGate[];
  readonly templateId?: string | null;
  readonly scheduledAt?: string | null;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const campaignsApi = {
  async getStats(): Promise<CampaignStats> {
    return apiClient.get<CampaignStats>('/campaigns/stats');
  },

  async listCampaigns(): Promise<Campaign[]> {
    return apiClient.get<Campaign[]>('/campaigns');
  },

  async getCampaign(id: string): Promise<Campaign> {
    return apiClient.get<Campaign>(`/campaigns/${id}`);
  },

  async createCampaign(body: CreateCampaignBody): Promise<Campaign> {
    return apiClient.post<Campaign>('/campaigns', body);
  },

  async updateCampaign(id: string, body: UpdateCampaignBody): Promise<Campaign> {
    return apiClient.put<Campaign>(`/campaigns/${id}`, body);
  },

  async launchCampaign(id: string): Promise<Campaign> {
    return apiClient.post<Campaign>(`/campaigns/${id}/launch`, {});
  },

  async pauseCampaign(id: string): Promise<Campaign> {
    return apiClient.post<Campaign>(`/campaigns/${id}/pause`, {});
  },

  async resumeCampaign(id: string): Promise<Campaign> {
    return apiClient.post<Campaign>(`/campaigns/${id}/resume`, {});
  },

  async cancelCampaign(id: string): Promise<Campaign> {
    return apiClient.post<Campaign>(`/campaigns/${id}/cancel`, {});
  },

  async deleteCampaign(id: string): Promise<void> {
    await apiClient.delete<unknown>(`/campaigns/${id}`);
  },
};
