import { describe, it, expect, beforeEach } from 'vitest';
import { AgentMemory } from '../memory.js';
import type { AgentStep } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeStep(overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    type: 'observe',
    input: 'test input',
    output: 'test output',
    confidence: 0.8,
    durationMs: 100,
    toolUsed: undefined,
    timestamp: new Date('2025-01-01T12:00:00Z'),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('AgentMemory', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = new AgentMemory();
  });

  // ── Observations ──────────────────────────────────

  describe('observations', () => {
    it('should store and retrieve observations', () => {
      memory.addObservation('customer_name', 'John Doe');
      expect(memory.getObservation('customer_name')).toBe('John Doe');
    });

    it('should return undefined for non-existent observations', () => {
      expect(memory.getObservation('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing observations with the same key', () => {
      memory.addObservation('score', 75);
      memory.addObservation('score', 90);
      expect(memory.getObservation('score')).toBe(90);
    });

    it('should check if an observation exists', () => {
      memory.addObservation('key', 'value');
      expect(memory.hasObservation('key')).toBe(true);
      expect(memory.hasObservation('missing')).toBe(false);
    });

    it('should list all observation keys', () => {
      memory.addObservation('a', 1);
      memory.addObservation('b', 2);
      memory.addObservation('c', 3);
      expect(memory.getObservationKeys()).toEqual(['a', 'b', 'c']);
    });

    it('should handle complex observation values', () => {
      const complex = { nested: { value: [1, 2, 3] } };
      memory.addObservation('complex', complex);
      expect(memory.getObservation('complex')).toEqual(complex);
    });
  });

  // ── Steps ─────────────────────────────────────────

  describe('steps', () => {
    it('should record steps and return count', () => {
      memory.addStep(makeStep());
      memory.addStep(makeStep({ type: 'think' }));
      expect(memory.stepCount).toBe(2);
    });

    it('should return recent steps in chronological order', () => {
      const step1 = makeStep({ type: 'observe', output: 'first' });
      const step2 = makeStep({ type: 'think', output: 'second' });
      const step3 = makeStep({ type: 'act', output: 'third' });

      memory.addStep(step1);
      memory.addStep(step2);
      memory.addStep(step3);

      const recent = memory.getRecentSteps(2);
      expect(recent).toHaveLength(2);
      expect(recent[0]?.output).toBe('second');
      expect(recent[1]?.output).toBe('third');
    });

    it('should return all steps when count exceeds total', () => {
      memory.addStep(makeStep({ output: 'only' }));
      const recent = memory.getRecentSteps(10);
      expect(recent).toHaveLength(1);
    });

    it('should return all steps in order', () => {
      memory.addStep(makeStep({ output: 'a' }));
      memory.addStep(makeStep({ output: 'b' }));
      memory.addStep(makeStep({ output: 'c' }));

      const all = memory.getAllSteps();
      expect(all).toHaveLength(3);
      expect(all[0]?.output).toBe('a');
      expect(all[2]?.output).toBe('c');
    });
  });

  // ── Conversation History ──────────────────────────

  describe('getConversationHistory', () => {
    it('should format observe steps as user messages', () => {
      memory.addStep(makeStep({ type: 'observe', output: 'Customer looked up' }));
      const history = memory.getConversationHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.role).toBe('user');
      expect(history[0]?.content).toContain('[OBSERVE]');
      expect(history[0]?.content).toContain('Customer looked up');
    });

    it('should format think steps as user messages', () => {
      memory.addStep(makeStep({ type: 'think', output: 'Analyzing data' }));
      const history = memory.getConversationHistory();
      expect(history[0]?.role).toBe('user');
      expect(history[0]?.content).toContain('[THINK]');
    });

    it('should format act steps as assistant messages', () => {
      memory.addStep(makeStep({ type: 'act', output: 'SMS sent', toolUsed: 'send_sms', confidence: 0.9 }));
      const history = memory.getConversationHistory();
      expect(history[0]?.role).toBe('assistant');
      expect(history[0]?.content).toContain('[ACT]');
      expect(history[0]?.content).toContain('Tool: send_sms');
      expect(history[0]?.content).toContain('confidence: 0.9');
    });

    it('should format check steps as assistant messages', () => {
      memory.addStep(makeStep({ type: 'check', output: 'Compliance passed' }));
      const history = memory.getConversationHistory();
      expect(history[0]?.role).toBe('assistant');
      expect(history[0]?.content).toContain('[CHECK]');
    });

    it('should maintain chronological order across multiple steps', () => {
      memory.addStep(makeStep({ type: 'observe', output: 'step1' }));
      memory.addStep(makeStep({ type: 'think', output: 'step2' }));
      memory.addStep(makeStep({ type: 'act', output: 'step3', toolUsed: 'send_sms' }));
      memory.addStep(makeStep({ type: 'check', output: 'step4' }));

      const history = memory.getConversationHistory();
      expect(history).toHaveLength(4);
      expect(history[0]?.role).toBe('user');
      expect(history[1]?.role).toBe('user');
      expect(history[2]?.role).toBe('assistant');
      expect(history[3]?.role).toBe('assistant');
    });
  });

  // ── Summarize ─────────────────────────────────────

  describe('summarize', () => {
    it('should return step count in summary', () => {
      memory.addStep(makeStep());
      memory.addStep(makeStep());
      const summary = memory.summarize();
      expect(summary).toContain('Steps: 2');
    });

    it('should include observation keys in summary', () => {
      memory.addObservation('customer', 'data');
      memory.addObservation('payment', 'info');
      const summary = memory.summarize();
      expect(summary).toContain('Observations: customer, payment');
    });

    it('should include step breakdown by type', () => {
      memory.addStep(makeStep({ type: 'observe' }));
      memory.addStep(makeStep({ type: 'observe' }));
      memory.addStep(makeStep({ type: 'think' }));
      memory.addStep(makeStep({ type: 'act' }));
      const summary = memory.summarize();
      expect(summary).toContain('observe=2');
      expect(summary).toContain('think=1');
      expect(summary).toContain('act=1');
    });

    it('should include last step info', () => {
      memory.addStep(makeStep({ type: 'act', confidence: 0.85 }));
      const summary = memory.summarize();
      expect(summary).toContain('Last step: act');
      expect(summary).toContain('confidence: 0.85');
    });

    it('should handle empty memory', () => {
      const summary = memory.summarize();
      expect(summary).toContain('Steps: 0');
    });
  });

  // ── State Export/Import ───────────────────────────

  describe('state serialization', () => {
    it('should export state as immutable snapshot', () => {
      memory.addObservation('key', 'value');
      memory.addStep(makeStep());

      const state = memory.toState();
      expect(state.observations.get('key')).toBe('value');
      expect(state.steps).toHaveLength(1);
    });

    it('should restore memory from state', () => {
      memory.addObservation('key', 'value');
      memory.addStep(makeStep({ output: 'restored' }));

      const state = memory.toState();
      const restored = AgentMemory.fromState(state);

      expect(restored.getObservation('key')).toBe('value');
      expect(restored.stepCount).toBe(1);
      expect(restored.getAllSteps()[0]?.output).toBe('restored');
    });
  });
});
