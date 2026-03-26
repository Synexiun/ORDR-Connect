/**
 * Usage Tracker — in-memory usage counters with periodic flush
 *
 * Tracks resource usage (agents, contacts, messages, API calls) per tenant.
 * Uses in-memory counters for high-throughput counting (e.g., API calls)
 * with periodic flush to durable storage.
 *
 * SOC2 CC6.1 — Enforces plan limits based on real-time usage.
 * ISO 27001 A.12.1.3 — Capacity management: usage monitoring.
 * HIPAA §164.312(b) — Audit controls: usage tracking for compliance.
 */

import type { UsageResource, UsageSummary, UsageRecord } from './types.js';
import { USAGE_RESOURCES } from './types.js';

// ─── Usage Store Interface ───────────────────────────────────────

export interface UsageStore {
  saveUsageRecord(record: Omit<UsageRecord, 'id'>): Promise<UsageRecord>;
  getUsageSummary(tenantId: string, periodStart: Date, periodEnd: Date): Promise<UsageSummary>;
  getUsageRecords(
    tenantId: string,
    resource: UsageResource | undefined,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<readonly UsageRecord[]>;
  resetUsage(tenantId: string, periodStart: Date, periodEnd: Date): Promise<number>;
}

// ─── Counter Key ─────────────────────────────────────────────────

function counterKey(tenantId: string, resource: UsageResource): string {
  return `${tenantId}:${resource}`;
}

// ─── Counter Entry ───────────────────────────────────────────────

interface CounterEntry {
  value: number;
  lastFlushed: Date;
  dirty: boolean;
}

// ─── Usage Tracker ───────────────────────────────────────────────

export class UsageTracker {
  private readonly store: UsageStore;
  private readonly counters = new Map<string, CounterEntry>();
  private readonly flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(store: UsageStore, flushIntervalMs: number = 60_000) {
    this.store = store;
    this.flushIntervalMs = flushIntervalMs;
  }

  /**
   * Start periodic flush timer.
   * Call this at application startup.
   */
  startPeriodicFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => {
      void this.flushAll();
    }, this.flushIntervalMs);
  }

  /**
   * Stop periodic flush timer and flush remaining data.
   * Call this during graceful shutdown.
   */
  async stopPeriodicFlush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushAll();
  }

  /**
   * Track usage for a specific resource.
   * Increments the in-memory counter; flushed to store periodically.
   *
   * @param tenantId - Tenant consuming the resource
   * @param resource - Resource type being consumed
   * @param quantity - Amount to add (default: 1)
   */
  trackUsage(tenantId: string, resource: UsageResource, quantity: number = 1): void {
    if (quantity <= 0) {
      throw new Error('Usage quantity must be positive');
    }

    if (!USAGE_RESOURCES.includes(resource)) {
      throw new Error(`Invalid usage resource: ${resource}`);
    }

    const key = counterKey(tenantId, resource);
    const existing = this.counters.get(key);

    if (existing) {
      existing.value += quantity;
      existing.dirty = true;
    } else {
      this.counters.set(key, {
        value: quantity,
        lastFlushed: new Date(),
        dirty: true,
      });
    }
  }

  /**
   * Get the current in-memory counter value for a resource.
   * Note: This may not include unflushed data from other instances.
   */
  getCounter(tenantId: string, resource: UsageResource): number {
    const key = counterKey(tenantId, resource);
    return this.counters.get(key)?.value ?? 0;
  }

  /**
   * Get a full usage summary from the persistent store.
   * Includes flushed data from all instances.
   */
  async getUsageSummary(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageSummary> {
    // Flush current counters before reading
    await this.flushTenant(tenantId);
    return this.store.getUsageSummary(tenantId, periodStart, periodEnd);
  }

  /**
   * Reset usage counters for a tenant (used at billing cycle start).
   */
  async resetUsage(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    // Clear in-memory counters for this tenant
    for (const resource of USAGE_RESOURCES) {
      const key = counterKey(tenantId, resource);
      this.counters.delete(key);
    }

    // Reset in the store
    await this.store.resetUsage(tenantId, periodStart, periodEnd);
  }

  /**
   * Flush all dirty counters to the persistent store.
   */
  async flushAll(): Promise<void> {
    const now = new Date();
    const flushPromises: Promise<UsageRecord>[] = [];

    for (const [key, entry] of this.counters) {
      if (!entry.dirty || entry.value === 0) continue;

      const parts = key.split(':');
      const tenantId = parts[0];
      const resource = parts[1] as UsageResource;

      if (!tenantId || !resource) continue;

      flushPromises.push(
        this.store.saveUsageRecord({
          tenant_id: tenantId,
          resource,
          quantity: entry.value,
          period_start: entry.lastFlushed,
          period_end: now,
          recorded_at: now,
        }),
      );

      // Reset counter after flushing
      entry.value = 0;
      entry.lastFlushed = now;
      entry.dirty = false;
    }

    await Promise.all(flushPromises);
  }

  /**
   * Flush counters for a specific tenant.
   */
  private async flushTenant(tenantId: string): Promise<void> {
    const now = new Date();
    const flushPromises: Promise<UsageRecord>[] = [];

    for (const resource of USAGE_RESOURCES) {
      const key = counterKey(tenantId, resource);
      const entry = this.counters.get(key);

      if (!entry || !entry.dirty || entry.value === 0) continue;

      flushPromises.push(
        this.store.saveUsageRecord({
          tenant_id: tenantId,
          resource,
          quantity: entry.value,
          period_start: entry.lastFlushed,
          period_end: now,
          recorded_at: now,
        }),
      );

      entry.value = 0;
      entry.lastFlushed = now;
      entry.dirty = false;
    }

    await Promise.all(flushPromises);
  }

  /**
   * Get all counter keys currently tracked (for testing/debugging).
   */
  getActiveCounters(): ReadonlyMap<string, { readonly value: number; readonly dirty: boolean }> {
    const result = new Map<string, { readonly value: number; readonly dirty: boolean }>();
    for (const [key, entry] of this.counters) {
      result.set(key, { value: entry.value, dirty: entry.dirty });
    }
    return result;
  }
}
