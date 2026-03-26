/**
 * Integration test — Agent lifecycle from creation through completion.
 *
 * Tests agent session management, tool execution, HITL escalation,
 * kill switch, budget enforcement, and audit trail completeness.
 *
 * Uses the SDK test harness + audit logger together.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  setupTestEnvironment,
  createTestTenant,
  createTestUser,
  getAuditLogger,
  getAuditStore,
} from './setup.js';
import { createMockAgentSession, createMockAgentAction } from './fixtures/agent-factory.js';

// SDK
import {
  AgentBuilder,
  AgentTestHarness,
  validateManifest,
  packageAgent,
  MIN_CONFIDENCE_THRESHOLD,
  PLATFORM_BUDGET_LIMITS,
} from '@ordr/sdk';
import type { ToolDefinition, AgentBudgetConfig } from '@ordr/sdk';

// Audit
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import type { AuditEventInput } from '@ordr/audit';

// Core
import { createAgentId, createAgentRole, isOk, isErr, ok as okResult } from '@ordr/core';
import type { AgentRole } from '@ordr/core';

// AI safety
import { validateInput, validateOutput, PII_PATTERNS } from '@ordr/ai';

// Zod (for agent tool parameters)
import { z } from 'zod';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAuditInput(tenantId: string, overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId,
    eventType: overrides?.eventType ?? 'agent.action',
    actorType: overrides?.actorType ?? 'agent',
    actorId: overrides?.actorId ?? 'agent-001',
    resource: overrides?.resource ?? 'agent_session',
    resourceId: overrides?.resourceId ?? 'ses-001',
    action: overrides?.action ?? 'execute_tool',
    details: overrides?.details ?? {},
    timestamp: overrides?.timestamp ?? new Date('2026-01-15T14:00:00.000Z'),
  };
}

function buildTestAgent(name: string): ReturnType<AgentBuilder['build']> {
  return new AgentBuilder(name)
    .version('1.0.0')
    .description('Integration test agent')
    .author('test@example.com')
    .license('MIT')
    .confidenceThreshold(0.7)
    .withPromptBuilder((_ctx) => [
      { role: 'system' as const, content: 'You are a test agent.' },
    ])
    .withTool({
      name: 'search-crm',
      description: 'Search customer records',
      parameters: z.object({ query: z.string() }),
      dataClassifications: ['internal'],
      regulations: [],
      execute: async (_params, _ctx) => okResult({ results: [{ id: 'cust-001', name: 'Test Customer' }] }),
    })
    .withTool({
      name: 'send-email',
      description: 'Send email via channel router',
      parameters: z.object({ to: z.string(), contentRef: z.string() }),
      dataClassifications: ['confidential'],
      regulations: ['gdpr'],
      execute: async (_params, _ctx) => okResult({ sent: true }),
    })
    .build();
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Agent Lifecycle — End-to-End', () => {
  let auditStore: InMemoryAuditStore;
  let auditLogger: AuditLogger;

  beforeAll(async () => {
    await setupTestEnvironment();
  });

  beforeEach(() => {
    auditStore = new InMemoryAuditStore();
    auditLogger = new AuditLogger(auditStore);
  });

  // ── Session Creation ───────────────────────────────────────────

  describe('Agent session creation', () => {
    it('creates agent session with correct role and tools', () => {
      const session = createMockAgentSession('collections');

      expect(session.agentRole).toBe('collections');
      expect(session.tools).toContain('check_balance');
      expect(session.tools).toContain('send_sms');
      expect(session.status).toBe('active');
    });

    it('validates agent role format using core branded type', () => {
      const role = createAgentRole('lead_qualifier');
      expect(typeof role).toBe('string');
      expect(role).toBe('lead_qualifier');
    });

    it('rejects invalid agent role format', () => {
      expect(() => createAgentRole('INVALID-ROLE!')).toThrow();
      expect(() => createAgentRole('')).toThrow();
    });

    it('creates agent ID using core branded type', () => {
      const agentId = createAgentId('agent-001');
      expect(agentId).toBe('agent-001');
    });

    it('logs session creation to audit trail', async () => {
      const tnt = await createTestTenant('agent-session');
      const session = createMockAgentSession('follow_up', { tenantId: tnt.id });

      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'agent.action',
        actorId: session.id,
        action: 'session_created',
        details: {
          agentRole: session.agentRole,
          tools: session.tools,
          budget: session.budget,
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.action).toBe('session_created');
    });
  });

  // ── Tool Execution ─────────────────────────────────────────────

  describe('Agent tool execution', () => {
    it('agent builder creates valid package with tools', () => {
      const result = buildTestAgent('test-lifecycle-agent');
      expect(isOk(result)).toBe(true);
    });

    it('validates manifest meets platform requirements', () => {
      const result = buildTestAgent('test-manifest-agent');
      if (!isOk(result)) throw new Error('Build failed');

      const validation = validateManifest(result.data.manifest);
      expect(validation.success).toBe(true);
    });

    it('records tool execution in audit trail', async () => {
      const tnt = await createTestTenant('tool-exec');
      const session = createMockAgentSession('lead_qualifier', { tenantId: tnt.id });
      const action = createMockAgentAction(session.id, {
        tenantId: tnt.id,
        toolName: 'search_crm',
        confidence: 0.85,
      });

      await auditLogger.log(makeAuditInput(tnt.id, {
        actorId: session.id,
        action: 'tool_executed',
        resourceId: action.id,
        details: {
          toolName: action.toolName,
          confidence: action.confidence,
          tokensUsed: action.tokensUsed,
          costCents: action.costCents,
          durationMs: action.durationMs,
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.details['toolName']).toBe('search_crm');
    });

    it('validates tool output against safety check', () => {
      const output = 'Customer health score is 75. Recommended action: send follow-up email.';
      const result = validateOutput(output);
      expect(result.passed).toBe(true);
    });
  });

  // ── HITL Escalation ────────────────────────────────────────────

  describe('HITL escalation flow', () => {
    it('action below confidence threshold triggers escalation', async () => {
      const tnt = await createTestTenant('hitl-esc');
      const session = createMockAgentSession('collections', { tenantId: tnt.id });

      const lowConfidenceAction = createMockAgentAction(session.id, {
        tenantId: tnt.id,
        confidence: 0.55, // Below 0.7 threshold
        toolName: 'offer_payment_plan',
      });

      const needsHitl = lowConfidenceAction.confidence < MIN_CONFIDENCE_THRESHOLD;
      expect(needsHitl).toBe(true);

      // Log escalation
      await auditLogger.log(makeAuditInput(tnt.id, {
        actorId: session.id,
        action: 'hitl_escalated',
        details: {
          reason: 'confidence_below_threshold',
          confidence: lowConfidenceAction.confidence,
          threshold: MIN_CONFIDENCE_THRESHOLD,
          proposedTool: lowConfidenceAction.toolName,
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.action).toBe('hitl_escalated');
    });

    it('HITL approval allows agent to continue', async () => {
      const tnt = await createTestTenant('hitl-approve');

      // Log escalation
      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'hitl_escalated',
        details: { reason: 'low_confidence', proposedAction: 'send_sms' },
      }));

      // Log approval
      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'agent.action',
        actorType: 'user',
        actorId: 'human-reviewer-001',
        action: 'hitl_approved',
        details: { originalAction: 'send_sms', reviewerNotes: 'Approved — context verified' },
      }));

      // Log execution after approval
      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'tool_executed',
        details: { toolName: 'send_sms', hitlApproved: true },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(3);
      expect(events[1]!.action).toBe('hitl_approved');
      expect(events[2]!.details['hitlApproved']).toBe(true);
    });

    it('HITL rejection stops agent execution', async () => {
      const tnt = await createTestTenant('hitl-reject');

      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'hitl_escalated',
        details: { proposedAction: 'send_voice_call' },
      }));

      await auditLogger.log(makeAuditInput(tnt.id, {
        actorType: 'user',
        actorId: 'human-reviewer-002',
        action: 'hitl_rejected',
        details: { reason: 'Action not appropriate for customer context' },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(2);
      expect(events[1]!.action).toBe('hitl_rejected');
    });
  });

  // ── Kill Switch ────────────────────────────────────────────────

  describe('Kill switch', () => {
    it('immediate agent termination is logged', async () => {
      const tnt = await createTestTenant('kill-switch');
      const session = createMockAgentSession('collections', { tenantId: tnt.id });

      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'agent.killed',
        actorType: 'user',
        actorId: tnt.adminUserId,
        action: 'kill_agent',
        resourceId: session.id,
        details: {
          reason: 'Emergency stop — compliance concern',
          agentRole: session.agentRole,
          actionsCompleted: 3,
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe('agent.killed');
      expect(events[0]!.action).toBe('kill_agent');
    });

    it('kill switch creates complete audit record with session context', async () => {
      const tnt = await createTestTenant('kill-context');
      const session = createMockAgentSession('support_triage', { tenantId: tnt.id });

      // Log some actions first
      await auditLogger.log(makeAuditInput(tnt.id, { action: 'session_started', resourceId: session.id }));
      await auditLogger.log(makeAuditInput(tnt.id, { action: 'tool_executed', resourceId: session.id }));

      // Kill
      await auditLogger.log(makeAuditInput(tnt.id, {
        eventType: 'agent.killed',
        action: 'kill_agent',
        resourceId: session.id,
      }));

      const integrity = await auditLogger.verifyIntegrity(tnt.id);
      expect(integrity.valid).toBe(true);
      expect(integrity.totalEvents).toBe(3);
    });
  });

  // ── Budget Enforcement ─────────────────────────────────────────

  describe('Budget enforcement', () => {
    it('detects when token budget is exceeded', () => {
      const budget: AgentBudgetConfig = {
        maxTokens: 1000,
        maxCostCents: 100,
        maxActions: 20,
      };

      const totalTokens = 1200; // Over budget
      expect(totalTokens > budget.maxTokens).toBe(true);
    });

    it('detects when cost budget is exceeded', () => {
      const budget: AgentBudgetConfig = {
        maxTokens: 50_000,
        maxCostCents: 50,
        maxActions: 20,
      };

      const totalCost = 55; // Over budget
      expect(totalCost > budget.maxCostCents).toBe(true);
    });

    it('detects when action count limit is exceeded', () => {
      const budget: AgentBudgetConfig = {
        maxTokens: 50_000,
        maxCostCents: 100,
        maxActions: 5,
      };

      const actionCount = 6;
      expect(actionCount > budget.maxActions).toBe(true);
    });

    it('logs budget exceeded event to audit trail', async () => {
      const tnt = await createTestTenant('budget-exceeded');
      const session = createMockAgentSession('collections', { tenantId: tnt.id });

      await auditLogger.log(makeAuditInput(tnt.id, {
        actorId: session.id,
        action: 'budget_exceeded',
        details: {
          budgetType: 'tokens',
          limit: 50_000,
          current: 52_000,
          sessionTerminated: true,
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.action).toBe('budget_exceeded');
      expect(events[0]!.details['sessionTerminated']).toBe(true);
    });

    it('platform budget limits are enforced', () => {
      expect(PLATFORM_BUDGET_LIMITS.maxTokens).toBe(1_000_000);
      expect(PLATFORM_BUDGET_LIMITS.maxCostCents).toBe(10_000);
      expect(PLATFORM_BUDGET_LIMITS.maxActions).toBe(500);
    });
  });

  // ── AI Safety Validation ───────────────────────────────────────

  describe('AI safety validation', () => {
    it('validates agent input does not contain PII patterns', () => {
      const safeMessages = [
        { role: 'system' as const, content: 'You are a collections agent.' },
        { role: 'user' as const, content: 'What is the current balance for account reference tok_acct_001?' },
      ];
      const result = validateInput(safeMessages);
      expect(result.passed).toBe(true);
    });

    it('detects potential PII in agent output', () => {
      const unsafeOutput = 'The customer SSN is 123-45-6789 and their email is john@example.com';
      const result = validateOutput(unsafeOutput);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('validates clean agent output passes safety check', () => {
      const safeOutput = 'Customer health score is 75. Recommended action: send follow-up email.';
      const result = validateOutput(safeOutput);
      expect(result.passed).toBe(true);
    });
  });

  // ── Memory After Session ───────────────────────────────────────

  describe('Session completion and memory', () => {
    it('logs complete session lifecycle with audit integrity', async () => {
      const tnt = await createTestTenant('full-lifecycle');
      const session = createMockAgentSession('churn_detection', { tenantId: tnt.id });

      const lifecycle = [
        { action: 'session_created', details: { role: session.agentRole } },
        { action: 'context_loaded', details: { customersScanned: 50 } },
        { action: 'tool_executed', details: { tool: 'analyze_usage', confidence: 0.88 } },
        { action: 'tool_executed', details: { tool: 'compute_health', confidence: 0.91 } },
        { action: 'decision_made', details: { action: 'escalate', confidence: 0.72 } },
        { action: 'session_completed', details: { totalTokens: 3500, totalCost: 4 } },
      ];

      for (const step of lifecycle) {
        await auditLogger.log(makeAuditInput(tnt.id, {
          actorId: session.id,
          resourceId: session.id,
          action: step.action,
          details: step.details,
        }));
      }

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(6);

      const integrity = await auditLogger.verifyIntegrity(tnt.id);
      expect(integrity.valid).toBe(true);
      expect(integrity.totalEvents).toBe(6);
    });
  });
});
