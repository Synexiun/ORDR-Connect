import { describe, it, expect } from 'vitest';
import { buildCollectionsPrompt, buildGenericPrompt } from '../prompts.js';
import { AgentMemory } from '../memory.js';
import type { AgentContext, AgentBudget, KillSwitch, AgentMemoryState, AgentTool } from '../types.js';
import { z } from 'zod';
import { ok } from '@ordr/core';

// ─── Helpers ────────────────────────────────────────────────────

function makeTool(name: string, description: string): AgentTool {
  return {
    name,
    description,
    parameters: z.object({}),
    execute: async () => ok({ result: 'ok' }),
  };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const tools = new Map<string, AgentTool>();
  tools.set('send_sms', makeTool('send_sms', 'Send an SMS message'));
  tools.set('lookup_customer', makeTool('lookup_customer', 'Look up customer info'));

  const budget: AgentBudget = {
    maxTokens: 100_000,
    maxCostCents: 500,
    maxActions: 20,
    usedTokens: 0,
    usedCostCents: 0,
    usedActions: 0,
  };

  const killSwitch: KillSwitch = {
    active: false,
    reason: '',
    killedAt: null,
  };

  const memoryState: AgentMemoryState = {
    observations: new Map(),
    steps: [],
  };

  return {
    sessionId: 'session-prompt-test',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    agentRole: 'collections',
    autonomyLevel: 'supervised',
    tools,
    memory: memoryState,
    budget,
    killSwitch,
    triggerEventId: 'evt-1',
    startedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('buildCollectionsPrompt', () => {
  it('should include system message as first message', () => {
    const context = makeContext();
    const memory = new AgentMemory();
    const messages = buildCollectionsPrompt(context, memory);

    expect(messages[0]?.role).toBe('system');
  });

  it('should include FDCPA compliance block', () => {
    const context = makeContext();
    const memory = new AgentMemory();
    const messages = buildCollectionsPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('FDCPA COMPLIANCE');
    expect(systemMsg?.content).toContain('Mini-Miranda');
    expect(systemMsg?.content).toContain('attempt to collect a debt');
  });

  it('should include TCPA compliance block', () => {
    const context = makeContext();
    const memory = new AgentMemory();
    const messages = buildCollectionsPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('TCPA COMPLIANCE');
    expect(systemMsg?.content).toContain('consent MUST be verified');
  });

  it('should include confidence threshold rule', () => {
    const context = makeContext();
    const memory = new AgentMemory();
    const messages = buildCollectionsPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('0.7');
    expect(systemMsg?.content).toContain('requiresApproval');
  });

  it('should include available tool descriptions', () => {
    const context = makeContext();
    const memory = new AgentMemory();
    const messages = buildCollectionsPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('send_sms');
    expect(systemMsg?.content).toContain('lookup_customer');
  });

  it('should include JSON response format', () => {
    const context = makeContext();
    const memory = new AgentMemory();
    const messages = buildCollectionsPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('"action"');
    expect(systemMsg?.content).toContain('"parameters"');
    expect(systemMsg?.content).toContain('"reasoning"');
    expect(systemMsg?.content).toContain('"confidence"');
  });

  it('should include session ID and agent role', () => {
    const context = makeContext({ sessionId: 'ses-xyz', agentRole: 'collections' });
    const memory = new AgentMemory();
    const messages = buildCollectionsPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('ses-xyz');
    expect(systemMsg?.content).toContain('collections');
  });

  it('should include safety boundary block', () => {
    const context = makeContext();
    const memory = new AgentMemory();
    const messages = buildCollectionsPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('SAFETY BOUNDARIES');
    expect(systemMsg?.content).toContain('CANNOT modify your own permissions');
  });

  it('should include contact timing restrictions', () => {
    const context = makeContext();
    const memory = new AgentMemory();
    const messages = buildCollectionsPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('8:00 AM');
    expect(systemMsg?.content).toContain('9:00 PM');
  });

  it('should include conversation history from memory', () => {
    const context = makeContext();
    const memory = new AgentMemory();
    memory.addStep({
      type: 'observe',
      input: 'test',
      output: 'Customer found',
      confidence: 0.9,
      durationMs: 50,
      toolUsed: undefined,
      timestamp: new Date(),
    });

    const messages = buildCollectionsPrompt(context, memory);
    const historyMsg = messages.find((m) => m.content.includes('[OBSERVE]'));
    expect(historyMsg).toBeDefined();
    expect(historyMsg?.content).toContain('Customer found');
  });
});

describe('buildGenericPrompt', () => {
  it('should NOT include FDCPA block for non-collections roles', () => {
    const context = makeContext({ agentRole: 'support_triage' });
    const memory = new AgentMemory();
    const messages = buildGenericPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).not.toContain('FDCPA COMPLIANCE');
    expect(systemMsg?.content).not.toContain('Mini-Miranda');
  });

  it('should include base compliance block', () => {
    const context = makeContext({ agentRole: 'lead_qualifier' });
    const memory = new AgentMemory();
    const messages = buildGenericPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('HIPAA');
    expect(systemMsg?.content).toContain('SOC2');
  });

  it('should include confidence and safety blocks', () => {
    const context = makeContext({ agentRole: 'churn_detection' });
    const memory = new AgentMemory();
    const messages = buildGenericPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('CONFIDENCE RULES');
    expect(systemMsg?.content).toContain('SAFETY BOUNDARIES');
  });

  it('should include tool descriptions', () => {
    const context = makeContext({ agentRole: 'support_triage' });
    const memory = new AgentMemory();
    const messages = buildGenericPrompt(context, memory);

    const systemMsg = messages[0];
    expect(systemMsg?.content).toContain('send_sms');
    expect(systemMsg?.content).toContain('lookup_customer');
  });
});
