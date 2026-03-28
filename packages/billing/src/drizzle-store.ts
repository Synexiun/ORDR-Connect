/* eslint-disable @typescript-eslint/require-await --
   Several interface methods are satisfied with single-query awaits that
   TypeScript's flow analysis doesn't count as "real" awaits in all cases.
   The async signatures are required by SubscriptionStore / UsageStore contracts.
*/
/**
 * Drizzle-backed implementations of SubscriptionStore and UsageStore
 *
 * Production-grade stores that persist billing and usage data to PostgreSQL.
 * Use these in the API server instead of InMemorySubscriptionStore.
 *
 * SOC2 CC6.1 — Plan state persisted durably; in-memory fallback is test-only.
 * ISO 27001 A.8.2.3 — Encrypted billing fields (stripe_customer_id, stripe_subscription_id)
 *                      stored as-is — encryption applied by SubscriptionManager before
 *                      calling the store.
 * HIPAA §164.312(b) — All subscription changes audited by SubscriptionManager.
 *
 * Usage:
 *   import { DrizzleSubscriptionStore, DrizzleUsageStore } from '@ordr/billing';
 *   const subStore = new DrizzleSubscriptionStore(db);
 *   const usageStore = new DrizzleUsageStore(db);
 */

import type { OrdrDatabase } from '@ordr/db';
import { billingCustomers, subscriptions, usageRecords } from '@ordr/db';
import { eq, and, gte, lt, sql } from 'drizzle-orm';
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

// ─── Row → Domain mappers ────────────────────────────────────────

function rowToCustomer(row: typeof billingCustomers.$inferSelect): BillingCustomer {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    stripe_customer_id: row.stripeCustomerId,
    email: row.email,
    name: row.name,
    created_at: row.createdAt,
  };
}

