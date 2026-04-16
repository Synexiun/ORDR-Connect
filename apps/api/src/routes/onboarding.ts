/**
 * Onboarding Routes — new-tenant first-run wizard state
 *
 * GET  /v1/onboarding          — Returns wizard progress { complete, step }
 * PUT  /v1/onboarding/step     — Advances wizard step (idempotent)
 * POST /v1/onboarding/complete — Marks wizard complete (irreversible admin action)
 *
 * SOC2 CC6.1 — Tenant-scoped; actorId from JWT.
 * ISO 27001 A.6.2.1 — Onboarding enforces policy acknowledgement.
 *
 * SECURITY:
 * - tenantId ALWAYS from JWT, never client input (Rule 2)
 * - complete is written once and never reset (no rollback vector)
 * - All mutations audit-logged (Rule 3)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import { AuthorizationError, ValidationError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

const stepSchema = z.object({
  step: z.number().int().min(0).max(10),
});

// ── Dependency Types ──────────────────────────────────────────────────────────

export interface OnboardingDeps {
  readonly auditLogger: AuditLogger;
  readonly getOnboardingState: (tenantId: string) => Promise<OnboardingState>;
  readonly setOnboardingStep: (tenantId: string, step: number) => Promise<OnboardingState>;
  readonly completeOnboarding: (tenantId: string) => Promise<OnboardingState>;
}

export interface OnboardingState {
  readonly tenantId: string;
  readonly complete: boolean;
  readonly step: number;
  readonly completedAt: Date | null;
}

// ── Module-level deps ─────────────────────────────────────────────────────────

let deps: OnboardingDeps | null = null;

export function configureOnboardingRoutes(d: OnboardingDeps): void {
  deps = d;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Tenant context required');
  return ctx;
}

// ── Router ────────────────────────────────────────────────────────────────────

const onboardingRouter = new Hono<Env>();

onboardingRouter.use('*', requireAuth());
onboardingRouter.use('*', rateLimit('read'));

// ── GET / — get wizard state ──────────────────────────────────────────────────

onboardingRouter.get('/', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Onboarding routes not configured');
  const ctx = getTenantContext(c);
  const state = await deps.getOnboardingState(ctx.tenantId);
  return c.json({ success: true as const, data: state });
});

// ── PUT /step — advance step ──────────────────────────────────────────────────

onboardingRouter.put('/step', rateLimit('write'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Onboarding routes not configured');
  const ctx = getTenantContext(c);
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json().catch(() => null);
  const parsed = stepSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid step value',
      { step: parsed.error.issues.map((i) => i.message) },
      requestId,
    );
  }

  const state = await deps.setOnboardingStep(ctx.tenantId, parsed.data.step);

  // WORM audit — onboarding step advanced (ISO 27001 A.6.2.1)
  await deps.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'system.config_change',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'tenants',
    resourceId: ctx.tenantId,
    action: 'advance_onboarding_step',
    details: { step: parsed.data.step },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: state });
});

// ── POST /complete — finish wizard ────────────────────────────────────────────

onboardingRouter.post('/complete', rateLimit('write'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Onboarding routes not configured');
  const ctx = getTenantContext(c);

  const state = await deps.completeOnboarding(ctx.tenantId);

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'system.config_change',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'tenants',
    resourceId: ctx.tenantId,
    action: 'complete_onboarding',
    details: { step: state.step },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: state });
});

export { onboardingRouter };
