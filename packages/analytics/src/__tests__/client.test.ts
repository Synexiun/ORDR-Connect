/**
 * AnalyticsClient + InMemoryAnalyticsStore tests
 *
 * Verifies:
 * - Tenant isolation on all queries
 * - Parameterized query enforcement
 * - Insert with tenant scoping
 * - Health check
 * - Error handling for disconnected state
 * - Empty tenantId rejection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAnalyticsStore, AnalyticsClient } from '../client.js';

describe('InMemoryAnalyticsStore', () => {
  let store: InMemoryAnalyticsStore;

  beforeEach(() => {
    store = new InMemoryAnalyticsStore();
  });

  // ─── Tenant Isolation ──────────────────────────────────────────

  it('enforces tenant isolation on queries — returns only matching tenant rows', async () => {
    await store.insert('metrics', [
      { metric: 'messages_sent', value: 10 },
    ], 'tenant-1');

    await store.insert('metrics', [
      { metric: 'messages_sent', value: 20 },
    ], 'tenant-2');

    const result = await store.query<{ value: number }>(
      'SELECT * FROM metrics',
      { tenantId: 'tenant-1' },
      'tenant-1',
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]?.value).toBe(10);
    }
  });

  it('returns empty array when querying tenant with no data', async () => {
    await store.insert('metrics', [
      { metric: 'messages_sent', value: 10 },
    ], 'tenant-1');

    const result = await store.query<{ value: number }>(
      'SELECT * FROM metrics',
      {},
      'tenant-99',
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(0);
    }
  });

  // ─── Query Validation ──────────────────────────────────────────

  it('rejects queries with empty tenantId', async () => {
    const result = await store.query('SELECT * FROM metrics', {}, '');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects queries with whitespace-only tenantId', async () => {
    const result = await store.query('SELECT * FROM metrics', {}, '   ');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  // ─── Insert ────────────────────────────────────────────────────

  it('inserts rows with tenant scoping', async () => {
    const insertResult = await store.insert(
      'metrics',
      [
        { metric: 'messages_sent', value: 5 },
        { metric: 'messages_delivered', value: 3 },
      ],
      'tenant-1',
    );

    expect(insertResult.success).toBe(true);
    expect(store.totalRows).toBe(2);
    expect(store.getRows('tenant-1').length).toBe(2);
  });

  it('rejects inserts with empty tenantId', async () => {
    const result = await store.insert('metrics', [{ value: 1 }], '');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('handles empty row array gracefully', async () => {
    const result = await store.insert('metrics', [], 'tenant-1');

    expect(result.success).toBe(true);
    expect(store.totalRows).toBe(0);
  });

  // ─── Health Check ──────────────────────────────────────────────

  it('returns true for health check when healthy', async () => {
    const healthy = await store.healthCheck();
    expect(healthy).toBe(true);
  });

  it('returns false for health check after close', async () => {
    await store.close();
    const healthy = await store.healthCheck();
    expect(healthy).toBe(false);
  });

  // ─── Error Handling ────────────────────────────────────────────

  it('returns error when store is unhealthy', async () => {
    store.setHealthy(false);
    const result = await store.query('SELECT 1', {}, 'tenant-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('returns error for insert when store is unhealthy', async () => {
    store.setHealthy(false);
    const result = await store.insert('metrics', [{ value: 1 }], 'tenant-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  // ─── Table Filtering ──────────────────────────────────────────

  it('filters by table name from SQL', async () => {
    await store.insert('metrics', [{ metric: 'a', value: 1 }], 'tenant-1');
    await store.insert('events', [{ metric: 'b', value: 2 }], 'tenant-1');

    const result = await store.query<{ metric: string }>(
      'SELECT * FROM metrics',
      {},
      'tenant-1',
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(1);
      expect(result.data[0]?.metric).toBe('a');
    }
  });

  // ─── Test Helpers ──────────────────────────────────────────────

  it('clears all rows', async () => {
    await store.insert('metrics', [{ value: 1 }], 'tenant-1');
    await store.insert('metrics', [{ value: 2 }], 'tenant-2');

    store.clear();
    expect(store.totalRows).toBe(0);
  });
});

describe('AnalyticsClient', () => {
  it('rejects queries when not connected', async () => {
    const client = new AnalyticsClient({
      url: 'http://localhost:8123',
      database: 'ordr',
      username: 'default',
      password: 'test',
      tls: false,
    });

    const result = await client.query('SELECT 1', {}, 'tenant-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('rejects inserts when not connected', async () => {
    const client = new AnalyticsClient({
      url: 'http://localhost:8123',
      database: 'ordr',
      username: 'default',
      password: 'test',
      tls: false,
    });

    const result = await client.insert('metrics', [{ value: 1 }], 'tenant-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('validates tenantId on query', async () => {
    const client = new AnalyticsClient({
      url: 'http://localhost:8123',
      database: 'ordr',
      username: 'default',
      password: 'test',
      tls: false,
    });

    const result = await client.query('SELECT 1', {}, '');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('reports false health when not connected', async () => {
    const client = new AnalyticsClient({
      url: 'http://localhost:8123',
      database: 'ordr',
      username: 'default',
      password: 'test',
      tls: false,
    });

    const healthy = await client.healthCheck();
    expect(healthy).toBe(false);
  });

  it('connects and reports healthy', async () => {
    const client = new AnalyticsClient({
      url: 'http://localhost:8123',
      database: 'ordr',
      username: 'default',
      password: 'test',
      tls: false,
    });

    await client.connect();
    const healthy = await client.healthCheck();
    expect(healthy).toBe(true);

    await client.close();
    const afterClose = await client.healthCheck();
    expect(afterClose).toBe(false);
  });
});
