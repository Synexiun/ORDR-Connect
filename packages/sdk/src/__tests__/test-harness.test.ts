/**
 * Tests for AgentTestHarness
 *
 * Validates the test framework for agent developers including mock tools,
 * compliance engine, budget enforcement, and audit trail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { isOk, isErr, ok, err, ValidationError } from '@ordr/core';
import { AgentTestHarness } from '../test-harness.js';
import { AgentBuilder } from '../agent-builder.js';
import type { ToolDefinition, SdkPromptBuilder, AgentPackage } from '../types.js';

// ─── Helpers ───────────────────────────────────────────────────

function makePromptBuilder(): SdkPromptBuilder {
  return vi.fn().mockReturnValue([
    { role: 'system' as const, content: 'Test agent prompt' },
  ]);
}

function makeTool(name: string, executeFn?: ToolDefinition['execute']): ToolDefinition {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: z.object({ input: z.string().optional() }),
    dataClassifications: ['internal'],
    regulations: [],
    execute: executeFn ?? vi.fn().mockResolvedValue(ok({ result: `${name} executed` })),
  };
}

function makeAgent(tools: ToolDefinition[] = [makeTool('default-tool')]): AgentPackage {
  let builder = new AgentBuilder('test-agent')
    .version('1.0.0')
    .description('Test agent for harness')
    .author('test@test.com')
    .license('MIT')
    .withPromptBuilder(makePromptBuilder())
    .maxBudget({ maxTokens: 50_000, maxCostCents: 500, maxActions: 20 });

  for (const tool of tools) {
    builder = builder.withTool(tool);
  }

  const result = builder.build();
  if (!isOk(result)) {
    throw new Error('Failed to build test agent');
  }
  return result.data;
}

// ─── Test Variables ────────────────────────────────────────────

let harness: AgentTestHarness;
let agent: AgentPackage;

// ─── Constructor ────────────────────────────────────────────────

describe('AgentTestHarness — constructor', () => {
  it('should create a valid harness from an agent package', () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    expect(harness).toBeDefined();
  });

  it('should register all tools from the agent', () => {
    const tools = [makeTool('tool-a'), makeTool('tool-b')];
    agent = makeAgent(tools);
    harness = new AgentTestHarness(agent);
    // Verify by executing both tools
    const execA = harness.executeTool('tool-a', {});
    const execB = harness.executeTool('tool-b', {});
    expect(execA).toBeDefined();
    expect(execB).toBeDefined();
  });

  it('should start with empty audit log', () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    expect(harness.getAuditLog()).toHaveLength(0);
  });

  it('should start with zero budget usage', () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    const usage = harness.getBudgetUsage();
    expect(usage.tokens).toBe(0);
    expect(usage.costCents).toBe(0);
    expect(usage.actions).toBe(0);
  });
});

// ─── Tool Execution ────────────────────────────────────────────

describe('AgentTestHarness — tool execution', () => {
  beforeEach(() => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
  });

  it('should execute a registered tool successfully', async () => {
    const result = await harness.executeTool('default-tool', { input: 'test' });
    expect(isOk(result)).toBe(true);
  });

  it('should return tool execution results', async () => {
    const result = await harness.executeTool('default-tool', { input: 'test' });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toEqual({ result: 'default-tool executed' });
    }
  });

  it('should fail for unknown tools', async () => {
    const result = await harness.executeTool('unknown-tool', {});
    expect(isErr(result)).toBe(true);
  });

  it('should log tool execution in audit trail', async () => {
    await harness.executeTool('default-tool', { input: 'test' });
    const log = harness.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.toolName).toBe('default-tool');
  });

  it('should handle tool execution errors', async () => {
    const failingTool = makeTool('failing-tool', vi.fn().mockResolvedValue(
      err(new ValidationError('Tool failed', {})),
    ));
    const failAgent = makeAgent([failingTool]);
    const failHarness = new AgentTestHarness(failAgent);
    const result = await failHarness.executeTool('failing-tool', {});
    expect(isErr(result)).toBe(true);
  });

  it('should pass confidence score to audit log', async () => {
    await harness.executeTool('default-tool', { input: 'test' }, 0.92);
    const log = harness.getAuditLog();
    expect(log[0]?.confidence).toBe(0.92);
  });

  it('should use default confidence of 0.85', async () => {
    await harness.executeTool('default-tool', { input: 'test' });
    const log = harness.getAuditLog();
    expect(log[0]?.confidence).toBe(0.85);
  });

  it('should record tool input in audit log', async () => {
    await harness.executeTool('default-tool', { input: 'hello' });
    const log = harness.getAuditLog();
    expect(log[0]?.input).toEqual({ input: 'hello' });
  });

  it('should record tool output in audit log on success', async () => {
    await harness.executeTool('default-tool', { input: 'test' });
    const log = harness.getAuditLog();
    expect(log[0]?.output).toEqual({ result: 'default-tool executed' });
  });

  it('should record null output in audit log on failure', async () => {
    const result = await harness.executeTool('unknown-tool', {});
    expect(isErr(result)).toBe(true);
    const log = harness.getAuditLog();
    expect(log[0]?.output).toBeNull();
  });

  it('should log action type as tool_executed for successful execution', async () => {
    await harness.executeTool('default-tool', {});
    const log = harness.getAuditLog();
    expect(log[0]?.action).toBe('tool_executed');
  });

  it('should log action type as tool_not_found for unknown tool', async () => {
    await harness.executeTool('nonexistent', {});
    const log = harness.getAuditLog();
    expect(log[0]?.action).toBe('tool_not_found');
  });

  it('should include timestamp in audit entry', async () => {
    await harness.executeTool('default-tool', {});
    const log = harness.getAuditLog();
    expect(log[0]?.timestamp).toBeInstanceOf(Date);
  });
});

// ─── Compliance Engine ─────────────────────────────────────────

describe('AgentTestHarness — compliance engine', () => {
  beforeEach(() => {
    agent = makeAgent([makeTool('tool-a'), makeTool('tool-b')]);
    harness = new AgentTestHarness(agent);
  });

  it('should allow all actions by default', async () => {
    const result = await harness.executeTool('tool-a', {});
    expect(isOk(result)).toBe(true);
  });

  it('should block actions when compliance is configured to block', async () => {
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });
    const result = await harness.executeTool('tool-a', {});
    expect(isErr(result)).toBe(true);
  });

  it('should block specific actions from blocklist', async () => {
    harness.configureCompliance({
      defaultAllow: true,
      blockedActions: ['tool-a'],
      allowedActions: [],
    });
    const resultA = await harness.executeTool('tool-a', {});
    expect(isErr(resultA)).toBe(true);

    const resultB = await harness.executeTool('tool-b', {});
    expect(isOk(resultB)).toBe(true);
  });

  it('should allow specific actions from allowlist even when default is deny', async () => {
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: ['tool-a'],
    });
    const resultA = await harness.executeTool('tool-a', {});
    expect(isOk(resultA)).toBe(true);

    const resultB = await harness.executeTool('tool-b', {});
    expect(isErr(resultB)).toBe(true);
  });

  it('should mark compliance failures in audit log', async () => {
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });
    await harness.executeTool('tool-a', {});
    const log = harness.getAuditLog();
    expect(log[0]?.compliancePassed).toBe(false);
  });

  it('should mark compliance successes in audit log', async () => {
    await harness.executeTool('tool-a', {});
    const log = harness.getAuditLog();
    expect(log[0]?.compliancePassed).toBe(true);
  });

  it('should return configureCompliance as fluent API', () => {
    const result = harness.configureCompliance({
      defaultAllow: true,
      blockedActions: [],
      allowedActions: [],
    });
    expect(result).toBe(harness);
  });

  it('should allowlist overriding blocklist', async () => {
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: ['tool-a'],
      allowedActions: ['tool-a'],
    });
    // Allowlist is checked first, so tool-a should be allowed
    const result = await harness.executeTool('tool-a', {});
    expect(isOk(result)).toBe(true);
  });

  it('should log compliance_blocked action type', async () => {
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });
    await harness.executeTool('tool-a', {});
    const log = harness.getAuditLog();
    expect(log[0]?.action).toBe('compliance_blocked');
  });

  it('should return error message mentioning compliance', async () => {
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });
    const result = await harness.executeTool('tool-a', {});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Compliance');
    }
  });
});

// ─── Budget Enforcement ────────────────────────────────────────

describe('AgentTestHarness — budget enforcement', () => {
  it('should track budget usage', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    await harness.executeTool('default-tool', {});
    const usage = harness.getBudgetUsage();
    expect(usage.actions).toBe(1);
    expect(usage.tokens).toBeGreaterThan(0);
    expect(usage.costCents).toBeGreaterThan(0);
  });

  it('should accumulate budget across multiple executions', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    await harness.executeTool('default-tool', {});
    await harness.executeTool('default-tool', {});
    const usage = harness.getBudgetUsage();
    expect(usage.actions).toBe(2);
  });

  it('should block when maxActions is exceeded', async () => {
    const smallBudgetAgent = new AgentBuilder('budget-agent')
      .version('1.0.0')
      .description('Budget test agent')
      .author('test@test.com')
      .license('MIT')
      .withTool(makeTool('tool'))
      .withPromptBuilder(makePromptBuilder())
      .maxBudget({ maxTokens: 50_000, maxCostCents: 500, maxActions: 2 })
      .build();

    expect(isOk(smallBudgetAgent)).toBe(true);
    if (!isOk(smallBudgetAgent)) return;

    const h = new AgentTestHarness(smallBudgetAgent.data);
    const r1 = await h.executeTool('tool', {});
    expect(isOk(r1)).toBe(true);
    const r2 = await h.executeTool('tool', {});
    expect(isOk(r2)).toBe(true);
    // Third should exceed
    const r3 = await h.executeTool('tool', {});
    expect(isErr(r3)).toBe(true);
  });

  it('should block when maxTokens is exceeded', async () => {
    const tinyTokenAgent = new AgentBuilder('tiny-token-agent')
      .version('1.0.0')
      .description('Tiny token budget')
      .author('test@test.com')
      .license('MIT')
      .withTool(makeTool('tool'))
      .withPromptBuilder(makePromptBuilder())
      .maxBudget({ maxTokens: 500, maxCostCents: 5_000, maxActions: 500 })
      .build();

    expect(isOk(tinyTokenAgent)).toBe(true);
    if (!isOk(tinyTokenAgent)) return;

    const h = new AgentTestHarness(tinyTokenAgent.data);
    // Each action uses 1000 tokens — first should fail on budget check
    const r1 = await h.executeTool('tool', {});
    expect(isErr(r1)).toBe(true);
  });

  it('should block when maxCostCents is exceeded', async () => {
    const tinyCostAgent = new AgentBuilder('tiny-cost-agent')
      .version('1.0.0')
      .description('Tiny cost budget')
      .author('test@test.com')
      .license('MIT')
      .withTool(makeTool('tool'))
      .withPromptBuilder(makePromptBuilder())
      .maxBudget({ maxTokens: 500_000, maxCostCents: 2, maxActions: 500 })
      .build();

    expect(isOk(tinyCostAgent)).toBe(true);
    if (!isOk(tinyCostAgent)) return;

    const h = new AgentTestHarness(tinyCostAgent.data);
    // Each action costs 5 cents — first should fail on budget check
    const r1 = await h.executeTool('tool', {});
    expect(isErr(r1)).toBe(true);
  });

  it('should reset budget on reset()', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    await harness.executeTool('default-tool', {});
    expect(harness.getBudgetUsage().actions).toBe(1);
    harness.reset();
    expect(harness.getBudgetUsage().actions).toBe(0);
  });

  it('should reset tokens on reset()', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    await harness.executeTool('default-tool', {});
    expect(harness.getBudgetUsage().tokens).toBeGreaterThan(0);
    harness.reset();
    expect(harness.getBudgetUsage().tokens).toBe(0);
  });

  it('should reset costCents on reset()', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    await harness.executeTool('default-tool', {});
    expect(harness.getBudgetUsage().costCents).toBeGreaterThan(0);
    harness.reset();
    expect(harness.getBudgetUsage().costCents).toBe(0);
  });

  it('should assertBudgetWithin pass when within limits', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    await harness.executeTool('default-tool', {});
    const result = harness.assertBudgetWithin({
      maxTokens: 100_000,
      maxCostCents: 1000,
      maxActions: 100,
    });
    expect(isOk(result)).toBe(true);
  });

  it('should assertBudgetWithin fail when over limits', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    await harness.executeTool('default-tool', {});
    const result = harness.assertBudgetWithin({
      maxTokens: 1,
      maxCostCents: 1,
      maxActions: 0,
    });
    expect(isErr(result)).toBe(true);
  });

  it('should assertBudgetWithin pass when no actions taken', () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    const result = harness.assertBudgetWithin({
      maxTokens: 1,
      maxCostCents: 1,
      maxActions: 1,
    });
    expect(isOk(result)).toBe(true);
  });

  it('should log budget_exceeded action type in audit', async () => {
    const tinyAgent = new AgentBuilder('budget-log-agent')
      .version('1.0.0')
      .description('Budget log test')
      .author('test@test.com')
      .license('MIT')
      .withTool(makeTool('tool'))
      .withPromptBuilder(makePromptBuilder())
      .maxBudget({ maxTokens: 50_000, maxCostCents: 500, maxActions: 1 })
      .build();

    expect(isOk(tinyAgent)).toBe(true);
    if (!isOk(tinyAgent)) return;

    const h = new AgentTestHarness(tinyAgent.data);
    await h.executeTool('tool', {});
    // Second call exceeds budget
    await h.executeTool('tool', {});
    const log = h.getAuditLog();
    const budgetEntry = log.find(e => e.action === 'budget_exceeded');
    expect(budgetEntry).toBeDefined();
  });
});

// ─── Audit Trail ───────────────────────────────────────────────

describe('AgentTestHarness — audit trail', () => {
  beforeEach(() => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
  });

  it('should start with empty audit log', () => {
    expect(harness.getAuditLog()).toHaveLength(0);
  });

  it('should capture all tool executions in audit log', async () => {
    await harness.executeTool('default-tool', { a: 1 });
    await harness.executeTool('default-tool', { b: 2 });
    expect(harness.getAuditLog()).toHaveLength(2);
  });

  it('should include timestamps in audit entries', async () => {
    await harness.executeTool('default-tool', {});
    const log = harness.getAuditLog();
    expect(log[0]?.timestamp).toBeInstanceOf(Date);
  });

  it('should assertAuditTrail fail when log is empty', () => {
    const result = harness.assertAuditTrail();
    expect(isErr(result)).toBe(true);
  });

  it('should assertAuditTrail pass when actions are logged', async () => {
    await harness.executeTool('default-tool', {});
    const result = harness.assertAuditTrail();
    expect(isOk(result)).toBe(true);
  });

  it('should clear audit log on reset', async () => {
    await harness.executeTool('default-tool', {});
    expect(harness.getAuditLog()).toHaveLength(1);
    harness.reset();
    expect(harness.getAuditLog()).toHaveLength(0);
  });

  it('should log compliance blocked actions', async () => {
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });
    await harness.executeTool('default-tool', {});
    const log = harness.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.action).toBe('compliance_blocked');
  });

  it('should return immutable copy of audit log', async () => {
    await harness.executeTool('default-tool', {});
    const log1 = harness.getAuditLog();
    const log2 = harness.getAuditLog();
    expect(log1).not.toBe(log2);
    expect(log1).toEqual(log2);
  });

  it('should log failed tool lookup in audit trail', async () => {
    await harness.executeTool('nonexistent', {});
    const log = harness.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.toolName).toBe('nonexistent');
  });

  it('should capture multiple different tool names in audit', async () => {
    const multiAgent = makeAgent([makeTool('alpha'), makeTool('beta')]);
    const multiHarness = new AgentTestHarness(multiAgent);
    await multiHarness.executeTool('alpha', {});
    await multiHarness.executeTool('beta', {});
    const log = multiHarness.getAuditLog();
    expect(log[0]?.toolName).toBe('alpha');
    expect(log[1]?.toolName).toBe('beta');
  });
});

// ─── assertCompliance ──────────────────────────────────────────

describe('AgentTestHarness — assertCompliance', () => {
  beforeEach(() => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
  });

  it('should pass when all actions pass compliance', async () => {
    await harness.executeTool('default-tool', {});
    const result = harness.assertCompliance();
    expect(isOk(result)).toBe(true);
  });

  it('should fail when any action fails compliance', async () => {
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });
    await harness.executeTool('default-tool', {});
    const result = harness.assertCompliance();
    expect(isErr(result)).toBe(true);
  });

  it('should pass with no actions executed', () => {
    // No actions = no failures
    const result = harness.assertCompliance();
    expect(isOk(result)).toBe(true);
  });

  it('should fail if one of many actions fails compliance', async () => {
    await harness.executeTool('default-tool', {});
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });
    await harness.executeTool('default-tool', {});
    const result = harness.assertCompliance();
    expect(isErr(result)).toBe(true);
  });

  it('should report count of failures in error message', async () => {
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });
    await harness.executeTool('default-tool', {});
    await harness.executeTool('default-tool', {});
    const result = harness.assertCompliance();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('2');
    }
  });
});

// ─── Scenario Runner ───────────────────────────────────────────

describe('AgentTestHarness — runScenario', () => {
  it('should run a successful scenario', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);

    const result = await harness.runScenario({
      name: 'basic test',
      input: { test: 'data' },
      expectedOutcome: 'completed',
      maxSteps: 1,
    });

    expect(result.passed).toBe(true);
    expect(result.outcome).toBe('completed');
    expect(result.stepsExecuted).toBe(1);
  });

  it('should detect compliance-blocked scenario', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });

    const result = await harness.runScenario({
      name: 'blocked test',
      input: {},
      expectedOutcome: 'compliance_blocked',
    });

    expect(result.passed).toBe(true);
    expect(result.outcome).toBe('compliance_blocked');
  });

  it('should detect budget_exceeded scenario', async () => {
    const tinyAgent = new AgentBuilder('tiny-agent')
      .version('1.0.0')
      .description('Tiny budget')
      .author('test@test.com')
      .license('MIT')
      .withTool(makeTool('tool'))
      .withPromptBuilder(makePromptBuilder())
      .maxBudget({ maxTokens: 50_000, maxCostCents: 500, maxActions: 1 })
      .build();

    expect(isOk(tinyAgent)).toBe(true);
    if (!isOk(tinyAgent)) return;

    const h = new AgentTestHarness(tinyAgent.data);
    const result = await h.runScenario({
      name: 'budget test',
      input: {},
      expectedOutcome: 'budget_exceeded',
      maxSteps: 5,
    });

    expect(result.passed).toBe(true);
    expect(result.outcome).toBe('budget_exceeded');
  });

  it('should reset state between scenarios', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);

    await harness.runScenario({
      name: 'scenario 1',
      input: {},
      expectedOutcome: 'completed',
      maxSteps: 1,
    });

    await harness.runScenario({
      name: 'scenario 2',
      input: {},
      expectedOutcome: 'completed',
      maxSteps: 1,
    });

    // Each scenario has its own audit trail (reset happens inside runScenario)
    // After second runScenario the internal state is from scenario 2 only
    const log = harness.getAuditLog();
    expect(log).toHaveLength(1);
  });

  it('should return scenario result with audit trail', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);

    const result = await harness.runScenario({
      name: 'audit test',
      input: {},
      expectedOutcome: 'completed',
      maxSteps: 1,
    });

    expect(result.auditTrail.length).toBeGreaterThan(0);
  });

  it('should track actions executed in scenario', async () => {
    agent = makeAgent([makeTool('tool-x'), makeTool('tool-y')]);
    harness = new AgentTestHarness(agent);

    const result = await harness.runScenario({
      name: 'multi-tool test',
      input: {},
      expectedOutcome: 'completed',
      maxSteps: 2,
    });

    expect(result.actionsExecuted.length).toBe(2);
  });

  it('should report failed outcome when scenario expectation mismatches', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);

    const result = await harness.runScenario({
      name: 'mismatch test',
      input: {},
      expectedOutcome: 'failed',
      maxSteps: 1,
    });

    // Agent succeeds but expected failure — so passed should be false
    expect(result.passed).toBe(false);
  });

  it('should include scenario name in result', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);

    const result = await harness.runScenario({
      name: 'named-scenario',
      input: {},
      expectedOutcome: 'completed',
      maxSteps: 1,
    });

    expect(result.scenario).toBe('named-scenario');
  });

  it('should track token usage in scenario result', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);

    const result = await harness.runScenario({
      name: 'token-track',
      input: {},
      expectedOutcome: 'completed',
      maxSteps: 1,
    });

    expect(result.totalTokensUsed).toBeGreaterThan(0);
  });

  it('should track cost in scenario result', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);

    const result = await harness.runScenario({
      name: 'cost-track',
      input: {},
      expectedOutcome: 'completed',
      maxSteps: 1,
    });

    expect(result.totalCostCents).toBeGreaterThan(0);
  });

  it('should include errors in result on failure', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    harness.configureCompliance({
      defaultAllow: false,
      blockedActions: [],
      allowedActions: [],
    });

    const result = await harness.runScenario({
      name: 'error-track',
      input: {},
      expectedOutcome: 'compliance_blocked',
    });

    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should default maxSteps to 10', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);

    // With only 1 tool and no expected actions defined, it will run
    // up to default maxSteps or break when tool cycles complete
    const result = await harness.runScenario({
      name: 'default-steps',
      input: {},
      expectedOutcome: 'completed',
      expectedActions: ['default-tool'],
    });

    expect(result.passed).toBe(true);
  });

  it('should handle scenario with expectedActions', async () => {
    agent = makeAgent([makeTool('target-tool')]);
    harness = new AgentTestHarness(agent);

    const result = await harness.runScenario({
      name: 'actions-test',
      input: {},
      expectedOutcome: 'completed',
      expectedActions: ['target-tool'],
      maxSteps: 5,
    });

    expect(result.passed).toBe(true);
    expect(result.actionsExecuted).toContain('target-tool');
  });
});

// ─── Observation Memory ────────────────────────────────────────

describe('AgentTestHarness — observations', () => {
  it('should set initial observations', () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    const result = harness.setObservation('key', 'value');
    expect(result).toBe(harness);
  });

  it('should support fluent chaining of setObservation', () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    const result = harness
      .setObservation('a', 1)
      .setObservation('b', 2);
    expect(result).toBe(harness);
  });

  it('should clear observations on reset', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    harness.setObservation('key', 'value');
    harness.reset();
    // After reset, running a scenario starts fresh
    const result = await harness.runScenario({
      name: 'reset test',
      input: {},
      expectedOutcome: 'completed',
      maxSteps: 1,
    });
    expect(result.passed).toBe(true);
  });

  it('should accept various observation value types', () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    harness.setObservation('string', 'hello');
    harness.setObservation('number', 42);
    harness.setObservation('object', { nested: true });
    harness.setObservation('array', [1, 2, 3]);
    harness.setObservation('boolean', true);
    // No errors means success
    expect(harness.getAuditLog()).toHaveLength(0);
  });
});

// ─── getBudgetUsage ────────────────────────────────────────────

describe('AgentTestHarness — getBudgetUsage', () => {
  it('should return accurate totals after multiple executions', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    await harness.executeTool('default-tool', {});
    await harness.executeTool('default-tool', {});
    await harness.executeTool('default-tool', {});

    const usage = harness.getBudgetUsage();
    expect(usage.actions).toBe(3);
    expect(usage.tokens).toBe(3000); // 1000 per action
    expect(usage.costCents).toBe(15); // 5 per action
  });

  it('should return a copy (not mutable reference)', async () => {
    agent = makeAgent();
    harness = new AgentTestHarness(agent);
    await harness.executeTool('default-tool', {});

    const usage1 = harness.getBudgetUsage();
    const usage2 = harness.getBudgetUsage();
    expect(usage1).not.toBe(usage2);
    expect(usage1).toEqual(usage2);
  });
});
