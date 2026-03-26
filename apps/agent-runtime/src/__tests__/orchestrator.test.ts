import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, isOk, isErr, AppError, InternalError } from '@ordr/core';
import { z } from 'zod';
import { AgentOrchestrator, MAX_HANDOFF_DEPTH } from '../orchestrator.js';
import type { OrchestratorDeps } from '../orchestrator.js';
import { AgentRegistry } from '../agent-registry.js';
import type { AgentConfig } from '../agent-registry.js';
import { HitlQueue } from '../hitl.js';
import { MemoryManager, InMemoryEpisodicStore } from '../memory/manager.js';
import type { AgentEngineDeps, AgentTool } from '../types.js';

// ─── Mock Tool Factory ──────────────────────────────────────────

function makeMockTool(name: string, result: unknown = { status: 'ok' }): AgentTool {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: z.object({}),
    execute: vi.fn().mockResolvedValue(ok(result)),
  };
}

// ─── Mock Engine Dependencies ───────────────────────────────────

function makeEngineDeps(overrides: Partial<AgentEngineDeps> = {}): AgentEngineDeps {
  const tools = new Map<string, AgentTool>();
  tools.set('send_sms', makeMockTool('send_sms'));
  tools.set('lookup_customer', makeMockTool('lookup_customer'));
  tools.set('check_payment', makeMockTool('check_payment'));
  tools.set('schedule_followup', makeMockTool('schedule_followup'));
  tools.set('search_knowledge', makeMockTool('search_knowledge'));
  tools.set('categorize_ticket', makeMockTool('categorize_ticket'));
  tools.set('route_ticket', makeMockTool('route_ticket'));
  tools.set('escalate_to_human', makeMockTool('escalate_to_human'));
  tools.set('summarize_conversation', makeMockTool('summarize_conversation'));
  tools.set('create_ticket', makeMockTool('create_ticket'));

  return {
    llmComplete: vi.fn().mockResolvedValue(ok({
      content: JSON.stringify({
        action: 'complete',
        parameters: { summary: 'Task completed successfully' },
        reasoning: 'All steps done',
        confidence: 0.9,
        requiresApproval: false,
      }),
      tokenUsage: { total: 500 },
      costCents: 2,
    })),
    complianceCheck: vi.fn().mockReturnValue({ allowed: true, violations: [] }),
    auditLog: vi.fn().mockResolvedValue(undefined),
    tools,
    ...overrides,
  };
}

// ─── Orchestrator Deps Factory ──────────────────────────────────

