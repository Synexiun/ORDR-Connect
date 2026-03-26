/**
 * @ordr/decision-engine — LLM Reasoner Tests (Layer 3)
 *
 * Tests prompt construction (no PHI), response parsing, low confidence
 * rejection, model tier selection, and error handling.
 *
 * Uses mock LLMClient to avoid real API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, InternalError, ValidationError, RateLimitError } from '@ordr/core';
import { LLMReasoner } from '../llm-reasoner.js';
import type { PromptRegistryInterface } from '../llm-reasoner.js';
import type { DecisionContext, RuleResult, MLPrediction } from '../types.js';
import type { LLMClient, LLMResponse } from '@ordr/ai';

// ─── Mocks ───────────────────────────────────────────────────────

function createMockLLMClient(response?: Partial<LLMResponse>, shouldFail?: boolean): LLMClient {
  const defaultResponse: LLMResponse = {
    content: JSON.stringify({
      action: 'send_sms',
      channel: 'sms',
      parameters: { template: 'payment_reminder' },
      confidence: 0.85,
      reasoning: 'Customer has overdue balance and responds well to SMS',
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
        ? err(new InternalError('LLM API failure'))
        : ok(defaultResponse),
    ),
  } as unknown as LLMClient;
}

function createMockPromptRegistry(): PromptRegistryInterface {
  return {
    get: vi.fn().mockReturnValue(undefined),
  };
}

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
      paymentHistory: [],
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

function createRuleResults(): readonly RuleResult[] {
  return [
    {
      ruleId: 'rule-1',
      ruleName: 'Test Rule',
      matched: true,
      action: { type: 'send_sms', channel: 'sms', parameters: {} },
      score: 1.0,
      reasoning: 'Rule matched',
    },
  ];
}

function createMLScores(): readonly MLPrediction[] {
  return [
    { modelName: 'propensity_to_pay', score: 0.75, confidence: 0.65, featuresUsed: ['health_score'] },
    { modelName: 'churn_risk', score: 0.3, confidence: 0.70, featuresUsed: ['sentiment_avg'] },
  ];
}

// ─── Tests ───────────────────────────────────────────────────────

describe('LLMReasoner', () => {
  let client: LLMClient;
  let registry: PromptRegistryInterface;
  let reasoner: LLMReasoner;

  beforeEach(() => {
    client = createMockLLMClient();
    registry = createMockPromptRegistry();
    reasoner = new LLMReasoner(client, registry);
  });

  describe('reason', () => {
    it('should return a valid Decision on successful reasoning', async () => {
      const ctx = createTestContext();
      const result = await reasoner.reason(ctx, createRuleResults(), createMLScores());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe('send_sms');
        expect(result.data.channel).toBe('sms');
        expect(result.data.confidence).toBe(0.85);
        expect(result.data.tenantId).toBe('tenant-1');
        expect(result.data.customerId).toBe('cust-1');
        expect(result.data.layersUsed).toContain('llm');
      }
    });

    it('should reject LLM response with confidence below 0.5', async () => {
      client = createMockLLMClient({
        content: JSON.stringify({
          action: 'send_sms',
          channel: 'sms',
          parameters: {},
          confidence: 0.3,
          reasoning: 'Not sure about this',
        }),
      });
      reasoner = new LLMReasoner(client, registry);

      const ctx = createTestContext();
      const result = await reasoner.reason(ctx, createRuleResults(), createMLScores());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('should handle LLM API failure', async () => {
      client = createMockLLMClient(undefined, true);
      reasoner = new LLMReasoner(client, registry);

      const ctx = createTestContext();
      const result = await reasoner.reason(ctx, createRuleResults(), createMLScores());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('should handle invalid JSON response', async () => {
      client = createMockLLMClient({
        content: 'This is not JSON at all',
      });
      reasoner = new LLMReasoner(client, registry);

      const ctx = createTestContext();
      const result = await reasoner.reason(ctx, createRuleResults(), createMLScores());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('should handle JSON with invalid schema', async () => {
      client = createMockLLMClient({
        content: JSON.stringify({
          action: 'invalid_action_type',
          confidence: 2.0,
        }),
      });
      reasoner = new LLMReasoner(client, registry);

      const ctx = createTestContext();
      const result = await reasoner.reason(ctx, createRuleResults(), createMLScores());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('should extract JSON from markdown code blocks', async () => {
      const json = JSON.stringify({
        action: 'send_email',
        channel: 'email',
        parameters: {},
        confidence: 0.9,
        reasoning: 'Email is the best channel',
      });
      client = createMockLLMClient({
        content: `Here is my recommendation:\n\`\`\`json\n${json}\n\`\`\``,
      });
      reasoner = new LLMReasoner(client, registry);

      const ctx = createTestContext();
      const result = await reasoner.reason(ctx, createRuleResults(), createMLScores());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe('send_email');
      }
    });

    it('should handle null channel in response', async () => {
      client = createMockLLMClient({
        content: JSON.stringify({
          action: 'escalate_to_human',
          channel: null,
          parameters: { reason: 'complex case' },
          confidence: 0.75,
          reasoning: 'Escalation needed',
        }),
      });
      reasoner = new LLMReasoner(client, registry);

      const ctx = createTestContext();
      const result = await reasoner.reason(ctx, createRuleResults(), createMLScores());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe('escalate_to_human');
        expect(result.data.channel).toBeUndefined();
      }
    });

    it('should set expiry time on decision', async () => {
      const ctx = createTestContext();
      const result = await reasoner.reason(ctx, createRuleResults(), createMLScores());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expiresAt.getTime()).toBeGreaterThan(result.data.evaluatedAt.getTime());
      }
    });
  });

  describe('buildReasoningPrompt', () => {
    it('should construct a prompt with no raw PII', () => {
      const ctx = createTestContext();
      const messages = reasoner.buildReasoningPrompt(ctx, createRuleResults(), createMLScores());

      expect(messages.length).toBeGreaterThan(0);

      // Check that no raw PII leaks — prompt should use tokenized IDs only
      const content = messages.map((m) => m.content).join(' ');
      expect(content).toContain('cust-1'); // tokenized ID is acceptable
      expect(content).toContain('Health Score: 65');
      expect(content).toContain('Lifecycle Stage: active');
      expect(content).not.toContain('John'); // No real names
      expect(content).not.toContain('@'); // No emails
      expect(content).not.toContain('555-'); // No phone numbers
    });

    it('should include rule results in prompt', () => {
      const ctx = createTestContext();
      const messages = reasoner.buildReasoningPrompt(ctx, createRuleResults(), createMLScores());
      const content = messages.map((m) => m.content).join(' ');

      expect(content).toContain('Test Rule');
      expect(content).toContain('send_sms');
    });

    it('should include ML scores in prompt', () => {
      const ctx = createTestContext();
      const messages = reasoner.buildReasoningPrompt(ctx, createRuleResults(), createMLScores());
      const content = messages.map((m) => m.content).join(' ');

      expect(content).toContain('propensity_to_pay');
      expect(content).toContain('churn_risk');
    });

    it('should handle empty rule results and ML scores', () => {
      const ctx = createTestContext();
      const messages = reasoner.buildReasoningPrompt(ctx, [], []);
      const content = messages.map((m) => m.content).join(' ');

      expect(content).toContain('No rules matched');
      expect(content).toContain('No ML scores available');
    });

    it('should include constraints in prompt', () => {
      const ctx = createTestContext({
        constraints: {
          budgetCents: 500,
          timeWindowMinutes: undefined,
          blockedChannels: ['voice'],
          maxContactsPerWeek: 3,
          maxSmsPerDay: 1,
          maxEmailsPerWeek: 5,
        },
      });
      const messages = reasoner.buildReasoningPrompt(ctx, [], []);
      const content = messages.map((m) => m.content).join(' ');

      expect(content).toContain('500 cents');
      expect(content).toContain('voice');
    });

    it('should show LTV tier as high for high-value customers', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          ltv: 75000,
        },
      });
      const messages = reasoner.buildReasoningPrompt(ctx, [], []);
      const content = messages.map((m) => m.content).join(' ');

      expect(content).toContain('LTV Tier: high');
    });

    it('should show LTV tier as standard for normal customers', () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          ltv: 10000,
        },
      });
      const messages = reasoner.buildReasoningPrompt(ctx, [], []);
      const content = messages.map((m) => m.content).join(' ');

      expect(content).toContain('LTV Tier: standard');
    });
  });

  describe('model tier selection', () => {
    it('should use premium tier for high-LTV customers', async () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          ltv: 75000,
        },
      });

      await reasoner.reason(ctx, [], []);

      const completeFn = client.complete as ReturnType<typeof vi.fn>;
      const callArgs = completeFn.mock.calls[0]?.[0];
      expect(callArgs?.modelTier).toBe('premium');
    });

    it('should use standard tier for normal customers', async () => {
      const ctx = createTestContext({
        customerProfile: {
          ...createTestContext().customerProfile,
          ltv: 10000,
        },
      });

      await reasoner.reason(ctx, [], []);

      const completeFn = client.complete as ReturnType<typeof vi.fn>;
      const callArgs = completeFn.mock.calls[0]?.[0];
      expect(callArgs?.modelTier).toBe('standard');
    });
  });
});
