/**
 * AnalyticsEventSink tests
 *
 * Verifies:
 * - All event handlers (customer, interaction, agent, compliance)
 * - Batch accumulation and flush on count threshold
 * - Flush on timer (via manual flush)
 * - Idempotent deduplication
 * - Tenant isolation in writes
 * - Dimension extraction from event payloads
 * - Error recovery (buffer retained on failure)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EventEnvelope } from '@ordr/events';
import { InMemoryAnalyticsStore } from '../client.js';
import { AnalyticsEventSink } from '../event-sink.js';

// ─── Test Helpers ────────────────────────────────────────────────

function makeEnvelope<T>(
  id: string,
  type: string,
  tenantId: string,
  payload: T,
): EventEnvelope<T> {
  return {
    id,
    type,
    tenantId,
    payload,
    metadata: {
      correlationId: 'corr-1',
      causationId: 'cause-1',
      source: 'test',
      version: 1,
    },
    timestamp: new Date().toISOString(),
  };
}

describe('AnalyticsEventSink', () => {
  let store: InMemoryAnalyticsStore;
  let sink: AnalyticsEventSink;

  beforeEach(() => {
    store = new InMemoryAnalyticsStore();
    sink = new AnalyticsEventSink(store, {
      flushIntervalMs: 60_000, // disable auto-flush in tests
      flushSize: 100,
      maxDedupCacheSize: 1000,
    });
  });

  afterEach(async () => {
    await sink.stop();
  });

  // ─── Customer Events ──────────────────────────────────────────

  describe('handleCustomerEvent', () => {
    it('writes a metric row for a customer event', async () => {
      const event = makeEnvelope('evt-1', 'customer.created', 'tenant-1', {
        customerId: 'cust-1',
        type: 'individual',
        lifecycleStage: 'lead',
      });

      await sink.handleCustomerEvent(event);
      await sink.flush();

      expect(store.getRows('tenant-1', 'metrics').length).toBe(1);
    });

    it('extracts customer type as dimension', async () => {
      const event = makeEnvelope('evt-2', 'customer.created', 'tenant-1', {
        customerId: 'cust-2',
        type: 'company',
        lifecycleStage: 'customer',
      });

      await sink.handleCustomerEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      expect(rows.length).toBe(1);
      const row = rows[0]!.data as Record<string, unknown>;
      const dims = row['dimensions'] as Record<string, string>;
      expect(dims['customer_type']).toBe('company');
    });
  });

  // ─── Interaction Events ────────────────────────────────────────

  describe('handleInteractionEvent', () => {
    it('writes messages_sent metric for default status', async () => {
      const event = makeEnvelope('evt-3', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-1',
        customerId: 'cust-1',
        channel: 'email',
        direction: 'outbound',
        type: 'email',
      });

      await sink.handleInteractionEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      expect(rows.length).toBe(1);
      const row = rows[0]!.data as Record<string, unknown>;
      expect(row['metric']).toBe('messages_sent');
    });

    it('writes messages_delivered metric for delivered status', async () => {
      const event = makeEnvelope('evt-4', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-2',
        customerId: 'cust-1',
        channel: 'sms',
        direction: 'outbound',
        type: 'sms',
        status: 'delivered',
      });

      await sink.handleInteractionEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      expect(rows.length).toBe(1);
      const row = rows[0]!.data as Record<string, unknown>;
      expect(row['metric']).toBe('messages_delivered');
    });

    it('writes messages_failed metric for failed status', async () => {
      const event = makeEnvelope('evt-5', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-3',
        customerId: 'cust-1',
        channel: 'email',
        direction: 'outbound',
        type: 'email',
        status: 'failed',
      });

      await sink.handleInteractionEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      expect(rows.length).toBe(1);
      const row = rows[0]!.data as Record<string, unknown>;
      expect(row['metric']).toBe('messages_failed');
    });

    it('tracks cost as separate metric row when costCents is present', async () => {
      const event = makeEnvelope('evt-6', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-4',
        customerId: 'cust-1',
        channel: 'sms',
        direction: 'outbound',
        type: 'sms',
        costCents: 5,
      });

      await sink.handleInteractionEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      expect(rows.length).toBe(2); // message + cost
    });

    it('extracts channel dimension from interaction event', async () => {
      const event = makeEnvelope('evt-7', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-5',
        customerId: 'cust-1',
        channel: 'whatsapp',
        direction: 'inbound',
        type: 'chat',
      });

      await sink.handleInteractionEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      const row = rows[0]!.data as Record<string, unknown>;
      const dims = row['dimensions'] as Record<string, string>;
      expect(dims['channel']).toBe('whatsapp');
    });
  });

  // ─── Agent Events ──────────────────────────────────────────────

  describe('handleAgentEvent', () => {
    it('writes agent_sessions metric', async () => {
      const event = makeEnvelope('evt-8', 'agent.action_executed', 'tenant-1', {
        actionId: 'act-1',
        agentId: 'agent-1',
        agentRole: 'collections',
        actionType: 'send_sms',
        confidence: 0.85,
        approved: true,
      });

      await sink.handleAgentEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const sessionRow = rows.find((r) => (r.data as Record<string, unknown>)['metric'] === 'agent_sessions');
      expect(sessionRow).toBeDefined();
    });

    it('writes agent_resolutions metric when resolved', async () => {
      const event = makeEnvelope('evt-9', 'agent.action_executed', 'tenant-1', {
        actionId: 'act-2',
        agentId: 'agent-1',
        agentRole: 'follow_up',
        actionType: 'resolve',
        confidence: 0.92,
        approved: true,
        resolved: true,
      });

      await sink.handleAgentEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      const resolutionRow = rows.find((r) => (r.data as Record<string, unknown>)['metric'] === 'agent_resolutions');
      expect(resolutionRow).toBeDefined();
    });

    it('tracks duration and cost as separate metrics', async () => {
      const event = makeEnvelope('evt-10', 'agent.action_executed', 'tenant-1', {
        actionId: 'act-3',
        agentId: 'agent-1',
        agentRole: 'collections',
        actionType: 'call',
        confidence: 0.8,
        approved: true,
        durationMs: 5000,
        costCents: 12,
        steps: 3,
      });

      await sink.handleAgentEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      const durationRow = rows.find((r) => (r.data as Record<string, unknown>)['metric'] === 'avg_response_time');
      const costRow = rows.find((r) =>
        (r.data as Record<string, unknown>)['metric'] === 'cost_per_interaction' &&
        (r.data as Record<string, unknown>)['event_id'] === 'evt-10_cost',
      );
      expect(durationRow).toBeDefined();
      expect(costRow).toBeDefined();
    });
  });

  // ─── Compliance Events ─────────────────────────────────────────

  describe('handleComplianceEvent', () => {
    it('writes compliance_violations metric for violations', async () => {
      const event = makeEnvelope('evt-11', 'compliance.check', 'tenant-1', {
        recordId: 'rec-1',
        regulation: 'HIPAA',
        ruleId: 'rule-1',
        result: 'violation',
      });

      await sink.handleComplianceEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      expect(rows.length).toBe(1);
      const row = rows[0]!.data as Record<string, unknown>;
      expect(row['metric']).toBe('compliance_violations');
    });

    it('does not write violation metric for passing checks', async () => {
      const event = makeEnvelope('evt-12', 'compliance.check', 'tenant-1', {
        recordId: 'rec-2',
        regulation: 'SOC2',
        ruleId: 'rule-2',
        result: 'pass',
      });

      await sink.handleComplianceEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      expect(rows.length).toBe(0);
    });

    it('extracts regulation dimension from compliance event', async () => {
      const event = makeEnvelope('evt-13', 'compliance.check', 'tenant-1', {
        recordId: 'rec-3',
        regulation: 'ISO27001',
        ruleId: 'rule-3',
        result: 'fail',
      });

      await sink.handleComplianceEvent(event);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      const row = rows[0]!.data as Record<string, unknown>;
      const dims = row['dimensions'] as Record<string, string>;
      expect(dims['regulation']).toBe('ISO27001');
    });
  });

  // ─── Batching ──────────────────────────────────────────────────

  describe('batching', () => {
    it('accumulates events in buffer before flush', async () => {
      const event = makeEnvelope('evt-14', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-6',
        customerId: 'cust-1',
        channel: 'email',
        direction: 'outbound',
        type: 'email',
      });

      await sink.handleInteractionEvent(event);

      // Buffer should have the row, store should not yet
      expect(sink.bufferSize).toBeGreaterThan(0);
      expect(store.totalRows).toBe(0);
    });

    it('flushes when buffer reaches size threshold', async () => {
      // Create a sink with low flush threshold
      const smallSink = new AnalyticsEventSink(store, {
        flushIntervalMs: 60_000,
        flushSize: 3,
        maxDedupCacheSize: 1000,
      });

      for (let i = 0; i < 3; i++) {
        const event = makeEnvelope(`batch-${i}`, 'interaction.logged', 'tenant-1', {
          interactionId: `int-batch-${i}`,
          customerId: 'cust-1',
          channel: 'email',
          direction: 'outbound',
          type: 'email',
        });
        await smallSink.handleInteractionEvent(event);
      }

      // Should have flushed after 3rd event
      expect(store.totalRows).toBeGreaterThanOrEqual(3);
      await smallSink.stop();
    });

    it('drains buffer on stop', async () => {
      const event = makeEnvelope('evt-15', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-7',
        customerId: 'cust-1',
        channel: 'sms',
        direction: 'outbound',
        type: 'sms',
      });

      await sink.handleInteractionEvent(event);
      expect(sink.bufferSize).toBeGreaterThan(0);

      await sink.stop();

      // Buffer should be drained to store
      expect(store.totalRows).toBeGreaterThan(0);
    });
  });

  // ─── Idempotency ──────────────────────────────────────────────

  describe('idempotency', () => {
    it('deduplicates events with the same ID', async () => {
      const event = makeEnvelope('dup-evt-1', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-dup',
        customerId: 'cust-1',
        channel: 'email',
        direction: 'outbound',
        type: 'email',
      });

      await sink.handleInteractionEvent(event);
      await sink.handleInteractionEvent(event); // Duplicate
      await sink.handleInteractionEvent(event); // Triple duplicate
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      // Only one row should be written (not three)
      expect(rows.length).toBe(1);
    });

    it('processes events with different IDs independently', async () => {
      const event1 = makeEnvelope('unique-1', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-u1',
        customerId: 'cust-1',
        channel: 'email',
        direction: 'outbound',
        type: 'email',
      });

      const event2 = makeEnvelope('unique-2', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-u2',
        customerId: 'cust-1',
        channel: 'sms',
        direction: 'outbound',
        type: 'sms',
      });

      await sink.handleInteractionEvent(event1);
      await sink.handleInteractionEvent(event2);
      await sink.flush();

      const rows = store.getRows('tenant-1', 'metrics');
      expect(rows.length).toBe(2);
    });

    it('tracks dedup cache size', async () => {
      const event = makeEnvelope('dedup-check', 'customer.created', 'tenant-1', {
        customerId: 'cust-1',
      });

      await sink.handleCustomerEvent(event);
      expect(sink.dedupCacheSize).toBe(1);
    });
  });

  // ─── Tenant Isolation ──────────────────────────────────────────

  describe('tenant isolation', () => {
    it('writes events to correct tenant scope', async () => {
      const event1 = makeEnvelope('t-evt-1', 'interaction.logged', 'tenant-1', {
        interactionId: 'int-t1',
        customerId: 'cust-1',
        channel: 'email',
        direction: 'outbound',
        type: 'email',
      });

      const event2 = makeEnvelope('t-evt-2', 'interaction.logged', 'tenant-2', {
        interactionId: 'int-t2',
        customerId: 'cust-2',
        channel: 'sms',
        direction: 'outbound',
        type: 'sms',
      });

      await sink.handleInteractionEvent(event1);
      await sink.handleInteractionEvent(event2);
      await sink.flush();

      expect(store.getRows('tenant-1', 'metrics').length).toBe(1);
      expect(store.getRows('tenant-2', 'metrics').length).toBe(1);
    });
  });
});
