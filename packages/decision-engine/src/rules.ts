/**
 * @ordr/decision-engine — Layer 1: Deterministic Rules Engine
 *
 * Pure data matching with zero I/O. Target: sub-100ms evaluation.
 * Rules are evaluated in priority order (highest number first).
 * First terminal match wins for routing decisions.
 *
 * COMPLIANCE:
 * - Rules can be tied to regulations for audit traceability
 * - All rule evaluations return structured results
 * - No PHI in rule conditions or outputs
 */

import {
  type Result,
  ok,
  err,
  InternalError,
} from '@ordr/core';
import type {
  DecisionContext,
  RuleCondition,
  RuleDefinition,
  RuleAction,
  RuleResult,
} from './types.js';

// ─── RuleStore Interface ─────────────────────────────────────────

/**
 * Storage adapter for rule definitions.
 * Implementations may be backed by database, in-memory, or config files.
 */
export interface RuleStore {
  getRules(tenantId: string): Promise<readonly RuleDefinition[]>;
  getRule(id: string, tenantId: string): Promise<RuleDefinition | undefined>;
  createRule(rule: RuleDefinition): Promise<void>;
  updateRule(rule: RuleDefinition): Promise<void>;
  deleteRule(id: string, tenantId: string): Promise<void>;
}

// ─── InMemoryRuleStore ───────────────────────────────────────────

/** In-memory rule store for testing and development. */
export class InMemoryRuleStore implements RuleStore {
  private readonly rules: Map<string, RuleDefinition> = new Map();

  async getRules(tenantId: string): Promise<readonly RuleDefinition[]> {
    const results: RuleDefinition[] = [];
    for (const rule of this.rules.values()) {
      if (rule.tenantId === tenantId && rule.enabled) {
        results.push(rule);
      }
    }
    return results;
  }

  async getRule(id: string, tenantId: string): Promise<RuleDefinition | undefined> {
    const rule = this.rules.get(id);
    if (rule !== undefined && rule.tenantId === tenantId) {
      return rule;
    }
    return undefined;
  }

  async createRule(rule: RuleDefinition): Promise<void> {
    this.rules.set(rule.id, rule);
  }

  async updateRule(rule: RuleDefinition): Promise<void> {
    this.rules.set(rule.id, rule);
  }

  async deleteRule(id: string, _tenantId: string): Promise<void> {
    this.rules.delete(id);
  }

  /** Helper: seed multiple rules at once. */
  seed(rules: readonly RuleDefinition[]): void {
    for (const rule of rules) {
      this.rules.set(rule.id, rule);
    }
  }

  /** Helper: clear all rules. */
  clear(): void {
    this.rules.clear();
  }
}

// ─── Resolve Nested Field ────────────────────────────────────────

/**
 * Resolve a dot-notation field path against the decision context.
 * Supports paths like "customerProfile.healthScore", "eventPayload.amount", etc.
 */
function resolveField(context: DecisionContext, field: string): unknown {
  const parts = field.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

// ─── Condition Evaluation ────────────────────────────────────────

/**
 * Evaluate a single rule condition against the decision context.
 * All comparisons are type-safe with graceful fallback to false.
 */
export function evaluateCondition(
  condition: RuleCondition,
  context: DecisionContext,
): boolean {
  const fieldValue = resolveField(context, condition.field);

  // Undefined field means condition cannot match
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }

  switch (condition.operator) {
    case 'eq':
      return fieldValue === condition.value;

    case 'neq':
      return fieldValue !== condition.value;

    case 'gt':
      return typeof fieldValue === 'number' && typeof condition.value === 'number'
        ? fieldValue > condition.value
        : false;

    case 'lt':
      return typeof fieldValue === 'number' && typeof condition.value === 'number'
        ? fieldValue < condition.value
        : false;

    case 'gte':
      return typeof fieldValue === 'number' && typeof condition.value === 'number'
        ? fieldValue >= condition.value
        : false;

    case 'lte':
      return typeof fieldValue === 'number' && typeof condition.value === 'number'
        ? fieldValue <= condition.value
        : false;

    case 'in':
      return Array.isArray(condition.value)
        ? (condition.value as readonly unknown[]).includes(fieldValue)
        : false;

    case 'not_in':
      return Array.isArray(condition.value)
        ? !(condition.value as readonly unknown[]).includes(fieldValue)
        : false;

    case 'contains':
      return typeof fieldValue === 'string' && typeof condition.value === 'string'
        ? fieldValue.includes(condition.value)
        : false;

    case 'regex': {
      if (typeof fieldValue !== 'string' || typeof condition.value !== 'string') {
        return false;
      }
      try {
        const regex = new RegExp(condition.value);
        return regex.test(fieldValue);
      } catch {
        // Invalid regex — fail-safe to no match
        return false;
      }
    }

    default:
      return false;
  }
}

