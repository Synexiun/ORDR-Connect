import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, isOk, isErr } from '@ordr/core';
import type { AgentContext } from '../types.js';
import { createSearchKnowledgeTool } from '../tools/search-knowledge.js';
import type { SearchKnowledgeDeps } from '../tools/search-knowledge.js';
import { createCategorizeTicketTool } from '../tools/categorize-ticket.js';
import type { CategorizeTicketDeps } from '../tools/categorize-ticket.js';
import { createRouteTicketTool } from '../tools/route-ticket.js';
import type { RouteTicketDeps } from '../tools/route-ticket.js';
import { createEscalateTool } from '../tools/escalate.js';
import type { EscalateDeps } from '../tools/escalate.js';
import { createSummarizeConversationTool } from '../tools/summarize-conversation.js';
import type { SummarizeConversationDeps } from '../tools/summarize-conversation.js';

// ─── Mock Context ───────────────────────────────────────────────

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    agentRole: 'support_triage',
    autonomyLevel: 'supervised',
    tools: new Map(),
    memory: { observations: new Map(), steps: [] },
    budget: {
      maxTokens: 100_000,
      maxCostCents: 500,
      maxActions: 20,
      usedTokens: 0,
      usedCostCents: 0,
      usedActions: 0,
    },
    killSwitch: { active: false, reason: '', killedAt: null },
    triggerEventId: 'evt-1',
    startedAt: new Date(),
    ...overrides,
  };
}

// ─── Search Knowledge Tool ──────────────────────────────────────

describe('createSearchKnowledgeTool', () => {
  let deps: SearchKnowledgeDeps;
  const context = makeContext();

  beforeEach(() => {
    deps = {
      searchKB: vi.fn().mockResolvedValue([
        { id: 'kb-1', title: 'Password Reset', content: 'Steps to reset password', category: 'account', relevanceScore: 0.95 },
        { id: 'kb-2', title: 'Billing FAQ', content: 'Common billing questions', category: 'billing', relevanceScore: 0.80 },
      ]),
      auditLog: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should search knowledge base and return results', async () => {
    const tool = createSearchKnowledgeTool(deps);
    const result = await tool.execute({ query: 'password reset', maxResults: 5 }, context);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as { results: unknown[]; totalResults: number };
      expect(data.results).toHaveLength(2);
      expect(data.totalResults).toBe(2);
    }
  });

  it('should use tenant-isolated search', async () => {
    const tool = createSearchKnowledgeTool(deps);
    await tool.execute({ query: 'test', maxResults: 3 }, context);

    expect(deps.searchKB).toHaveBeenCalledWith('test', 'tenant-1', 3);
  });

  it('should audit log the search', async () => {
    const tool = createSearchKnowledgeTool(deps);
    await tool.execute({ query: 'test' }, context);

    expect(deps.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'search_knowledge' }),
    );
  });

  it('should reject empty query', async () => {
    const tool = createSearchKnowledgeTool(deps);
    const result = await tool.execute({ query: '' }, context);
    expect(isErr(result)).toBe(true);
  });

  it('should reject query exceeding max length', async () => {
    const tool = createSearchKnowledgeTool(deps);
    const result = await tool.execute({ query: 'a'.repeat(501) }, context);
    expect(isErr(result)).toBe(true);
  });
});

// ─── Categorize Ticket Tool ─────────────────────────────────────

