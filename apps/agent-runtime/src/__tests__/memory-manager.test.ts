import { describe, it, expect, beforeEach } from 'vitest';
import { isOk } from '@ordr/core';
import { MemoryManager, InMemoryEpisodicStore } from '../memory/manager.js';
import type { EpisodicMemory } from '../memory/manager.js';
import { AgentMemory } from '../memory.js';
import type { AgentStep } from '../types.js';

// ─── Helper: create a populated memory ──────────────────────────

function makePopulatedMemory(): AgentMemory {
  const memory = new AgentMemory();
  memory.addObservation('decision_id', 'dec-1');
  memory.addObservation('customer_status', 'active');

  const steps: AgentStep[] = [
    {
      type: 'observe',
      input: 'Starting',
      output: 'Customer lookup initiated',
      confidence: 0.9,
      durationMs: 50,
      toolUsed: undefined,
      timestamp: new Date(),
    },
    {
      type: 'act',
      input: 'Action: lookup_customer',
      output: 'Customer found',
      confidence: 0.85,
      durationMs: 120,
      toolUsed: 'lookup_customer',
      timestamp: new Date(),
    },
    {
      type: 'act',
      input: 'Action: send_sms',
      output: 'SMS sent',
      confidence: 0.8,
      durationMs: 200,
      toolUsed: 'send_sms',
      timestamp: new Date(),
    },
    {
      type: 'check',
      input: 'Check HITL',
      output: 'Routed to HITL queue',
      confidence: 0.5,
      durationMs: 10,
      toolUsed: undefined,
      timestamp: new Date(),
    },
    {
      type: 'check',
      input: 'Check compliance',
      output: 'Blocked by compliance gate',
      confidence: 0.7,
      durationMs: 15,
      toolUsed: undefined,
      timestamp: new Date(),
    },
  ];

  for (const step of steps) {
    memory.addStep(step);
  }

  return memory;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('MemoryManager', () => {
  let manager: MemoryManager;
  let store: InMemoryEpisodicStore;

  beforeEach(() => {
    store = new InMemoryEpisodicStore();
    manager = new MemoryManager(store);
  });

  // ── Working Memory ────────────────────────────────

  describe('createWorkingMemory', () => {
    it('should create a fresh AgentMemory instance', () => {
      const memory = manager.createWorkingMemory();
      expect(memory).toBeInstanceOf(AgentMemory);
      expect(memory.stepCount).toBe(0);
    });

    it('should create independent instances', () => {
      const mem1 = manager.createWorkingMemory();
      const mem2 = manager.createWorkingMemory();
      mem1.addObservation('key', 'value');
      expect(mem2.hasObservation('key')).toBe(false);
    });
  });

  // ── Promote to Episodic ───────────────────────────

  describe('promoteToEpisodic', () => {
    it('should save episodic memory from working memory', async () => {
      const memory = makePopulatedMemory();
      const result = await manager.promoteToEpisodic(
        'session-1', 'cust-1', 'tenant-1', 'collections', memory, 'completed',
      );

      expect(isOk(result)).toBe(true);
      expect(store.size).toBe(1);
    });

    it('should extract key observations from steps', async () => {
      const memory = makePopulatedMemory();
      await manager.promoteToEpisodic(
        'session-1', 'cust-1', 'tenant-1', 'collections', memory, 'completed',
      );

      const episodic = await store.findByCustomer('cust-1', 'tenant-1', 10);
      expect(isOk(episodic)).toBe(true);
      if (isOk(episodic)) {
        const mem = episodic.data[0];
        expect(mem).toBeDefined();
        // Should have observations for tool executions
        expect(mem?.keyObservations.some((o) => o.includes('lookup_customer'))).toBe(true);
        expect(mem?.keyObservations.some((o) => o.includes('send_sms'))).toBe(true);
        // Should have HITL observation
        expect(mem?.keyObservations.some((o) => o.includes('human review'))).toBe(true);
        // Should have compliance observation
        expect(mem?.keyObservations.some((o) => o.includes('compliance'))).toBe(true);
      }
    });

    it('should calculate average confidence', async () => {
      const memory = makePopulatedMemory();
      await manager.promoteToEpisodic(
        'session-1', 'cust-1', 'tenant-1', 'collections', memory, 'completed',
      );

      const episodic = await store.findByCustomer('cust-1', 'tenant-1', 10);
      if (isOk(episodic)) {
        const mem = episodic.data[0];
        expect(mem?.confidence).toBeGreaterThan(0);
        expect(mem?.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should preserve agent role and outcome', async () => {
      const memory = makePopulatedMemory();
      await manager.promoteToEpisodic(
        'session-1', 'cust-1', 'tenant-1', 'collections', memory, 'escalated',
      );

      const episodic = await store.findByCustomer('cust-1', 'tenant-1', 10);
      if (isOk(episodic)) {
        const mem = episodic.data[0];
        expect(mem?.agentRole).toBe('collections');
        expect(mem?.outcome).toBe('escalated');
      }
    });
  });

  // ── Retrieve Episodic ─────────────────────────────

  describe('getEpisodic', () => {
    it('should retrieve episodic memories for a customer', async () => {
      // Save 3 episodes
      for (let i = 0; i < 3; i++) {
        await store.save({
          id: `ep-${String(i)}`,
          sessionId: `session-${String(i)}`,
          customerId: 'cust-1',
          tenantId: 'tenant-1',
          agentRole: 'collections',
          keyObservations: [`Observation ${String(i)}`],
          outcome: 'completed',
          confidence: 0.8,
          timestamp: new Date(Date.now() - i * 60000), // offset timestamps
        });
      }

      const result = await manager.getEpisodic('cust-1', 'tenant-1');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(3);
        // Should be sorted most recent first
        expect(result.data[0]?.sessionId).toBe('session-0');
      }
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await store.save({
          id: `ep-${String(i)}`,
          sessionId: `session-${String(i)}`,
          customerId: 'cust-1',
          tenantId: 'tenant-1',
          agentRole: 'collections',
          keyObservations: [],
          outcome: 'completed',
          confidence: 0.8,
          timestamp: new Date(),
        });
      }

      const result = await manager.getEpisodic('cust-1', 'tenant-1', 3);
      if (isOk(result)) {
        expect(result.data).toHaveLength(3);
      }
    });

    it('should return empty for unknown customer', async () => {
      const result = await manager.getEpisodic('unknown', 'tenant-1');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(0);
      }
    });
  });

  // ── Tenant Isolation ──────────────────────────────

  describe('tenant isolation', () => {
    it('should not return memories from other tenants', async () => {
      await store.save({
        id: 'ep-1',
        sessionId: 'session-1',
        customerId: 'cust-1',
        tenantId: 'tenant-1',
        agentRole: 'collections',
        keyObservations: ['Tenant 1 data'],
        outcome: 'completed',
        confidence: 0.9,
        timestamp: new Date(),
      });

      await store.save({
        id: 'ep-2',
        sessionId: 'session-2',
        customerId: 'cust-1',
        tenantId: 'tenant-2',
        agentRole: 'collections',
        keyObservations: ['Tenant 2 data'],
        outcome: 'completed',
        confidence: 0.9,
        timestamp: new Date(),
      });

      const result = await manager.getEpisodic('cust-1', 'tenant-1');
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.tenantId).toBe('tenant-1');
      }
    });
  });

  // ── Get by Session ────────────────────────────────

  describe('getEpisodicBySession', () => {
    it('should find episodic memory by session ID', async () => {
      await store.save({
        id: 'ep-1',
        sessionId: 'session-abc',
        customerId: 'cust-1',
        tenantId: 'tenant-1',
        agentRole: 'collections',
        keyObservations: [],
        outcome: 'completed',
        confidence: 0.9,
        timestamp: new Date(),
      });

      const result = await manager.getEpisodicBySession('session-abc', 'tenant-1');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeDefined();
        expect(result.data?.sessionId).toBe('session-abc');
      }
    });

    it('should return undefined for unknown session', async () => {
      const result = await manager.getEpisodicBySession('non-existent', 'tenant-1');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeUndefined();
      }
    });
  });

  // ── Semantic Memory Stubs ─────────────────────────

  describe('semantic memory', () => {
    it('should return success from promoteToSemantic stub', async () => {
      const result = await manager.promoteToSemantic('tenant-1');
      expect(isOk(result)).toBe(true);
    });

    it('should return empty results from searchSemantic stub', async () => {
      const result = await manager.searchSemantic('test query', 'tenant-1');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('should accept topK parameter in searchSemantic', async () => {
      const result = await manager.searchSemantic('test query', 'tenant-1', 10);
      expect(isOk(result)).toBe(true);
    });
  });

  // ── Store Access ──────────────────────────────────

  describe('store access', () => {
    it('should expose the episodic store', () => {
      const exposedStore = manager.getEpisodicStore();
      expect(exposedStore).toBe(store);
    });
  });
});
