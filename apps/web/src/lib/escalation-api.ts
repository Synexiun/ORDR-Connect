/**
 * Escalation Rules API Service
 *
 * Typed wrappers over /api/v1/escalation endpoints.
 * Covers: rule CRUD, priority reordering, trigger history,
 * and dry-run evaluation.
 *
 * SECURITY:
 * - Rule mutations WORM-logged with actor identity — Rule 3
 * - Auto-respond actions must pass compliance rules engine — Rule 9
 * - Agent assignment scoped to tenant's agent pool — Rule 2
 * - PHI must not appear in rule conditions or action payloads — Rule 6
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.25 | HIPAA §164.312(a)(1)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type ConditionField =
  | 'sla_breach'
  | 'sla_minutes_remaining'
  | 'ticket_age_hours'
  | 'sentiment_score'
  | 'customer_tier'
  | 'ticket_priority'
  | 'channel'
  | 'unresponsive_hours'
  | 'csat_score'
  | 'tag';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'contains'
  | 'is_true';

export type ActionType =
  | 'assign_queue'
  | 'assign_agent'
  | 'set_priority'
  | 'notify_agent'
  | 'notify_manager'
  | 'auto_respond'
  | 'add_tag'
  | 'create_task'
  | 'webhook';

export interface RuleCondition {
  readonly id: string;
  readonly field: ConditionField;
  readonly operator: ConditionOperator;
  readonly value: string;
}

export interface RuleAction {
  readonly id: string;
  readonly type: ActionType;
  /** Action-specific configuration key-value pairs */
  readonly config: Readonly<Record<string, string>>;
}

export interface EscalationRule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  /** Lower number = higher priority; first matching rule wins */
  readonly priority: number;
  readonly conditions: readonly RuleCondition[];
  /** All conditions must match (AND logic) */
  readonly conditionLogic: 'all' | 'any';
  readonly actions: readonly RuleAction[];
  readonly triggeredToday: number;
  readonly triggeredTotal: number;
  readonly lastTriggeredAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface EscalationStats {
  readonly activeRules: number;
  readonly triggeredToday: number;
  readonly escalationsCreated: number;
  readonly avgResolutionHrs: number;
}

export interface TriggerEvent {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly ticketId: string;
  readonly triggeredAt: string;
  readonly actionsExecuted: readonly ActionType[];
  readonly outcome: 'success' | 'partial' | 'failed';
}

export interface ToggleRuleBody {
  readonly enabled: boolean;
}

export interface ReorderBody {
  readonly orderedIds: readonly string[];
}

// ── API Client ─────────────────────────────────────────────────────────────

export const escalationApi = {
  async getStats(): Promise<EscalationStats> {
    return apiClient.get<EscalationStats>('/escalation/stats');
  },

  async listRules(): Promise<EscalationRule[]> {
    return apiClient.get<EscalationRule[]>('/escalation/rules');
  },

  async toggleRule(id: string, body: ToggleRuleBody): Promise<EscalationRule> {
    return apiClient.put<EscalationRule>(`/escalation/rules/${id}/toggle`, body);
  },

  async reorderRules(body: ReorderBody): Promise<EscalationRule[]> {
    return apiClient.put<EscalationRule[]>('/escalation/rules/reorder', body);
  },

  async listTriggerHistory(): Promise<TriggerEvent[]> {
    return apiClient.get<TriggerEvent[]>('/escalation/history');
  },
};
