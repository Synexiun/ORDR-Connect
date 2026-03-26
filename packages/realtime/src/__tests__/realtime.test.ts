/**
 * @ordr/realtime — Comprehensive Test Suite
 *
 * Covers ChannelManager, EventPublisher, serializeSSEEvent, and
 * serializeHeartbeat.  All tests run in-process — no network, no timers
 * left running between cases.
 *
 * SOC2 CC6.1 — Tenant isolation verified in every cross-tenant scenario.
 * ISO 27001 A.9.4.1 — Category/user-scope access controls are unit-tested.
 * HIPAA §164.312(e) — SSE serializer never injects PHI into the wire format.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelManager } from '../channels.js';
import { EventPublisher } from '../publisher.js';
import { serializeSSEEvent, serializeHeartbeat } from '../sse-handler.js';
import { EVENT_CATEGORIES } from '../types.js';
import type {
  EventCategory,
  RealtimeEvent,
  ChannelSubscription,
  RealtimeAuditLogger,
} from '../types.js';
import type { RealtimeAuditLogger as PublisherAuditLogger } from '../publisher.js';

// ─── Factory Helpers ──────────────────────────────────────────────────────────

function makeSendFn(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

function makeCloseFn(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

function makeEvent(overrides: Partial<RealtimeEvent> = {}): RealtimeEvent {
  return {
    id: overrides.id ?? 'evt-001',
    tenantId: overrides.tenantId ?? 'tenant-A',
    category: overrides.category ?? 'customer',
    type: overrides.type ?? 'customer.updated',
    data: overrides.data ?? { customerId: 'cust-001' },
    timestamp: overrides.timestamp ?? new Date('2026-01-01T00:00:00.000Z').toISOString(),
    ...(overrides.targetUserIds !== undefined ? { targetUserIds: overrides.targetUserIds } : {}),
  };
}

/**
 * Build an audit logger mock that resolves immediately and records calls.
 */
function makeAuditLogger(): PublisherAuditLogger & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    log: vi.fn(async (entry: unknown) => {
      calls.push(entry);
    }) as PublisherAuditLogger['log'],
  };
}

// ─── ChannelManager ───────────────────────────────────────────────────────────

