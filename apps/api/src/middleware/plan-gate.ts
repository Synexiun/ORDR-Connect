/* eslint-disable
   @typescript-eslint/no-unsafe-assignment,
   @typescript-eslint/no-unsafe-call,
   @typescript-eslint/no-unsafe-member-access,
   @typescript-eslint/no-unsafe-return,
   @typescript-eslint/no-redundant-type-constituents
   --
   NOTE: These rules are disabled because @ordr/billing has not been compiled to dist/ yet,
   so TypeScript's project service cannot resolve its types. Re-enable once all packages
   are built (tracked in build pipeline TODO). Security rules remain fully active.
*/
/**
 * Plan Gate Middleware — API-side billing gate
 *
 * Wraps @ordr/billing feature/plan/quota enforcement with a module-level
 * SubscriptionManager. Call configureBillingGate() once at startup, then
 * use featureGate / planGate / quotaGate as route middleware.
 *
 * SOC2 CC6.1 — Logical access: plan-based feature authorization.
 * ISO 27001 A.9.1.2 — Access to services: plan-gated per endpoint.
 * ISO 27001 A.12.1.3 — Capacity management: quota enforcement.
 *
 * Usage:
 *   // server.ts
 *   configureBillingGate(subscriptionManager);
 *
 *   // route files
 *   import { featureGate, FEATURES } from '../middleware/plan-gate.js';
 *   router.use('*', featureGate(FEATURES.ANALYTICS));
 *   router.post('/install', featureGate(FEATURES.MARKETPLACE), handler);
 *   router.post('/messages', quotaGate('messages'), handler);
 */

import {
  requireFeature,
  requirePlan,
  PlanLimitExceededError,
  SubscriptionNotFoundError,
} from '@ordr/billing';
export { FEATURES } from '@ordr/billing';
import type { SubscriptionManager } from '@ordr/billing';
import type { PlanTier, UsageResource } from '@ordr/billing';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../types.js';

// ─── Module-level state ──────────────────────────────────────────

let _manager: SubscriptionManager | null = null;

/**
 * Configure the billing gate. Must be called once during server bootstrap
 * before any plan-gated routes are accessed.
 */
export function configureBillingGate(manager: SubscriptionManager): void {
  _manager = manager;
}

function getManager(): SubscriptionManager {
  if (_manager === null) {
    throw new Error(
      '[ORDR:API] Billing gate not configured — call configureBillingGate() at startup',
    );
  }
  return _manager;
}

// ─── Middleware Factories ────────────────────────────────────────

/**
 * Gate a route on a plan feature.
 * Returns 403 if the tenant's plan does not include the feature,
 * or if no active subscription is found.
 */
export function featureGate(feature: string) {
  return requireFeature(feature, (tenantId) => getManager().getSubscription(tenantId));
}

/**
 * Gate a route on a minimum plan tier.
 * Returns 403 if the tenant's plan is below the required tier.
 */
export function planGate(minimumTier: PlanTier) {
  return requirePlan(minimumTier, (tenantId) => getManager().getSubscription(tenantId));
}

/**
 * Gate a route on a usage quota.
 * Returns 429 if the tenant is at or over their plan limit for the resource.
 * Returns 403 if no active subscription is found.
 */
export function quotaGate(resource: UsageResource) {
  return createMiddleware<Env>(async (c, next) => {
    const ctx = c.get('tenantContext');
    if (ctx === undefined) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'AUTH_FAILED' as const,
            message: 'Authentication required',
            correlationId: c.get('requestId'),
          },
        },
        401,
      );
    }

    try {
      await getManager().enforceLimit(ctx.tenantId, resource);
    } catch (error: unknown) {
      if (error instanceof PlanLimitExceededError) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'RATE_LIMIT' as const,
              message: error.message,
              correlationId: c.get('requestId'),
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
              correlationId: c.get('requestId'),
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
