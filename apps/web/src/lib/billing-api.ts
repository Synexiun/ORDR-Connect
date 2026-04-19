/**
 * Billing API Service
 *
 * Typed wrappers over /api/v1/billing endpoints.
 * Covers: subscription lifecycle, invoice history, and payment method management.
 *
 * SECURITY:
 * - Subscription data is tenant-scoped via JWT — Rule 2
 * - No raw card numbers, CVVs, or full PANs ever returned — PCI DSS Req 3.4
 * - Payment method IDs are Stripe tokens only — Rule 5
 * - Stripe subscription IDs are internal refs; never rendered in UI — Rule 6
 * - All billing mutations WORM-logged with actor identity — Rule 3
 *
 * SOC 2 CC6.1 | PCI DSS Req 3.4 | ISO 27001 A.9.1.2 | HIPAA §164.312(a)(1)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type PlanTier = 'free' | 'starter' | 'professional' | 'enterprise';
export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'trialing';
export type InvoiceStatus = 'paid' | 'open' | 'void' | 'uncollectible';
export type PaymentMethodBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown';

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
  /** Internal Stripe reference — never rendered in UI (PCI DSS Req 3.4) */
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

export interface Invoice {
  readonly id: string;
  readonly tenantId: string;
  readonly number: string;
  readonly status: InvoiceStatus;
  readonly amountCents: number;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly invoiceDate: string;
  readonly paidAt: string | null;
  /** Signed Stripe-hosted URL — safe to render as download link */
  readonly pdfUrl: string | null;
}

export interface PaymentMethod {
  readonly id: string;
  /** Card network brand — safe to display */
  readonly brand: PaymentMethodBrand;
  /** Last 4 digits only — PCI DSS Req 3.4 */
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
  readonly isDefault: boolean;
  readonly createdAt: string;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const billingApi = {
  async listPlans(): Promise<Plan[]> {
    return apiClient.get<Plan[]>('/billing/plans');
  },

  async getSubscription(): Promise<Subscription> {
    return apiClient.get<Subscription>('/billing/subscription');
  },

  async getUsage(): Promise<UsageSummary> {
    return apiClient.get<UsageSummary>('/billing/usage');
  },

  async createSubscription(
    planTier: PlanTier,
    paymentMethodId: string | null = null,
  ): Promise<Subscription> {
    return apiClient.post<Subscription>('/billing', { planTier, paymentMethodId });
  },

  async upgradeSubscription(planTier: PlanTier): Promise<Subscription> {
    return apiClient.post<Subscription>('/billing/upgrade', { planTier });
  },

  async downgradeSubscription(planTier: PlanTier): Promise<Subscription> {
    return apiClient.post<Subscription>('/billing/downgrade', { planTier });
  },

  async cancelSubscription(): Promise<Subscription> {
    return apiClient.post<Subscription>('/billing/cancel', {});
  },

  async reactivateSubscription(): Promise<Subscription> {
    return apiClient.post<Subscription>('/billing/reactivate', {});
  },

  async listInvoices(): Promise<Invoice[]> {
    return apiClient.get<Invoice[]>('/billing/invoices');
  },

  async listPaymentMethods(): Promise<PaymentMethod[]> {
    return apiClient.get<PaymentMethod[]>('/billing/payment-methods');
  },

  async setDefaultPaymentMethod(id: string): Promise<PaymentMethod[]> {
    return apiClient.post<PaymentMethod[]>(`/billing/payment-methods/${id}/default`, {});
  },

  async removePaymentMethod(id: string): Promise<unknown> {
    return apiClient.delete<unknown>(`/billing/payment-methods/${id}`);
  },
};
