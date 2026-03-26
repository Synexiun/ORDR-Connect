import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildHealthcarePrompt,
  requiresHealthcareHitl,
  HEALTHCARE_CONFIDENCE_THRESHOLD,
  HITL_REQUIRED_ACTIONS,
} from '../agents/healthcare.js';
import { AgentMemory } from '../memory.js';
import type { AgentContext, AgentBudget, KillSwitch, AgentMemoryState, AgentTool } from '../types.js';
import { z } from 'zod';
import { ok } from '@ordr/core';

// ─── Helpers ────────────────────────────────────────────────────

function makeMockTool(name: string): AgentTool {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: z.object({}),
    execute: vi.fn().mockResolvedValue(ok({ status: 'ok' })),
  };
}

function makeHealthcareTools(): Map<string, AgentTool> {
  const tools = new Map<string, AgentTool>();
  tools.set('lookup_patient', makeMockTool('lookup_patient'));
  tools.set('schedule_appointment', makeMockTool('schedule_appointment'));
  tools.set('check_care_plan', makeMockTool('check_care_plan'));
  tools.set('send_health_reminder', makeMockTool('send_health_reminder'));
  return tools;
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const budget: AgentBudget = {
    maxTokens: 50_000, maxCostCents: 200, maxActions: 10,
    usedTokens: 0, usedCostCents: 0, usedActions: 0,
  };
  const killSwitch: KillSwitch = { active: false, reason: '', killedAt: null };
  const memoryState: AgentMemoryState = { observations: new Map(), steps: [] };

  return {
    sessionId: 'session-healthcare-test',
    tenantId: 'tenant-health',
    customerId: 'pat-token-abc123',
    agentRole: 'healthcare',
    autonomyLevel: 'supervised',
    tools: makeHealthcareTools(),
    memory: memoryState,
    budget,
    killSwitch,
    triggerEventId: 'evt-1',
    startedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Healthcare Agent', () => {

  // ── Constants ──────────────────────────────────────────────────

  describe('HEALTHCARE_CONFIDENCE_THRESHOLD', () => {
    it('should be 0.8 — elevated above default 0.7', () => {
      expect(HEALTHCARE_CONFIDENCE_THRESHOLD).toBe(0.8);
    });

    it('should be higher than default confidence threshold', () => {
      expect(HEALTHCARE_CONFIDENCE_THRESHOLD).toBeGreaterThan(0.7);
    });
  });

  describe('HITL_REQUIRED_ACTIONS', () => {
    it('should include lookup_patient', () => {
      expect(HITL_REQUIRED_ACTIONS).toContain('lookup_patient');
    });

    it('should include check_care_plan', () => {
      expect(HITL_REQUIRED_ACTIONS).toContain('check_care_plan');
    });

    it('should include modify_care_plan', () => {
      expect(HITL_REQUIRED_ACTIONS).toContain('modify_care_plan');
    });

    it('should include prescription_action', () => {
      expect(HITL_REQUIRED_ACTIONS).toContain('prescription_action');
    });

    it('should include send_health_reminder', () => {
      expect(HITL_REQUIRED_ACTIONS).toContain('send_health_reminder');
    });
  });

  // ── Prompt Builder ─────────────────────────────────────────────

  describe('buildHealthcarePrompt()', () => {
    it('should produce a non-empty message array', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should start with a system message', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      expect(messages[0]?.role).toBe('system');
    });

    it('should include HIPAA compliance in the system prompt', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('HIPAA');
    });

    it('should include minimum necessary standard in prompt', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('Minimum Necessary');
    });

    it('should NOT contain raw PHI in the system prompt', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      // Ensure no PHI patterns: SSN, DOB, medical record numbers
      expect(systemMsg).not.toMatch(/\d{3}-\d{2}-\d{4}/); // SSN
      expect(systemMsg).not.toMatch(/\b(diagnosis|treatment plan|medication)\b.*\bfor\b.*\b[A-Z][a-z]+\b/); // Named treatments
    });

    it('should NOT contain patient names in the prompt', () => {
      const memory = new AgentMemory();
      const ctx = makeContext({ customerId: 'pat-token-xyz789' });
      const messages = buildHealthcarePrompt(ctx, memory);
      const fullText = messages.map(m => m.content).join('\n');
      // Only the token reference should appear, not a real name
      expect(fullText).toContain('pat-token-xyz789');
      expect(fullText).not.toContain('John Doe');
      expect(fullText).not.toContain('Jane Smith');
    });

    it('should reference the session ID in the prompt', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('session-healthcare-test');
    });

    it('should include the 0.8 confidence threshold in the prompt', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('0.8');
    });

    it('should include tool descriptions when tools are available', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('lookup_patient');
      expect(systemMsg).toContain('schedule_appointment');
      expect(systemMsg).toContain('check_care_plan');
      expect(systemMsg).toContain('send_health_reminder');
    });

    it('should show (No tools available) when tools map is empty', () => {
      const memory = new AgentMemory();
      const ctx = makeContext({ tools: new Map() });
      const messages = buildHealthcarePrompt(ctx, memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('(No tools available)');
    });

    it('should include safety boundaries block', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('SAFETY BOUNDARIES');
    });

    it('should include response format block', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('RESPONSE FORMAT');
    });

    it('should include decision framework block', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('DECISION FRAMEWORK');
    });

    it('should include conversation history when memory has steps', () => {
      const memory = new AgentMemory();
      memory.addStep({
        type: 'observe',
        input: 'test',
        output: 'Observation recorded',
        confidence: 0.9,
        durationMs: 100,
        toolUsed: undefined,
        timestamp: new Date(),
      });

      const messages = buildHealthcarePrompt(makeContext(), memory);
      const hasObservation = messages.some(m => m.content.includes('Observation recorded'));
      expect(hasObservation).toBe(true);
    });

    it('should include initial instruction when memory is empty', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg?.content).toContain('Begin the healthcare task');
    });

    it('should include session state when memory has data', () => {
      const memory = new AgentMemory();
      memory.addStep({
        type: 'act',
        input: 'test',
        output: 'Action completed',
        confidence: 0.9,
        durationMs: 50,
        toolUsed: 'lookup_patient',
        timestamp: new Date(),
      });

      const messages = buildHealthcarePrompt(makeContext(), memory);
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg?.content).toContain('Current session state');
    });

    it('should instruct never sharing patient data between agents', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('NEVER share one patient');
    });

    it('should instruct tokenized references only', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('tokenized');
    });

    it('should include audit logging instruction', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('audit');
    });

    it('should mention requiresApproval for PHI actions', () => {
      const memory = new AgentMemory();
      const messages = buildHealthcarePrompt(makeContext(), memory);
      const systemMsg = messages[0]?.content ?? '';
      expect(systemMsg).toContain('requiresApproval');
    });
  });

  // ── HITL Requirement ───────────────────────────────────────────

  describe('requiresHealthcareHitl()', () => {
    it('should require HITL for lookup_patient regardless of confidence', () => {
      expect(requiresHealthcareHitl('lookup_patient', 1.0)).toBe(true);
    });

    it('should require HITL for check_care_plan regardless of confidence', () => {
      expect(requiresHealthcareHitl('check_care_plan', 0.99)).toBe(true);
    });

    it('should require HITL for modify_care_plan regardless of confidence', () => {
      expect(requiresHealthcareHitl('modify_care_plan', 1.0)).toBe(true);
    });

    it('should require HITL for prescription_action regardless of confidence', () => {
      expect(requiresHealthcareHitl('prescription_action', 1.0)).toBe(true);
    });

    it('should require HITL for send_health_reminder regardless of confidence', () => {
      expect(requiresHealthcareHitl('send_health_reminder', 0.95)).toBe(true);
    });

    it('should require HITL when confidence is below 0.8', () => {
      expect(requiresHealthcareHitl('some_other_action', 0.79)).toBe(true);
    });

    it('should require HITL when confidence is exactly 0.0', () => {
      expect(requiresHealthcareHitl('some_action', 0.0)).toBe(true);
    });

    it('should NOT require HITL for non-PHI action with high confidence', () => {
      expect(requiresHealthcareHitl('some_safe_action', 0.85)).toBe(false);
    });

    it('should NOT require HITL for non-PHI action at exactly 0.8', () => {
      expect(requiresHealthcareHitl('safe_action', 0.8)).toBe(false);
    });

    it('should require HITL for confidence exactly at 0.79', () => {
      expect(requiresHealthcareHitl('safe_action', 0.79)).toBe(true);
    });
  });
});
