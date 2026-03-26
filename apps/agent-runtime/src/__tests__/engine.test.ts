import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ok,
  err,
  isOk,
  isErr,
  AppError,
  ComplianceViolationError,
  InternalError,
  ValidationError,
} from '@ordr/core';
import { z } from 'zod';
import { AgentEngine } from '../engine.js';
import { HitlQueue } from '../hitl.js';
import type { AgentEngineDeps, AgentTool, AgentContext, AgentStep } from '../types.js';
import { CONFIDENCE_THRESHOLD } from '../types.js';

// ─── Mock Tool Factory ──────────────────────────────────────────

function makeMockTool(name: string, result: unknown = { status: 'ok' }): AgentTool {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: z.object({}),
    execute: vi.fn().mockResolvedValue(ok(result)),
  };
}

// ─── Mock Dependencies Factory ──────────────────────────────────

function makeDeps(overrides: Partial<AgentEngineDeps> = {}): AgentEngineDeps {
  const tools = new Map<string, AgentTool>();
  tools.set('send_sms', makeMockTool('send_sms', { messageId: 'msg-1', status: 'queued' }));
  tools.set('lookup_customer', makeMockTool('lookup_customer', { name: 'John', healthScore: 80 }));
  tools.set('check_payment', makeMockTool('check_payment', { outstandingBalance: 500 }));

  return {
    llmComplete: vi.fn().mockResolvedValue(ok({
      content: JSON.stringify({
        action: 'lookup_customer',
        parameters: { customerId: 'cust-1' },
        reasoning: 'Need to check customer info first',
        confidence: 0.85,
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

// ─── Tests ──────────────────────────────────────────────────────

describe('AgentEngine', () => {
  let deps: AgentEngineDeps;
  let engine: AgentEngine;
  let hitlQueue: HitlQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    hitlQueue = new HitlQueue();
    deps = makeDeps();
    engine = new AgentEngine(deps, hitlQueue);
  });

  // ── Session Lifecycle ─────────────────────────────

  describe('startSession', () => {
    it('should create a session with unique ID', async () => {
      const result = await engine.startSession('tenant-1', 'cust-1', 'collections', 'evt-1');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.sessionId).toBeDefined();
        expect(typeof result.data.sessionId).toBe('string');
      }
    });

    it('should set correct tenant and customer IDs', async () => {
      const result = await engine.startSession('tenant-abc', 'cust-xyz', 'collections', 'evt-1');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.tenantId).toBe('tenant-abc');
        expect(result.data.customerId).toBe('cust-xyz');
      }
    });

    it('should initialize budget with defaults', async () => {
      const result = await engine.startSession('t', 'c', 'collections', 'e');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.budget.maxTokens).toBe(100_000);
        expect(result.data.budget.usedTokens).toBe(0);
        expect(result.data.budget.usedActions).toBe(0);
      }
    });

    it('should accept custom budget', async () => {
      const result = await engine.startSession('t', 'c', 'collections', 'e', 'supervised', {
        maxTokens: 50_000,
        maxCostCents: 100,
        maxActions: 5,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.budget.maxTokens).toBe(50_000);
        expect(result.data.budget.maxCostCents).toBe(100);
        expect(result.data.budget.maxActions).toBe(5);
      }
    });

    it('should initialize kill switch as inactive', async () => {
      const result = await engine.startSession('t', 'c', 'collections', 'e');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.killSwitch.active).toBe(false);
      }
    });

    it('should fix tools at session start', async () => {
      const result = await engine.startSession('t', 'c', 'collections', 'e');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.tools.size).toBe(3);
        expect(result.data.tools.has('send_sms')).toBe(true);
      }
    });

    it('should audit log session start', async () => {
      await engine.startSession('t', 'c', 'collections', 'e');
      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'session_started',
          eventType: 'agent.action',
        }),
      );
    });
  });

  // ── Step Execution ────────────────────────────────

  describe('runStep', () => {
    it('should execute a step and return result', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      expect(isOk(sessionResult)).toBe(true);
      if (!isOk(sessionResult)) return;

      const stepResult = await engine.runStep(sessionResult.data);
      expect(isOk(stepResult)).toBe(true);
    });

    it('should call LLM with prompt messages', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      await engine.runStep(sessionResult.data);
      expect(deps.llmComplete).toHaveBeenCalledTimes(1);
    });

    it('should update budget after LLM call', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      await engine.runStep(sessionResult.data);
      expect(sessionResult.data.budget.usedTokens).toBe(500);
      expect(sessionResult.data.budget.usedCostCents).toBe(2);
    });

    it('should execute tool when LLM returns an action', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const stepResult = await engine.runStep(sessionResult.data);
      expect(isOk(stepResult)).toBe(true);

      // Tool should have been called
      const tool = deps.tools.get('lookup_customer');
      expect(tool?.execute).toHaveBeenCalled();
    });

    it('should increment action counter after tool execution', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      await engine.runStep(sessionResult.data);
      expect(sessionResult.data.budget.usedActions).toBe(1);
    });

    it('should audit log the decision and action', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      await engine.runStep(sessionResult.data);

      // Should have audit logs for: session start + decision + action
      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'agent.decision' }),
      );
      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'agent.action', action: expect.stringContaining('lookup_customer') }),
      );
    });
  });

  // ── Confidence Threshold & HITL ───────────────────

  describe('confidence threshold', () => {
    it('should route low-confidence decisions to HITL queue', async () => {
      const lowConfDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'send_sms',
            parameters: { to: '+14155551234', body: 'Hello' },
            reasoning: 'Not sure about this one',
            confidence: 0.5,
            requiresApproval: true,
          }),
          tokenUsage: { total: 300 },
          costCents: 1,
        })),
      });
      const lowConfEngine = new AgentEngine(lowConfDeps, hitlQueue);

      const sessionResult = await lowConfEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const stepResult = await lowConfEngine.runStep(sessionResult.data);
      expect(isOk(stepResult)).toBe(true);

      // Should be in HITL queue
      expect(hitlQueue.getPendingCount('t')).toBe(1);
    });

    it('should auto-execute high-confidence decisions', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      await engine.runStep(sessionResult.data);

      // Tool should execute (confidence is 0.85 in default mock)
      expect(hitlQueue.getPendingCount('t')).toBe(0);
      expect(deps.tools.get('lookup_customer')?.execute).toHaveBeenCalled();
    });

    it('should set requiresApproval to true when confidence < threshold', async () => {
      const lowConfDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'send_sms',
            parameters: {},
            reasoning: 'Uncertain',
            confidence: 0.4,
            requiresApproval: true,
          }),
          tokenUsage: { total: 200 },
          costCents: 1,
        })),
      });
      const lowConfEngine = new AgentEngine(lowConfDeps, hitlQueue);

      const sessionResult = await lowConfEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      await lowConfEngine.runStep(sessionResult.data);

      const pending = hitlQueue.getPending('t');
      expect(pending).toHaveLength(1);
      expect(pending[0]?.decision.requiresApproval).toBe(true);
    });
  });

  // ── Budget Enforcement ────────────────────────────

  describe('budget enforcement', () => {
    it('should reject step when token budget is exhausted', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e', 'supervised', {
        maxTokens: 100,
      });
      if (!isOk(sessionResult)) return;

      // Manually exhaust budget
      sessionResult.data.budget.usedTokens = 100;

      const stepResult = await engine.runStep(sessionResult.data);
      expect(isErr(stepResult)).toBe(true);
      if (isErr(stepResult)) {
        expect(stepResult.error.message).toContain('Token budget');
      }
    });

    it('should reject step when cost budget is exhausted', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e', 'supervised', {
        maxCostCents: 10,
      });
      if (!isOk(sessionResult)) return;

      sessionResult.data.budget.usedCostCents = 10;

      const stepResult = await engine.runStep(sessionResult.data);
      expect(isErr(stepResult)).toBe(true);
      if (isErr(stepResult)) {
        expect(stepResult.error.message).toContain('Cost budget');
      }
    });

    it('should reject step when action budget is exhausted', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e', 'supervised', {
        maxActions: 3,
      });
      if (!isOk(sessionResult)) return;

      sessionResult.data.budget.usedActions = 3;

      const stepResult = await engine.runStep(sessionResult.data);
      expect(isErr(stepResult)).toBe(true);
      if (isErr(stepResult)) {
        expect(stepResult.error.message).toContain('Action budget');
      }
    });
  });

  // ── Kill Switch ───────────────────────────────────

  describe('kill switch', () => {
    it('should terminate session immediately when kill switch is activated', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      engine.killSession(sessionResult.data.sessionId, 'Emergency stop');

      const stepResult = await engine.runStep(sessionResult.data);
      expect(isErr(stepResult)).toBe(true);
      if (isErr(stepResult)) {
        expect(stepResult.error.message).toContain('killed');
      }
    });

    it('should set killed reason', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      engine.killSession(sessionResult.data.sessionId, 'Compliance breach detected');

      expect(sessionResult.data.killSwitch.active).toBe(true);
      expect(sessionResult.data.killSwitch.reason).toBe('Compliance breach detected');
      expect(sessionResult.data.killSwitch.killedAt).toBeInstanceOf(Date);
    });

    it('should stop the run loop when killed mid-execution', async () => {
      // LLM mock that kills the session after the 2nd call
      let callCount = 0;
      const respondDeps = makeDeps({
        llmComplete: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount >= 2) {
            // Simulate external kill between steps
            respondEngine.killSession(sessionResult.data.sessionId, 'Admin kill');
          }
          return ok({
            content: JSON.stringify({
              action: 'respond',
              parameters: { message: 'Checking...' },
              reasoning: 'Need more info',
              confidence: 0.9,
              requiresApproval: false,
            }),
            tokenUsage: { total: 100 },
            costCents: 1,
          });
        }),
      });
      const respondEngine = new AgentEngine(respondDeps, hitlQueue);

      const sessionResult = await respondEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const outcome = await respondEngine.runLoop(sessionResult.data, 100);
      expect(isOk(outcome)).toBe(true);
      if (isOk(outcome)) {
        expect(outcome.data.result).toBe('killed');
        expect(outcome.data.totalSteps).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ── Compliance Gate ───────────────────────────────

  describe('compliance gate', () => {
    it('should block action when compliance gate rejects', async () => {
      const blockingDeps = makeDeps({
        complianceCheck: vi.fn().mockReturnValue({
          allowed: false,
          violations: [{ violation: { message: 'FDCPA timing violation' } }],
        }),
      });
      const blockingEngine = new AgentEngine(blockingDeps, hitlQueue);

      const sessionResult = await blockingEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const stepResult = await blockingEngine.runStep(sessionResult.data);
      expect(isErr(stepResult)).toBe(true);
      if (isErr(stepResult)) {
        expect(stepResult.error).toBeInstanceOf(ComplianceViolationError);
      }
    });

    it('should call compliance check before tool execution', async () => {
      const sessionResult = await engine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      await engine.runStep(sessionResult.data);

      expect(deps.complianceCheck).toHaveBeenCalled();
      // Compliance should be called before tool execute
      const complianceCallOrder = (deps.complianceCheck as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      const toolExecuteOrder = ((deps.tools.get('lookup_customer') as AgentTool).execute as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      if (complianceCallOrder !== undefined && toolExecuteOrder !== undefined) {
        expect(complianceCallOrder).toBeLessThan(toolExecuteOrder);
      }
    });
  });

  // ── LLM Error Handling ────────────────────────────

  describe('LLM error handling', () => {
    it('should handle LLM call failure gracefully', async () => {
      const failDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(err(new InternalError('LLM service unavailable'))),
      });
      const failEngine = new AgentEngine(failDeps, hitlQueue);

      const sessionResult = await failEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const stepResult = await failEngine.runStep(sessionResult.data);
      expect(isErr(stepResult)).toBe(true);
    });

    it('should handle malformed LLM response', async () => {
      const badDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: 'This is not valid JSON at all',
          tokenUsage: { total: 100 },
          costCents: 1,
        })),
      });
      const badEngine = new AgentEngine(badDeps, hitlQueue);

      const sessionResult = await badEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const stepResult = await badEngine.runStep(sessionResult.data);
      expect(isErr(stepResult)).toBe(true);
    });

    it('should handle LLM response in markdown code block', async () => {
      const mdDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: '```json\n{"action":"lookup_customer","parameters":{"customerId":"c1"},"reasoning":"checking","confidence":0.9,"requiresApproval":false}\n```',
          tokenUsage: { total: 200 },
          costCents: 1,
        })),
      });
      const mdEngine = new AgentEngine(mdDeps, hitlQueue);

      const sessionResult = await mdEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const stepResult = await mdEngine.runStep(sessionResult.data);
      expect(isOk(stepResult)).toBe(true);
    });
  });

  // ── Unknown Tool ──────────────────────────────────

  describe('unknown tool', () => {
    it('should reject action for tool not in agent tool set', async () => {
      const unknownDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'hack_the_planet',
            parameters: {},
            reasoning: 'I want to do something unauthorized',
            confidence: 0.99,
            requiresApproval: false,
          }),
          tokenUsage: { total: 100 },
          costCents: 1,
        })),
      });
      const unknownEngine = new AgentEngine(unknownDeps, hitlQueue);

      const sessionResult = await unknownEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const stepResult = await unknownEngine.runStep(sessionResult.data);
      expect(isErr(stepResult)).toBe(true);
      if (isErr(stepResult)) {
        expect(stepResult.error.message).toContain('unknown tool');
      }
    });
  });

  // ── Run Loop ──────────────────────────────────────

  describe('runLoop', () => {
    it('should complete when agent returns complete action', async () => {
      const completeDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'complete',
            parameters: { summary: 'Task done successfully' },
            reasoning: 'All steps completed',
            confidence: 0.95,
            requiresApproval: false,
          }),
          tokenUsage: { total: 200 },
          costCents: 1,
        })),
      });
      const completeEngine = new AgentEngine(completeDeps, hitlQueue);

      const sessionResult = await completeEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const outcome = await completeEngine.runLoop(sessionResult.data);
      expect(isOk(outcome)).toBe(true);
      if (isOk(outcome)) {
        expect(outcome.data.result).toBe('completed');
        expect(outcome.data.totalSteps).toBe(1);
      }
    });

    it('should timeout when max steps reached', async () => {
      const loopDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'respond',
            parameters: { message: 'Still working...' },
            reasoning: 'Not done yet',
            confidence: 0.8,
            requiresApproval: false,
          }),
          tokenUsage: { total: 50 },
          costCents: 0.5,
        })),
      });
      const loopEngine = new AgentEngine(loopDeps, hitlQueue);

      const sessionResult = await loopEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const outcome = await loopEngine.runLoop(sessionResult.data, 3);
      expect(isOk(outcome)).toBe(true);
      if (isOk(outcome)) {
        expect(outcome.data.result).toBe('timeout');
        expect(outcome.data.totalSteps).toBe(3);
      }
    });

    it('should escalate when agent returns escalate action', async () => {
      const escDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'escalate',
            parameters: { reason: 'Customer requested human' },
            reasoning: 'Customer wants to speak with a person',
            confidence: 0.95,
            requiresApproval: false,
          }),
          tokenUsage: { total: 150 },
          costCents: 1,
        })),
      });
      const escEngine = new AgentEngine(escDeps, hitlQueue);

      const sessionResult = await escEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const outcome = await escEngine.runLoop(sessionResult.data);
      expect(isOk(outcome)).toBe(true);
      if (isOk(outcome)) {
        expect(outcome.data.result).toBe('escalated');
      }
    });

    it('should return escalated when routed to HITL', async () => {
      const lowDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'send_sms',
            parameters: {},
            reasoning: 'Not sure',
            confidence: 0.3,
            requiresApproval: true,
          }),
          tokenUsage: { total: 100 },
          costCents: 1,
        })),
      });
      const lowEngine = new AgentEngine(lowDeps, hitlQueue);

      const sessionResult = await lowEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const outcome = await lowEngine.runLoop(sessionResult.data);
      expect(isOk(outcome)).toBe(true);
      if (isOk(outcome)) {
        expect(outcome.data.result).toBe('escalated');
      }
    });

    it('should track total cost and tokens in outcome', async () => {
      const completeDeps = makeDeps({
        llmComplete: vi.fn().mockResolvedValue(ok({
          content: JSON.stringify({
            action: 'complete',
            parameters: { summary: 'Done' },
            reasoning: 'Complete',
            confidence: 0.9,
            requiresApproval: false,
          }),
          tokenUsage: { total: 300 },
          costCents: 5,
        })),
      });
      const completeEngine = new AgentEngine(completeDeps, hitlQueue);

      const sessionResult = await completeEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const outcome = await completeEngine.runLoop(sessionResult.data);
      expect(isOk(outcome)).toBe(true);
      if (isOk(outcome)) {
        expect(outcome.data.totalTokens).toBe(300);
        expect(outcome.data.totalCost).toBe(5);
      }
    });

    it('should handle compliance failure in loop gracefully', async () => {
      const compDeps = makeDeps({
        complianceCheck: vi.fn().mockReturnValue({
          allowed: false,
          violations: [{ violation: { message: 'Blocked' } }],
        }),
      });
      const compEngine = new AgentEngine(compDeps, hitlQueue);

      const sessionResult = await compEngine.startSession('t', 'c', 'collections', 'e');
      if (!isOk(sessionResult)) return;

      const outcome = await compEngine.runLoop(sessionResult.data, 3);
      expect(isOk(outcome)).toBe(true);
      if (isOk(outcome)) {
        expect(outcome.data.result).toBe('failed');
      }
    });
  });

  // ── HITL Queue Access ─────────────────────────────

  describe('getHitlQueue', () => {
    it('should return the HITL queue instance', () => {
      const queue = engine.getHitlQueue();
      expect(queue).toBe(hitlQueue);
    });
  });
});
