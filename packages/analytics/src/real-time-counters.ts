/**
 * Real-time counters — Redis-backed live metric counters for ORDR-Connect
 *
 * Provides low-latency counter operations for dashboard live views.
 * Uses DI via CounterStore interface — InMemoryCounterStore for MVP/testing.
 *
 * SECURITY:
 * - All counter keys are tenant-scoped — no cross-tenant access (SOC2 CC6.1)
 * - Counter keys use namespaced format: ordr:counters:{tenantId}:{metric}:{date}
 * - TTL enforced: 48 hours per counter key to prevent unbounded growth
 * - No PII/PHI stored in counters — only numeric aggregates
 *
 * ISO 27001 A.12.4.1 — Event logging: real-time operational visibility.
 * HIPAA §164.312(a)(1) — Access control: tenant boundary enforced.
 */

import type { CounterStore, MetricName } from './types.js';
import { COUNTER_KEY_PREFIX, COUNTER_TTL_SECONDS, METRIC_NAMES } from './types.js';

// ─── Real-Time Counters ──────────────────────────────────────────

export class RealTimeCounters {
  private readonly store: CounterStore;

  constructor(store: CounterStore) {
    this.store = store;
  }

  /**
   * Increment a metric counter for a tenant.
   * Counter key includes today's date for daily segmentation.
   */
  async increment(
    tenantId: string,
    metric: MetricName,
    dimensions?: Readonly<Record<string, string>> | undefined,
  ): Promise<void> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new Error('tenantId is required for counter operations');
    }

    const key = buildCounterKey(tenantId, metric);
    await this.store.increment(key);

    // If dimensions provided, also increment dimension-specific counters
    if (dimensions) {
      for (const [dimKey, dimValue] of Object.entries(dimensions)) {
        const dimensionKey = `${key}:${dimKey}:${dimValue}`;
        await this.store.increment(dimensionKey);
      }
    }
  }

  /**
   * Get the current value of a metric counter for a tenant.
   */
  async get(tenantId: string, metric: MetricName): Promise<number> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new Error('tenantId is required for counter operations');
    }

    const key = buildCounterKey(tenantId, metric);
    return this.store.get(key);
  }

  /**
   * Get multiple metric counters for a tenant in a single call.
   */
  async getMultiple(
    tenantId: string,
    metrics: readonly MetricName[],
  ): Promise<Readonly<Record<MetricName, number>>> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new Error('tenantId is required for counter operations');
    }

    const keys = metrics.map((metric) => buildCounterKey(tenantId, metric));
    const results = await this.store.getMultiple(keys);

    const output: Partial<Record<MetricName, number>> = {};
    for (let i = 0; i < metrics.length; i++) {
      const metric = metrics[i]!;
      const key = keys[i]!;
      output[metric] = results.get(key) ?? 0;
    }

    return output as Readonly<Record<MetricName, number>>;
  }

  /**
   * Reset all daily counters for a tenant.
   * Called at midnight to start fresh daily counts.
   */
  async resetDaily(tenantId: string): Promise<void> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new Error('tenantId is required for counter operations');
    }

    const dateStr = getTodayDateString();
    const pattern = `${COUNTER_KEY_PREFIX}:${tenantId}:*:${dateStr}`;
    await this.store.reset(pattern);
  }

  /**
   * Get all standard metric counters for a tenant in a single call.
   * Convenience method for dashboard real-time view.
   */
  async getAllCounters(
    tenantId: string,
  ): Promise<Readonly<Record<MetricName, number>>> {
    return this.getMultiple(tenantId, METRIC_NAMES);
  }
}

// ─── In-Memory Counter Store ─────────────────────────────────────

interface CounterEntry {
  value: number;
  readonly createdAt: number;
}

/**
 * In-memory counter store for testing and MVP.
 * Implements the same interface as a Redis-backed store.
 *
 * SECURITY: Still enforces key structure for tenant isolation.
 */
export class InMemoryCounterStore implements CounterStore {
  private readonly counters = new Map<string, CounterEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? COUNTER_TTL_SECONDS * 1000;
  }

  async increment(key: string, amount?: number): Promise<void> {
    this.evictExpired();

    const existing = this.counters.get(key);
    if (existing) {
      existing.value += amount ?? 1;
    } else {
      this.counters.set(key, {
        value: amount ?? 1,
        createdAt: Date.now(),
      });
    }
  }

  async get(key: string): Promise<number> {
    this.evictExpired();

    const entry = this.counters.get(key);
    if (!entry) return 0;

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.counters.delete(key);
      return 0;
    }

    return entry.value;
  }

  async getMultiple(keys: readonly string[]): Promise<ReadonlyMap<string, number>> {
    this.evictExpired();

    const results = new Map<string, number>();
    for (const key of keys) {
      const entry = this.counters.get(key);
      if (entry && Date.now() - entry.createdAt <= this.ttlMs) {
        results.set(key, entry.value);
      } else {
        results.set(key, 0);
      }
    }

    return results;
  }

  async reset(keyPattern: string): Promise<void> {
    // Simple pattern matching: convert glob pattern to regex
    const regexStr = keyPattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexStr}$`);

    for (const key of this.counters.keys()) {
      if (regex.test(key)) {
        this.counters.delete(key);
      }
    }
  }

  /** Get total counter count — test helper only */
  get size(): number {
    return this.counters.size;
  }

  /** Clear all counters — test helper only */
  clear(): void {
    this.counters.clear();
  }

  // ─── Private ─────────────────────────────────────────────────

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.counters) {
      if (now - entry.createdAt > this.ttlMs) {
        this.counters.delete(key);
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function buildCounterKey(tenantId: string, metric: MetricName): string {
  const dateStr = getTodayDateString();
  return `${COUNTER_KEY_PREFIX}:${tenantId}:${metric}:${dateStr}`;
}

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Exported for testing */
export { buildCounterKey, getTodayDateString };