describe('createCategorizeTicketTool', () => {
  let deps: CategorizeTicketDeps;
  const context = makeContext();

  beforeEach(() => {
    deps = {
      classify: vi.fn().mockResolvedValue({
        category: 'billing',
        subcategory: 'payment_issue',
        priority: 'medium',
        suggestedAgent: 'billing_team',
        confidence: 0.85,
      }),
      auditLog: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should categorize a ticket with description', async () => {
    const tool = createCategorizeTicketTool(deps);
    const result = await tool.execute({ description: 'I have a billing issue with my last invoice' }, context);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as { category: string; priority: string };
      expect(data.category).toBe('billing');
      expect(data.priority).toBe('medium');
    }
  });

  it('should pass customer context to classifier', async () => {
    const tool = createCategorizeTicketTool(deps);
    await tool.execute({
      description: 'Payment issue',
      customerContext: { plan: 'premium' },
    }, context);

    expect(deps.classify).toHaveBeenCalledWith(
      'Payment issue',
      'tenant-1',
      { plan: 'premium' },
    );
  });

  it('should audit log the categorization', async () => {
    const tool = createCategorizeTicketTool(deps);
    await tool.execute({ description: 'Test issue' }, context);

    expect(deps.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'categorize_ticket',
        details: expect.objectContaining({
          category: 'billing',
          priority: 'medium',
        }),
      }),
    );
  });

  it('should reject empty description', async () => {
    const tool = createCategorizeTicketTool(deps);
    const result = await tool.execute({ description: '' }, context);
    expect(isErr(result)).toBe(true);
  });
});

// ─── Route Ticket Tool ──────────────────────────────────────────

describe('createRouteTicketTool', () => {
  let deps: RouteTicketDeps;
  const context = makeContext();

  beforeEach(() => {
    deps = {
      routeToTeam: vi.fn().mockResolvedValue({
        assignedTo: 'billing_team',
        queuePosition: 3,
        estimatedWaitTime: 15,
        routingReason: 'Matched billing category with medium priority',
      }),
      auditLog: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should route ticket to appropriate team', async () => {
    const tool = createRouteTicketTool(deps);
    const result = await tool.execute({
      category: 'billing',
      priority: 'medium',
      customerId: 'cust-1',
    }, context);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as { assignedTo: string; queuePosition: number };
      expect(data.assignedTo).toBe('billing_team');
      expect(data.queuePosition).toBe(3);
    }
  });

  it('should use tenant-isolated routing', async () => {
    const tool = createRouteTicketTool(deps);
    await tool.execute({ category: 'billing', priority: 'high', customerId: 'cust-1' }, context);

    expect(deps.routeToTeam).toHaveBeenCalledWith('billing', 'high', 'cust-1', 'tenant-1');
  });

  it('should audit log the routing decision', async () => {
    const tool = createRouteTicketTool(deps);
    await tool.execute({ category: 'billing', priority: 'medium', customerId: 'cust-1' }, context);

    expect(deps.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'route_ticket' }),
    );
  });

  it('should reject invalid priority', async () => {
    const tool = createRouteTicketTool(deps);
    const result = await tool.execute({
      category: 'billing',
      priority: 'invalid_priority',
      customerId: 'cust-1',
    }, context);
    expect(isErr(result)).toBe(true);
  });

  it('should reject empty category', async () => {
    const tool = createRouteTicketTool(deps);
    const result = await tool.execute({ category: '', priority: 'high', customerId: 'cust-1' }, context);
    expect(isErr(result)).toBe(true);
  });
});

// ─── Escalate Tool ──────────────────────────────────────────────