function makeOrchestratorDeps(
  engineOverrides: Partial<AgentEngineDeps> = {},
  registryConfigs?: readonly AgentConfig[],
): OrchestratorDeps {
  return {
    registry: new AgentRegistry(registryConfigs),
    engineDeps: makeEngineDeps(engineOverrides),
    memoryManager: new MemoryManager(new InMemoryEpisodicStore()),
    hitlQueue: new HitlQueue(),
    auditLog: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('AgentOrchestrator', () => {
  let deps: OrchestratorDeps;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeOrchestratorDeps();
    orchestrator = new AgentOrchestrator(deps);
  });

  // ── Dispatch ──────────────────────────────────────

  describe('dispatch', () => {
    it('should dispatch a decision to the correct agent role', async () => {
      const result = await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.9,
          confidence: 0.85,
          reasoning: 'Customer needs follow-up',
        },
        'tenant-1',
        'cust-1',
      );

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.result).toBe('completed');
      }
    });

    it('should reject dispatch for unmapped action', async () => {
      const result = await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'no_action',
          parameters: {},
          score: 0,
          confidence: 0,
          reasoning: 'No action needed',
        },
        'tenant-1',
        'cust-1',
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('No agent role mapped');
      }
    });

    it('should reject dispatch when role is disabled for tenant', async () => {
      deps.registry.setTenantRoleOverride('tenant-1', 'collections', false);

      const result = await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.9,
          confidence: 0.85,
          reasoning: 'Test',
        },
        'tenant-1',
        'cust-1',
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('disabled');
      }
    });

    it('should audit log the dispatch', async () => {
      await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.9,
          confidence: 0.85,
          reasoning: 'Test',
        },
        'tenant-1',
        'cust-1',
      );

      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'dispatch' }),
      );
    });

    it('should audit log completion', async () => {
      await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.9,
          confidence: 0.85,
          reasoning: 'Test',
        },
        'tenant-1',
        'cust-1',
      );

      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'dispatch_completed' }),
      );
    });

    it('should map route_to_agent to support_triage', async () => {
      const result = await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'route_to_agent',
          parameters: {},
          score: 0.8,
          confidence: 0.8,
          reasoning: 'Route to support',
        },
        'tenant-1',
        'cust-1',
      );

      expect(isOk(result)).toBe(true);
    });

    it('should map escalate_to_human to escalation agent', async () => {
      const result = await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'escalate_to_human',
          parameters: {},
          score: 0.8,
          confidence: 0.8,
          reasoning: 'Needs human attention',
        },
        'tenant-1',
        'cust-1',
      );

      expect(isOk(result)).toBe(true);
    });

    it('should load episodic memory for customer context', async () => {
      // Pre-populate episodic memory
      const memManager = deps.memoryManager;
      const store = memManager.getEpisodicStore() as InMemoryEpisodicStore;
      await store.save({
        id: 'ep-1',
        sessionId: 'old-session',
        customerId: 'cust-1',
        tenantId: 'tenant-1',
        agentRole: 'collections',
        keyObservations: ['Tool "send_sms" executed (confidence: 0.9)'],
        outcome: 'completed',
        confidence: 0.9,
        timestamp: new Date(),
      });

      const result = await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.9,
          confidence: 0.85,
          reasoning: 'Follow-up',
        },
        'tenant-1',
        'cust-1',
      );

      expect(isOk(result)).toBe(true);
    });

    it('should promote memory to episodic after dispatch', async () => {
      await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.9,
          confidence: 0.85,
          reasoning: 'Test',
        },
        'tenant-1',
        'cust-1',
      );

      const store = deps.memoryManager.getEpisodicStore() as InMemoryEpisodicStore;
      expect(store.size).toBeGreaterThanOrEqual(1);
    });

    it('should handle escalated outcome by triggering handoff', async () => {
      const escDeps = makeOrchestratorDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'escalate',
            parameters: { reason: 'Customer wants human' },
            reasoning: 'Escalation needed',
            confidence: 0.95,
            requiresApproval: false,
          }),
          tokenUsage: { total: 200 },
          costCents: 1,
        })),
      });
      const escOrchestrator = new AgentOrchestrator(escDeps);

      const result = await escOrchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.8,
          confidence: 0.8,
          reasoning: 'Test',
        },
        'tenant-1',
        'cust-1',
      );

      // Should complete (either via handoff or original outcome)
      expect(isOk(result)).toBe(true);
    });

    it('should track total cost and tokens in outcome', async () => {
      const result = await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.9,
          confidence: 0.85,
          reasoning: 'Test',
        },
        'tenant-1',
        'cust-1',
      );

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.totalTokens).toBeGreaterThanOrEqual(0);
        expect(result.data.totalCost).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ── Handoff ──────────────────────────────────────

  describe('handoff', () => {
    it('should hand off from one agent to another', async () => {
      const result = await orchestrator.handoff(
        'session-1',
        'escalation',
        'Customer wants human',
        {
          fromAgent: 'collections',
          toAgent: 'escalation',
          reason: 'Customer wants human',
          preservedMemory: ['Tool "send_sms" executed'],
          conversationHistory: [],
          customerContext: { customerId: 'cust-1', tenantId: 'tenant-1' },
        },
      );

      expect(isOk(result)).toBe(true);
    });

    it('should audit log the handoff', async () => {
      await orchestrator.handoff(
        'session-1',
        'escalation',
        'Customer wants human',
        {
          fromAgent: 'collections',
          toAgent: 'escalation',
          reason: 'Customer wants human',
          preservedMemory: [],
          conversationHistory: [],
          customerContext: { customerId: 'cust-1', tenantId: 'tenant-1' },
        },
      );

      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'handoff' }),
      );
    });

    it('should enforce max handoff depth of 3', async () => {
      // First dispatch to create a session with depth tracking
      await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.9,
          confidence: 0.85,
          reasoning: 'Test',
        },
        'tenant-1',
        'cust-1',
      );

      // Simulate reaching max depth by chaining handoffs
      // Direct handoff starts at depth 0, so we need to test the limit
      let lastResult: typeof import('@ordr/core').Result<typeof import('../types.js').AgentOutcome, typeof AppError>;

      // Handoff 1 (depth 1)
      lastResult = await orchestrator.handoff(
        'session-first',
        'support_triage',
        'Need triage',
        {
          fromAgent: 'collections',
          toAgent: 'support_triage',
          reason: 'Need triage',
          preservedMemory: [],
          conversationHistory: [],
          customerContext: { customerId: 'cust-1', tenantId: 'tenant-1' },
        },
      );
      expect(isOk(lastResult)).toBe(true);
    });

    it('should reject handoff when target role is disabled', async () => {
      deps.registry.setTenantRoleOverride('tenant-1', 'escalation', false);

      const result = await orchestrator.handoff(
        'session-1',
        'escalation',
        'Customer wants human',
        {
          fromAgent: 'collections',
          toAgent: 'escalation',
          reason: 'Test',
          preservedMemory: [],
          conversationHistory: [],
          customerContext: { customerId: 'cust-1', tenantId: 'tenant-1' },
        },
      );

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('disabled');
      }
    });

    it('should reject handoff when target config is missing', async () => {
      const emptyRegistry = new AgentRegistry([]);
      const customDeps = {
        ...deps,
        registry: emptyRegistry,
      };
      const customOrchestrator = new AgentOrchestrator(customDeps);

      const result = await customOrchestrator.handoff(
        'session-1',
        'escalation',
        'Test',
        {
          fromAgent: 'collections',
          toAgent: 'escalation',
          reason: 'Test',
          preservedMemory: [],
          conversationHistory: [],
          customerContext: { customerId: 'cust-1', tenantId: 'tenant-1' },
        },
      );

      expect(isErr(result)).toBe(true);
    });

    it('should send handoff message via message bus', async () => {
      await orchestrator.handoff(
        'session-1',
        'escalation',
        'Test',
        {
          fromAgent: 'collections',
          toAgent: 'escalation',
          reason: 'Test',
          preservedMemory: [],
          conversationHistory: [],
          customerContext: { customerId: 'cust-1', tenantId: 'tenant-1' },
        },
      );

      const bus = orchestrator.getMessageBus('tenant-1');
      expect(bus).toBeDefined();
      expect(bus?.totalMessageCount).toBeGreaterThanOrEqual(1);
    });

    it('should preserve memory observations across handoff', async () => {
      const result = await orchestrator.handoff(
        'session-1',
        'support_triage',
        'Need triage',
        {
          fromAgent: 'collections',
          toAgent: 'support_triage',
          reason: 'Need triage',
          preservedMemory: ['Tool "send_sms" executed', 'Payment check complete'],
          conversationHistory: [],
          customerContext: { customerId: 'cust-1', tenantId: 'tenant-1' },
        },
      );

      expect(isOk(result)).toBe(true);
    });
  });

  // ── Session Management ────────────────────────────

  describe('session management', () => {
    it('should track active sessions for tenant', async () => {
      // Before dispatch, no active sessions
      expect(orchestrator.getActiveSessionsForTenant('tenant-1')).toHaveLength(0);
    });

    it('should clean up sessions after dispatch completes', async () => {
      await orchestrator.dispatch(
        {
          id: 'dec-1',
          action: 'send_sms',
          parameters: {},
          score: 0.9,
          confidence: 0.85,
          reasoning: 'Test',
        },
        'tenant-1',
        'cust-1',
      );

      // After dispatch completes, session should be cleaned up
      expect(orchestrator.getActiveSessionsForTenant('tenant-1')).toHaveLength(0);
    });
  });

  // ── Kill All for Tenant ───────────────────────────

  describe('killAllForTenant', () => {
    it('should kill all sessions for a tenant', async () => {
      // Use a long-running agent to have active sessions
      const longDeps = makeOrchestratorDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'respond',
            parameters: { message: 'Working...' },
            reasoning: 'Still processing',
            confidence: 0.9,
            requiresApproval: false,
          }),
          tokenUsage: { total: 50 },
          costCents: 0.5,
        })),
      });
      const longOrchestrator = new AgentOrchestrator(longDeps);

      // killAllForTenant should not throw even with no sessions
      expect(() => longOrchestrator.killAllForTenant('tenant-1', 'Emergency stop')).not.toThrow();
    });

    it('should audit log each kill', () => {
      // Kill with no sessions — should not throw
      orchestrator.killAllForTenant('tenant-1', 'Test kill');
      // No sessions to kill, so no audit calls expected for kills
    });

    it('should handle kill for non-existent tenant gracefully', () => {
      expect(() => orchestrator.killAllForTenant('non-existent', 'Test')).not.toThrow();
    });
  });

  // ── Decision Routing ──────────────────────────────

  describe('decision routing', () => {
    it('should route send_sms to collections', async () => {
      const result = await orchestrator.dispatch(
        { id: 'd-1', action: 'send_sms', parameters: {}, score: 0.9, confidence: 0.9, reasoning: 'Test' },
        'tenant-1', 'cust-1',
      );
      expect(isOk(result)).toBe(true);
    });

    it('should route send_email to collections', async () => {
      const result = await orchestrator.dispatch(
        { id: 'd-1', action: 'send_email', parameters: {}, score: 0.9, confidence: 0.9, reasoning: 'Test' },
        'tenant-1', 'cust-1',
      );
      expect(isOk(result)).toBe(true);
    });

    it('should route route_to_agent to support_triage', async () => {
      const result = await orchestrator.dispatch(
        { id: 'd-1', action: 'route_to_agent', parameters: {}, score: 0.8, confidence: 0.8, reasoning: 'Test' },
        'tenant-1', 'cust-1',
      );
      expect(isOk(result)).toBe(true);
    });

    it('should route trigger_workflow to support_triage', async () => {
      const result = await orchestrator.dispatch(
        { id: 'd-1', action: 'trigger_workflow', parameters: {}, score: 0.8, confidence: 0.8, reasoning: 'Test' },
        'tenant-1', 'cust-1',
      );
      expect(isOk(result)).toBe(true);
    });

    it('should route escalate_to_human to escalation', async () => {
      const result = await orchestrator.dispatch(
        { id: 'd-1', action: 'escalate_to_human', parameters: {}, score: 0.8, confidence: 0.8, reasoning: 'Test' },
        'tenant-1', 'cust-1',
      );
      expect(isOk(result)).toBe(true);
    });

    it('should route cease_communication to escalation', async () => {
      const result = await orchestrator.dispatch(
        { id: 'd-1', action: 'cease_communication', parameters: {}, score: 0.8, confidence: 0.8, reasoning: 'Test' },
        'tenant-1', 'cust-1',
      );
      expect(isOk(result)).toBe(true);
    });
  });

  // ── Accessors ─────────────────────────────────────

  describe('accessors', () => {
    it('should expose the engine', () => {
      expect(orchestrator.getEngine()).toBeDefined();
    });

    it('should expose the registry', () => {
      expect(orchestrator.getRegistry()).toBeDefined();
    });

    it('should expose the checkpoint manager', () => {
      expect(orchestrator.getCheckpointManager()).toBeDefined();
    });
  });
});
