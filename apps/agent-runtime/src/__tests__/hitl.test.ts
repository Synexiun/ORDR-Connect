import { describe, it, expect, beforeEach } from 'vitest';
import { HitlQueue } from '../hitl.js';
import type { AgentDecision, AgentContext, AgentBudget, KillSwitch, AgentMemoryState } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeDecision(overrides: Partial<AgentDecision> = {}): AgentDecision {
  return {
    action: 'send_sms',
    parameters: { to: '+14155551234', body: 'Payment reminder' },
    reasoning: 'Customer has overdue balance',
    confidence: 0.6,
    requiresApproval: true,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
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
    sessionId: 'session-123',
    tenantId: 'tenant-abc',
    customerId: 'cust-456',
    agentRole: 'collections',
    autonomyLevel: 'supervised',
    tools: new Map(),
    memory: memoryState,
    budget,
    killSwitch,
    triggerEventId: 'evt-789',
    startedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('HitlQueue', () => {
  let queue: HitlQueue;

  beforeEach(() => {
    queue = new HitlQueue();
  });

  // ── Enqueue ───────────────────────────────────────

  describe('enqueue', () => {
    it('should add an item and return a queue ID', () => {
      const id = queue.enqueue('session-1', makeDecision(), makeContext());
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should set item status to pending', () => {
      const id = queue.enqueue('session-1', makeDecision(), makeContext());
      const item = queue.getItem(id);
      expect(item?.status).toBe('pending');
    });

    it('should capture the decision and context metadata', () => {
      const decision = makeDecision({ action: 'schedule_followup', confidence: 0.5 });
      const context = makeContext({ tenantId: 'tenant-xyz', customerId: 'cust-999' });

      const id = queue.enqueue('session-2', decision, context);
      const item = queue.getItem(id);

      expect(item?.decision.action).toBe('schedule_followup');
      expect(item?.decision.confidence).toBe(0.5);
      expect(item?.context.tenantId).toBe('tenant-xyz');
      expect(item?.context.customerId).toBe('cust-999');
    });

    it('should increment queue size', () => {
      expect(queue.size).toBe(0);
      queue.enqueue('s1', makeDecision(), makeContext());
      expect(queue.size).toBe(1);
      queue.enqueue('s2', makeDecision(), makeContext());
      expect(queue.size).toBe(2);
    });
  });

  // ── Approve ───────────────────────────────────────

  describe('approve', () => {
    it('should approve a pending item and return the decision', () => {
      const decision = makeDecision({ action: 'send_sms', confidence: 0.65 });
      const id = queue.enqueue('session-1', decision, makeContext());

      const returned = queue.approve(id, 'user-admin');
      expect(returned.action).toBe('send_sms');
      expect(returned.confidence).toBe(0.65);
    });

    it('should update item status to approved', () => {
      const id = queue.enqueue('session-1', makeDecision(), makeContext());
      queue.approve(id, 'user-admin');

      const item = queue.getItem(id);
      expect(item?.status).toBe('approved');
      expect(item?.reviewedBy).toBe('user-admin');
      expect(item?.reviewedAt).toBeInstanceOf(Date);
    });

    it('should throw for non-existent item', () => {
      expect(() => queue.approve('nonexistent', 'user-admin')).toThrow('not found');
    });

    it('should throw for already approved item', () => {
      const id = queue.enqueue('session-1', makeDecision(), makeContext());
      queue.approve(id, 'user-admin');

      expect(() => queue.approve(id, 'user-admin')).toThrow('not pending');
    });
  });

  // ── Reject ────────────────────────────────────────

  describe('reject', () => {
    it('should reject a pending item with reason', () => {
      const id = queue.enqueue('session-1', makeDecision(), makeContext());
      queue.reject(id, 'user-admin', 'Customer already contacted today');

      const item = queue.getItem(id);
      expect(item?.status).toBe('rejected');
      expect(item?.reviewedBy).toBe('user-admin');
      expect(item?.rejectionReason).toBe('Customer already contacted today');
    });

    it('should throw for non-existent item', () => {
      expect(() => queue.reject('nonexistent', 'user-admin', 'reason')).toThrow('not found');
    });

    it('should throw for already rejected item', () => {
      const id = queue.enqueue('session-1', makeDecision(), makeContext());
      queue.reject(id, 'user-admin', 'reason1');

      expect(() => queue.reject(id, 'user-admin', 'reason2')).toThrow('not pending');
    });

    it('should throw when trying to reject an approved item', () => {
      const id = queue.enqueue('session-1', makeDecision(), makeContext());
      queue.approve(id, 'user-admin');

      expect(() => queue.reject(id, 'user-other', 'changed mind')).toThrow('not pending');
    });
  });

  // ── getPending ────────────────────────────────────

  describe('getPending', () => {
    it('should return only pending items for the specified tenant', () => {
      const ctxA = makeContext({ tenantId: 'tenant-A' });
      const ctxB = makeContext({ tenantId: 'tenant-B' });

      queue.enqueue('s1', makeDecision(), ctxA);
      queue.enqueue('s2', makeDecision(), ctxB);
      queue.enqueue('s3', makeDecision(), ctxA);

      const pendingA = queue.getPending('tenant-A');
      expect(pendingA).toHaveLength(2);

      const pendingB = queue.getPending('tenant-B');
      expect(pendingB).toHaveLength(1);
    });

    it('should exclude approved and rejected items', () => {
      const ctx = makeContext({ tenantId: 'tenant-X' });
      const id1 = queue.enqueue('s1', makeDecision(), ctx);
      const id2 = queue.enqueue('s2', makeDecision(), ctx);
      queue.enqueue('s3', makeDecision(), ctx);

      queue.approve(id1, 'user-admin');
      queue.reject(id2, 'user-admin', 'reason');

      const pending = queue.getPending('tenant-X');
      expect(pending).toHaveLength(1);
    });

    it('should return empty array for tenant with no items', () => {
      expect(queue.getPending('nonexistent')).toEqual([]);
    });

    it('should return items sorted by creation time (oldest first)', () => {
      const ctx = makeContext({ tenantId: 'tenant-sort' });
      queue.enqueue('s1', makeDecision({ action: 'first' }), ctx);
      queue.enqueue('s2', makeDecision({ action: 'second' }), ctx);
      queue.enqueue('s3', makeDecision({ action: 'third' }), ctx);

      const pending = queue.getPending('tenant-sort');
      expect(pending[0]?.decision.action).toBe('first');
      expect(pending[2]?.decision.action).toBe('third');
    });
  });

  // ── getPendingCount ───────────────────────────────

  describe('getPendingCount', () => {
    it('should return correct count of pending items', () => {
      const ctx = makeContext({ tenantId: 'tenant-count' });
      queue.enqueue('s1', makeDecision(), ctx);
      queue.enqueue('s2', makeDecision(), ctx);

      expect(queue.getPendingCount('tenant-count')).toBe(2);
    });

    it('should return 0 for empty queue', () => {
      expect(queue.getPendingCount('empty')).toBe(0);
    });
  });
});