// ─── Rules Engine ────────────────────────────────────────────────

export class RulesEngine {
  private readonly store: RuleStore;

  constructor(store: RuleStore) {
    this.store = store;
  }

  /**
   * Evaluate all matching rules for the given context.
   * Rules are evaluated in priority order (highest priority number first).
   *
   * Returns results for all rules — matched and unmatched.
   * Sub-100ms by design: pure in-memory data matching.
   */
  async evaluate(context: DecisionContext): Promise<Result<readonly RuleResult[], InternalError>> {
    try {
      const rules = await this.store.getRules(context.tenantId);
      const sorted = this.sortByPriority(rules);
      const results: RuleResult[] = [];

      for (const rule of sorted) {
        const matched = this.matchRule(rule, context);
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          matched,
          action: matched ? rule.action : undefined,
          score: matched ? 1.0 : 0.0,
          reasoning: matched
            ? `Rule "${rule.name}" matched all ${String(rule.conditions.length)} conditions`
            : `Rule "${rule.name}" did not match`,
        });
      }

      return ok(results);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown rules engine error';
      return err(new InternalError(`Rules engine evaluation failed: ${message}`));
    }
  }

  /**
   * Find the first terminal match — the fast-path rule that skips ML/LLM.
   * Returns the first matched terminal rule, or undefined if none match.
   */
  async findTerminalMatch(
    context: DecisionContext,
  ): Promise<Result<RuleResult | undefined, InternalError>> {
    try {
      const rules = await this.store.getRules(context.tenantId);
      const sorted = this.sortByPriority(rules);

      for (const rule of sorted) {
        if (rule.terminal && this.matchRule(rule, context)) {
          return ok({
            ruleId: rule.id,
            ruleName: rule.name,
            matched: true,
            action: rule.action,
            score: 1.0,
            reasoning: `Terminal rule "${rule.name}" matched — fast path`,
          });
        }
      }

      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown rules engine error';
      return err(new InternalError(`Rules engine terminal match failed: ${message}`));
    }
  }

  /**
   * Filter rules that match the given context.
   */
  matchRules(
    context: DecisionContext,
    rules: readonly RuleDefinition[],
  ): readonly RuleDefinition[] {
    return rules.filter((rule) => rule.enabled && this.matchRule(rule, context));
  }

  /**
   * Check if a single rule matches the context.
   * ALL conditions must be true (AND logic).
   */
  private matchRule(rule: RuleDefinition, context: DecisionContext): boolean {
    if (rule.conditions.length === 0) {
      return false;
    }
    return rule.conditions.every((condition) => evaluateCondition(condition, context));
  }

  /**
   * Sort rules by priority — highest number first.
   */
  private sortByPriority(
    rules: readonly RuleDefinition[],
  ): readonly RuleDefinition[] {
    return [...rules].sort((a, b) => b.priority - a.priority);
  }
}

// ─── Built-in Collections Rules ──────────────────────────────────

/**
 * Built-in rules for collections workflows.
 * These are registered as tenant-specific rules during onboarding.
 *
 * The tenantId '__builtin__' is used as a template — copy and assign
 * the real tenant ID when provisioning.
 */

const BUILTIN_TENANT = '__builtin__' as const;

const BUILTIN_ACTION_SEND_SMS: RuleAction = {
  type: 'send_sms',
  channel: 'sms',
  parameters: { template: 'collections.payment_reminder' },
} as const;

