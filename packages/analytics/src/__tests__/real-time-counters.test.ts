/**
 * RealTimeCounters + InMemoryCounterStore tests
 *
 * Verifies:
 * - Increment and get operations
 * - GetMultiple batch retrieval
 * - Tenant isolation
 * - TTL expiration
 * - Daily reset
 * - Key structure
 * - Dimension-specific counters
 * - Error handling for missing tenantId
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RealTimeCounters,
  InMemoryCounterStore,
  buildCounterKey,
  getTodayDateString,
} from '../real-time-counters.js';
import { COUNTER_KEY_PREFIX } from '../types.js';

describe('InMemoryCounterStore', () => {
  let counterStore: InMemoryCounterStore;

  beforeEach(() => {
    counterStore = new InMemoryCounterStore();
  });

  it('increments counter by 1 by default', async () => {
    await counterStore.increment('key1');
    const value = await counterStore.get('key1');
    expect(value).toBe(1);
  });

  it('increments counter by specified amount', async () => {
    await counterStore.increment('key1', 5);
    const value = await counterStore.get('key1');
    expect(value).toBe(5);
  });

  it('accumulates multiple increments', async () => {
    await counterStore.increment('key1');
    await counterStore.increment('key1');
    await counterStore.increment('key1');
    const value = await counterStore.get('key1');
    expect(value).toBe(3);
  });

  it('returns 0 for non-existent key', async () => {
    const value = await counterStore.get('non-existent');
    expect(value).toBe(0);
  });

  it('gets multiple keys in one call', async () => {
    await counterStore.increment('key1', 10);
    await counterStore.increment('key2', 20);

    const results = await counterStore.getMultiple(['key1', 'key2', 'key3']);
    expect(results.get('key1')).toBe(10);
    expect(results.get('key2')).toBe(20);
    expect(results.get('key3')).toBe(0);
  });

  it('resets counters matching pattern', async () => {
    await counterStore.increment('prefix:a:1');
    await counterStore.increment('prefix:a:2');
    await counterStore.increment('prefix:b:1');

    await counterStore.reset('prefix:a:*');

    const val1 = await counterStore.get('prefix:a:1');
    const val2 = await counterStore.get('prefix:a:2');
    const val3 = await counterStore.get('prefix:b:1');

    expect(val1).toBe(0);
    expect(val2).toBe(0);
    expect(val3).toBe(1); // Not matching pattern
  });

  it('expires entries after TTL', async () => {
    // Create store with very short TTL (1ms)
    const shortTtlStore = new InMemoryCounterStore(1);
    await shortTtlStore.increment('key1', 10);

    // Wait for TTL to expire
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });

    const value = await shortTtlStore.get('key1');
    expect(value).toBe(0);
  });

  it('clears all counters', async () => {
    await counterStore.increment('key1');
    await counterStore.increment('key2');

    counterStore.clear();
    expect(counterStore.size).toBe(0);
  });
});

describe('RealTimeCounters', () => {
  let counterStore: InMemoryCounterStore;
  let counters: RealTimeCounters;

  beforeEach(() => {
    counterStore = new InMemoryCounterStore();
    counters = new RealTimeCounters(counterStore);
  });

  // ─── Increment ─────────────────────────────────────────────────

  it('increments a metric counter', async () => {
    await counters.increment('tenant-1', 'messages_sent');
    const value = await counters.get('tenant-1', 'messages_sent');
    expect(value).toBe(1);
  });

  it('accumulates increments', async () => {
    await counters.increment('tenant-1', 'messages_delivered');
    await counters.increment('tenant-1', 'messages_delivered');
    await counters.increment('tenant-1', 'messages_delivered');

    const value = await counters.get('tenant-1', 'messages_delivered');
    expect(value).toBe(3);
  });

  // ─── Get ───────────────────────────────────────────────────────

  it('returns 0 for counter that has not been incremented', async () => {
    const value = await counters.get('tenant-1', 'agent_sessions');
    expect(value).toBe(0);
  });

  // ─── GetMultiple ───────────────────────────────────────────────

  it('gets multiple metric counters in one call', async () => {
    await counters.increment('tenant-1', 'messages_sent');
    await counters.increment('tenant-1', 'messages_sent');
    await counters.increment('tenant-1', 'agent_sessions');

    const result = await counters.getMultiple('tenant-1', [
      'messages_sent',
      'agent_sessions',
      'messages_failed',
    ]);

    expect(result['messages_sent']).toBe(2);
    expect(result['agent_sessions']).toBe(1);
    expect(result['messages_failed']).toBe(0);
  });

  // ─── Tenant Isolation ──────────────────────────────────────────

  it('isolates counters between tenants', async () => {
    await counters.increment('tenant-1', 'messages_sent');
    await counters.increment('tenant-1', 'messages_sent');
    await counters.increment('tenant-2', 'messages_sent');

    const val1 = await counters.get('tenant-1', 'messages_sent');
    const val2 = await counters.get('tenant-2', 'messages_sent');

    expect(val1).toBe(2);
    expect(val2).toBe(1);
  });

  // ─── Daily Reset ───────────────────────────────────────────────

  it('resets daily counters for a tenant', async () => {
    await counters.increment('tenant-1', 'messages_sent');
    await counters.increment('tenant-1', 'messages_delivered');

    await counters.resetDaily('tenant-1');

    const sent = await counters.get('tenant-1', 'messages_sent');
    const delivered = await counters.get('tenant-1', 'messages_delivered');

    expect(sent).toBe(0);
    expect(delivered).toBe(0);
  });

  it('does not affect other tenants during reset', async () => {
    await counters.increment('tenant-1', 'messages_sent');
    await counters.increment('tenant-2', 'messages_sent');

    await counters.resetDaily('tenant-1');

    const val1 = await counters.get('tenant-1', 'messages_sent');
    const val2 = await counters.get('tenant-2', 'messages_sent');

    expect(val1).toBe(0);
    expect(val2).toBe(1); // Unaffected
  });

  // ─── Dimension Counters ────────────────────────────────────────

  it('increments dimension-specific counters', async () => {
    await counters.increment('tenant-1', 'messages_sent', { channel: 'email' });

    // The base counter should be incremented
    const baseValue = await counters.get('tenant-1', 'messages_sent');
    expect(baseValue).toBe(1);
  });

  // ─── Error Handling ────────────────────────────────────────────

  it('throws for empty tenantId on increment', async () => {
    await expect(
      counters.increment('', 'messages_sent'),
    ).rejects.toThrow('tenantId is required');
  });

  it('throws for empty tenantId on get', async () => {
    await expect(
      counters.get('', 'messages_sent'),
    ).rejects.toThrow('tenantId is required');
  });

  it('throws for empty tenantId on getMultiple', async () => {
    await expect(
      counters.getMultiple('', ['messages_sent']),
    ).rejects.toThrow('tenantId is required');
  });

  it('throws for empty tenantId on resetDaily', async () => {
    await expect(
      counters.resetDaily(''),
    ).rejects.toThrow('tenantId is required');
  });

  // ─── Get All Counters ──────────────────────────────────────────

  it('gets all standard metric counters', async () => {
    await counters.increment('tenant-1', 'messages_sent');
    await counters.increment('tenant-1', 'agent_sessions');

    const all = await counters.getAllCounters('tenant-1');

    expect(all['messages_sent']).toBe(1);
    expect(all['agent_sessions']).toBe(1);
    expect(all['messages_failed']).toBe(0);
    expect(all['compliance_violations']).toBe(0);
  });
});

describe('buildCounterKey', () => {
  it('builds tenant-scoped key with date', () => {
    const key = buildCounterKey('tenant-1', 'messages_sent');
    const dateStr = getTodayDateString();

    expect(key).toBe(`${COUNTER_KEY_PREFIX}:tenant-1:messages_sent:${dateStr}`);
  });

  it('includes correct date format (YYYY-MM-DD)', () => {
    const dateStr = getTodayDateString();
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
