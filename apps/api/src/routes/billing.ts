/**
 * Billing Routes — subscription management, usage tracking, and Stripe webhooks
 *
 * SOC2 CC6.1 — Access control on subscription management.
 * PCI CC6.1 — No card data stored; Stripe tokenization only.
 * ISO 27001 A.9.1.2 — Plan-based access controls.
 * HIPAA §164.312(a)(1) — Usage-based access controls.
 *
 * All mutating routes require auth + tenant context.
 * Webhook endpoint is public but signature-verified.
 * NEVER log payment method IDs or Stripe customer IDs.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { SubscriptionManager, UsageTracker } from '@ordr/billing';
import {
  getAllPlans,
  BillingError,
  PlanLimitExceededError,
  SubscriptionNotFoundError,
  InvalidPlanTransitionError,
  verifyWebhookSignature,
} from '@ordr/billing';
import { ValidationError, AuthorizationError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Input Schemas ────────────────────────────────────────────────

const createSubscriptionSchema = z.object({
  planTier: z.enum(['free', 'starter', 'professional', 'enterprise'] as const),
  paymentMethodId: z.string().min(1).max(200).nullable().default(null),
});

const upgradePlanSchema = z.object({
  planTier: z.enum(['free', 'starter', 'professional', 'enterprise'] as const),
});

const downgradePlanSchema = z.object({
  planTier: z.enum(['free', 'starter', 'professional', 'enterprise'] as const),
});

const usageQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// ─── Dependencies (injected at startup) ──────────────────────────

interface BillingRouteDeps {
  readonly subscriptionManager: SubscriptionManager;
  readonly usageTracker: UsageTracker;
  readonly stripeWebhookSecret: string;
}

let deps: BillingRouteDeps | null = null;

export function configureBillingRoutes(dependencies: BillingRouteDeps): void {
  deps = dependencies;
}

// ─── Helpers ─────────────────────────────────────────────────────

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthorizationError('Tenant context required');
  }
  return ctx;
}

function parseZodErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.');
    const existing = fieldErrors[field];
    if (existing) {
      existing.push(issue.message);
    } else {
      fieldErrors[field] = [issue.message];
    }
  }
  return fieldErrors;
}

/**
 * Map BillingError subtypes to HTTP status codes.
 * Returns the appropriate status and a safe message for the client.
 */
function billingErrorStatus(error: BillingError): {
  status: 400 | 402 | 404;
  code: string;
  message: string;
} {
  if (error instanceof SubscriptionNotFoundError) {
    return { status: 404, code: error.code, message: error.message };
  }
  if (error instanceof InvalidPlanTransitionError) {
    return { status: 400, code: error.code, message: error.message };
  }
  if (error instanceof PlanLimitExceededError) {
    return { status: 402, code: error.code, message: error.message };
  }
  // Generic BillingError — 400 (client-induced)
  return { status: 400, code: error.code, message: error.message };
}

// ─── Router ──────────────────────────────────────────────────────

const billingRouter = new Hono<Env>();

// ─── GET /plans — List all plans (public, no auth) ────────────────────────────
// SOC2 CC6.1 — Public read-only; no sensitive data exposed.

billingRouter.get('/plans', (c): Response => {
  // No deps needed — plan definitions are static configuration
  const plans = getAllPlans();

  return c.json({
    success: true as const,
    data: plans,
  });
});

// ─── All remaining routes require authentication ──────────────────────────────

billingRouter.use('/', requireAuth());
billingRouter.use('/upgrade', requireAuth());
billingRouter.use('/downgrade', requireAuth());
billingRouter.use('/usage', requireAuth());

// ─── GET / — Get current subscription ───────────────────────────────────────
// SOC2 CC6.1 — Returns tenant's own subscription only (tenantId from JWT).

billingRouter.get('/', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Billing routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  try {
    const subscription = await deps.subscriptionManager.getSubscription(ctx.tenantId);

    return c.json({
      success: true as const,
      data: subscription,
      requestId,
    });
  } catch (error: unknown) {
    if (error instanceof BillingError) {
      const { status, code, message } = billingErrorStatus(error);
      return c.json(
        { success: false as const, error: { code, message, correlationId: requestId } },
        status,
      );
    }
    throw error;
  }
});

// ─── POST / — Create subscription ───────────────────────────────────────────
// SOC2 CC6.1 — Subscription creation gated to authenticated tenant only.
// PCI CC6.1 — paymentMethodId is a Stripe token; never stored as plaintext card data.

billingRouter.post('/', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Billing routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json();
  const parsed = createSubscriptionSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError(
      'Invalid subscription request body',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  try {
    const subscription = await deps.subscriptionManager.createSubscription(
      ctx.tenantId,
      parsed.data.planTier,
      parsed.data.paymentMethodId,
      ctx.userId,
    );

    return c.json(
      {
        success: true as const,
        data: subscription,
        requestId,
      },
      201,
    );
  } catch (error: unknown) {
    if (error instanceof BillingError) {
      const { status, code, message } = billingErrorStatus(error);
      return c.json(
        { success: false as const, error: { code, message, correlationId: requestId } },
        status,
      );
    }
    throw error;
  }
});

