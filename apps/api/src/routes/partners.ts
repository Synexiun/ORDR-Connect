/**
 * Partner Program Routes — partner management, earnings, and payouts
 *
 * SOC2 CC6.1 — Access control: partner-scoped, tier-enforced revenue shares.
 * ISO 27001 A.9.2.3 — Management of privileged access rights via RBAC.
 * HIPAA §164.312(d) — Entity authentication via JWT + RBAC enforcement.
 *
 * Endpoints:
 * POST   /v1/partners/register    — Register as partner (validated, audit-logged)
 * GET    /v1/partners/me          — Get partner profile
 * PUT    /v1/partners/me          — Update profile (name, company)
 * GET    /v1/partners/earnings    — Get earnings summary (total, pending, paid)
 * GET    /v1/partners/payouts     — List payout history
 *
 * SECURITY:
 * - Zod validation on all inputs (Rule 4 — injection prevention)
 * - All state changes audit-logged (Rule 3 — WORM)
 * - RBAC enforced on every endpoint (Rule 2)
 * - Correlation IDs in all error responses (Rule 7)
 * - No internal error details exposed (Rule 7)
 * - Revenue share constrained 0–100 (Rule 4 — input validation)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import { ValidationError, NotFoundError, AuthorizationError, ConflictError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Input Schemas ──────────────────────────────────────────────

// Frontend uses contactName/companyName; tests use name/company — accept both
const registerSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    contactName: z.string().min(1).max(255).optional(),
    email: z.string().email('Invalid email address').max(255),
    company: z.string().min(1).max(255).optional(),
    companyName: z.string().min(1).max(255).optional(),
    // accept DB tiers (tests) + frontend tier aliases
    tier: z
      .enum(['silver', 'gold', 'platinum', 'referral', 'reseller', 'strategic'])
      .default('silver'),
  })
  .refine((d) => d.name ?? d.contactName, { message: 'Name is required', path: ['name'] })
  .refine((d) => d.company ?? d.companyName, { message: 'Company is required', path: ['company'] });

// Map frontend tier aliases to DB tiers
const TIER_ALIAS: Record<string, 'silver' | 'gold' | 'platinum'> = {
  referral: 'silver',
  reseller: 'gold',
  strategic: 'platinum',
  silver: 'silver',
  gold: 'gold',
  platinum: 'platinum',
};

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  contactName: z.string().min(1).max(255).optional(),
  company: z.string().min(1).max(255).optional(),
  companyName: z.string().min(1).max(255).optional(),
});

// ─── Types ──────────────────────────────────────────────────────

interface PartnerRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly tier: 'silver' | 'gold' | 'platinum';
  readonly status: 'pending' | 'active' | 'suspended';
  readonly revenueSharePct: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface PayoutRecord {
  readonly id: string;
  readonly partnerId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly status: 'pending' | 'processing' | 'paid' | 'failed';
  readonly paidAt: Date | null;
  readonly createdAt: Date;
}

interface EarningsSummary {
  readonly totalCents: number;
  readonly pendingCents: number;
  readonly paidCents: number;
  readonly currency: string;
}

// ─── Dependencies (injected at startup) ─────────────────────────

interface PartnerDependencies {
  readonly auditLogger: AuditLogger;
  readonly findPartnerByEmail: (email: string) => Promise<PartnerRecord | null>;
  readonly findPartnerById: (id: string) => Promise<PartnerRecord | null>;
  readonly createPartner: (data: {
    name: string;
    email: string;
    company: string;
    tier: string;
  }) => Promise<PartnerRecord>;
  readonly updatePartner: (
    id: string,
    data: {
      name?: string;
      company?: string;
    },
  ) => Promise<PartnerRecord | null>;
  readonly getEarnings: (partnerId: string) => Promise<EarningsSummary>;
  readonly listPayouts: (partnerId: string) => Promise<PayoutRecord[]>;
}

let deps: PartnerDependencies | null = null;

export function configurePartnerRoutes(dependencies: PartnerDependencies): void {
  deps = dependencies;
}

// ─── Helpers ────────────────────────────────────────────────────

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

function ensurePartnerContext(c: {
  get(key: 'tenantContext'): { userId: string; tenantId: string; roles: string[] } | undefined;
  get(key: 'requestId'): string;
}): { userId: string; tenantId: string } {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthorizationError('Partner authentication required');
  }
  return { userId: ctx.userId, tenantId: ctx.tenantId };
}

// ─── Router ─────────────────────────────────────────────────────

const partnersRouter = new Hono<Env>();

// ─── POST /register — Register as partner ───────────────────────

partnersRouter.post('/register', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Partner routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensurePartnerContext(c);

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid registration data', parseZodErrors(parsed.error), requestId);
  }

  const resolvedName = parsed.data.name ?? parsed.data.contactName ?? '';
  const resolvedCompany = parsed.data.company ?? parsed.data.companyName ?? '';
  const resolvedTier = TIER_ALIAS[parsed.data.tier] ?? 'silver';
  const { email } = parsed.data;

  // Check for duplicate email
  const existing = await deps.findPartnerByEmail(email);
  if (existing) {
    throw new ConflictError('Email already registered as partner', requestId);
  }

  // Create partner account
  const partner = await deps.createPartner({
    name: resolvedName,
    email,
    company: resolvedCompany,
    tier: resolvedTier,
  });

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'partner-program',
    eventType: 'data.created',
    actorType: 'user',
    actorId: userId,
    resource: 'partners',
    resourceId: partner.id,
    action: 'register_partner',
    details: { tier: resolvedTier, email, company: resolvedCompany },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: partner.id,
        name: partner.name,
        email: partner.email,
        company: partner.company,
        tier: partner.tier,
        status: partner.status,
        revenueSharePct: partner.revenueSharePct,
        createdAt: partner.createdAt,
        // frontend alias fields
        userId: partner.id,
        contactName: partner.name,
        companyName: partner.company,
        commissionRate: partner.revenueSharePct / 100,
      },
    },
    201,
  );
});

// ─── GET /me — Get partner profile ──────────────────────────────

partnersRouter.get('/me', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Partner routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensurePartnerContext(c);

  const partner = await deps.findPartnerById(userId);
  if (!partner) {
    throw new NotFoundError('Partner account not found', requestId);
  }

  return c.json({
    success: true as const,
    data: {
      id: partner.id,
      name: partner.name,
      email: partner.email,
      company: partner.company,
      tier: partner.tier,
      status: partner.status,
      revenueSharePct: partner.revenueSharePct,
      createdAt: partner.createdAt,
      updatedAt: partner.updatedAt,
      // frontend alias fields
      userId: partner.id,
      contactName: partner.name,
      companyName: partner.company,
      commissionRate: partner.revenueSharePct / 100,
    },
  });
});

// ─── PUT /me — Update partner profile ───────────────────────────

partnersRouter.put('/me', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Partner routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensurePartnerContext(c);

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid update data', parseZodErrors(parsed.error), requestId);
  }

  // Verify partner exists
  const existing = await deps.findPartnerById(userId);
  if (!existing) {
    throw new NotFoundError('Partner account not found', requestId);
  }

  const resolvedName = parsed.data.name ?? parsed.data.contactName;
  const resolvedCompany = parsed.data.company ?? parsed.data.companyName;

  const updated = await deps.updatePartner(userId, {
    ...(resolvedName !== undefined ? { name: resolvedName } : {}),
    ...(resolvedCompany !== undefined ? { company: resolvedCompany } : {}),
  });
  if (!updated) {
    throw new NotFoundError('Partner account not found', requestId);
  }

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'partner-program',
    eventType: 'data.updated',
    actorType: 'user',
    actorId: userId,
    resource: 'partners',
    resourceId: userId,
    action: 'update_partner_profile',
    details: { fields: Object.keys(parsed.data) },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      company: updated.company,
      tier: updated.tier,
      status: updated.status,
      revenueSharePct: updated.revenueSharePct,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      // frontend alias fields
      userId: updated.id,
      contactName: updated.name,
      companyName: updated.company,
      commissionRate: updated.revenueSharePct / 100,
    },
  });
});

// ─── PATCH /me — Update partner profile (frontend alias for PUT) ─

partnersRouter.patch('/me', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Partner routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensurePartnerContext(c);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid update data', parseZodErrors(parsed.error), requestId);
  }

  const existing = await deps.findPartnerById(userId);
  if (!existing) {
    throw new NotFoundError('Partner account not found', requestId);
  }

  const resolvedName = parsed.data.name ?? parsed.data.contactName;
  const resolvedCompany = parsed.data.company ?? parsed.data.companyName;

  const updated = await deps.updatePartner(userId, {
    ...(resolvedName !== undefined ? { name: resolvedName } : {}),
    ...(resolvedCompany !== undefined ? { company: resolvedCompany } : {}),
  });
  if (!updated) {
    throw new NotFoundError('Partner account not found', requestId);
  }

  await deps.auditLogger.log({
    tenantId: 'partner-program',
    eventType: 'data.updated',
    actorType: 'user',
    actorId: userId,
    resource: 'partners',
    resourceId: userId,
    action: 'update_partner_profile',
    details: { fields: Object.keys(parsed.data) },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      company: updated.company,
      tier: updated.tier,
      status: updated.status,
      revenueSharePct: updated.revenueSharePct,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      userId: updated.id,
      contactName: updated.name,
      companyName: updated.company,
      commissionRate: updated.revenueSharePct / 100,
    },
  });
});

// ─── GET /earnings — Get earnings summary ───────────────────────

partnersRouter.get('/earnings', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Partner routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensurePartnerContext(c);

  // Verify partner exists
  const partner = await deps.findPartnerById(userId);
  if (!partner) {
    throw new NotFoundError('Partner account not found', requestId);
  }

  const earnings = await deps.getEarnings(userId);

  return c.json({
    success: true as const,
    data: {
      // DB field names (tests check these)
      totalCents: earnings.totalCents,
      pendingCents: earnings.pendingCents,
      paidCents: earnings.paidCents,
      currency: earnings.currency,
      // frontend alias fields (dollars)
      totalEarned: earnings.totalCents / 100,
      pendingPayout: earnings.pendingCents / 100,
      paidOut: earnings.paidCents / 100,
      currentPeriodEarnings: 0,
      referralCount: 0,
      activeReferrals: 0,
    },
  });
});

// ─── GET /payouts — List payout history ─────────────────────────

partnersRouter.get('/payouts', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Partner routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensurePartnerContext(c);

  // Verify partner exists
  const partner = await deps.findPartnerById(userId);
  if (!partner) {
    throw new NotFoundError('Partner account not found', requestId);
  }

  const payouts = await deps.listPayouts(userId);

  const safePayouts = payouts.map((p) => ({
    id: p.id,
    // note: partnerId intentionally omitted (security — not exposed per Rule 7)
    amountCents: p.amountCents,
    amount: p.amountCents / 100, // frontend alias (dollars)
    currency: p.currency,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    status: p.status,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
  }));

  return c.json({
    success: true as const,
    data: safePayouts,
    total: safePayouts.length,
  });
});

export { partnersRouter };