const BUILTIN_ACTION_ESCALATE: RuleAction = {
  type: 'escalate_to_human',
  channel: undefined,
  parameters: { reason: 'Multiple failed contact attempts', queue: 'collections_escalation' },
} as const;

const BUILTIN_ACTION_PAYMENT_PLAN: RuleAction = {
  type: 'offer_payment_plan',
  channel: undefined,
  parameters: { template: 'collections.payment_plan' },
} as const;

const BUILTIN_ACTION_CEASE: RuleAction = {
  type: 'cease_communication',
  channel: undefined,
  parameters: { reason: 'Customer requested STOP' },
} as const;

const BUILTIN_ACTION_PREMIUM_ROUTE: RuleAction = {
  type: 'route_to_agent',
  channel: undefined,
  parameters: { agentTier: 'premium', reason: 'High LTV customer' },
} as const;

export const BUILTIN_RULES: readonly RuleDefinition[] = [
  {
    id: 'builtin_collections_initial_contact',
    tenantId: BUILTIN_TENANT,
    name: 'Collections: Initial Contact',
    description: 'If customer has overdue payment AND no contact in 7 days, send payment reminder SMS',
    priority: 80,
    conditions: [
      { field: 'customerProfile.outstandingBalance', operator: 'gt', value: 0 },
      { field: 'customerProfile.daysSinceLastContact', operator: 'gte', value: 7 },
    ],
    action: BUILTIN_ACTION_SEND_SMS,
    enabled: true,
    terminal: true,
    regulation: 'fdcpa',
  },
  {
    id: 'builtin_collections_escalation',
    tenantId: BUILTIN_TENANT,
    name: 'Collections: Escalation',
    description: 'If 3+ failed contacts in history, escalate to human agent',
    priority: 90,
    conditions: [
      { field: 'customerProfile.outstandingBalance', operator: 'gt', value: 0 },
      { field: 'eventPayload.failedContactCount', operator: 'gte', value: 3 },
    ],
    action: BUILTIN_ACTION_ESCALATE,
    enabled: true,
    terminal: true,
    regulation: 'fdcpa',
  },
  {
    id: 'builtin_collections_payment_plan',
    tenantId: BUILTIN_TENANT,
    name: 'Collections: Payment Plan Offer',
    description: 'If customer responded positively, offer payment plan',
    priority: 70,
    conditions: [
      { field: 'customerProfile.outstandingBalance', operator: 'gt', value: 0 },
      { field: 'eventPayload.customerResponse', operator: 'eq', value: 'positive' },
    ],
    action: BUILTIN_ACTION_PAYMENT_PLAN,
    enabled: true,
    terminal: false,
    regulation: 'fdcpa',
  },
  {
    id: 'builtin_collections_cease',
    tenantId: BUILTIN_TENANT,
    name: 'Collections: Cease Communication',
    description: 'If customer said STOP, immediately cease all communication',
    priority: 100,
    conditions: [
      { field: 'eventPayload.customerResponse', operator: 'eq', value: 'stop' },
    ],
    action: BUILTIN_ACTION_CEASE,
    enabled: true,
    terminal: true,
    regulation: 'fdcpa',
  },
  {
    id: 'builtin_high_value_routing',
    tenantId: BUILTIN_TENANT,
    name: 'High Value: Premium Routing',
    description: 'If customer LTV exceeds threshold, route to premium agent',
    priority: 60,
    conditions: [
      { field: 'customerProfile.ltv', operator: 'gt', value: 50000 },
    ],
    action: BUILTIN_ACTION_PREMIUM_ROUTE,
    enabled: true,
    terminal: false,
    regulation: undefined,
  },
] as const;

/**
 * Copy built-in rules for a specific tenant.
 * Replaces the __builtin__ tenant ID with the real tenant ID.
 */
export function copyBuiltinRulesForTenant(tenantId: string): readonly RuleDefinition[] {
  return BUILTIN_RULES.map((rule) => ({
    ...rule,
    id: `${tenantId}_${rule.id.replace('builtin_', '')}`,
    tenantId,
  }));
}
