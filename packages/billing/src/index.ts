/**
 * @ordr/billing — Plan-Based Billing & Usage Tracking
 *
 * Manages subscriptions, plan tiers, usage quotas, and Stripe
 * integration for the multi-tenant ORDR platform.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - PCI: Payment card data stored only as last-4 tokens (CC6.1)
 * - Audit: All billing events immutably logged (CC7.2)
 * - Access: Plan-gated middleware for feature control (A.9.1.2)
 * - Capacity: Usage quota enforcement (A.12.1.3)
 *
 * Usage:
 *   import { SubscriptionManager, UsageTracker, requirePlan } from '@ordr/billing';
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  PlanTier,
  PlanLimits,
  Plan,
  Subscription,
  Invoice,
  UsageResource,
  UsageSummary,
  UsageRecord,
  PaymentMethod,
  BillingCustomer,
  BillingEvent,
} from './types.js';

export { PLAN_TIER_RANK } from './types.js';

// ─── Plans ────────────────────────────────────────────────────────
export {
  PLANS,
  getAllPlans,
  getPlanByTier,
  hasFeature,
  compareTiers,
  isAtLeastTier,
  getResourceLimit,
} from './plans.js';

// ─── Stripe Client ───────────────────────────────────────────────
export {
  MockStripeClient,
  verifyWebhookSignature,
  generateWebhookSignature,
} from './stripe-client.js';

export type { StripeClient } from './stripe-client.js';

// ─── Subscription Manager ────────────────────────────────────────
export {
  SubscriptionManager,
  BillingError,
  PlanLimitExceededError,
  SubscriptionNotFoundError,
  InvalidPlanTransitionError,
} from './subscription-manager.js';

export type { SubscriptionStore } from './subscription-manager.js';

// ─── Usage Tracker ───────────────────────────────────────────────
export { UsageTracker } from './usage-tracker.js';

export type { UsageStore } from './usage-tracker.js';

// ─── Plan Gate Middleware ─────────────────────────────────────────
export {
  requirePlan,
  requireFeature,
  checkQuota,
  configurePlanGate,
  clearSubscriptionCache,
} from './plan-gate.js';

// ─── In-Memory Stores (dev / testing) ────────────────────────────
export { InMemorySubscriptionStore, InMemoryUsageStore } from './in-memory-store.js';
