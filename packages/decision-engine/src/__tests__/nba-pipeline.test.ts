/**
 * @ordr/decision-engine — NBA Pipeline Tests (THE CORE)
 *
 * Tests the full 3-layer pipeline: rules-only fast path, ML-augmented,
 * LLM fallback, compliance blocking, candidate ranking, and audit logging.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, InternalError, ValidationError } from '@ordr/core';
import { NBAPipeline } from '../nba-pipeline.js';
import type { NBAPipelineDeps } from '../nba-pipeline.js';
import { RulesEngine, InMemoryRuleStore } from '../rules.js';
import { MLScorer, createDefaultMLScorer } from '../ml-scorer.js';
import { LLMReasoner } from '../llm-reasoner.js';
import type {
  DecisionContext,
  ComplianceGateInterface,
  AuditLoggerInterface,
  RuleDefinition,
  Decision,
} from '../types.js';
import type { LLMClient, LLMResponse } from '@ordr/ai';

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
      ],
    },
    channelPreferences: ['sms', 'email'],
    interactionHistory: [
      {
        id: 'int-1',
        channel: 'sms',
        direction: 'outbound',
        timestamp: new Date('2025-06-14T14:00:00Z'),
        outcome: 'delivered',
        sentiment: 0.5,
        responded: true,
      },
    ],
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

function createTerminalRule(tenantId: string = 'tenant-1'): RuleDefinition {
  return {
    id: 'terminal-rule',
    tenantId,
    name: 'Terminal Cease',
    description: 'Cease all communication',
    priority: 100,
    conditions: [
      { field: 'eventPayload.customerResponse', operator: 'eq', value: 'stop' },
    ],
    action: { type: 'cease_communication', channel: undefined, parameters: {} },
    enabled: true,
    terminal: true,
    regulation: 'fdcpa',
  };
}

function createNonTerminalRule(tenantId: string = 'tenant-1'): RuleDefinition {
  return {
    id: 'non-terminal-rule',
    tenantId,
    name: 'Send Reminder',
    description: 'Send SMS reminder',
    priority: 50,
    conditions: [
      { field: 'customerProfile.outstandingBalance', operator: 'gt', value: 0 },
      { field: 'customerProfile.daysSinceLastContact', operator: 'gte', value: 7 },
    ],
    action: { type: 'send_sms', channel: 'sms', parameters: { template: 'reminder' } },
    enabled: true,
    terminal: false,
    regulation: undefined,
  };
}

function createMockCompliance(allowed: boolean = true): ComplianceGateInterface {
  return {
    check: vi.fn().mockReturnValue({
      allowed,
      violations: allowed ? [] : [
        { ruleId: 'fdcpa-1', regulation: 'fdcpa', passed: false },
      ],
    }),
  };
}

function createMockAuditLogger(): AuditLoggerInterface {
  return {
    log: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  };
}

function createMockLLMClient(response?: Partial<LLMResponse>, shouldFail?: boolean): LLMClient {
  const defaultResponse: LLMResponse = {
    content: JSON.stringify({
      action: 'send_email',
      channel: 'email',
      parameters: {},
      confidence: 0.85,
      reasoning: 'Email recommended by LLM',
    }),
    model: 'claude-sonnet',
    tokenUsage: { input: 500, output: 200, total: 700 },
    costCents: 0.5,
    latencyMs: 1200,
    provider: 'anthropic',
    finishReason: 'end_turn',
    ...response,
  };

  return {
    complete: vi.fn().mockResolvedValue(
      shouldFail
        ? err(new InternalError('LLM failure'))
        : ok(defaultResponse),
    ),
  } as unknown as LLMClient;
}

function createPipeline(overrides: Partial<NBAPipelineDeps> = {}): {
  pipeline: NBAPipeline;
  store: InMemoryRuleStore;
  compliance: ComplianceGateInterface;
  auditLogger: AuditLoggerInterface;
} {
  const store = new InMemoryRuleStore();
  const rules = new RulesEngine(store);
  const ml = createDefaultMLScorer();
  const compliance = createMockCompliance();
  const auditLogger = createMockAuditLogger();
  const llmClient = createMockLLMClient();
  const promptRegistry = { get: vi.fn().mockReturnValue(undefined) };
  const llm = new LLMReasoner(llmClient, promptRegistry);

  const pipeline = new NBAPipeline({
    rules,
    ml,
    llm,
    compliance,
    auditLogger,
    ...overrides,
  });

  return { pipeline, store, compliance, auditLogger };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('NBAPipeline', () => {
  describe('evaluate — full pipeline', () => {
    it('should return a Decision with all three layers', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext();
      const result = await pipeline.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tenantId).toBe('tenant-1');
        expect(result.data.customerId).toBe('cust-1');
        expect(result.data.action).toBeDefined();
        expect(result.data.layersUsed).toContain('rules');
      }
    });

    it('should return no_action when no rules or candidates exist', async () => {
      // Create pipeline with no rules, and LLM will fail to produce a good result
      const llmClient = createMockLLMClient(undefined, true);
      const promptRegistry = { get: vi.fn().mockReturnValue(undefined) };
      const llm = new LLMReasoner(llmClient, promptRegistry);

      const store = new InMemoryRuleStore();
      const rules = new RulesEngine(store);
      const ml = new MLScorer(new Map()); // Empty ML models
      const compliance = createMockCompliance();
      const auditLogger = createMockAuditLogger();

      const pipeline = new NBAPipeline({ rules, ml, llm, compliance, auditLogger });
      const ctx = createTestContext({
        // Ensure ML confidence is low enough to trigger LLM
        customerProfile: {
          ...createTestContext().customerProfile,
          healthScore: 50,
        },
      });
      const result = await pipeline.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe('no_action');
      }
    });
  });

  describe('fast path — terminal rule match', () => {
    it('should return immediately on terminal rule match without invoking ML/LLM', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createTerminalRule());

      const ctx = createTestContext({
        eventPayload: { customerResponse: 'stop' },
      });
      const result = await pipeline.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe('cease_communication');
        expect(result.data.confidence).toBe(1.0);
        expect(result.data.layersUsed).toEqual(['rules']);
        expect(result.data.layersUsed).not.toContain('ml');
        expect(result.data.layersUsed).not.toContain('llm');
      }
    });

    it('should skip fast path when no terminal rule matches', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext();
      const result = await pipeline.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have used more than just rules
        expect(result.data.layersUsed.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('ML-augmented decisions', () => {
    it('should include ML layer when no terminal match', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext();
      const result = await pipeline.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.layersUsed).toContain('ml');
      }
    });

    it('should generate candidates from ML scores', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext();
      const result = await pipeline.evaluate(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have candidates from multiple sources
        expect(result.data.candidates.length).toBeGreaterThan(0);
      }
    });
  });

  describe('LLM fallback', () => {
    it('should invoke LLM when context is complex (at_risk lifecycle)', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          lifecycleStage: 'at_risk',
        },
      });

      const result = await pipeline.evaluate(ctx);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.layersUsed).toContain('llm');
      }
    });

    it('should invoke LLM when health score is low', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          healthScore: 20,
        },
      });

      const result = await pipeline.evaluate(ctx);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.layersUsed).toContain('llm');
      }
    });

    it('should still produce a result when LLM fails', async () => {
      const llmClient = createMockLLMClient(undefined, true);
      const promptRegistry = { get: vi.fn().mockReturnValue(undefined) };
      const llm = new LLMReasoner(llmClient, promptRegistry);

      const { pipeline, store } = createPipeline({ llm });
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          lifecycleStage: 'at_risk',
        },
      });

      const result = await pipeline.evaluate(ctx);
      // Should still succeed using rules + ML results
      expect(result.success).toBe(true);
    });
  });

  describe('compliance blocking', () => {
    it('should block decision when compliance gate fails on terminal rule', async () => {
      const compliance = createMockCompliance(false);
      const { pipeline, store } = createPipeline({ compliance });
      await store.createRule(createTerminalRule());

      const ctx = createTestContext({
        eventPayload: { customerResponse: 'stop' },
      });

      const result = await pipeline.evaluate(ctx);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('COMPLIANCE_VIOLATION');
      }
    });

    it('should block when all candidates fail compliance', async () => {
      const compliance = createMockCompliance(false);
      const { pipeline, store } = createPipeline({ compliance });
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext();
      const result = await pipeline.evaluate(ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('COMPLIANCE_VIOLATION');
      }
    });
  });

  describe('candidate ranking', () => {
    it('should rank candidates by composite score (score * 0.5 + confidence * 0.3 + constraint bonus)', () => {
      const { pipeline } = createPipeline();

      const candidates = [
        {
          action: 'send_sms' as const,
          channel: 'sms' as const,
          score: 0.6,
          confidence: 0.7,
          constraintsSatisfied: true,
          complianceChecked: false,
          estimatedCostCents: 5,
          source: 'rules' as const,
          reasoning: 'Rule match',
        },
        {
          action: 'send_email' as const,
          channel: 'email' as const,
          score: 0.9,
          confidence: 0.9,
          constraintsSatisfied: false,
          complianceChecked: false,
          estimatedCostCents: 1,
          source: 'ml' as const,
          reasoning: 'ML suggestion',
        },
      ];

      const ranked = pipeline.rankCandidates(candidates);

      // Second candidate has higher score+confidence but fails constraints
      // First: 0.6*0.5 + 0.7*0.3 + 0.2 = 0.3 + 0.21 + 0.2 = 0.71
      // Second: 0.9*0.5 + 0.9*0.3 + 0.0 = 0.45 + 0.27 + 0 = 0.72
      expect(ranked[0]?.action).toBe('send_email');
      expect(ranked[1]?.action).toBe('send_sms');
    });

    it('should favor candidates with satisfied constraints', () => {
      const { pipeline } = createPipeline();

      const candidates = [
        {
          action: 'send_sms' as const,
          channel: 'sms' as const,
          score: 0.8,
          confidence: 0.8,
          constraintsSatisfied: true,
          complianceChecked: false,
          estimatedCostCents: 5,
          source: 'rules' as const,
          reasoning: 'Constraints satisfied',
        },
        {
          action: 'send_voice' as const,
          channel: 'voice' as const,
          score: 0.8,
          confidence: 0.8,
          constraintsSatisfied: false,
          complianceChecked: false,
          estimatedCostCents: 25,
          source: 'ml' as const,
          reasoning: 'Constraints not satisfied',
        },
      ];

      const ranked = pipeline.rankCandidates(candidates);
      // Same score and confidence, but SMS has constraint bonus
      expect(ranked[0]?.action).toBe('send_sms');
    });
  });

  describe('candidate generation', () => {
    it('should generate candidates from rules, ML, and LLM', () => {
      const { pipeline } = createPipeline();
      const ctx = createTestContext();

      const ruleResults = [
        {
          ruleId: 'r1',
          ruleName: 'Rule 1',
          matched: true,
          action: { type: 'send_sms' as const, channel: 'sms' as const, parameters: {} },
          score: 1.0,
          reasoning: 'Matched',
        },
        {
          ruleId: 'r2',
          ruleName: 'Rule 2',
          matched: false,
          action: undefined,
          score: 0,
          reasoning: 'Not matched',
        },
      ];

      const mlScores = [
        { modelName: 'propensity_to_pay', score: 0.8, confidence: 0.75, featuresUsed: [] as string[] },
      ];

      const llmDecision: Decision = {
        id: 'dec-1',
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        action: 'send_email',
        channel: 'email',
        parameters: {},
        score: 0.85,
        confidence: 0.9,
        reasoning: 'LLM says email',
        layersUsed: ['llm'],
        candidates: [],
        evaluatedAt: new Date(),
        expiresAt: new Date(),
      };

      const candidates = pipeline.generateCandidates(ruleResults, mlScores, llmDecision, ctx);

      // Should have: 1 from rules (only matched), 1 from ML, 1 from LLM = 3
      expect(candidates.length).toBe(3);
      expect(candidates.some((c) => c.source === 'rules')).toBe(true);
      expect(candidates.some((c) => c.source === 'ml')).toBe(true);
      expect(candidates.some((c) => c.source === 'llm')).toBe(true);
    });

    it('should not generate candidates from unmatched rules', () => {
      const { pipeline } = createPipeline();
      const ctx = createTestContext();

      const ruleResults = [
        { ruleId: 'r1', ruleName: 'Rule 1', matched: false, action: undefined, score: 0, reasoning: 'No match' },
      ];

      const candidates = pipeline.generateCandidates(ruleResults, [], undefined, ctx);
      expect(candidates.length).toBe(0);
    });

    it('should handle undefined LLM decision gracefully', () => {
      const { pipeline } = createPipeline();
      const ctx = createTestContext();

      const candidates = pipeline.generateCandidates([], [], undefined, ctx);
      expect(candidates.length).toBe(0);
    });
  });

  describe('audit logging', () => {
    it('should log audit entries for each layer evaluated', async () => {
      const { pipeline, store, auditLogger } = createPipeline();
      await store.createRule(createTerminalRule());

      const ctx = createTestContext({
        eventPayload: { customerResponse: 'stop' },
      });

      await pipeline.evaluate(ctx);

      const logFn = auditLogger.log as ReturnType<typeof vi.fn>;
      expect(logFn).toHaveBeenCalled();

      // At minimum, rules layer should be logged
      const calls = logFn.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);

      // Check first call has the right structure
      const firstCall = calls[0]?.[0];
      expect(firstCall?.eventType).toBe('agent.decision');
      expect(firstCall?.actorType).toBe('agent');
      expect(firstCall?.actorId).toBe('decision-engine');
      expect(firstCall?.resource).toBe('decision');
    });

    it('should not include PHI in audit entries', async () => {
      const { pipeline, store, auditLogger } = createPipeline();
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext();
      await pipeline.evaluate(ctx);

      const logFn = auditLogger.log as ReturnType<typeof vi.fn>;
      for (const call of logFn.mock.calls) {
        const details = JSON.stringify(call[0]?.details ?? {});
        // Should not contain real PII
        expect(details).not.toContain('john');
        expect(details).not.toContain('@');
        expect(details).not.toContain('555-');
      }
    });

    it('should continue even when audit logging fails', async () => {
      const auditLogger: AuditLoggerInterface = {
        log: vi.fn().mockRejectedValue(new Error('Audit store unavailable')),
      };

      const { pipeline, store } = createPipeline({ auditLogger });
      await store.createRule(createTerminalRule());

      const ctx = createTestContext({
        eventPayload: { customerResponse: 'stop' },
      });

      // Should not throw even though audit logging failed
      const result = await pipeline.evaluate(ctx);
      expect(result.success).toBe(true);
    });
  });

  describe('constraint checking', () => {
    it('should mark candidates as constraint-unsatisfied when channel is blocked', async () => {
      const { pipeline } = createPipeline();

      const ctx = createTestContext({
        constraints: {
          ...createTestContext().constraints,
          blockedChannels: ['sms'],
        },
      });

      const ruleResults = [
        {
          ruleId: 'r1',
          ruleName: 'SMS Rule',
          matched: true,
          action: { type: 'send_sms' as const, channel: 'sms' as const, parameters: {} },
          score: 1.0,
          reasoning: 'Matched',
        },
      ];

      const candidates = pipeline.generateCandidates(ruleResults, [], undefined, ctx);
      expect(candidates[0]?.constraintsSatisfied).toBe(false);
    });

    it('should mark candidates as constraint-unsatisfied when over budget', async () => {
      const { pipeline } = createPipeline();

      const ctx = createTestContext({
        constraints: {
          ...createTestContext().constraints,
          budgetCents: 1, // Very low budget
        },
      });

      const ruleResults = [
        {
          ruleId: 'r1',
          ruleName: 'Voice Rule',
          matched: true,
          action: { type: 'send_voice' as const, channel: 'voice' as const, parameters: {} },
          score: 1.0,
          reasoning: 'Matched',
        },
      ];

      const candidates = pipeline.generateCandidates(ruleResults, [], undefined, ctx);
      // Voice costs 25 cents, budget is 1 cent
      expect(candidates[0]?.constraintsSatisfied).toBe(false);
    });
  });

  describe('decision structure', () => {
    it('should include evaluatedAt and expiresAt', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createTerminalRule());

      const ctx = createTestContext({
        eventPayload: { customerResponse: 'stop' },
      });

      const result = await pipeline.evaluate(ctx);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.evaluatedAt).toBeInstanceOf(Date);
        expect(result.data.expiresAt).toBeInstanceOf(Date);
        expect(result.data.expiresAt.getTime()).toBeGreaterThan(result.data.evaluatedAt.getTime());
      }
    });

    it('should include correlation ID as decision ID', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createTerminalRule());

      const ctx = createTestContext({
        eventPayload: { customerResponse: 'stop' },
      });

      const result = await pipeline.evaluate(ctx);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBeDefined();
        expect(typeof result.data.id).toBe('string');
      }
    });
  });

  describe('complex context detection', () => {
    it('should invoke LLM for churned customers', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          lifecycleStage: 'churned',
        },
      });

      const result = await pipeline.evaluate(ctx);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.layersUsed).toContain('llm');
      }
    });

    it('should invoke LLM when many constraints are active', async () => {
      const { pipeline, store } = createPipeline();
      await store.createRule(createNonTerminalRule());

      const ctx = createTestContext({
        constraints: {
          budgetCents: 100,
          timeWindowMinutes: 30,
          blockedChannels: ['voice', 'sms'],
          maxContactsPerWeek: 1,
          maxSmsPerDay: 0,
          maxEmailsPerWeek: 1,
        },
      });

      const result = await pipeline.evaluate(ctx);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.layersUsed).toContain('llm');
      }
    });
  });
});
