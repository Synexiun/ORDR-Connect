/**
 * Decision Engine API Service
 *
 * Typed wrappers over /api/v1/decision-engine endpoints.
 * Covers: engine stats, layer metrics, decision record log,
 * and rule CRUD for the rules-layer of the 3-tier AI cascade.
 *
 * SECURITY:
 * - All records and rules are tenant-scoped via JWT — Rule 2
 * - Decision records contain customer IDs only — no PHI in reasoning logs — Rule 6
 * - Rule mutations WORM-logged with actor identity — Rule 3
 * - Low-confidence decisions (<0.7) surface to human review queue — Rule 9
 *
 * SOC 2 CC7.2 | ISO 27001 A.8.6 | HIPAA §164.312(a)(1)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type DecisionLayer = 'rules' | 'ml_scorer' | 'llm_reasoner';

export type DecisionType =
  | 'routing'
  | 'escalation'
  | 'follow_up'
  | 'sentiment'
  | 'compliance'
  | 'fraud'
  | 'next_best_action'
  | 'channel_selection';

export type DecisionOutcome = 'approved' | 'rejected' | 'escalated' | 'deferred';

export type RuleConditionType =
  | 'sentiment_lt'
  | 'sentiment_gt'
  | 'intent_equals'
  | 'entity_contains'
  | 'channel_equals'
  | 'age_days_gt'
  | 'amount_gt'
  | 'priority_equals'
  | 'tag_contains'
  | 'attempts_gte';

export type RuleAction =
  | 'route_to_agent'
  | 'escalate'
  | 'send_follow_up'
  | 'flag_compliance'
  | 'flag_fraud'
  | 'close'
  | 'defer'
  | 'apply_tag';

export interface DecisionRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly decisionType: DecisionType;
  readonly layer: DecisionLayer;
  /** 0.0–1.0 — decisions <0.7 surface to human review per Rule 9 */
  readonly confidence: number;
  readonly latencyMs: number;
  readonly outcome: DecisionOutcome;
  /** Reasoning summary — no PHI, customer IDs only */
  readonly reasoning: string;
  readonly customerId: string;
  readonly ruleId: string | null;
  readonly createdAt: string;
}

export interface DecisionRule {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly conditionType: RuleConditionType;
  readonly conditionValue: string;
  readonly action: RuleAction;
  readonly decisionType: DecisionType;
  /** Lower = higher priority; evaluated in ascending order */
  readonly priority: number;
  readonly enabled: boolean;
  readonly hitCount: number;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface DecisionEngineStats {
  readonly totalToday: number;
  readonly avgLatencyMs: number;
  readonly rulesLayerPct: number;
  readonly mlLayerPct: number;
  readonly llmLayerPct: number;
  readonly avgConfidence: number;
  readonly lowConfidenceCount: number;
}

export interface LayerStats {
  readonly layer: DecisionLayer;
  readonly avgLatencyMs: number;
  readonly hitCount: number;
  readonly hitPct: number;
  readonly avgConfidence: number;
}

export interface ListDecisionRecordsParams {
  decisionType?: DecisionType;
  layer?: DecisionLayer;
  outcome?: DecisionOutcome;
  limit?: number;
}

export interface CreateRuleBody {
  readonly name: string;
  readonly description: string;
  readonly conditionType: RuleConditionType;
  readonly conditionValue: string;
  readonly action: RuleAction;
  readonly decisionType: DecisionType;
  readonly priority: number;
}

export interface UpdateRuleBody {
  readonly name?: string;
  readonly description?: string;
  readonly conditionType?: RuleConditionType;
  readonly conditionValue?: string;
  readonly action?: RuleAction;
  readonly decisionType?: DecisionType;
  readonly priority?: number;
  readonly enabled?: boolean;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const decisionEngineApi = {
  async getStats(): Promise<DecisionEngineStats> {
    return apiClient.get<DecisionEngineStats>('/decision-engine/stats');
  },

  async getLayerStats(): Promise<LayerStats[]> {
    return apiClient.get<LayerStats[]>('/decision-engine/layer-stats');
  },

  listRecords(params: ListDecisionRecordsParams = {}): Promise<DecisionRecord[]> {
    const q = new URLSearchParams();
    if (params.decisionType !== undefined) q.set('decisionType', params.decisionType);
    if (params.layer !== undefined) q.set('layer', params.layer);
    if (params.outcome !== undefined) q.set('outcome', params.outcome);
    if (params.limit !== undefined) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiClient.get<DecisionRecord[]>(`/decision-engine/records${qs !== '' ? `?${qs}` : ''}`);
  },

  async listRules(): Promise<DecisionRule[]> {
    return apiClient.get<DecisionRule[]>('/decision-engine/rules');
  },

  async createRule(body: CreateRuleBody): Promise<DecisionRule> {
    return apiClient.post<DecisionRule>('/decision-engine/rules', body);
  },

  async updateRule(id: string, body: UpdateRuleBody): Promise<DecisionRule> {
    return apiClient.put<DecisionRule>(`/decision-engine/rules/${id}`, body);
  },

  async deleteRule(id: string): Promise<void> {
    await apiClient.delete<unknown>(`/decision-engine/rules/${id}`);
  },
};