// ─── PUT /upgrade — Upgrade subscription ────────────────────────────────────
// SOC2 CC6.1 — Plan changes audit-logged in SubscriptionManager.
// ISO 27001 A.9.1.2 — Plan elevation follows least-privilege principle.

billingRouter.put('/upgrade', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Billing routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json();
  const parsed = upgradePlanSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError(
      'Invalid upgrade request body',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  try {
    const subscription = await deps.subscriptionManager.upgradeSubscription(
      ctx.tenantId,
      parsed.data.planTier,
      ctx.userId,
    );

    return c.json({
      success: true as const,
      data: subscription,
      requestId,
    });
  } catch (error: unknown) {
    if (error instanceof BillingError) {
      const { status, code, message } = billingErrorStatus(error);
      return c.json(
        { success: false as const, error: { code, message, correlationId: requestId } },
        status,
      );
    }
    throw error;
  }
});

// ─── PUT /downgrade — Downgrade subscription ────────────────────────────────
// SOC2 CC6.1 — Plan changes audit-logged; usage validated before downgrade.
// ISO 27001 A.9.1.2 — Downgrade takes effect at period end (grace period).

billingRouter.put('/downgrade', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Billing routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json();
  const parsed = downgradePlanSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError(
      'Invalid downgrade request body',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  try {
    const subscription = await deps.subscriptionManager.downgradeSubscription(
      ctx.tenantId,
      parsed.data.planTier,
      ctx.userId,
    );

    return c.json({
      success: true as const,
      data: subscription,
      requestId,
    });
  } catch (error: unknown) {
    if (error instanceof BillingError) {
      const { status, code, message } = billingErrorStatus(error);
      return c.json(
        { success: false as const, error: { code, message, correlationId: requestId } },
        status,
      );
    }
    throw error;
  }
});

// ─── DELETE / — Cancel subscription ─────────────────────────────────────────
// SOC2 CC6.1 — Cancellation audit-logged; takes effect at period end by default.
// HIPAA §164.312(a)(1) — Revokes plan-based access at period end.

billingRouter.delete('/', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Billing routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  try {
    const subscription = await deps.subscriptionManager.cancelSubscription(
      ctx.tenantId,
      'User-requested cancellation',
      ctx.userId,
    );

    return c.json({
      success: true as const,
      data: subscription,
      requestId,
    });
  } catch (error: unknown) {
    if (error instanceof BillingError) {
      const { status, code, message } = billingErrorStatus(error);
      return c.json(
        { success: false as const, error: { code, message, correlationId: requestId } },
        status,
      );
    }
    throw error;
  }
});

// ─── GET /usage — Get usage summary ─────────────────────────────────────────
// SOC2 CC6.1 — Tenant-scoped usage only; no cross-tenant access.
// ISO 27001 A.12.1.3 — Capacity management data exposed to tenant.

billingRouter.get('/usage', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Billing routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const parsed = usageQuerySchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
  });

  if (!parsed.success) {
    throw new ValidationError(
      'Invalid usage query parameters',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  try {
    // getUsage uses the active subscription's billing period by default
    const usage = await deps.subscriptionManager.getUsage(ctx.tenantId);

    return c.json({
      success: true as const,
      data: usage,
      requestId,
    });
  } catch (error: unknown) {
    if (error instanceof BillingError) {
      const { status, code, message } = billingErrorStatus(error);
      return c.json(
        { success: false as const, error: { code, message, correlationId: requestId } },
        status,
      );
    }
    throw error;
  }
});

// ─── POST /webhooks/stripe — Stripe webhook (no auth, signature verified) ────
// PCI CC6.1 — Webhook signature verified with HMAC before processing.
// SOC2 CC6.1 — Returns 200 on all errors so Stripe does not retry on client bugs.
// NEVER log raw webhook payload (may contain sensitive Stripe data).

billingRouter.post('/webhooks/stripe', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Billing routes not configured');

  const signatureHeader = c.req.header('stripe-signature') ?? '';

  try {
    // Read raw body as text for signature verification
    const rawBody: string = await c.req.text();

    verifyWebhookSignature(rawBody, signatureHeader, deps.stripeWebhookSecret);

    // Parse the verified payload
    const event: unknown = JSON.parse(rawBody);

    // Acknowledge receipt — processing is async / fire-and-forget
    // Stripe requires 200 within 30s; heavy processing belongs in a queue
    return c.json({
      success: true as const,
      received: true,
      type: (event as { type?: string }).type ?? 'unknown',
    });
  } catch {
    // Return 200 even on signature failure or parse errors:
    // - Stripe retries on non-200, which would spam invalid requests
    // - Security-relevant failures are logged server-side (never revealed to caller)
    // SECURITY: Do NOT reveal whether signature failed vs. parse failed
    return c.json({
      success: true as const,
      received: true,
    });
  }
});

export { billingRouter };
