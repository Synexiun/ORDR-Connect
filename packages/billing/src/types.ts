/**
 * Billing types — subscription management, usage tracking, payments
 *
 * PCI Compliance: NEVER store full card numbers. Only last 4 digits.
 * Stripe handles full PCI-DSS compliance — we store only references.
 *
 * SOC2 CC6.1 — Access control: all billing operations tenant-scoped.
 * ISO 27001 A.8.2 — Asset handling: Stripe IDs are RESTRICTED data (encrypted at rest).
 * HIPAA §164.312(e)(1) — No PHI in billing records.
 */

// ─── Plan Tiers ──────────────────────────────────────────────────

export const PLAN_TIERS = ['free', 'starter', 'professional', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** Numeric tier ranking for upgrade/downgrade comparison */
export const PLAN_TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  starter: 1,
  professional: 2,
  enterprise: 3,
} as const;

// ─── Plan Limits ─────────────────────────────────────────────────

export interface PlanLimits {
  readonly max_agents: number;
  readonly max_contacts: number;
  readonly max_messages_month: number;
  readonly max_api_calls_month: number;
  readonly features: readonly string[];
}

// ─── Plan ────────────────────────────────────────────────────────

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

// ─── Subscription Status ─────────────────────────────────────────

export const SUBSCRIPTION_STATUSES = [
  'active',
  'past_due',
  'cancelled',
  'trialing',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// ─── Subscription ────────────────────────────────────────────────

export interface Subscription {
  readonly id: string;
  readonly tenant_id: string;
  readonly stripe_subscription_id: string;
  readonly plan_tier: PlanTier;
  readonly status: SubscriptionStatus;
  readonly current_period_start: Date;
  readonly current_period_end: Date;
  readonly cancel_at_period_end: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

// ─── Invoice Status ──────────────────────────────────────────────

export const INVOICE_STATUSES = [
  'draft',
  'open',
  'paid',
  'void',
  'uncollectible',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// ─── Invoice ─────────────────────────────────────────────────────

export interface Invoice {
  readonly id: string;
  readonly tenant_id: string;
  readonly stripe_invoice_id: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly period_start: Date;
  readonly period_end: Date;
  readonly paid_at: Date | null;
  readonly created_at: Date;
}

// ─── Usage Resources ─────────────────────────────────────────────

export const USAGE_RESOURCES = [
  'agents',
  'contacts',
  'messages',
  'api_calls',
] as const;
export type UsageResource = (typeof USAGE_RESOURCES)[number];

// ─── Usage Record ────────────────────────────────────────────────

export interface UsageRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly resource: UsageResource;
  readonly quantity: number;
  readonly period_start: Date;
  readonly period_end: Date;
  readonly recorded_at: Date;
}

// ─── Payment Method Type ─────────────────────────────────────────

export const PAYMENT_METHOD_TYPES = [
  'card',
  'bank_account',
  'sepa_debit',
] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

// ─── Payment Method ──────────────────────────────────────────────

/** PCI: Only last 4 digits stored. Full card data handled by Stripe. */
export interface PaymentMethod {
  readonly id: string;
  readonly tenant_id: string;
  readonly stripe_payment_method_id: string;
  readonly type: PaymentMethodType;
  readonly last_four: string;
  readonly exp_month: number;
  readonly exp_year: number;
  readonly is_default: boolean;
  readonly created_at: Date;
}

// ─── Billing Customer ────────────────────────────────────────────

export interface BillingCustomer {
  readonly id: string;
  readonly tenant_id: string;
  readonly stripe_customer_id: string;
  readonly email: string;
  readonly name: string;
  readonly created_at: Date;
}

// ─── Billing Events ──────────────────────────────────────────────

export const BILLING_EVENT_TYPES = [
  'subscription.created',
  'subscription.upgraded',
  'subscription.downgraded',
  'subscription.cancelled',
  'subscription.renewed',
  'invoice.paid',
  'invoice.failed',
  'payment_method.added',
  'payment_method.removed',
  'usage.limit_reached',
  'usage.limit_exceeded',
] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

export interface BillingEvent {
  readonly id: string;
  readonly tenant_id: string;
  readonly type: BillingEventType;
  readonly payload: Record<string, unknown>;
  readonly timestamp: Date;
}

// ─── Usage Summary ───────────────────────────────────────────────

export interface UsageSummary {
  readonly tenant_id: string;
  readonly period_start: Date;
  readonly period_end: Date;
  readonly agents: number;
  readonly contacts: number;
  readonly messages: number;
  readonly api_calls: number;
}

// ─── Subscription Change ─────────────────────────────────────────

export interface SubscriptionChange {
  readonly from_tier: PlanTier;
  readonly to_tier: PlanTier;
  readonly effective_at: Date;
  readonly prorated_amount_cents: number;
}
