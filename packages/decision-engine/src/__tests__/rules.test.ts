/**
 * @ordr/decision-engine — Rules Engine Tests (Layer 1)
 *
 * Tests condition evaluation (all operators), rule matching,
 * priority ordering, built-in collections rules, terminal fast path,
 * and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RulesEngine,
  InMemoryRuleStore,
  evaluateCondition,
  BUILTIN_RULES,
  copyBuiltinRulesForTenant,
} from '../rules.js';
import type {
  DecisionContext,
  RuleCondition,
  RuleDefinition,
} from '../types.js';

// ─── Test Helpers ────────────────────────────────────────────────

function createTestContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    eventType: 'payment_overdue',
    eventPayload: {},
    customerProfile: {
      healthScore: 65,
      lifecycleStage: 'active',
      segment: 'mid-market',
      ltv: 25000,
      sentimentAvg: 0.3,
      responseRate: 0.6,
      preferredChannel: 'sms',
      outstandingBalance: 5000,
      maxBalance: 10000,
      daysSinceLastContact: 10,
      totalInteractions30d: 5,
      paymentHistory: [
        { date: new Date('2025-01-15'), amount: 1000, onTime: true },
        { date: new Date('2025-02-15'), amount: 1000, onTime: false },
      ],
    },
    channelPreferences: ['sms', 'email'],
    interactionHistory: [],
    constraints: {
      budgetCents: undefined,
      timeWindowMinutes: undefined,
      blockedChannels: [],
      maxContactsPerWeek: 3,
      maxSmsPerDay: 1,
      maxEmailsPerWeek: 5,
    },
    timestamp: new Date('2025-06-15T14:00:00Z'),
    correlationId: 'corr-1',
    ...overrides,
  };
}

function createRule(overrides: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    id: 'rule-1',
    tenantId: 'tenant-1',
    name: 'Test Rule',
    description: 'A test rule',
    priority: 50,
    conditions: [],
    action: { type: 'send_sms', channel: 'sms', parameters: {} },
    enabled: true,
    terminal: false,
    regulation: undefined,
    ...overrides,
  };
}

// ─── Condition Evaluation ────────────────────────────────────────

describe('evaluateCondition', () => {
  const ctx = createTestContext();

  it('should evaluate eq operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.lifecycleStage', operator: 'eq', value: 'active' };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate eq operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.lifecycleStage', operator: 'eq', value: 'churned' };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should evaluate neq operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.lifecycleStage', operator: 'neq', value: 'churned' };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate neq operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.lifecycleStage', operator: 'neq', value: 'active' };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should evaluate gt operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.healthScore', operator: 'gt', value: 50 };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate gt operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.healthScore', operator: 'gt', value: 100 };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should evaluate lt operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.healthScore', operator: 'lt', value: 80 };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate lt operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.healthScore', operator: 'lt', value: 50 };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should evaluate gte operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.healthScore', operator: 'gte', value: 65 };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate gte operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.healthScore', operator: 'gte', value: 66 };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should evaluate lte operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.healthScore', operator: 'lte', value: 65 };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate lte operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.healthScore', operator: 'lte', value: 64 };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should evaluate in operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'in', value: ['enterprise', 'mid-market'] };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate in operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'in', value: ['enterprise', 'startup'] };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should evaluate not_in operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'not_in', value: ['enterprise', 'startup'] };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate not_in operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'not_in', value: ['mid-market'] };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should evaluate contains operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'contains', value: 'market' };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate contains operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'contains', value: 'xyz' };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should evaluate regex operator', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'regex', value: '^mid-' };
    expect(evaluateCondition(condition, ctx)).toBe(true);
  });

  it('should evaluate regex operator (false)', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'regex', value: '^enterprise$' };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should return false for invalid regex', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'regex', value: '[invalid' };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should return false for null/undefined fields', () => {
    const condition: RuleCondition = { field: 'nonExistent.field', operator: 'eq', value: 'test' };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should return false for numeric operators on non-numeric fields', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'gt', value: 5 };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should return false for in operator on non-array value', () => {
    const condition: RuleCondition = { field: 'customerProfile.segment', operator: 'in', value: 'not-array' };
    expect(evaluateCondition(condition, ctx)).toBe(false);
  });

  it('should resolve nested dot-notation fields', () => {
    const ctx2 = createTestContext({
      eventPayload: { nested: { deep: { value: 42 } } },
    });
    const condition: RuleCondition = { field: 'eventPayload.nested.deep.value', operator: 'eq', value: 42 };
    expect(evaluateCondition(condition, ctx2)).toBe(true);
  });
});

// ─── Rules Engine ────────────────────────────────────────────────

describe('RulesEngine', () => {
  let store: InMemoryRuleStore;
  let engine: RulesEngine;

  beforeEach(() => {
    store = new InMemoryRuleStore();
    engine = new RulesEngine(store);
  });

  describe('evaluate', () => {
    it('should return empty results for no rules', async () => {
      const ctx = createTestContext();
      const result = await engine.evaluate(ctx);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('should match a simple rule', async () => {
      const rule = createRule({
        conditions: [
          { field: 'customerProfile.healthScore', operator: 'gt', value: 50 },
        ],
      });
      await store.createRule(rule);

      const ctx = createTestContext();
      const result = await engine.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.matched).toBe(true);
        expect(result.data[0]?.score).toBe(1.0);
      }
    });

    it('should fail a rule when conditions are not met', async () => {
      const rule = createRule({
        conditions: [
          { field: 'customerProfile.healthScore', operator: 'gt', value: 90 },
        ],
      });
      await store.createRule(rule);

      const ctx = createTestContext();
      const result = await engine.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.matched).toBe(false);
        expect(result.data[0]?.score).toBe(0.0);
      }
    });

    it('should require ALL conditions to match (AND logic)', async () => {
      const rule = createRule({
        conditions: [
          { field: 'customerProfile.healthScore', operator: 'gt', value: 50 },
          { field: 'customerProfile.lifecycleStage', operator: 'eq', value: 'churned' },
        ],
      });
      await store.createRule(rule);

      const ctx = createTestContext(); // lifecycleStage = 'active', not 'churned'
      const result = await engine.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0]?.matched).toBe(false);
      }
    });

    it('should evaluate rules in priority order (highest first)', async () => {
      const lowPriority = createRule({ id: 'low', priority: 10, conditions: [{ field: 'tenantId', operator: 'eq', value: 'tenant-1' }] });
      const highPriority = createRule({ id: 'high', priority: 90, conditions: [{ field: 'tenantId', operator: 'eq', value: 'tenant-1' }] });
      const medPriority = createRule({ id: 'med', priority: 50, conditions: [{ field: 'tenantId', operator: 'eq', value: 'tenant-1' }] });

      store.seed([lowPriority, highPriority, medPriority]);

      const ctx = createTestContext();
      const result = await engine.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0]?.ruleId).toBe('high');
        expect(result.data[1]?.ruleId).toBe('med');
        expect(result.data[2]?.ruleId).toBe('low');
      }
    });

    it('should skip disabled rules', async () => {
      const rule = createRule({ enabled: false, conditions: [{ field: 'tenantId', operator: 'eq', value: 'tenant-1' }] });
      await store.createRule(rule);

      const ctx = createTestContext();
      const result = await engine.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('should isolate rules by tenant', async () => {
      const rule = createRule({ tenantId: 'other-tenant', conditions: [{ field: 'tenantId', operator: 'eq', value: 'other-tenant' }] });
      await store.createRule(rule);

      const ctx = createTestContext({ tenantId: 'tenant-1' });
      const result = await engine.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('should not match rules with empty conditions', async () => {
      const rule = createRule({ conditions: [] });
      await store.createRule(rule);

      const ctx = createTestContext();
      const result = await engine.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0]?.matched).toBe(false);
      }
    });
  });

  describe('findTerminalMatch', () => {
    it('should find a terminal matching rule', async () => {
      const rule = createRule({
        terminal: true,
        conditions: [
          { field: 'customerProfile.outstandingBalance', operator: 'gt', value: 0 },
        ],
      });
      await store.createRule(rule);

      const ctx = createTestContext();
      const result = await engine.findTerminalMatch(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data?.matched).toBe(true);
        expect(result.data?.score).toBe(1.0);
      }
    });

    it('should return undefined when no terminal rule matches', async () => {
      const rule = createRule({
        terminal: false,
        conditions: [
          { field: 'customerProfile.outstandingBalance', operator: 'gt', value: 0 },
        ],
      });
      await store.createRule(rule);

      const ctx = createTestContext();
      const result = await engine.findTerminalMatch(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeUndefined();
      }
    });

    it('should return highest-priority terminal match', async () => {
      const lowTerminal = createRule({
        id: 'low-term',
        terminal: true,
        priority: 10,
        conditions: [{ field: 'tenantId', operator: 'eq', value: 'tenant-1' }],
        action: { type: 'send_email', channel: 'email', parameters: {} },
      });
      const highTerminal = createRule({
        id: 'high-term',
        terminal: true,
        priority: 90,
        conditions: [{ field: 'tenantId', operator: 'eq', value: 'tenant-1' }],
        action: { type: 'escalate_to_human', channel: undefined, parameters: {} },
      });
      store.seed([lowTerminal, highTerminal]);

      const ctx = createTestContext();
      const result = await engine.findTerminalMatch(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.ruleId).toBe('high-term');
        expect(result.data?.action?.type).toBe('escalate_to_human');
      }
    });
  });

  describe('matchRules', () => {
    it('should filter matching rules from a list', () => {
      const matching = createRule({
        id: 'match',
        conditions: [{ field: 'customerProfile.healthScore', operator: 'gt', value: 50 }],
      });
      const nonMatching = createRule({
        id: 'no-match',
        conditions: [{ field: 'customerProfile.healthScore', operator: 'gt', value: 90 }],
      });

      const ctx = createTestContext();
      const results = engine.matchRules(ctx, [matching, nonMatching]);

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('match');
    });
  });
});

// ─── Built-in Rules ──────────────────────────────────────────────

describe('Built-in Rules', () => {
  let store: InMemoryRuleStore;
  let engine: RulesEngine;

  beforeEach(() => {
    store = new InMemoryRuleStore();
    engine = new RulesEngine(store);
  });

  it('should have 5 built-in rules', () => {
    expect(BUILTIN_RULES).toHaveLength(5);
  });

  it('collections_initial_contact should match overdue + no contact in 7 days', async () => {
    const tenantRules = copyBuiltinRulesForTenant('tenant-1');
    store.seed(tenantRules);

    const ctx = createTestContext({
      customerProfile: {
        ...createTestContext().customerProfile,
        outstandingBalance: 5000,
        daysSinceLastContact: 10,
      },
    });

    const result = await engine.evaluate(ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      const initialContact = result.data.find((r) => r.ruleName === 'Collections: Initial Contact');
      expect(initialContact?.matched).toBe(true);
    }
  });

  it('collections_escalation should match 3+ failed contacts', async () => {
    const tenantRules = copyBuiltinRulesForTenant('tenant-1');
    store.seed(tenantRules);

    const ctx = createTestContext({
      eventPayload: { failedContactCount: 4 },
    });

    const result = await engine.evaluate(ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      const escalation = result.data.find((r) => r.ruleName === 'Collections: Escalation');
      expect(escalation?.matched).toBe(true);
    }
  });

  it('collections_cease should match STOP response', async () => {
    const tenantRules = copyBuiltinRulesForTenant('tenant-1');
    store.seed(tenantRules);

    const ctx = createTestContext({
      eventPayload: { customerResponse: 'stop' },
    });

    const result = await engine.evaluate(ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      const cease = result.data.find((r) => r.ruleName === 'Collections: Cease Communication');
      expect(cease?.matched).toBe(true);
      expect(cease?.action?.type).toBe('cease_communication');
    }
  });

  it('collections_payment_plan should match positive response with balance', async () => {
    const tenantRules = copyBuiltinRulesForTenant('tenant-1');
    store.seed(tenantRules);

    const ctx = createTestContext({
      eventPayload: { customerResponse: 'positive' },
    });

    const result = await engine.evaluate(ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      const plan = result.data.find((r) => r.ruleName === 'Collections: Payment Plan Offer');
      expect(plan?.matched).toBe(true);
      expect(plan?.action?.type).toBe('offer_payment_plan');
    }
  });

  it('high_value_routing should match high LTV customers', async () => {
    const tenantRules = copyBuiltinRulesForTenant('tenant-1');
    store.seed(tenantRules);

    const ctx = createTestContext({
      customerProfile: {
        ...createTestContext().customerProfile,
        ltv: 75000,
      },
    });

    const result = await engine.evaluate(ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      const hvr = result.data.find((r) => r.ruleName === 'High Value: Premium Routing');
      expect(hvr?.matched).toBe(true);
      expect(hvr?.action?.type).toBe('route_to_agent');
    }
  });

  it('copyBuiltinRulesForTenant should replace tenant ID', () => {
    const rules = copyBuiltinRulesForTenant('my-tenant');
    for (const rule of rules) {
      expect(rule.tenantId).toBe('my-tenant');
      expect(rule.id).toContain('my-tenant');
      expect(rule.id).not.toContain('builtin_');
    }
  });
});

// ─── InMemoryRuleStore ───────────────────────────────────────────

describe('InMemoryRuleStore', () => {
  let store: InMemoryRuleStore;

  beforeEach(() => {
    store = new InMemoryRuleStore();
  });

  it('should create and retrieve a rule', async () => {
    const rule = createRule();
    await store.createRule(rule);
    const retrieved = await store.getRule('rule-1', 'tenant-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Test Rule');
  });

  it('should return undefined for non-existent rule', async () => {
    const retrieved = await store.getRule('non-existent', 'tenant-1');
    expect(retrieved).toBeUndefined();
  });

  it('should not return rules from other tenants', async () => {
    const rule = createRule({ tenantId: 'other-tenant' });
    await store.createRule(rule);
    const retrieved = await store.getRule('rule-1', 'tenant-1');
    expect(retrieved).toBeUndefined();
  });

  it('should update a rule', async () => {
    const rule = createRule();
    await store.createRule(rule);
    await store.updateRule({ ...rule, name: 'Updated Rule' });
    const retrieved = await store.getRule('rule-1', 'tenant-1');
    expect(retrieved?.name).toBe('Updated Rule');
  });

  it('should delete a rule', async () => {
    const rule = createRule();
    await store.createRule(rule);
    await store.deleteRule('rule-1', 'tenant-1');
    const retrieved = await store.getRule('rule-1', 'tenant-1');
    expect(retrieved).toBeUndefined();
  });

  it('should only return enabled rules via getRules', async () => {
    const enabled = createRule({ id: 'enabled', enabled: true, conditions: [] });
    const disabled = createRule({ id: 'disabled', enabled: false, conditions: [] });
    store.seed([enabled, disabled]);

    const rules = await store.getRules('tenant-1');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe('enabled');
  });

  it('should clear all rules', () => {
    store.seed([createRule()]);
    store.clear();
    // getRules is async, so let's test via getRule
    void store.getRules('tenant-1').then((rules) => {
      expect(rules).toHaveLength(0);
    });
  });
});
