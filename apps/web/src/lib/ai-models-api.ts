/**
 * AI Models API Service
 *
 * Typed wrappers over /api/v1/ai-models endpoints.
 * Covers: model registry, per-agent-role configuration,
 * 30-day usage/cost stats, and global safety parameters.
 *
 * SECURITY:
 * - API keys for LLM providers stored in Vault, never returned to client — Rule 5
 * - Kill-switch state changes WORM-logged with actor identity — Rule 3
 * - Confidence threshold below 0.7 requires senior-operator role — Rule 2
 * - All agent actions below threshold routed to human review queue — Rule 9
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.25 | HIPAA §164.312(a)(1)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'mistral';
export type ModelStatus = 'active' | 'deprecated' | 'disabled';

export type AgentRole =
  | 'customer_service'
  | 'escalation'
  | 'compliance_checker'
  | 'data_analyst'
  | 'content_moderator'
  | 'triage';

export interface AiModel {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly provider: ModelProvider;
  readonly version: string;
  readonly contextWindowTokens: number;
  /** USD per 1,000 input tokens */
  readonly inputCostPer1kTokens: number;
  /** USD per 1,000 output tokens */
  readonly outputCostPer1kTokens: number;
  readonly status: ModelStatus;
  readonly supportsVision: boolean;
  readonly supportsFunctionCalling: boolean;
  readonly addedAt: string;
}

export interface AgentRoleConfig {
  readonly role: AgentRole;
  readonly displayName: string;
  readonly modelId: string;
  /** Max tokens per single agent run */
  readonly tokenBudgetPerRun: number;
  /** Max tool calls per single agent run */
  readonly maxActionsPerRun: number;
  /** 0.0–1.0; actions below this score route to human review */
  readonly confidenceThreshold: number;
  /** Always route to human review regardless of confidence */
  readonly alwaysRequireHumanReview: boolean;
  /** Individual kill switch for this role */
  readonly enabled: boolean;
  readonly lastUpdatedAt: string;
}

export interface ModelUsageStat {
  readonly modelId: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  /** USD, 30-day rolling window */
  readonly totalCostUsd: number;
  readonly requestCount: number;
}

export interface AiSafetyConfig {
  /** Instantly disables all agent execution across the entire tenant */
  readonly globalKillSwitchEnabled: boolean;
  readonly killSwitchActivatedAt: string | null;
  readonly killSwitchActivatedBy: string | null;
  /** Requests below this score are auto-rejected without human review */
  readonly minimumConfidenceFloor: number;
}

export interface AiStats {
  readonly activeModels: number;
  readonly totalSpend30dUsd: number;
  readonly agentRunsToday: number;
  readonly pendingHumanReviews: number;
}

export interface UpdateAgentRoleBody {
  readonly modelId?: string;
  readonly tokenBudgetPerRun?: number;
  readonly maxActionsPerRun?: number;
  readonly confidenceThreshold?: number;
  readonly alwaysRequireHumanReview?: boolean;
  readonly enabled?: boolean;
}

export interface UpdateSafetyConfigBody {
  readonly globalKillSwitchEnabled?: boolean;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const aiModelsApi = {
  async getStats(): Promise<AiStats> {
    return apiClient.get<AiStats>('/ai-models/stats');
  },

  async listModels(): Promise<AiModel[]> {
    return apiClient.get<AiModel[]>('/ai-models');
  },

  async listRoleConfigs(): Promise<AgentRoleConfig[]> {
    return apiClient.get<AgentRoleConfig[]>('/ai-models/roles');
  },

  async updateRoleConfig(role: AgentRole, body: UpdateAgentRoleBody): Promise<AgentRoleConfig> {
    return apiClient.put<AgentRoleConfig>(`/ai-models/roles/${role}`, body);
  },

  async listUsageStats(): Promise<ModelUsageStat[]> {
    return apiClient.get<ModelUsageStat[]>('/ai-models/usage');
  },

  async getSafetyConfig(): Promise<AiSafetyConfig> {
    return apiClient.get<AiSafetyConfig>('/ai-models/safety');
  },

  async updateSafetyConfig(body: UpdateSafetyConfigBody): Promise<AiSafetyConfig> {
    return apiClient.put<AiSafetyConfig>('/ai-models/safety', body);
  },
};
