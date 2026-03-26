/**
 * Plan definitions — static plan catalog for ORDR-Connect
 *
 * Each plan defines limits for agents, contacts, messages, API calls,
 * and available features. Plans are ordered by tier for comparison.
 *
 * SOC2 CC6.3 — Role-based access: plan tier gates feature access.
 * ISO 27001 A.9.1.2 — Access to networks and services: plan-based.
 */

import type { Plan, PlanTier, PlanLimits } from './types.js';
import { PLAN_TIER_RANK } from './types.js';

// ─── Feature Constants ───────────────────────────────────────────

export const FEATURES = {
  BASIC_CRM: 'basic_crm',
  EMAIL_SUPPORT: 'email_support',
  ANALYTICS: 'analytics',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  SSO: 'sso',
  MARKETPLACE: 'marketplace',
  WHITE_LABEL: 'white_label',
  DEDICATED_SUPPORT: 'dedicated_support',
  SLA: 'sla',
  CUSTOM_INTEGRATIONS: 'custom_integrations',
  API_ACCESS: 'api_access',
  MULTI_CHANNEL: 'multi_channel',
  AI_AGENTS: 'ai_agents',
  ADVANCED_AI: 'advanced_ai',
  AUDIT_EXPORT: 'audit_export',
  COMPLIANCE_DASHBOARD: 'compliance_dashboard',
} as const;

// ─── Plan Limits ─────────────────────────────────────────────────

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    max_agents: 1,
    max_contacts: 100,
    max_messages_month: 500,
    max_api_calls_month: 1_000,
    features: [
      FEATURES.BASIC_CRM,
      FEATURES.EMAIL_SUPPORT,
    ],
  },
  starter: {
    max_agents: 3,
    max_contacts: 1_000,
    max_messages_month: 5_000,
    max_api_calls_month: 10_000,
    features: [
      FEATURES.BASIC_CRM,
      FEATURES.EMAIL_SUPPORT,
      FEATURES.ANALYTICS,
      FEATURES.API_ACCESS,
      FEATURES.AI_AGENTS,
    ],
  },
  professional: {
    max_agents: 10,
    max_contacts: 10_000,
    max_messages_month: 50_000,
    max_api_calls_month: 100_000,
    features: [
      FEATURES.BASIC_CRM,
      FEATURES.EMAIL_SUPPORT,
      FEATURES.ANALYTICS,
      FEATURES.ADVANCED_ANALYTICS,
      FEATURES.SSO,
      FEATURES.MARKETPLACE,
      FEATURES.API_ACCESS,
      FEATURES.MULTI_CHANNEL,
      FEATURES.AI_AGENTS,
      FEATURES.ADVANCED_AI,
      FEATURES.AUDIT_EXPORT,
    ],
  },
  enterprise: {
    max_agents: Infinity,
    max_contacts: Infinity,
    max_messages_month: Infinity,
    max_api_calls_month: Infinity,
    features: [
      FEATURES.BASIC_CRM,
      FEATURES.EMAIL_SUPPORT,
      FEATURES.ANALYTICS,
      FEATURES.ADVANCED_ANALYTICS,
      FEATURES.SSO,
      FEATURES.MARKETPLACE,
      FEATURES.WHITE_LABEL,
      FEATURES.DEDICATED_SUPPORT,
      FEATURES.SLA,
      FEATURES.CUSTOM_INTEGRATIONS,
      FEATURES.API_ACCESS,
      FEATURES.MULTI_CHANNEL,
      FEATURES.AI_AGENTS,
      FEATURES.ADVANCED_AI,
      FEATURES.AUDIT_EXPORT,
      FEATURES.COMPLIANCE_DASHBOARD,
    ],
  },
} as const;

// ─── Plan Definitions ────────────────────────────────────────────

export const PLANS: Record<PlanTier, Plan> = {
  free: {
    id: 'plan_free',
    tier: 'free',
    name: 'Free',
    description: 'Get started with basic CRM capabilities',
    price_cents_monthly: 0,
    price_cents_yearly: 0,
    limits: PLAN_LIMITS.free,
    is_custom: false,
  },
  starter: {
    id: 'plan_starter',
    tier: 'starter',
    name: 'Starter',
    description: 'For growing teams with analytics and AI agents',
    price_cents_monthly: 4900, // $49/month
    price_cents_yearly: 47000, // $470/year (~20% discount)
    limits: PLAN_LIMITS.starter,
    is_custom: false,
  },
  professional: {
    id: 'plan_professional',
    tier: 'professional',
    name: 'Professional',
    description: 'Advanced features with SSO, marketplace, and multi-channel',
    price_cents_monthly: 14900, // $149/month
    price_cents_yearly: 143000, // $1,430/year (~20% discount)
    limits: PLAN_LIMITS.professional,
    is_custom: false,
  },
  enterprise: {
    id: 'plan_enterprise',
    tier: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited usage with white-label, dedicated support, and SLA',
    price_cents_monthly: 0, // Custom pricing
    price_cents_yearly: 0, // Custom pricing
    limits: PLAN_LIMITS.enterprise,
    is_custom: true,
  },
} as const;

// ─── Helper Functions ────────────────────────────────────────────

/** Get all plans as an ordered array (free -> enterprise) */
export function getAllPlans(): readonly Plan[] {
  return [PLANS.free, PLANS.starter, PLANS.professional, PLANS.enterprise];
}

/** Get a plan by its tier */
export function getPlanByTier(tier: PlanTier): Plan {
  return PLANS[tier];
}

/** Get limits for a given plan tier */
export function getPlanLimits(tier: PlanTier): PlanLimits {
  return PLAN_LIMITS[tier];
}

/** Check if a feature is available on a given plan tier */
export function hasFeature(tier: PlanTier, feature: string): boolean {
  return PLAN_LIMITS[tier].features.includes(feature);
}

/** Compare two tiers: returns negative if a < b, 0 if equal, positive if a > b */
export function compareTiers(a: PlanTier, b: PlanTier): number {
  return PLAN_TIER_RANK[a] - PLAN_TIER_RANK[b];
}

/** Check if tierA is at least as high as tierB */
export function isAtLeastTier(tierA: PlanTier, minimumTier: PlanTier): boolean {
  return PLAN_TIER_RANK[tierA] >= PLAN_TIER_RANK[minimumTier];
}

/** Get the limit value for a specific resource on a plan tier */
export function getResourceLimit(
  tier: PlanTier,
  resource: 'agents' | 'contacts' | 'messages' | 'api_calls',
): number {
  const limits = PLAN_LIMITS[tier];
  const resourceMap = {
    agents: limits.max_agents,
    contacts: limits.max_contacts,
    messages: limits.max_messages_month,
    api_calls: limits.max_api_calls_month,
  } as const;
  return resourceMap[resource];
}
