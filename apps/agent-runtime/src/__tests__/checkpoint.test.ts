import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@ordr/core';
import {
  CheckpointManager,
  InMemoryCheckpointStore,
  CHECKPOINT_AUTO_SAVE_INTERVAL,
} from '../checkpoint.js';
import type { CheckpointInfo } from '../checkpoint.js';
import { AgentMemory } from '../memory.js';
import type { AgentContext, AgentStep } from '../types.js';

// ─── Mock Context Factory ───────────────────────────────────────

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    agentRole: 'collections',
    autonomyLevel: 'supervised',
    tools: new Map(),
    memory: { observations: new Map(), steps: [] },
    budget: {
      maxTokens: 100_000,
      maxCostCents: 500,
      maxActions: 20,
      usedTokens: 5000,
      usedCostCents: 25,
      usedActions: 3,
    },
    killSwitch: { active: false, reason: '', killedAt: null },
    triggerEventId: 'evt-1',
    startedAt: new Date(),
    ...overrides,
  };
}

function makePopulatedMemory(): AgentMemory {
  const memory = new AgentMemory();
  memory.addObservation('decision_id', 'dec-1');
  memory.addObservation('customer_status', 'active');

  const steps: AgentStep[] = [
    {
      type: 'observe',
      input: 'Start',
      output: 'Customer lookup',
      confidence: 0.9,
      durationMs: 50,
      toolUsed: undefined,
      timestamp: new Date('2024-01-15T10:00:00Z'),
    },
    {
      type: 'act',
      input: 'Action: send_sms',
      output: 'SMS sent',
      confidence: 0.85,
      durationMs: 200,
      toolUsed: 'send_sms',
      timestamp: new Date('2024-01-15T10:01:00Z'),
    },
  ];

  for (const step of steps) {
    memory.addStep(step);
  }

  return memory;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('CheckpointManager', () => {
  let manager: CheckpointManager;
  let store: InMemoryCheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
    manager = new CheckpointManager(store);
  });

  // ── Save ──────────────────────────────────────────

  describe('save', () => {
    it('should save a checkpoint and return ID', async () => {
      const context = makeContext();
      const memory = makePopulatedMemory();

      const result = await manager.save(context, memory);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeDefined();
        expect(typeof result.data).toBe('string');
      }
    });

    it('should persist checkpoint to store', async () => {
      const context = makeContext();
      const memory = makePopulatedMemory();

      await manager.save(context, memory);
      expect(store.size).toBe(1);
    });

    it('should save multiple checkpoints for same session', async () => {
      const context = makeContext();
      const memory = makePopulatedMemory();

      await manager.save(context, memory);
      memory.addStep({
        type: 'act',
        input: 'Action: check_payment',
        output: 'Payment checked',
        confidence: 0.8,
        durationMs: 150,
        toolUsed: 'check_payment',
        timestamp: new Date(),
      });
      await manager.save(context, memory);

      expect(store.size).toBe(2);
    });

    it('should serialize budget state', async () => {
      const context = makeContext({
        budget: {
          maxTokens: 50_000,
          maxCostCents: 200,
          maxActions: 10,
          usedTokens: 10_000,
          usedCostCents: 50,
          usedActions: 5,
        },
      });
      const memory = new AgentMemory();

      const saveResult = await manager.save(context, memory);
      expect(isOk(saveResult)).toBe(true);
      if (!isOk(saveResult)) return;

      const restoreResult = await manager.restore(saveResult.data, 'tenant-1');
      expect(isOk(restoreResult)).toBe(true);
      if (isOk(restoreResult)) {
        expect(restoreResult.data.context.budget.maxTokens).toBe(50_000);
        expect(restoreResult.data.context.budget.usedTokens).toBe(10_000);
        expect(restoreResult.data.context.budget.usedActions).toBe(5);
      }
    });
  });

  // ── Restore ───────────────────────────────────────

  describe('restore', () => {
    it('should restore context and memory from checkpoint', async () => {
      const context = makeContext();
      const memory = makePopulatedMemory();

      const saveResult = await manager.save(context, memory);
      expect(isOk(saveResult)).toBe(true);
      if (!isOk(saveResult)) return;

      const restoreResult = await manager.restore(saveResult.data, 'tenant-1');
      expect(isOk(restoreResult)).toBe(true);
      if (isOk(restoreResult)) {
        expect(restoreResult.data.context.sessionId).toBe('session-1');
        expect(restoreResult.data.context.tenantId).toBe('tenant-1');
        expect(restoreResult.data.context.customerId).toBe('cust-1');
        expect(restoreResult.data.context.agentRole).toBe('collections');
        expect(restoreResult.data.memory).toBeInstanceOf(AgentMemory);
        expect(restoreResult.data.memory.stepCount).toBe(2);
      }
    });

    it('should restore memory observations', async () => {
      const context = makeContext();
      const memory = makePopulatedMemory();

      const saveResult = await manager.save(context, memory);
      if (!isOk(saveResult)) return;

      const restoreResult = await manager.restore(saveResult.data, 'tenant-1');
      if (isOk(restoreResult)) {
        expect(restoreResult.data.memory.hasObservation('decision_id')).toBe(true);
        expect(restoreResult.data.memory.getObservation('decision_id')).toBe('dec-1');
      }
    });

    it('should return error for non-existent checkpoint', async () => {
      const result = await manager.restore('non-existent-id', 'tenant-1');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('not found');
      }
    });
  });

  // ── Tenant Verification ───────────────────────────

  describe('tenant verification', () => {
    it('should reject restore for wrong tenant', async () => {
      const context = makeContext({ tenantId: 'tenant-1' });
      const memory = new AgentMemory();

      const saveResult = await manager.save(context, memory);
      if (!isOk(saveResult)) return;

      const result = await manager.restore(saveResult.data, 'tenant-2');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('does not belong to tenant');
      }
    });

    it('should reject delete for wrong tenant', async () => {
      const context = makeContext({ tenantId: 'tenant-1' });
      const memory = new AgentMemory();

      const saveResult = await manager.save(context, memory);
      if (!isOk(saveResult)) return;

      const result = await manager.deleteCheckpoint(saveResult.data, 'tenant-2');
      expect(isErr(result)).toBe(true);
    });
  });

  // ── List ──────────────────────────────────────────

  describe('listCheckpoints', () => {
    it('should list checkpoints for a session', async () => {
      const context = makeContext();
      const memory = makePopulatedMemory();

      await manager.save(context, memory);
      memory.addStep({
        type: 'observe',
        input: 'Extra step',
        output: 'More data',
        confidence: 0.7,
        durationMs: 30,
        toolUsed: undefined,
        timestamp: new Date(),
      });
      await manager.save(context, memory);

      const result = await manager.listCheckpoints('session-1', 'tenant-1');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(2);
        // Sorted by step number ascending
        expect(result.data[0]?.stepNumber).toBeLessThanOrEqual(result.data[1]?.stepNumber ?? Infinity);
      }
    });

    it('should return empty for unknown session', async () => {
      const result = await manager.listCheckpoints('non-existent', 'tenant-1');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('should respect tenant isolation', async () => {
      const context = makeContext({ tenantId: 'tenant-1' });
      const memory = new AgentMemory();
      await manager.save(context, memory);

      // Query with different tenant
      const result = await manager.listCheckpoints('session-1', 'tenant-2');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(0);
      }
    });
  });

  // ── Delete ────────────────────────────────────────

  describe('deleteCheckpoint', () => {
    it('should delete a checkpoint', async () => {
      const context = makeContext();
      const memory = new AgentMemory();

      const saveResult = await manager.save(context, memory);
      if (!isOk(saveResult)) return;

      const deleteResult = await manager.deleteCheckpoint(saveResult.data, 'tenant-1');
      expect(isOk(deleteResult)).toBe(true);
      expect(store.size).toBe(0);
    });

    it('should return error for non-existent checkpoint', async () => {
      const result = await manager.deleteCheckpoint('non-existent', 'tenant-1');
      expect(isErr(result)).toBe(true);
    });
  });

  // ── Auto-Save Logic ───────────────────────────────

  describe('shouldAutoSave', () => {
    it('should return true at auto-save interval', () => {
      expect(manager.shouldAutoSave(CHECKPOINT_AUTO_SAVE_INTERVAL)).toBe(true);
      expect(manager.shouldAutoSave(CHECKPOINT_AUTO_SAVE_INTERVAL * 2)).toBe(true);
    });

    it('should return false between intervals', () => {
      expect(manager.shouldAutoSave(1)).toBe(false);
      expect(manager.shouldAutoSave(2)).toBe(false);
      expect(manager.shouldAutoSave(CHECKPOINT_AUTO_SAVE_INTERVAL + 1)).toBe(false);
    });

    it('should return false for step 0', () => {
      expect(manager.shouldAutoSave(0)).toBe(false);
    });

    it('should have auto-save interval of 3', () => {
      expect(CHECKPOINT_AUTO_SAVE_INTERVAL).toBe(3);
    });
  });

  // ── Store Access ──────────────────────────────────

  describe('store access', () => {
    it('should expose the underlying store', () => {
      const exposedStore = manager.getStore();
      expect(exposedStore).toBe(store);
    });
  });
});
