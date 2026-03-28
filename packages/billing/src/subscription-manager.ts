/**
 * Subscription Manager — lifecycle management for tenant subscriptions
 *
 * Handles creation, upgrades, downgrades, cancellation, and limit enforcement.
 * All mutations are audit-logged for SOC2/ISO27001/HIPAA compliance.
 *
 * SOC2 CC6.1 — Access control: plan-based feature gating.
 * SOC2 CC7.1 — Change management: subscription changes logged.
 * ISO 27001 A.8.2.3 — Handling of assets: billing data encrypted.
 * HIPAA §164.312(b) — Audit controls: all billing changes logged.
 */

import type { AuditLogger } from '@ordr/audit';
import type { FieldEncryptor } from '@ordr/crypto';
import type {
  PlanTier,
  Subscription,
  SubscriptionStatus,
  BillingCustomer,
  UsageResource,
  UsageSummary,
  PaymentMethod,
} from './types.js';
import { getPlanLimits, compareTiers, getResourceLimit } from './plans.js';
import type { StripeClient } from './stripe-client.js';

// ─── Error Classes ───────────────────────────────────────────────

export class BillingError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PlanLimitExceededError extends BillingError {
  public readonly resource: string;
  public readonly current: number;
  public readonly limit: number;

  constructor(resource: string, current: number, limit: number) {
    super(
      `Plan limit exceeded for ${resource}: ${String(current)}/${String(limit)}`,
      'PLAN_LIMIT_EXCEEDED',
    );
    this.name = 'PlanLimitExceededError';
    this.resource = resource;
    this.current = current;
    this.limit = limit;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SubscriptionNotFoundError extends BillingError {
  constructor(_tenantId: string) {
    super(`No active subscription found for tenant`, 'SUBSCRIPTION_NOT_FOUND');
    this.name = 'SubscriptionNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidPlanTransitionError extends BillingError {
  constructor(fromTier: PlanTier, toTier: PlanTier, reason: string) {
    super(`Cannot transition from ${fromTier} to ${toTier}: ${reason}`, 'INVALID_PLAN_TRANSITION');
    this.name = 'InvalidPlanTransitionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Store Interface ─────────────────────────────────────────────

export interface SubscriptionStore {
  findCustomerByTenantId(tenantId: string): Promise<BillingCustomer | null>;
  saveCustomer(customer: BillingCustomer): Promise<void>;
  findSubscriptionByTenantId(tenantId: string): Promise<Subscription | null>;
  saveSubscription(subscription: Subscription): Promise<void>;
  updateSubscription(id: string, data: Partial<Subscription>): Promise<Subscription | null>;
  findPaymentMethodsByTenantId(tenantId: string): Promise<readonly PaymentMethod[]>;
  getUsageSummary(tenantId: string, periodStart: Date, periodEnd: Date): Promise<UsageSummary>;
}

// ─── Price ID Mapping ────────────────────────────────────────────

const STRIPE_PRICE_IDS: Record<PlanTier, string> = {
  free: 'price_free',
  starter: 'price_starter_monthly',
  professional: 'price_professional_monthly',
  enterprise: 'price_enterprise_custom',
} as const;

// ─── Subscription Manager ────────────────────────────────────────

export class SubscriptionManager {
  private readonly store: SubscriptionStore;
  private readonly stripe: StripeClient;
  private readonly auditLogger: AuditLogger;
  private readonly fieldEncryptor: FieldEncryptor;

  constructor(deps: {
    readonly store: SubscriptionStore;
    readonly stripe: StripeClient;
    readonly auditLogger: AuditLogger;
    readonly fieldEncryptor: FieldEncryptor;
  }) {
    this.store = deps.store;
    this.stripe = deps.stripe;
    this.auditLogger = deps.auditLogger;
    this.fieldEncryptor = deps.fieldEncryptor;
  }

  /**
   * Create a new subscription for a tenant.
   *
   * @param tenantId - Tenant creating the subscription
   * @param planTier - Desired plan tier
   * @param paymentMethodId - Stripe PaymentMethod ID (required for paid plans)
   * @param userId - ID of the user performing the action (for audit)
   */
  async createSubscription(
    tenantId: string,
    planTier: PlanTier,
    paymentMethodId: string | null,
    userId: string,
  ): Promise<Subscription> {
    // Check for existing active subscription
    const existing = await this.store.findSubscriptionByTenantId(tenantId);
    if (existing && existing.status === 'active') {
      throw new BillingError('Tenant already has an active subscription', 'SUBSCRIPTION_EXISTS');
    }

    // Paid plans require a payment method
    if (planTier !== 'free' && paymentMethodId === null) {
      throw new BillingError('Payment method required for paid plans', 'PAYMENT_METHOD_REQUIRED');
    }

    // Create or find Stripe customer
    let customer = await this.store.findCustomerByTenantId(tenantId);
    if (!customer) {
      const stripeCustomer = await this.stripe.createCustomer({
        email: `billing@tenant-${tenantId}.com`,
        name: `Tenant ${tenantId}`,
        metadata: { tenant_id: tenantId },
      });

      customer = {
        id: stripeCustomer.id,
        tenant_id: tenantId,
        stripe_customer_id: this.fieldEncryptor.encryptField(
          'stripe_customer_id',
          stripeCustomer.id,
        ),
        email: `billing@tenant-${tenantId}.com`,
        name: `Tenant ${tenantId}`,
        created_at: new Date(),
      };
      await this.store.saveCustomer(customer);
    }

    // Create Stripe subscription
    const stripeSubscription = await this.stripe.createSubscription({
      customer: customer.stripe_customer_id,
      price_id: STRIPE_PRICE_IDS[planTier],
      ...(paymentMethodId !== null ? { payment_method: paymentMethodId } : {}),
    });

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const subscription: Subscription = {
      id: stripeSubscription.id,
      tenant_id: tenantId,
      stripe_subscription_id: this.fieldEncryptor.encryptField(
        'stripe_subscription_id',
        stripeSubscription.id,
      ),
      plan_tier: planTier,
      status: 'active',
      current_period_start: now,
      current_period_end: periodEnd,
      cancel_at_period_end: false,
      created_at: now,
      updated_at: now,
    };

    await this.store.saveSubscription(subscription);

    // Audit log
    await this.auditLogger.log({
      tenantId,
      eventType: 'data.created',
      actorType: 'user',
      actorId: userId,
      resource: 'subscriptions',
      resourceId: subscription.id,
      action: 'create',
      details: { plan_tier: planTier },
      timestamp: now,
    });

    return subscription;
  }

  /**
   * Upgrade a tenant's subscription to a higher plan tier.
   * Prorated immediately — charges the difference.
   */
  async upgradeSubscription(
    tenantId: string,
    newTier: PlanTier,
    userId: string,
  ): Promise<Subscription> {
    const existing = await this.getActiveSubscription(tenantId);

    if (compareTiers(newTier, existing.plan_tier) <= 0) {
      throw new InvalidPlanTransitionError(
        existing.plan_tier,
        newTier,
        'New tier must be higher than current tier for upgrade',
      );
    }

    // Update Stripe subscription with proration
    await this.stripe.updateSubscription(existing.id, {
      price_id: STRIPE_PRICE_IDS[newTier],
      proration_behavior: 'create_prorations',
    });

    const now = new Date();
    const updated = await this.store.updateSubscription(existing.id, {
      plan_tier: newTier,
      updated_at: now,
    });

    if (!updated) {
      throw new BillingError('Failed to update subscription', 'UPDATE_FAILED');
    }

    // Audit log
    await this.auditLogger.log({
      tenantId,
      eventType: 'data.updated',
      actorType: 'user',
      actorId: userId,
      resource: 'subscriptions',
      resourceId: existing.id,
      action: 'upgrade',
      details: {
        from_tier: existing.plan_tier,
        to_tier: newTier,
      },
      timestamp: now,
    });

    return updated;
  }

  /**
   * Downgrade a tenant's subscription to a lower plan tier.
   * Takes effect at the end of the current billing period.
   */
  async downgradeSubscription(
    tenantId: string,
    newTier: PlanTier,
    userId: string,
  ): Promise<Subscription> {
    const existing = await this.getActiveSubscription(tenantId);

    if (compareTiers(newTier, existing.plan_tier) >= 0) {
      throw new InvalidPlanTransitionError(
        existing.plan_tier,
        newTier,
        'New tier must be lower than current tier for downgrade',
      );
    }

    // Verify usage fits within new plan limits
    const usage = await this.store.getUsageSummary(
      tenantId,
      existing.current_period_start,
      existing.current_period_end,
    );
    const newLimits = getPlanLimits(newTier);

    if (usage.agents > newLimits.max_agents) {
      throw new InvalidPlanTransitionError(
        existing.plan_tier,
        newTier,
        `Current agent count (${String(usage.agents)}) exceeds new plan limit (${String(newLimits.max_agents)})`,
      );
    }
    if (usage.contacts > newLimits.max_contacts) {
      throw new InvalidPlanTransitionError(
        existing.plan_tier,
        newTier,
        `Current contact count (${String(usage.contacts)}) exceeds new plan limit (${String(newLimits.max_contacts)})`,
      );
    }

    // Schedule downgrade at period end (no proration)
    await this.stripe.updateSubscription(existing.id, {
      price_id: STRIPE_PRICE_IDS[newTier],
      proration_behavior: 'none',
    });

    const now = new Date();
    const updated = await this.store.updateSubscription(existing.id, {
      plan_tier: newTier,
      updated_at: now,
    });

    if (!updated) {
      throw new BillingError('Failed to update subscription', 'UPDATE_FAILED');
    }

    // Audit log
    await this.auditLogger.log({
      tenantId,
      eventType: 'data.updated',
      actorType: 'user',
      actorId: userId,
      resource: 'subscriptions',
      resourceId: existing.id,
      action: 'downgrade',
      details: {
        from_tier: existing.plan_tier,
        to_tier: newTier,
        effective_at: existing.current_period_end.toISOString(),
      },
      timestamp: now,
    });

    return updated;
  }

  /**
   * Cancel a tenant's subscription.
   * Cancels at end of billing period (grace period) unless immediate.
   */
  async cancelSubscription(
    tenantId: string,
    reason: string,
    userId: string,
    immediate: boolean = false,
  ): Promise<Subscription> {
    const existing = await this.getActiveSubscription(tenantId);

    await this.stripe.cancelSubscription(existing.id, !immediate);

    const now = new Date();
    const updatedData: Partial<Subscription> = immediate
      ? { status: 'cancelled' as SubscriptionStatus, cancel_at_period_end: false, updated_at: now }
      : { cancel_at_period_end: true, updated_at: now };

    const updated = await this.store.updateSubscription(existing.id, updatedData);

    if (!updated) {
      throw new BillingError('Failed to cancel subscription', 'CANCEL_FAILED');
    }

    // Audit log
    await this.auditLogger.log({
      tenantId,
      eventType: 'data.updated',
      actorType: 'user',
      actorId: userId,
      resource: 'subscriptions',
      resourceId: existing.id,
      action: 'cancel',
      details: {
        reason,
        immediate,
        effective_at: immediate ? now.toISOString() : existing.current_period_end.toISOString(),
      },
      timestamp: now,
    });

    return updated;
  }

  /**
   * Check if a tenant is within plan limits for a specific resource.
   * Returns true if within limits, false if at or over limit.
   */
  async checkLimit(
    tenantId: string,
    resource: UsageResource,
  ): Promise<{ within_limit: boolean; current: number; limit: number }> {
    const subscription = await this.getActiveSubscription(tenantId);
    const limit = getResourceLimit(subscription.plan_tier, resource);

    // Infinite limit (enterprise)
    if (!isFinite(limit)) {
      return { within_limit: true, current: 0, limit };
    }

    const usage = await this.store.getUsageSummary(
      tenantId,
      subscription.current_period_start,
      subscription.current_period_end,
    );

    const usageMap: Record<UsageResource, number> = {
      agents: usage.agents,
      contacts: usage.contacts,
      messages: usage.messages,
      api_calls: usage.api_calls,
    };

    const current = usageMap[resource];
    return {
      within_limit: current < limit,
      current,
      limit,
    };
  }

  /**
   * Enforce plan limits — throws PlanLimitExceededError if over limit.
   * Used in middleware to gate resource access.
   */
  async enforceLimit(tenantId: string, resource: UsageResource): Promise<void> {
    const result = await this.checkLimit(tenantId, resource);
    if (!result.within_limit) {
      throw new PlanLimitExceededError(resource, result.current, result.limit);
    }
  }

  /**
   * Get current usage summary for a tenant's active billing period.
   */
  async getUsage(tenantId: string): Promise<UsageSummary> {
    const subscription = await this.getActiveSubscription(tenantId);
    return this.store.getUsageSummary(
      tenantId,
      subscription.current_period_start,
      subscription.current_period_end,
    );
  }

  /**
   * Get the current subscription for a tenant, or null if none exists.
   * Does not throw on missing subscription — callers must handle null.
   */
  async getSubscription(tenantId: string): Promise<Subscription | null> {
    return this.store.findSubscriptionByTenantId(tenantId);
  }

  /**
   * Get active subscription for tenant (throws if not found).
   */
  private async getActiveSubscription(tenantId: string): Promise<Subscription> {
    const subscription = await this.store.findSubscriptionByTenantId(tenantId);
    if (!subscription || (subscription.status !== 'active' && subscription.status !== 'trialing')) {
      throw new SubscriptionNotFoundError(tenantId);
    }
    return subscription;
  }
}
