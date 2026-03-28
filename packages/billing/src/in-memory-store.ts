/* eslint-disable @typescript-eslint/require-await --
   In-memory implementations satisfy async interfaces without real async I/O.
   The async signature is required by the interface contracts; the body is synchronous.
*/
/**
 * In-Memory Billing Stores — for development and testing
 *
 * These implementations satisfy the SubscriptionStore and UsageStore interfaces
 * using plain Maps. Suitable for local development, CI environments, and unit
 * tests that do not have a live database.
 *
 * SOC2 CC6.1 — Logical access: same interface contracts as production stores.
 * NOT for production use — data is not persisted across restarts.
 */

import type {
  BillingCustomer,
  Subscription,
  PaymentMethod,
  UsageSummary,
  UsageRecord,
  UsageResource,
} from './types.js';
import type { SubscriptionStore } from './subscription-manager.js';
import type { UsageStore } from './usage-tracker.js';

// ─── InMemorySubscriptionStore ───────────────────────────────────

export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly customers = new Map<string, BillingCustomer>();
  private readonly subscriptions = new Map<string, Subscription>();

  async findCustomerByTenantId(tenantId: string): Promise<BillingCustomer | null> {
    return this.customers.get(tenantId) ?? null;
  }

  async saveCustomer(customer: BillingCustomer): Promise<void> {
    this.customers.set(customer.tenant_id, customer);
  }

  async findSubscriptionByTenantId(tenantId: string): Promise<Subscription | null> {
    return this.subscriptions.get(tenantId) ?? null;
  }

  async saveSubscription(subscription: Subscription): Promise<void> {
    this.subscriptions.set(subscription.tenant_id, subscription);
  }

  async updateSubscription(id: string, data: Partial<Subscription>): Promise<Subscription | null> {
    for (const [tenantId, sub] of this.subscriptions.entries()) {
      if (sub.id === id) {
        const updated = { ...sub, ...data } as Subscription;
        this.subscriptions.set(tenantId, updated);
        return updated;
      }
    }
    return null;
  }

  async findPaymentMethodsByTenantId(_tenantId: string): Promise<readonly PaymentMethod[]> {
    return [];
  }

  async getUsageSummary(
    tenantId: string,
    _periodStart: Date,
    _periodEnd: Date,
  ): Promise<UsageSummary> {
    return {
      tenant_id: tenantId,
      period_start: _periodStart,
      period_end: _periodEnd,
      agents: 0,
      contacts: 0,
      messages: 0,
      api_calls: 0,
    };
  }
}

// ─── InMemoryUsageStore ──────────────────────────────────────────

export class InMemoryUsageStore implements UsageStore {
  private readonly records: UsageRecord[] = [];

  async saveUsageRecord(record: Omit<UsageRecord, 'id'>): Promise<UsageRecord> {
    const saved: UsageRecord = { ...record, id: crypto.randomUUID() };
    this.records.push(saved);
    return saved;
  }

  async getUsageSummary(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageSummary> {
    const relevant = this.records.filter(
      (r) => r.tenant_id === tenantId && r.period_start >= periodStart && r.period_end <= periodEnd,
    );
    const sum = (resource: UsageResource): number =>
      relevant.filter((r) => r.resource === resource).reduce((acc, r) => acc + r.quantity, 0);
    return {
      tenant_id: tenantId,
      period_start: periodStart,
      period_end: periodEnd,
      agents: sum('agents'),
      contacts: sum('contacts'),
      messages: sum('messages'),
      api_calls: sum('api_calls'),
    };
  }

  async getUsageRecords(
    tenantId: string,
    resource: UsageResource | undefined,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<readonly UsageRecord[]> {
    return this.records.filter(
      (r) =>
        r.tenant_id === tenantId &&
        (resource === undefined || r.resource === resource) &&
        r.period_start >= periodStart &&
        r.period_end <= periodEnd,
    );
  }

  async resetUsage(tenantId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const before = this.records.length;
    const toRemove = this.records.filter(
      (r) => r.tenant_id === tenantId && r.period_start >= periodStart && r.period_end <= periodEnd,
    );
    for (const r of toRemove) {
      const idx = this.records.indexOf(r);
      if (idx !== -1) this.records.splice(idx, 1);
    }
    return before - this.records.length;
  }
}
