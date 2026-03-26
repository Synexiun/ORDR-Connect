/**
 * Agent Sandbox Tests — constrained execution environment
 *
 * Tests budget enforcement (tokens, cost, actions), tool allowlist,
 * timeout enforcement, output validation, audit logging, kill switch,
 * concurrent sandbox isolation, and graceful shutdown.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { ok, err, AppError } from '@ordr/core';
import type { AgentTool } from '../types.js';
import { AgentSandbox, STEP_TIMEOUT_MS } from '../sandbox.js';
import type { SandboxConfig, SandboxAuditLog } from '../sandbox.js';

// ─── Test Helpers ───────────────────────────────────────────────

function createMockTool(name: string, result: unknown = { success: true }): AgentTool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: z.object({}).passthrough(),
    execute: vi.fn(async () => ok(result)),
  };
}

function createFailingTool(name: string, errorMessage: string = 'Tool failed'): AgentTool {
  return {
    name,
    description: `Failing tool: ${name}`,
    parameters: z.object({}).passthrough(),
    execute: vi.fn(async () => err(new AppError(errorMessage, 'INTERNAL_ERROR', 500, true))),
  };
}

function createSlowTool(name: string, delayMs: number): AgentTool {
  return {
    name,
    description: `Slow tool: ${name}`,
    parameters: z.object({}).passthrough(),
    execute: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return ok({ slow: true });
    }),
  };
}

function createDefaultConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    agentId: 'agent-001',
    agentName: 'test-agent',
    tenantId: 'tenant-001',
    toolAllowlist: ['search', 'lookup'],
    budget: {
      maxTokens: 10_000,
      maxCostCents: 100,
      maxActions: 5,
    },
    ...overrides,
  };
}

let auditLog: SandboxAuditLog;
let auditEvents: Array<{
  tenantId: string;
  eventType: string;
  actorId: string;
  action: string;
  details: Record<string, unknown>;
}>;

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  auditEvents = [];
  auditLog = vi.fn(async (input) => {
    auditEvents.push({
      tenantId: input.tenantId,
      eventType: input.eventType,
      actorId: input.actorId,
      action: input.action,
      details: input.details,
    });
  });
});

// ─── Basic Execution ────────────────────────────────────────────

describe('Basic execution', () => {
  it('executes an allowed tool successfully', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search', { results: ['item1'] }));
    tools.set('lookup', createMockTool('lookup'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    const result = await sandbox.executeStep('search', { query: 'test' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('search');
      expect(result.data.output).toEqual({ results: ['item1'] });
    }
  });

  it('returns step ID for each execution', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    const result = await sandbox.executeStep('search', {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stepId).toBeDefined();
      expect(typeof result.data.stepId).toBe('string');
    }
  });

  it('tracks duration in milliseconds', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    const result = await sandbox.executeStep('search', {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('records steps in history', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    await sandbox.executeStep('search', {});
    await sandbox.executeStep('search', {});

    const steps = sandbox.getSteps();
    expect(steps).toHaveLength(2);
  });

  it('starts with active status', () => {
    const sandbox = new AgentSandbox(createDefaultConfig(), new Map(), auditLog);
    expect(sandbox.isActive()).toBe(true);
  });
});

// ─── Budget Enforcement — Tokens ────────────────────────────────

describe('Budget enforcement — tokens', () => {
  it('allows execution within token budget', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig({ budget: { maxTokens: 1000, maxCostCents: 100, maxActions: 5 } }), tools, auditLog);
    const result = await sandbox.executeStep('search', {}, 500);

    expect(result.success).toBe(true);
  });

  it('blocks execution when token budget would be exceeded', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig({ budget: { maxTokens: 100, maxCostCents: 100, maxActions: 5 } }), tools, auditLog);
    const result = await sandbox.executeStep('search', {}, 200);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('AGENT_SAFETY_BLOCK');
      expect(result.error.message).toContain('Token budget exceeded');
    }
  });

  it('tracks cumulative token usage', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig({ budget: { maxTokens: 1000, maxCostCents: 100, maxActions: 5 } }), tools, auditLog);
    await sandbox.executeStep('search', {}, 400);
    await sandbox.executeStep('search', {}, 400);

    const budget = sandbox.getBudget();
    expect(budget.usedTokens).toBe(800);

    // Third call should fail
    const result = await sandbox.executeStep('search', {}, 300);
    expect(result.success).toBe(false);
  });

  it('audit-logs token budget exceeded', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig({ budget: { maxTokens: 50, maxCostCents: 100, maxActions: 5 } }), tools, auditLog);
    await sandbox.executeStep('search', {}, 100);

    const budgetEvent = auditEvents.find((e) => e.action === 'budget_exceeded_tokens');
    expect(budgetEvent).toBeDefined();
  });
});

// ─── Budget Enforcement — Cost ──────────────────────────────────

describe('Budget enforcement — cost', () => {
  it('blocks execution when cost budget would be exceeded', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig({ budget: { maxTokens: 10000, maxCostCents: 10, maxActions: 5 } }), tools, auditLog);
    const result = await sandbox.executeStep('search', {}, 0, 20);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Cost budget exceeded');
    }
  });

  it('tracks cumulative cost', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig({ budget: { maxTokens: 10000, maxCostCents: 100, maxActions: 5 } }), tools, auditLog);
    await sandbox.executeStep('search', {}, 0, 30);
    await sandbox.executeStep('search', {}, 0, 30);

    const budget = sandbox.getBudget();
    expect(budget.usedCostCents).toBe(60);
  });
});

// ─── Budget Enforcement — Actions ───────────────────────────────

describe('Budget enforcement — actions', () => {
  it('blocks execution when action budget is exhausted', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig({ budget: { maxTokens: 10000, maxCostCents: 100, maxActions: 2 } }), tools, auditLog);
    await sandbox.executeStep('search', {});
    await sandbox.executeStep('search', {});
    const result = await sandbox.executeStep('search', {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Action budget exceeded');
    }
  });

  it('tracks action count correctly', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig({ budget: { maxTokens: 10000, maxCostCents: 100, maxActions: 10 } }), tools, auditLog);
    await sandbox.executeStep('search', {});
    await sandbox.executeStep('search', {});
    await sandbox.executeStep('search', {});

    const budget = sandbox.getBudget();
    expect(budget.usedActions).toBe(3);
  });
});

// ─── Tool Allowlist Enforcement ─────────────────────────────────

describe('Tool allowlist enforcement', () => {
  it('allows execution of tools in the allowlist', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig({ toolAllowlist: ['search'] }), tools, auditLog);
    const result = await sandbox.executeStep('search', {});

    expect(result.success).toBe(true);
  });

  it('blocks execution of tools NOT in the allowlist', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));
    tools.set('dangerous', createMockTool('dangerous'));

    const sandbox = new AgentSandbox(createDefaultConfig({ toolAllowlist: ['search'] }), tools, auditLog);
    const result = await sandbox.executeStep('dangerous', {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('not in the agent allowlist');
    }
  });

  it('returns error for non-existent tools', async () => {
    const tools = new Map<string, AgentTool>();

    const sandbox = new AgentSandbox(createDefaultConfig({ toolAllowlist: ['ghost'] }), tools, auditLog);
    const result = await sandbox.executeStep('ghost', {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('not found');
    }
  });

  it('audit-logs blocked tool attempts', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('blocked', createMockTool('blocked'));

    const sandbox = new AgentSandbox(createDefaultConfig({ toolAllowlist: ['search'] }), tools, auditLog);
    await sandbox.executeStep('blocked', {});

    const blockedEvent = auditEvents.find((e) => e.action === 'tool_blocked');
    expect(blockedEvent).toBeDefined();
    expect(blockedEvent?.details).toHaveProperty('toolName', 'blocked');
  });

  it('includes allowed tools in audit details', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('forbidden', createMockTool('forbidden'));

    const sandbox = new AgentSandbox(createDefaultConfig({ toolAllowlist: ['search', 'lookup'] }), tools, auditLog);
    await sandbox.executeStep('forbidden', {});

    const blockedEvent = auditEvents.find((e) => e.action === 'tool_blocked');
    expect(blockedEvent?.details).toHaveProperty('allowedTools');
    const allowed = blockedEvent?.details['allowedTools'] as string[];
    expect(allowed).toContain('search');
    expect(allowed).toContain('lookup');
  });
});

// ─── Timeout Enforcement ────────────────────────────────────────

describe('Timeout enforcement', () => {
  it('exports STEP_TIMEOUT_MS as 30000', () => {
    expect(STEP_TIMEOUT_MS).toBe(30_000);
  });

  it('handles tools that return errors gracefully', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('failing', createFailingTool('failing', 'Database connection lost'));

    const sandbox = new AgentSandbox(createDefaultConfig({ toolAllowlist: ['failing'] }), tools, auditLog);
    const result = await sandbox.executeStep('failing', {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Database connection lost');
    }
  });
});

// ─── Output Validation ──────────────────────────────────────────

describe('Output validation', () => {
  it('passes when no output schema is configured', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search', { anything: true }));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    const result = await sandbox.executeStep('search', {});

    expect(result.success).toBe(true);
  });

  it('passes when output matches expected object type', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search', { valid: true }));

    const sandbox = new AgentSandbox(
      createDefaultConfig({ outputSchema: { type: 'object' } }),
      tools,
      auditLog,
    );
    const result = await sandbox.executeStep('search', {});

    expect(result.success).toBe(true);
  });

  it('fails when output does not match expected object type', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search', 'just a string'));

    const sandbox = new AgentSandbox(
      createDefaultConfig({ outputSchema: { type: 'object' } }),
      tools,
      auditLog,
    );
    const result = await sandbox.executeStep('search', {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('does not match expected schema');
    }
  });

  it('fails when output is null', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search', null));

    const sandbox = new AgentSandbox(
      createDefaultConfig({ outputSchema: { type: 'object' } }),
      tools,
      auditLog,
    );
    const result = await sandbox.executeStep('search', {});

    expect(result.success).toBe(false);
  });

  it('rejects array output when object is expected', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search', [1, 2, 3]));

    const sandbox = new AgentSandbox(
      createDefaultConfig({ outputSchema: { type: 'object' } }),
      tools,
      auditLog,
    );
    const result = await sandbox.executeStep('search', {});

    expect(result.success).toBe(false);
  });
});

// ─── Audit Logging ──────────────────────────────────────────────

describe('Audit logging', () => {
  it('logs successful step execution', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    await sandbox.executeStep('search', {});

    const successEvent = auditEvents.find((e) => e.action === 'search_success');
    expect(successEvent).toBeDefined();
    expect(successEvent?.tenantId).toBe('tenant-001');
  });

  it('logs failed step execution', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createFailingTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    await sandbox.executeStep('search', {});

    const failEvent = auditEvents.find((e) => e.action === 'search_failed');
    expect(failEvent).toBeDefined();
  });

  it('logs sandbox shutdown', async () => {
    const sandbox = new AgentSandbox(createDefaultConfig(), new Map(), auditLog);
    await sandbox.shutdown();

    const shutdownEvent = auditEvents.find((e) => e.action === 'sandbox_shutdown');
    expect(shutdownEvent).toBeDefined();
  });

  it('includes budget info in audit details', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    await sandbox.executeStep('search', {}, 100, 5);

    const event = auditEvents.find((e) => e.action === 'search_success');
    expect(event?.details).toHaveProperty('budgetUsed');
  });

  it('includes agent info in audit details', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    await sandbox.executeStep('search', {});

    const event = auditEvents.find((e) => e.action === 'search_success');
    expect(event?.details).toHaveProperty('agentId', 'agent-001');
    expect(event?.details).toHaveProperty('agentName', 'test-agent');
  });
});

// ─── Kill Switch ────────────────────────────────────────────────

describe('Kill switch', () => {
  it('stops execution immediately when killed', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    sandbox.kill('Emergency shutdown');

    const result = await sandbox.executeStep('search', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('AGENT_SAFETY_BLOCK');
      expect(result.error.message).toContain('Sandbox killed');
    }
  });

  it('sets sandbox to inactive after kill', () => {
    const sandbox = new AgentSandbox(createDefaultConfig(), new Map(), auditLog);
    expect(sandbox.isActive()).toBe(true);

    sandbox.kill('Test kill');
    expect(sandbox.isActive()).toBe(false);
  });

  it('logs kill event to audit', () => {
    const sandbox = new AgentSandbox(createDefaultConfig(), new Map(), auditLog);
    sandbox.kill('Security threat detected');

    const killEvent = auditEvents.find((e) => e.action === 'sandbox_killed');
    expect(killEvent).toBeDefined();
    expect(killEvent?.eventType).toBe('agent.killed');
    expect(killEvent?.details).toHaveProperty('reason', 'Security threat detected');
  });

  it('includes budget summary in kill audit', () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    sandbox.kill('Forced stop');

    const killEvent = auditEvents.find((e) => e.action === 'sandbox_killed');
    expect(killEvent?.details).toHaveProperty('budgetUsed');
  });

  it('all subsequent steps fail after kill', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    sandbox.kill('Done');

    const r1 = await sandbox.executeStep('search', {});
    const r2 = await sandbox.executeStep('search', {});

    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });
});

// ─── Concurrent Sandboxes ───────────────────────────────────────

describe('Concurrent sandboxes', () => {
  it('multiple sandboxes run independently', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox1 = new AgentSandbox(
      createDefaultConfig({ agentId: 'agent-1', tenantId: 'tenant-1' }),
      tools,
      auditLog,
    );
    const sandbox2 = new AgentSandbox(
      createDefaultConfig({ agentId: 'agent-2', tenantId: 'tenant-2' }),
      tools,
      auditLog,
    );

    const [r1, r2] = await Promise.all([
      sandbox1.executeStep('search', {}),
      sandbox2.executeStep('search', {}),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('killing one sandbox does not affect another', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox1 = new AgentSandbox(createDefaultConfig({ agentId: 'agent-1' }), tools, auditLog);
    const sandbox2 = new AgentSandbox(createDefaultConfig({ agentId: 'agent-2' }), tools, auditLog);

    sandbox1.kill('Kill sandbox 1');

    const r1 = await sandbox1.executeStep('search', {});
    const r2 = await sandbox2.executeStep('search', {});

    expect(r1.success).toBe(false);
    expect(r2.success).toBe(true);
  });

  it('sandboxes have unique IDs', () => {
    const sandbox1 = new AgentSandbox(createDefaultConfig(), new Map(), auditLog);
    const sandbox2 = new AgentSandbox(createDefaultConfig(), new Map(), auditLog);

    expect(sandbox1.sandboxId).not.toBe(sandbox2.sandboxId);
  });

  it('budget tracking is per-sandbox', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox1 = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    const sandbox2 = new AgentSandbox(createDefaultConfig(), tools, auditLog);

    await sandbox1.executeStep('search', {}, 500);
    await sandbox2.executeStep('search', {}, 200);

    expect(sandbox1.getBudget().usedTokens).toBe(500);
    expect(sandbox2.getBudget().usedTokens).toBe(200);
  });
});

// ─── Graceful Shutdown ──────────────────────────────────────────

describe('Graceful shutdown', () => {
  it('sets sandbox to inactive after shutdown', async () => {
    const sandbox = new AgentSandbox(createDefaultConfig(), new Map(), auditLog);
    expect(sandbox.isActive()).toBe(true);

    await sandbox.shutdown();
    expect(sandbox.isActive()).toBe(false);
  });

  it('blocks further execution after shutdown', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    await sandbox.shutdown();

    const result = await sandbox.executeStep('search', {});
    expect(result.success).toBe(false);
  });

  it('logs shutdown event with total steps', async () => {
    const tools = new Map<string, AgentTool>();
    tools.set('search', createMockTool('search'));

    const sandbox = new AgentSandbox(createDefaultConfig(), tools, auditLog);
    await sandbox.executeStep('search', {});
    await sandbox.executeStep('search', {});
    await sandbox.shutdown();

    const shutdownEvent = auditEvents.find((e) => e.action === 'sandbox_shutdown');
    expect(shutdownEvent?.details).toHaveProperty('totalSteps', 2);
  });
});