function rowToSubscription(row: typeof subscriptions.$inferSelect): Subscription {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    stripe_subscription_id: row.stripeSubscriptionId,
    plan_tier: row.planTier,
    status: row.status,
    current_period_start: row.currentPeriodStart,
    current_period_end: row.currentPeriodEnd,
    cancel_at_period_end: row.cancelAtPeriodEnd,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// ─── DrizzleSubscriptionStore ────────────────────────────────────

/**
 * PostgreSQL-backed SubscriptionStore.
 *
 * Persists billing customers, subscriptions, and queries usage summaries
 * from the usage_records table for quota enforcement.
 */
export class DrizzleSubscriptionStore implements SubscriptionStore {
  constructor(private readonly db: OrdrDatabase) {}

  async findCustomerByTenantId(tenantId: string): Promise<BillingCustomer | null> {
    const rows = await this.db
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.tenantId, tenantId))
      .limit(1);
    const row = rows[0];
    return row !== undefined ? rowToCustomer(row) : null;
  }

  async saveCustomer(customer: BillingCustomer): Promise<void> {
    await this.db
      .insert(billingCustomers)
      .values({
        id: customer.id,
        tenantId: customer.tenant_id,
        stripeCustomerId: customer.stripe_customer_id,
        email: customer.email,
        name: customer.name,
        createdAt: customer.created_at,
      })
      .onConflictDoUpdate({
        target: billingCustomers.tenantId,
        set: {
          stripeCustomerId: customer.stripe_customer_id,
          email: customer.email,
          name: customer.name,
        },
      });
  }

  async findSubscriptionByTenantId(tenantId: string): Promise<Subscription | null> {
    // Return the most-recent active/trialing subscription; fall back to latest any status
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .orderBy(subscriptions.createdAt)
      .limit(10);

    if (rows.length === 0) return null;

    // Prefer active > trialing > everything else; latest wins within each status
    const ranked = [...rows].sort((a, b) => {
      const priority: Record<string, number> = {
        active: 0,
        trialing: 1,
        past_due: 2,
        cancelled: 3,
      };
      const ap = priority[a.status] ?? 9;
      const bp = priority[b.status] ?? 9;
      if (ap !== bp) return ap - bp;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const best = ranked[0];
    return best !== undefined ? rowToSubscription(best) : null;
  }

  async saveSubscription(subscription: Subscription): Promise<void> {
    await this.db
      .insert(subscriptions)
      .values({
        id: subscription.id,
        tenantId: subscription.tenant_id,
        stripeSubscriptionId: subscription.stripe_subscription_id,
        planTier: subscription.plan_tier,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        createdAt: subscription.created_at,
        updatedAt: subscription.updated_at,
      })
      .onConflictDoUpdate({
        target: subscriptions.id,
        set: {
          planTier: subscription.plan_tier,
          status: subscription.status,
          stripeSubscriptionId: subscription.stripe_subscription_id,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          updatedAt: subscription.updated_at,
        },
      });
  }

  async updateSubscription(id: string, data: Partial<Subscription>): Promise<Subscription | null> {
    const updateValues: Partial<typeof subscriptions.$inferInsert> = {};

    if (data.plan_tier !== undefined) {
      updateValues.planTier = data.plan_tier;
    }
    if (data.status !== undefined) {
      updateValues.status = data.status;
    }
    if (data.cancel_at_period_end !== undefined) {
      updateValues.cancelAtPeriodEnd = data.cancel_at_period_end;
    }
    if (data.current_period_start !== undefined) {
      updateValues.currentPeriodStart = data.current_period_start;
    }
    if (data.current_period_end !== undefined) {
      updateValues.currentPeriodEnd = data.current_period_end;
    }
    if (data.stripe_subscription_id !== undefined) {
      updateValues.stripeSubscriptionId = data.stripe_subscription_id;
    }
    updateValues.updatedAt = data.updated_at ?? new Date();

    const rows = await this.db
      .update(subscriptions)
      .set(updateValues)
      .where(eq(subscriptions.id, id))
      .returning();

    const row = rows[0];
    return row !== undefined ? rowToSubscription(row) : null;
  }

  async findPaymentMethodsByTenantId(_tenantId: string): Promise<readonly PaymentMethod[]> {
    // Payment methods are managed in Stripe directly.
    // A payment_methods table can be added in a future sprint when the
    // billing UI requires listing saved cards.
    return [];
  }

  async getUsageSummary(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageSummary> {
    const rows = await this.db
      .select({
        resource: usageRecords.resource,
        total: sql<number>`COALESCE(SUM(${usageRecords.quantity}), 0)::int`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.tenantId, tenantId),
          gte(usageRecords.recordedAt, periodStart),
          lt(usageRecords.recordedAt, periodEnd),
        ),
      )
      .groupBy(usageRecords.resource);

    let agents = 0;
    let contacts = 0;
    let messages = 0;
    let api_calls = 0;

    for (const row of rows) {
      const total = row.total;
      switch (row.resource) {
        case 'agents':
          agents = total;
          break;
        case 'contacts':
          contacts = total;
          break;
        case 'messages':
          messages = total;
          break;
        case 'api_calls':
          api_calls = total;
          break;
      }
    }

    return {
      tenant_id: tenantId,
      period_start: periodStart,
      period_end: periodEnd,
      agents,
      contacts,
      messages,
      api_calls,
    };
  }
}

// ─── DrizzleUsageStore ───────────────────────────────────────────

/**
 * PostgreSQL-backed UsageStore.
 *
 * Persists usage records written by UsageTracker.flushAll().
 * Provides aggregated summaries for quota enforcement queries.
 */
export class DrizzleUsageStore implements UsageStore {
  constructor(private readonly db: OrdrDatabase) {}

  async saveUsageRecord(record: Omit<UsageRecord, 'id'>): Promise<UsageRecord> {
    const rows = await this.db
      .insert(usageRecords)
      .values({
        tenantId: record.tenant_id,
        resource: record.resource,
        quantity: record.quantity,
        periodStart: record.period_start,
        periodEnd: record.period_end,
        recordedAt: record.recorded_at,
      })
      .returning();

    const row = rows[0];
    if (row === undefined) {
      throw new Error('[ORDR:billing] saveUsageRecord: insert returned no rows');
    }

    return {
      id: row.id,
      tenant_id: row.tenantId,
      resource: row.resource,
      quantity: row.quantity,
      period_start: row.periodStart,
      period_end: row.periodEnd,
      recorded_at: row.recordedAt,
    };
  }

  async getUsageSummary(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageSummary> {
    const rows = await this.db
      .select({
        resource: usageRecords.resource,
        total: sql<number>`COALESCE(SUM(${usageRecords.quantity}), 0)::int`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.tenantId, tenantId),
          gte(usageRecords.recordedAt, periodStart),
          lt(usageRecords.recordedAt, periodEnd),
        ),
      )
      .groupBy(usageRecords.resource);

    let agents = 0,
      contacts = 0,
      messages = 0,
      api_calls = 0;

    for (const row of rows) {
      const total = row.total;
      switch (row.resource) {
        case 'agents':
          agents = total;
          break;
        case 'contacts':
          contacts = total;
          break;
        case 'messages':
          messages = total;
          break;
        case 'api_calls':
          api_calls = total;
          break;
      }
    }

    return {
      tenant_id: tenantId,
      period_start: periodStart,
      period_end: periodEnd,
      agents,
      contacts,
      messages,
      api_calls,
    };
  }

  async getUsageRecords(
    tenantId: string,
    resource: UsageResource | undefined,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<readonly UsageRecord[]> {
    const conditions = [
      eq(usageRecords.tenantId, tenantId),
      gte(usageRecords.recordedAt, periodStart),
      lt(usageRecords.recordedAt, periodEnd),
      ...(resource !== undefined ? [eq(usageRecords.resource, resource)] : []),
    ];

    const rows = await this.db
      .select()
      .from(usageRecords)
      .where(and(...conditions));

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      resource: row.resource,
      quantity: row.quantity,
      period_start: row.periodStart,
      period_end: row.periodEnd,
      recorded_at: row.recordedAt,
    }));
  }

  async resetUsage(tenantId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const result = await this.db
      .delete(usageRecords)
      .where(
        and(
          eq(usageRecords.tenantId, tenantId),
          gte(usageRecords.periodStart, periodStart),
          lt(usageRecords.periodEnd, periodEnd),
        ),
      )
      .returning({ id: usageRecords.id });

    return result.length;
  }
}