describe('createEscalateTool', () => {
  let deps: EscalateDeps;
  const context = makeContext({ agentRole: 'escalation' });

  beforeEach(() => {
    deps = {
      createEscalation: vi.fn().mockResolvedValue({
        escalationId: 'esc-1',
        assignedTo: 'senior_agent',
        severity: 'high',
        createdAt: new Date(),
      }),
      auditLog: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should create an escalation ticket', async () => {
    const tool = createEscalateTool(deps);
    const result = await tool.execute({
      reason: 'Customer is frustrated',
      severity: 'high',
      conversationSummary: 'Multiple failed attempts to resolve billing issue.',
    }, context);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as { escalationId: string; assignedTo: string };
      expect(data.escalationId).toBe('esc-1');
      expect(data.assignedTo).toBe('senior_agent');
    }
  });

  it('should pass all parameters to create escalation', async () => {
    const tool = createEscalateTool(deps);
    await tool.execute({
      reason: 'Legal threat',
      severity: 'critical',
      conversationSummary: 'Customer mentioned lawyer.',
    }, context);

    expect(deps.createEscalation).toHaveBeenCalledWith(
      'Legal threat',
      'critical',
      'Customer mentioned lawyer.',
      'cust-1',
      'tenant-1',
      'session-1',
    );
  });

  it('should audit log the escalation', async () => {
    const tool = createEscalateTool(deps);
    await tool.execute({
      reason: 'Test',
      severity: 'medium',
      conversationSummary: 'Test summary',
    }, context);

    expect(deps.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'escalate_to_human',
        details: expect.objectContaining({
          severity: 'medium',
          escalationId: 'esc-1',
        }),
      }),
    );
  });

  it('should reject invalid severity', async () => {
    const tool = createEscalateTool(deps);
    const result = await tool.execute({
      reason: 'Test',
      severity: 'extreme',
      conversationSummary: 'Test',
    }, context);
    expect(isErr(result)).toBe(true);
  });

  it('should reject empty reason', async () => {
    const tool = createEscalateTool(deps);
    const result = await tool.execute({
      reason: '',
      severity: 'high',
      conversationSummary: 'Test',
    }, context);
    expect(isErr(result)).toBe(true);
  });
});

// ─── Summarize Conversation Tool ────────────────────────────────

describe('createSummarizeConversationTool', () => {
  let deps: SummarizeConversationDeps;
  const context = makeContext({ agentRole: 'escalation' });

  beforeEach(() => {
    deps = {
      getSessionSteps: vi.fn().mockResolvedValue([
        { type: 'observe', output: 'Customer identified', toolUsed: undefined, confidence: 0.9 },
        { type: 'act', output: 'SMS sent', toolUsed: 'send_sms', confidence: 0.85 },
        { type: 'check', output: 'Response received', toolUsed: undefined, confidence: 0.8 },
      ]),
      llmSummarize: vi.fn().mockResolvedValue({
        summary: 'Agent sent SMS to customer regarding outstanding balance. Customer responded positively.',
        keyDecisions: ['Sent SMS follow-up', 'Scheduled callback'],
        unresolvedIssues: ['Payment plan not yet agreed'],
      }),
      auditLog: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should summarize a conversation session', async () => {
    const tool = createSummarizeConversationTool(deps);
    const result = await tool.execute({ sessionId: 'target-session' }, context);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as {
        summary: string;
        keyDecisions: string[];
        unresolvedIssues: string[];
        stepCount: number;
      };
      expect(data.summary).toContain('SMS');
      expect(data.keyDecisions).toHaveLength(2);
      expect(data.unresolvedIssues).toHaveLength(1);
      expect(data.stepCount).toBe(3);
    }
  });

  it('should handle empty session', async () => {
    deps = {
      ...deps,
      getSessionSteps: vi.fn().mockResolvedValue([]),
    };
    const tool = createSummarizeConversationTool(deps);
    const result = await tool.execute({ sessionId: 'empty-session' }, context);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as { summary: string; stepCount: number };
      expect(data.stepCount).toBe(0);
      expect(data.summary).toContain('No steps');
    }
  });

  it('should use tenant-isolated step retrieval', async () => {
    const tool = createSummarizeConversationTool(deps);
    await tool.execute({ sessionId: 'target-session' }, context);

    expect(deps.getSessionSteps).toHaveBeenCalledWith('target-session', 'tenant-1');
  });

  it('should audit log the summarization', async () => {
    const tool = createSummarizeConversationTool(deps);
    await tool.execute({ sessionId: 'target-session' }, context);

    expect(deps.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'summarize_conversation',
        details: expect.objectContaining({
          stepCount: 3,
          keyDecisionCount: 2,
          unresolvedIssueCount: 1,
        }),
      }),
    );
  });

  it('should reject empty session ID', async () => {
    const tool = createSummarizeConversationTool(deps);
    const result = await tool.execute({ sessionId: '' }, context);
    expect(isErr(result)).toBe(true);
  });
});
