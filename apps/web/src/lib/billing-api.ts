/**
 * Billing API Service
 *
 * Typed wrappers over /api/v1/billing endpoints.
 *
 * SOC2 CC6.1 — Subscription data is tenant-scoped; tenantId sourced from JWT.
 * PCI CC6.1 — No card data handled here; Stripe tokenization only.
 * ISO 27001 A.9.1.2 — Plan-based access controls.
 * HIPAA §164.312(a)(1) — Usage-based access controls.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type PlanTier = 'free' | 'starter' | 'professional' | 'enterprise';
export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'trialing';

export interface PlanLimits {
  readonly max_agents: number;
  readonly max_contacts: number;
  readonly max_messages_month: number;
  readonly max_api_calls_month: number;
  readonly features: readonly string[];
}

export interface Plan {
  readonly id: string;
  readonly tier: PlanTier;
  readonly name: string;
  readonly description: string;
  readonly price_cents_monthly: number;
  readonly price_cents_yearly: number;
  readonly limits: PlanLimits;
  readonly is_custom: boolean;
}

export interface Subscription {
  readonly id: string;
  readonly tenant_id: string;
  readonly stripe_subscription_id: string;
  readonly plan_tier: PlanTier;
  readonly status: SubscriptionStatus;
  readonly current_period_start: string;
  readonly current_period_end: string;
  readonly cancel_at_period_end: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface UsageSummary {
  readonly tenant_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly agents: number;
  readonly contacts: number;
  readonly messages: number;
  readonly api_calls: number;
}

// ── API ────────────────────────────────────────────────────────────

export const billingApi = {
  /**
   * List all available plans (public, no auth required).
   */
  listPlans(): Promise<Plan[]> {
    return apiClient
      .get<{ success: boolean; data: Plan[] }>('/v1/billing/plans')
      .then((r) => r.data);
  },

  /**
   * Get the current tenant's subscription.
   */
  getSubscription(): Promise<Subscription> {
    return apiClient
      .get<{ success: boolean; data: Subscription }>('/v1/billing')
      .then((r) => r.data);
  },

  /**
   * Create a new subscription.
   * PCI CC6.1 — paymentMethodId is a Stripe token; never a raw card number.
   */
  createSubscription(
    planTier: PlanTier,
    paymentMethodId: string | null = null,
  ): Promise<Subscription> {
    return apiClient
      .post<{ success: boolean; data: Subscription }>('/v1/billing', {
        planTier,
        paymentMethodId,
      })
      .then((r) => r.data);
  },

  /**
   * Upgrade the current subscription to a higher plan tier.
   */
  upgradeSubscription(planTier: PlanTier): Promise<Subscription> {
    return apiClient
      .patch<{ success: boolean; data: Subscription }>('/v1/billing/upgrade', { planTier })
      .then((r) => r.data);
  },

  /**
   * Downgrade the current subscription to a lower plan tier.
   * Takes effect at the end of the current billing period.
   */
  downgradeSubscription(planTier: PlanTier): Promise<Subscription> {
    return apiClient
      .patch<{ success: boolean; data: Subscription }>('/v1/billing/downgrade', { planTier })
      .then((r) => r.data);
  },

  /**
   * Cancel the current subscription (takes effect at period end).
   */
  cancelSubscription(): Promise<Subscription> {
    return apiClient
      .delete<{ success: boolean; data: Subscription }>('/v1/billing')
      .then((r) => r.data);
  },

  /**
   * Get usage summary for the current billing period.
   */
  getUsage(): Promise<UsageSummary> {
    return apiClient
      .get<{ success: boolean; data: UsageSummary }>('/v1/billing/usage')
      .then((r) => r.data);
  },
};