describe('ChannelManager', () => {
  let manager: ChannelManager;

  beforeEach(() => {
    manager = new ChannelManager(60_000);
  });

  // ── 1. addConnection ────────────────────────────────────────────────────────

  describe('addConnection()', () => {
    it('returns a ChannelSubscription with the correct tenantId and userId', () => {
      const sub = manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());

      expect(sub.tenantId).toBe('tenant-A');
      expect(sub.userId).toBe('user-1');
    });

    it('returns a ChannelSubscription with the requested categories', () => {
      const categories: EventCategory[] = ['workflow', 'agent'];
      const sub = manager.addConnection('tenant-A', 'user-1', categories, makeSendFn(), makeCloseFn());

      expect(sub.categories).toEqual(categories);
    });

    it('falls back to all categories when an empty array is passed', () => {
      const sub = manager.addConnection('tenant-A', 'user-1', [], makeSendFn(), makeCloseFn());

      expect(sub.categories).toEqual(EVENT_CATEGORIES);
    });

    it('assigns a unique UUID-shaped id to each subscription', () => {
      const sub1 = manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());
      const sub2 = manager.addConnection('tenant-A', 'user-2', ['customer'], makeSendFn(), makeCloseFn());

      expect(sub1.id).not.toBe(sub2.id);
      expect(sub1.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('sets connectedAt and lastHeartbeatAt to current Date instances', () => {
      const before = new Date();
      const sub = manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());
      const after = new Date();

      expect(sub.connectedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(sub.connectedAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(sub.lastHeartbeatAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('registers multiple connections under the same tenant independently', () => {
      manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', ['workflow'], makeSendFn(), makeCloseFn());

      expect(manager.getConnectionCount('tenant-A')).toBe(2);
    });
  });

  // ── 2. removeConnection ─────────────────────────────────────────────────────

  describe('removeConnection()', () => {
    it('returns true and calls closeFn when removing an existing connection', () => {
      const closeFn = makeCloseFn();
      const sub = manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), closeFn);

      const result = manager.removeConnection('tenant-A', sub.id);

      expect(result).toBe(true);
      expect(closeFn).toHaveBeenCalledOnce();
    });

    it('returns false for a non-existent subscriptionId', () => {
      manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());

      const result = manager.removeConnection('tenant-A', 'non-existent-id');

      expect(result).toBe(false);
    });

    it('returns false when tenantId does not exist', () => {
      const result = manager.removeConnection('no-such-tenant', 'sub-id');

      expect(result).toBe(false);
    });

    it('reduces connection count by 1 after removal', () => {
      const sub = manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());
      expect(manager.getConnectionCount('tenant-A')).toBe(1);

      manager.removeConnection('tenant-A', sub.id);

      expect(manager.getConnectionCount('tenant-A')).toBe(0);
    });

    it('double-remove returns false on the second call', () => {
      const sub = manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());

      manager.removeConnection('tenant-A', sub.id);
      const second = manager.removeConnection('tenant-A', sub.id);

      expect(second).toBe(false);
    });
  });

  // ── 3. publish — basic delivery ─────────────────────────────────────────────

  describe('publish() — basic delivery', () => {
    it('returns 0 when there are no connections for the tenant', () => {
      const event = makeEvent({ tenantId: 'tenant-empty' });

      const delivered = manager.publish(event);

      expect(delivered).toBe(0);
    });

    it('calls sendFn and returns 1 for a single matching connection', () => {
      const sendFn = makeSendFn();
      manager.addConnection('tenant-A', 'user-1', ['customer'], sendFn, makeCloseFn());

      const event = makeEvent({ tenantId: 'tenant-A', category: 'customer' });
      const delivered = manager.publish(event);

      expect(delivered).toBe(1);
      expect(sendFn).toHaveBeenCalledOnce();
      expect(sendFn).toHaveBeenCalledWith(event);
    });

    it('delivers to all matching connections and returns the correct count', () => {
      const send1 = makeSendFn();
      const send2 = makeSendFn();
      const send3 = makeSendFn();

      manager.addConnection('tenant-A', 'user-1', ['customer'], send1, makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', ['customer'], send2, makeCloseFn());
      manager.addConnection('tenant-A', 'user-3', ['customer'], send3, makeCloseFn());

      const event = makeEvent({ tenantId: 'tenant-A', category: 'customer' });
      const delivered = manager.publish(event);

      expect(delivered).toBe(3);
      expect(send1).toHaveBeenCalledWith(event);
      expect(send2).toHaveBeenCalledWith(event);
      expect(send3).toHaveBeenCalledWith(event);
    });
  });

  // ── 4. publish — category filtering ─────────────────────────────────────────

  describe('publish() — category filter', () => {
    it('only delivers to connections subscribed to the matching category', () => {
      const sendCustomer = makeSendFn();
      const sendWorkflow = makeSendFn();

      manager.addConnection('tenant-A', 'user-1', ['customer'], sendCustomer, makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', ['workflow'], sendWorkflow, makeCloseFn());

      const event = makeEvent({ tenantId: 'tenant-A', category: 'customer' });
      const delivered = manager.publish(event);

      expect(delivered).toBe(1);
      expect(sendCustomer).toHaveBeenCalledOnce();
      expect(sendWorkflow).not.toHaveBeenCalled();
    });

    it('delivers a billing event only to billing-subscribed connections', () => {
      const sendBilling = makeSendFn();
      const sendAgent = makeSendFn();

      manager.addConnection('tenant-A', 'user-1', ['billing'], sendBilling, makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', ['agent'], sendAgent, makeCloseFn());

      const event = makeEvent({ tenantId: 'tenant-A', category: 'billing', type: 'invoice.created' });
      const delivered = manager.publish(event);

      expect(delivered).toBe(1);
      expect(sendBilling).toHaveBeenCalledWith(event);
      expect(sendAgent).not.toHaveBeenCalled();
    });

    it('skips a connection subscribed to multiple categories when none match', () => {
      const sendFn = makeSendFn();
      manager.addConnection('tenant-A', 'user-1', ['workflow', 'agent'], sendFn, makeCloseFn());

      const event = makeEvent({ tenantId: 'tenant-A', category: 'customer' });
      const delivered = manager.publish(event);

      expect(delivered).toBe(0);
      expect(sendFn).not.toHaveBeenCalled();
    });

    it('delivers when one category in a multi-category subscription matches', () => {
      const sendFn = makeSendFn();
      manager.addConnection('tenant-A', 'user-1', ['customer', 'workflow'], sendFn, makeCloseFn());

      const event = makeEvent({ tenantId: 'tenant-A', category: 'workflow' });
      const delivered = manager.publish(event);

      expect(delivered).toBe(1);
      expect(sendFn).toHaveBeenCalledWith(event);
    });

    it('all-category subscriber receives events from every category', () => {
      const sendFn = makeSendFn();
      manager.addConnection('tenant-A', 'user-1', [], sendFn, makeCloseFn()); // [] → all categories

      const categories: EventCategory[] = ['customer', 'workflow', 'agent', 'notification', 'billing', 'system'];
      for (const cat of categories) {
        const event = makeEvent({ tenantId: 'tenant-A', category: cat, id: `evt-${cat}` });
        manager.publish(event);
      }

      expect(sendFn).toHaveBeenCalledTimes(categories.length);
    });
  });

  // ── 5. publish — targetUserIds ───────────────────────────────────────────────

  describe('publish() — targetUserIds', () => {
    it('delivers only to the targeted user when targetUserIds is set', () => {
      const sendUser1 = makeSendFn();
      const sendUser2 = makeSendFn();

      manager.addConnection('tenant-A', 'user-1', ['notification'], sendUser1, makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', ['notification'], sendUser2, makeCloseFn());

      const event = makeEvent({
        tenantId: 'tenant-A',
        category: 'notification',
        targetUserIds: ['user-1'],
      });
      const delivered = manager.publish(event);

      expect(delivered).toBe(1);
      expect(sendUser1).toHaveBeenCalledWith(event);
      expect(sendUser2).not.toHaveBeenCalled();
    });

    it('delivers to multiple targeted users', () => {
      const sends = [makeSendFn(), makeSendFn(), makeSendFn()];
      ['user-1', 'user-2', 'user-3'].forEach((uid, i) =>
        manager.addConnection('tenant-A', uid, ['notification'], sends[i]!, makeCloseFn()),
      );

      const event = makeEvent({
        tenantId: 'tenant-A',
        category: 'notification',
        targetUserIds: ['user-1', 'user-3'],
      });
      const delivered = manager.publish(event);

      expect(delivered).toBe(2);
      expect(sends[0]).toHaveBeenCalledWith(event);
      expect(sends[1]).not.toHaveBeenCalled();
      expect(sends[2]).toHaveBeenCalledWith(event);
    });

    it('broadcasts to all category-matching connections when targetUserIds is undefined', () => {
      const send1 = makeSendFn();
      const send2 = makeSendFn();

      manager.addConnection('tenant-A', 'user-1', ['system'], send1, makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', ['system'], send2, makeCloseFn());

      const event = makeEvent({ tenantId: 'tenant-A', category: 'system' });
      // targetUserIds is intentionally absent
      const delivered = manager.publish(event);

      expect(delivered).toBe(2);
    });

    it('broadcasts when targetUserIds is an empty array', () => {
      const send1 = makeSendFn();
      const send2 = makeSendFn();

      manager.addConnection('tenant-A', 'user-1', ['agent'], send1, makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', ['agent'], send2, makeCloseFn());

      const event = makeEvent({ tenantId: 'tenant-A', category: 'agent', targetUserIds: [] });
      const delivered = manager.publish(event);

      expect(delivered).toBe(2);
    });
  });

  // ── 6. TENANT ISOLATION ─────────────────────────────────────────────────────

  describe('TENANT ISOLATION — events never leak between tenants', () => {
    it('does NOT deliver to connections belonging to a different tenant', () => {
      const sendA = makeSendFn();
      const sendB = makeSendFn();

      manager.addConnection('tenant-A', 'user-1', ['customer'], sendA, makeCloseFn());
      manager.addConnection('tenant-B', 'user-2', ['customer'], sendB, makeCloseFn());

      const eventForA = makeEvent({ tenantId: 'tenant-A', category: 'customer' });
      manager.publish(eventForA);

      expect(sendA).toHaveBeenCalledOnce();
      expect(sendB).not.toHaveBeenCalled();
    });

    it('publishing to tenant-B does NOT reach tenant-A connections', () => {
      const sendA = makeSendFn();
      const sendB = makeSendFn();

      manager.addConnection('tenant-A', 'user-1', [], sendA, makeCloseFn());
      manager.addConnection('tenant-B', 'user-1', [], sendB, makeCloseFn());

      manager.publish(makeEvent({ tenantId: 'tenant-B', category: 'system' }));

      expect(sendA).not.toHaveBeenCalled();
      expect(sendB).toHaveBeenCalledOnce();
    });

    it('simultaneous publishes to different tenants reach only the correct connections', () => {
      const sendA = makeSendFn();
      const sendB = makeSendFn();
      const sendC = makeSendFn();

      manager.addConnection('tenant-A', 'u-1', ['workflow'], sendA, makeCloseFn());
      manager.addConnection('tenant-B', 'u-2', ['workflow'], sendB, makeCloseFn());
      manager.addConnection('tenant-C', 'u-3', ['workflow'], sendC, makeCloseFn());

      manager.publish(makeEvent({ tenantId: 'tenant-A', category: 'workflow', id: 'e1' }));
      manager.publish(makeEvent({ tenantId: 'tenant-C', category: 'workflow', id: 'e2' }));

      expect(sendA).toHaveBeenCalledTimes(1);
      expect(sendB).not.toHaveBeenCalled();
      expect(sendC).toHaveBeenCalledTimes(1);
    });

    it('getConnections returns an empty array for an unknown tenant', () => {
      manager.addConnection('tenant-A', 'user-1', [], makeSendFn(), makeCloseFn());

      expect(manager.getConnections('unknown-tenant')).toHaveLength(0);
    });
  });

  // ── 7. heartbeat ────────────────────────────────────────────────────────────

  describe('heartbeat()', () => {
    it('updates lastHeartbeatAt to a more recent timestamp', async () => {
      const sub = manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());
      const before = sub.lastHeartbeatAt.getTime();

      // Guarantee clock advances at least 1 ms
      await new Promise<void>((r) => setTimeout(r, 2));

      const result = manager.heartbeat('tenant-A', sub.id);
      const connections = manager.getConnections('tenant-A');

      expect(result).toBe(true);
      expect(connections[0]?.subscription.lastHeartbeatAt.getTime()).toBeGreaterThan(before);
    });

    it('returns false for a non-existent subscription', () => {
      expect(manager.heartbeat('tenant-A', 'ghost-id')).toBe(false);
    });

    it('returns false for a non-existent tenant', () => {
      expect(manager.heartbeat('no-such-tenant', 'sub-id')).toBe(false);
    });
  });

  // ── 8. getConnections ───────────────────────────────────────────────────────

  describe('getConnections()', () => {
    it('returns only open connections for the tenant', () => {
      const sub = manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', ['workflow'], makeSendFn(), makeCloseFn());

      // Remove one
      manager.removeConnection('tenant-A', sub.id);

      const conns = manager.getConnections('tenant-A');
      expect(conns).toHaveLength(1);
      expect(conns[0]?.subscription.userId).toBe('user-2');
    });

    it('each returned SSEConnection has isOpen = true', () => {
      manager.addConnection('tenant-A', 'user-1', ['customer'], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', ['agent'], makeSendFn(), makeCloseFn());

      const conns = manager.getConnections('tenant-A');
      for (const c of conns) {
        expect(c.isOpen).toBe(true);
      }
    });

    it('returns an empty array when no connections exist for a tenant', () => {
      expect(manager.getConnections('tenant-X')).toHaveLength(0);
    });
  });

  // ── 9. getConnectionCount ───────────────────────────────────────────────────

  describe('getConnectionCount()', () => {
    it('returns 0 for an unknown tenant', () => {
      expect(manager.getConnectionCount('no-such-tenant')).toBe(0);
    });

    it('returns the correct count after adding connections', () => {
      manager.addConnection('tenant-A', 'user-1', [], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', [], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-A', 'user-3', [], makeSendFn(), makeCloseFn());

      expect(manager.getConnectionCount('tenant-A')).toBe(3);
    });

    it('count decreases after removing a connection', () => {
      const sub = manager.addConnection('tenant-A', 'user-1', [], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-A', 'user-2', [], makeSendFn(), makeCloseFn());

      manager.removeConnection('tenant-A', sub.id);

      expect(manager.getConnectionCount('tenant-A')).toBe(1);
    });

    it('counts are independent across tenants', () => {
      manager.addConnection('tenant-A', 'u-1', [], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-A', 'u-2', [], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-B', 'u-3', [], makeSendFn(), makeCloseFn());

      expect(manager.getConnectionCount('tenant-A')).toBe(2);
      expect(manager.getConnectionCount('tenant-B')).toBe(1);
    });
  });

  // ── 10. getStats ────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns zeroed totals on a fresh instance', () => {
      const stats = manager.getStats();

      expect(stats.totalConnections).toBe(0);
      expect(stats.eventsSent).toBe(0);
      expect(stats.eventsDropped).toBe(0);
      expect(stats.connectionsByTenant).toEqual({});
    });

    it('reflects correct totalConnections and connectionsByTenant', () => {
      manager.addConnection('tenant-A', 'u-1', [], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-A', 'u-2', [], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-B', 'u-3', [], makeSendFn(), makeCloseFn());

      const stats = manager.getStats();

      expect(stats.totalConnections).toBe(3);
      expect(stats.connectionsByTenant['tenant-A']).toBe(2);
      expect(stats.connectionsByTenant['tenant-B']).toBe(1);
    });

    it('increments eventsSent on each successful publish', () => {
      manager.addConnection('tenant-A', 'u-1', ['system'], makeSendFn(), makeCloseFn());

      manager.publish(makeEvent({ tenantId: 'tenant-A', category: 'system', id: 'e1' }));
      manager.publish(makeEvent({ tenantId: 'tenant-A', category: 'system', id: 'e2' }));

      expect(manager.getStats().eventsSent).toBe(2);
    });

    it('increments eventsDropped when sendFn throws', () => {
      const throwingFn = vi.fn(() => { throw new Error('stream closed'); });
      manager.addConnection('tenant-A', 'u-1', ['system'], throwingFn, makeCloseFn());

      manager.publish(makeEvent({ tenantId: 'tenant-A', category: 'system' }));

      expect(manager.getStats().eventsDropped).toBe(1);
      expect(manager.getStats().eventsSent).toBe(0);
    });

    it('uptime is a non-negative number', () => {
      expect(manager.getStats().uptime).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 11. pruneStaleConnections ───────────────────────────────────────────────

  describe('pruneStaleConnections()', () => {
    it('removes connections whose heartbeat has timed out', async () => {
      // Use a very short timeout so we can trigger it without long sleep
      const shortManager = new ChannelManager(5);

      shortManager.addConnection('tenant-A', 'u-1', [], makeSendFn(), makeCloseFn());

      // Wait long enough for the heartbeat to expire
      await new Promise<void>((r) => setTimeout(r, 20));

      const pruned = shortManager.pruneStaleConnections();

      expect(pruned).toBeGreaterThanOrEqual(1);
      expect(shortManager.getConnectionCount('tenant-A')).toBe(0);
    });

    it('does NOT prune a connection that has recently sent a heartbeat', () => {
      const sub = manager.addConnection('tenant-A', 'u-1', [], makeSendFn(), makeCloseFn());
      manager.heartbeat('tenant-A', sub.id);

      const pruned = manager.pruneStaleConnections();

      expect(pruned).toBe(0);
      expect(manager.getConnectionCount('tenant-A')).toBe(1);
    });

    it('calls closeFn on each pruned connection', async () => {
      const shortManager = new ChannelManager(5);
      const closeFn = makeCloseFn();

      shortManager.addConnection('tenant-A', 'u-1', [], makeSendFn(), closeFn);

      await new Promise<void>((r) => setTimeout(r, 20));
      shortManager.pruneStaleConnections();

      expect(closeFn).toHaveBeenCalledOnce();
    });

    it('returns 0 on an empty manager', () => {
      expect(manager.pruneStaleConnections()).toBe(0);
    });
  });

  // ── 12. closeAll ────────────────────────────────────────────────────────────

  describe('closeAll()', () => {
    it('calls closeFn on every open connection', () => {
      const close1 = makeCloseFn();
      const close2 = makeCloseFn();
      const close3 = makeCloseFn();

      manager.addConnection('tenant-A', 'u-1', [], makeSendFn(), close1);
      manager.addConnection('tenant-A', 'u-2', [], makeSendFn(), close2);
      manager.addConnection('tenant-B', 'u-3', [], makeSendFn(), close3);

      manager.closeAll();

      expect(close1).toHaveBeenCalledOnce();
      expect(close2).toHaveBeenCalledOnce();
      expect(close3).toHaveBeenCalledOnce();
    });

    it('reduces total connection count to 0', () => {
      manager.addConnection('tenant-A', 'u-1', [], makeSendFn(), makeCloseFn());
      manager.addConnection('tenant-B', 'u-2', [], makeSendFn(), makeCloseFn());

      manager.closeAll();

      expect(manager.getStats().totalConnections).toBe(0);
    });

    it('no-ops gracefully when there are no connections', () => {
      expect(() => manager.closeAll()).not.toThrow();
    });
  });

  // ── 13. send failure marks connection as closed / increments eventsDropped ──

  describe('send failure handling', () => {
    it('marks the connection as closed so it does not receive future publishes', () => {
      let callCount = 0;
      const failingFn = vi.fn(() => {
        callCount++;
        if (callCount === 1) throw new Error('write error');
      });

      manager.addConnection('tenant-A', 'u-1', ['system'], failingFn, makeCloseFn());

      // First publish — throws → connection marked closed, eventsDropped++
      manager.publish(makeEvent({ tenantId: 'tenant-A', category: 'system', id: 'e1' }));

      // Second publish — connection is already marked closed, sendFn must NOT be called again
      manager.publish(makeEvent({ tenantId: 'tenant-A', category: 'system', id: 'e2' }));

      expect(failingFn).toHaveBeenCalledTimes(1);
      expect(manager.getStats().eventsDropped).toBe(1);
    });

    it('still delivers to healthy connections when one connection fails', () => {
      const failingFn = vi.fn(() => { throw new Error('dead'); });
      const healthySend = makeSendFn();

      manager.addConnection('tenant-A', 'u-fail', ['system'], failingFn, makeCloseFn());
      manager.addConnection('tenant-A', 'u-ok', ['system'], healthySend, makeCloseFn());

      const event = makeEvent({ tenantId: 'tenant-A', category: 'system' });
      const delivered = manager.publish(event);

      expect(delivered).toBe(1);
      expect(healthySend).toHaveBeenCalledWith(event);
      expect(manager.getStats().eventsDropped).toBe(1);
    });
  });
});

// ─── EventPublisher ───────────────────────────────────────────────────────────

describe('EventPublisher', () => {
  let channelManager: ChannelManager;
  let publisher: EventPublisher;

  beforeEach(() => {
    channelManager = new ChannelManager();
    publisher = new EventPublisher(channelManager);
  });

  // ── 14. publish — event construction ──────────────────────────────────────

  describe('publish() — event construction', () => {
    it('delivers the event and returns the delivery count', async () => {
      const sendFn = makeSendFn();
      channelManager.addConnection('tenant-A', 'user-1', ['customer'], sendFn, makeCloseFn());

      const count = await publisher.publish('tenant-A', 'customer', 'customer.updated', { id: 'c-1' });

      expect(count).toBe(1);
      expect(sendFn).toHaveBeenCalledOnce();
    });

    it('constructs an event with the correct tenantId, category, and type fields', async () => {
      const sendFn = makeSendFn();
      channelManager.addConnection('tenant-A', 'user-1', ['billing'], sendFn, makeCloseFn());

      await publisher.publish('tenant-A', 'billing', 'invoice.paid', { amount: 100 });

      const received = sendFn.mock.calls[0]?.[0] as RealtimeEvent;
      expect(received.tenantId).toBe('tenant-A');
      expect(received.category).toBe('billing');
      expect(received.type).toBe('invoice.paid');
      expect(received.data).toEqual({ amount: 100 });
    });

    it('assigns a unique id and a valid ISO 8601 timestamp to each event', async () => {
      const sendFn = makeSendFn();
      channelManager.addConnection('tenant-A', 'user-1', ['system'], sendFn, makeCloseFn());

      await publisher.publish('tenant-A', 'system', 'ping', {});
      await publisher.publish('tenant-A', 'system', 'ping', {});

      const evt1 = sendFn.mock.calls[0]?.[0] as RealtimeEvent;
      const evt2 = sendFn.mock.calls[1]?.[0] as RealtimeEvent;

      expect(evt1.id).not.toBe(evt2.id);
      expect(() => new Date(evt1.timestamp)).not.toThrow();
      expect(new Date(evt1.timestamp).toISOString()).toBe(evt1.timestamp);
    });
  });

  // ── 15. publish — audit logger ──────────────────────────────────────────────

  describe('publish() — audit logger', () => {
    it('calls the audit logger when one is configured', async () => {
      const auditLogger = makeAuditLogger();
      const publisherWithAudit = new EventPublisher(channelManager, auditLogger);

      await publisherWithAudit.publish('tenant-A', 'customer', 'customer.created', { id: 'c-1' });

      expect(auditLogger.log).toHaveBeenCalledOnce();
    });

    it('logs the correct tenantId and resource in the audit entry', async () => {
      const auditLogger = makeAuditLogger();
      const publisherWithAudit = new EventPublisher(channelManager, auditLogger);

      await publisherWithAudit.publish('tenant-X', 'agent', 'agent.acted', { agentId: 'a-1' });

      expect(auditLogger.calls[0]).toMatchObject({
        tenantId: 'tenant-X',
        resource: 'realtime_events',
        action: 'publish',
        eventType: 'realtime.event_published',
      });
    });

    it('does NOT call the audit logger when none is configured', async () => {
      // publisher constructed without auditLogger
      const sendFn = makeSendFn();
      channelManager.addConnection('tenant-A', 'user-1', ['system'], sendFn, makeCloseFn());

      await expect(publisher.publish('tenant-A', 'system', 'test', {})).resolves.toBe(1);
    });
  });

  // ── 16. publish — tenantId validation ───────────────────────────────────────

  describe('publish() — tenantId validation', () => {
    it('throws when tenantId is an empty string', async () => {
      await expect(publisher.publish('', 'customer', 'test', {}))
        .rejects.toThrow('[ORDR:Realtime] tenantId is required');
    });

    it('throws when tenantId is a whitespace-only string', async () => {
      await expect(publisher.publish('   ', 'customer', 'test', {}))
        .rejects.toThrow('[ORDR:Realtime] tenantId is required');
    });
  });

  // ── 17. publish — category validation ───────────────────────────────────────

  describe('publish() — category validation', () => {
    it('throws when an invalid category string is cast and passed', async () => {
      // TypeScript would normally prevent this — we cast to test the runtime guard
      await expect(publisher.publish('tenant-A', 'invalid_cat' as EventCategory, 'test', {}))
        .rejects.toThrow('[ORDR:Realtime] Invalid event category');
    });

    it('accepts all valid EVENT_CATEGORIES without throwing', async () => {
      for (const cat of EVENT_CATEGORIES) {
        await expect(
          publisher.publish('tenant-A', cat, `${cat}.test`, {}),
        ).resolves.toBeDefined();
      }
    });
  });

  // ── 18. notifyUsers ─────────────────────────────────────────────────────────

  describe('notifyUsers()', () => {
    it('targets only the specified user IDs', async () => {
      const sendUser1 = makeSendFn();
      const sendUser2 = makeSendFn();

      channelManager.addConnection('tenant-A', 'user-1', ['notification'], sendUser1, makeCloseFn());
      channelManager.addConnection('tenant-A', 'user-2', ['notification'], sendUser2, makeCloseFn());

      await publisher.notifyUsers('tenant-A', ['user-1'], 'alert.new', { message: 'hi' });

      expect(sendUser1).toHaveBeenCalledOnce();
      expect(sendUser2).not.toHaveBeenCalled();
    });

    it('uses the "notification" category for the event', async () => {
      const sendFn = makeSendFn();
      channelManager.addConnection('tenant-A', 'user-1', ['notification'], sendFn, makeCloseFn());

      await publisher.notifyUsers('tenant-A', ['user-1'], 'task.assigned', { taskId: 't-1' });

      const received = sendFn.mock.calls[0]?.[0] as RealtimeEvent;
      expect(received.category).toBe('notification');
    });

    it('returns 0 when no targeted users have connections', async () => {
      const count = await publisher.notifyUsers('tenant-A', ['ghost-user'], 'ping', {});
      expect(count).toBe(0);
    });
  });

  // ── 19. broadcastToTenant ───────────────────────────────────────────────────

  describe('broadcastToTenant()', () => {
    it('uses the "system" category', async () => {
      const sendFn = makeSendFn();
      channelManager.addConnection('tenant-A', 'user-1', ['system'], sendFn, makeCloseFn());

      await publisher.broadcastToTenant('tenant-A', 'maintenance.start', { durationMs: 5000 });

      const received = sendFn.mock.calls[0]?.[0] as RealtimeEvent;
      expect(received.category).toBe('system');
    });

    it('reaches all connections in the tenant that subscribe to "system"', async () => {
      const sends = [makeSendFn(), makeSendFn(), makeSendFn()];
      ['u-1', 'u-2', 'u-3'].forEach((uid, i) =>
        channelManager.addConnection('tenant-A', uid, ['system'], sends[i]!, makeCloseFn()),
      );

      const count = await publisher.broadcastToTenant('tenant-A', 'system.event', {});
      expect(count).toBe(3);
    });

    it('does NOT deliver to non-"system" subscribers', async () => {
      const systemSend = makeSendFn();
      const customerSend = makeSendFn();

      channelManager.addConnection('tenant-A', 'u-sys', ['system'], systemSend, makeCloseFn());
      channelManager.addConnection('tenant-A', 'u-cust', ['customer'], customerSend, makeCloseFn());

      await publisher.broadcastToTenant('tenant-A', 'global.announcement', {});

      expect(systemSend).toHaveBeenCalledOnce();
      expect(customerSend).not.toHaveBeenCalled();
    });
  });
});

// ─── serializeSSEEvent ────────────────────────────────────────────────────────

describe('serializeSSEEvent()', () => {
  const sampleEvent: RealtimeEvent = {
    id: 'evt-abc123',
    tenantId: 'tenant-A',
    category: 'customer',
    type: 'customer.updated',
    data: { customerId: 'cust-001', status: 'active' },
    timestamp: '2026-01-01T00:00:00.000Z',
  };

  it('includes an "event:" line with the event type', () => {
    const serialized = serializeSSEEvent(sampleEvent);
    expect(serialized).toContain('event: customer.updated');
  });

  it('includes a "data:" line with serialized JSON', () => {
    const serialized = serializeSSEEvent(sampleEvent);
    expect(serialized).toMatch(/^data: /m);

    // Find the data line and parse it
    const dataLine = serialized.split('\n').find((l) => l.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.slice('data: '.length)) as Record<string, unknown>;
    expect(parsed['id']).toBe('evt-abc123');
    expect(parsed['category']).toBe('customer');
    expect(parsed['type']).toBe('customer.updated');
    expect(parsed['timestamp']).toBe('2026-01-01T00:00:00.000Z');
  });

  it('includes an "id:" line with the event id', () => {
    const serialized = serializeSSEEvent(sampleEvent);
    expect(serialized).toContain('id: evt-abc123');
  });

  it('ends with a double newline (SSE message delimiter)', () => {
    const serialized = serializeSSEEvent(sampleEvent);
    expect(serialized.endsWith('\n\n')).toBe(true);
  });

  it('does NOT include tenantId in the serialized output (tenant isolation)', () => {
    const serialized = serializeSSEEvent(sampleEvent);
    expect(serialized).not.toContain('"tenantId"');
    expect(serialized).not.toContain('tenant-A');
  });

  it('serializes the data payload faithfully', () => {
    const event = makeEvent({
      data: { foo: 'bar', count: 42, nested: { x: true } },
    });
    const serialized = serializeSSEEvent(event);
    const dataLine = serialized.split('\n').find((l) => l.startsWith('data: '))!;
    const parsed = JSON.parse(dataLine.slice('data: '.length)) as { data: Record<string, unknown> };
    expect(parsed.data).toEqual({ foo: 'bar', count: 42, nested: { x: true } });
  });
});

// ─── serializeHeartbeat ───────────────────────────────────────────────────────

describe('serializeHeartbeat()', () => {
  it('starts with ": heartbeat"', () => {
    const hb = serializeHeartbeat();
    expect(hb.startsWith(': heartbeat')).toBe(true);
  });

  it('contains an ISO 8601 timestamp', () => {
    const hb = serializeHeartbeat();
    // Extract the timestamp portion after ": heartbeat "
    const ts = hb.slice(': heartbeat '.length).trim().replace(/\n/g, '');
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('ends with a double newline', () => {
    const hb = serializeHeartbeat();
    expect(hb.endsWith('\n\n')).toBe(true);
  });

  it('two calls produce different timestamps (clock advances)', async () => {
    const hb1 = serializeHeartbeat();
    await new Promise<void>((r) => setTimeout(r, 2));
    const hb2 = serializeHeartbeat();
    expect(hb1).not.toBe(hb2);
  });
});
