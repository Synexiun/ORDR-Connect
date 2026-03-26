/**
 * Plan Gate Middleware — Hono middleware for plan-based access control
 *
 * Three middleware factories:
 * 1. requirePlan(minimumTier) — check tenant's plan meets minimum tier
 * 2. requireFeature(featureName) — check if feature is on tenant's plan
 * 3. checkQuota(resource) — check usage quota before allowing request
 *
 * SOC2 CC6.1 — Logical access: feature/plan-based authorization.
 * ISO 27001 A.9.1.2 — Access to networks/services: plan-gated.
 * ISO 27001 A.12.1.3 — Capacity management: quota enforcement.
 */

import { createMiddleware } from 'hono/factory';
import type { PlanTier, UsageResource, Subscription } from './types.js';
import { isAtLeastTier, hasFeature } from './plans.js';
import type { SubscriptionManager } from './subscription-manager.js';
import { PlanLimitExceededError, SubscriptionNotFoundError } from './subscription-manager.js';

// ─── Env Type (matches API Env) ──────────────────────────────────

interface BillingEnv {
  Variables: {
    requestId: string;
    tenantContext: {
      readonly tenantId: string;
      readonly userId: string;
      readonly roles: readonly string[];
      readonly permissions: readonly string[];
    } | undefined;
  };
}

// ─── Module-level config ─────────────────────────────────────────

let subscriptionManager: SubscriptionManager | null = null;
let subscriptionCache = new Map<string, { subscription: Subscription; cachedAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Configure plan gate middleware with the subscription manager.
 * Must be called once at startup before any plan-gated routes are hit.
 */
export function configurePlanGate(manager: SubscriptionManager): void {
  subscriptionManager = manager;
}

/**
 * Clear the subscription cache (e.g., after plan change).
 */
export function clearSubscriptionCache(tenantId?: string): void {
  if (tenantId) {
    subscriptionCache.delete(tenantId);
  } else {
    subscriptionCache = new Map();
  }
}

// ─── Internal: Get Tenant Subscription ───────────────────────────

async function getTenantSubscription(tenantId: string): Promise<Subscription | null> {
  if (!subscriptionManager) {
    throw new Error('[ORDR:Billing] Plan gate not configured — call configurePlanGate()');
  }

  // Check cache
  const cached = subscriptionCache.get(tenantId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.subscription;
  }

  try {
    const usage = await subscriptionManager.getUsage(tenantId);
    // getUsage internally calls getActiveSubscription, which throws if not found.
    // We need to get the subscription directly.
    // Use checkLimit as a proxy to verify subscription exists.
    await subscriptionManager.checkLimit(tenantId, 'api_calls');

    // If we got here, subscription exists. Use checkLimit result to infer.
    // For a proper implementation, we'd add a getSubscription method.
    // For now, return null and let the middleware handle missing subscriptions.
    return null;
  } catch {
    return null;
  }
}

// ─── requirePlan Middleware ──────────────────────────────────────

/**
 * Middleware that verifies the tenant's plan meets the minimum tier.
 * Returns 403 if the tenant's plan is below the required tier.
 *
 * @param minimumTier - Minimum plan tier required to access the endpoint
 * @param getSubscription - Function to resolve tenant's current subscription
 */
export function requirePlan(
  minimumTier: PlanTier,
  getSubscription: (tenantId: string) => Promise<Subscription | null>,
) {
  return createMiddleware<BillingEnv>(async (c, next) => {
    const ctx = c.get('tenantContext');
    if (!ctx) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'AUTH_FAILED' as const,
            message: 'Authentication required',
            correlationId: c.get('requestId') ?? 'unknown',
          },
        },
        401,
      );
    }

    const subscription = await getSubscription(ctx.tenantId);
    if (!subscription) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'FORBIDDEN' as const,
            message: 'No active subscription found',
            correlationId: c.get('requestId') ?? 'unknown',
          },
        },
        403,
      );
    }

    if (!isAtLeastTier(subscription.plan_tier, minimumTier)) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'FORBIDDEN' as const,
            message: `This feature requires the ${minimumTier} plan or higher`,
            correlationId: c.get('requestId') ?? 'unknown',
          },
        },
        403,
      );
    }

    await next();
  });
}

// ─── requireFeature Middleware ───────────────────────────────────

/**
 * Middleware that checks if a specific feature is available on the tenant's plan.
 * Returns 403 if the feature is not included.
 *
 * @param featureName - Feature identifier to check
 * @param getSubscription - Function to resolve tenant's current subscription
 */
export function requireFeature(
  featureName: string,
  getSubscription: (tenantId: string) => Promise<Subscription | null>,
) {
  return createMiddleware<BillingEnv>(async (c, next) => {
    const ctx = c.get('tenantContext');
    if (!ctx) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'AUTH_FAILED' as const,
            message: 'Authentication required',
            correlationId: c.get('requestId') ?? 'unknown',
          },
        },
        401,
      );
    }

    const subscription = await getSubscription(ctx.tenantId);
    if (!subscription) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'FORBIDDEN' as const,
            message: 'No active subscription found',
            correlationId: c.get('requestId') ?? 'unknown',
          },
        },
        403,
      );
    }

    if (!hasFeature(subscription.plan_tier, featureName)) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'FORBIDDEN' as const,
            message: `Feature '${featureName}' is not available on your current plan`,
            correlationId: c.get('requestId') ?? 'unknown',
          },
        },
        403,
      );
    }

    await next();
  });
}

// ─── checkQuota Middleware ───────────────────────────────────────

/**
 * Middleware that checks if the tenant is within their usage quota.
 * Returns 429 if the quota is exceeded.
 *
 * @param resource - Usage resource to check quota for
 * @param manager - SubscriptionManager instance for limit checking
 */
export function checkQuota(
  resource: UsageResource,
  manager: SubscriptionManager,
) {
  return createMiddleware<BillingEnv>(async (c, next) => {
    const ctx = c.get('tenantContext');
    if (!ctx) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'AUTH_FAILED' as const,
            message: 'Authentication required',
            correlationId: c.get('requestId') ?? 'unknown',
          },
        },
        401,
      );
    }

    try {
      await manager.enforceLimit(ctx.tenantId, resource);
    } catch (error: unknown) {
      if (error instanceof PlanLimitExceededError) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'RATE_LIMIT' as const,
              message: error.message,
              correlationId: c.get('requestId') ?? 'unknown',
              details: {
                resource: error.resource,
                current: error.current,
                limit: error.limit,
              },
            },
          },
          429,
        );
      }
      if (error instanceof SubscriptionNotFoundError) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'FORBIDDEN' as const,
              message: 'No active subscription found',
              correlationId: c.get('requestId') ?? 'unknown',
            },
          },
          403,
        );
      }
      throw error;
    }

    await next();
  });
}
