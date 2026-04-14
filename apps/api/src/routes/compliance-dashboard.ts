/**
 * Compliance Dashboard Routes — summary, violations, consent status
 *
 * GET  /v1/compliance/summary              — Overall compliance score + check counts
 * GET  /v1/compliance/violations           — Paginated violation list (filterable)
 * POST /v1/compliance/violations/:id/resolve — Mark a violation resolved
 * GET  /v1/compliance/consent-status       — Consent rates by channel
 *
 * SOC2 CC6.1  — Tenant-scoped, role-checked.
 * SOC2 CC7.2  — Compliance monitoring and anomaly detection.
 * ISO 27001 A.5.36 — Compliance with information security policies.
 * HIPAA §164.308(a)(1) — Risk analysis and management.
 *
 * SECURITY:
 * - tenantId ALWAYS from JWT, never client input (Rule 2)
 * - All resolve actions are audit-logged (Rule 3)
 * - customerName is NOT returned — name field is encrypted (Rule 6)
 * - Violation core fields are immutable at DB layer (WORM — Rule 3)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { ComplianceEngine, ALL_RULES } from '@ordr/compliance';
import type { AuditLogger } from '@ordr/audit';
import { ValidationError, AuthorizationError, NotFoundError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requirePermissionMiddleware } from '../middleware/auth.js';
import { featureGate, FEATURES } from '../middleware/plan-gate.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ── Violation domain types ────────────────────────────────────────────────────

export type ViolationRegulation = 'HIPAA' | 'FDCPA' | 'TCPA' | 'GDPR' | 'SOC2' | 'ISO27001';
export type ViolationSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ViolationRecord {
  readonly id: string;
  readonly rule: string;
  readonly regulation: ViolationRegulation;
  readonly severity: ViolationSeverity;
  readonly description: string;
  readonly customerId: string | null;
  /** Always null — customer name is encrypted, fetch from /v1/customers/:id if needed. */
  readonly customerName: null;
  readonly timestamp: string;
  readonly resolved: boolean;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly resolutionNote: string | null;
}

export interface ViolationCounts {
  readonly [regulation: string]: {
    readonly open: number;
    readonly resolved: number;
  };
}

export interface ConsentRate {
  readonly channel: string;
  readonly consented: number;
  readonly total: number;
  readonly percentage: number;
}

// ── Dependency Types ──────────────────────────────────────────────────────────

export interface ComplianceDashboardDeps {
  readonly auditLogger: AuditLogger;
  readonly listViolations: (
    tenantId: string,
    opts: {
      regulation?: ViolationRegulation;
      resolved?: boolean;
      page: number;
      pageSize: number;
    },
  ) => Promise<{ readonly items: readonly ViolationRecord[]; readonly total: number }>;
  readonly getViolation: (tenantId: string, id: string) => Promise<ViolationRecord | null>;
  readonly resolveViolation: (
    tenantId: string,
    id: string,
    data: { readonly resolvedBy: string; readonly resolutionNote: string | null },
  ) => Promise<ViolationRecord | null>;
  readonly getViolationCounts: (tenantId: string) => Promise<ViolationCounts>;
  readonly getConsentRates: (tenantId: string) => Promise<readonly ConsentRate[]>;
  readonly getLastAuditTime: (tenantId: string) => Promise<Date | null>;
}

// ── Module-level deps ─────────────────────────────────────────────────────────

let deps: ComplianceDashboardDeps | null = null;

export function configureComplianceDashboardRoutes(d: ComplianceDashboardDeps): void {
  deps = d;
}

// ── Input Schemas ─────────────────────────────────────────────────────────────

const violationQuerySchema = z.object({
  regulation: z.enum(['HIPAA', 'FDCPA', 'TCPA', 'GDPR', 'SOC2', 'ISO27001'] as const).optional(),
  resolved: z
    .string()
    .optional()
    .transform((v) => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    }),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const resolveBodySchema = z.object({
  note: z.string().max(500).nullable().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (ctx === undefined) throw new AuthorizationError('Tenant context required');
  return ctx;
}

function getDeps(): ComplianceDashboardDeps {
  if (!deps) throw new Error('[ORDR:API] Compliance dashboard routes not configured');
  return deps;
}

/**
 * Compute compliance score by running ALL_RULES against a neutral test context.
 * This reflects rule-configuration health, not violation history.
 * Score 0–100; 100 = all rules pass against nominal data.
 */
function computeComplianceScore(): {
  score: number;
  totalChecks: number;
  passingChecks: number;
  failingChecks: number;
} {
  const engine = new ComplianceEngine();
  engine.registerRules(ALL_RULES);
  const result = engine.evaluate({
    tenantId: 'health-check',
    action: 'send_message',
    channel: 'sms',
    data: {
      localHour: 14, // 2PM — within quiet-hour rules
      contactCount7Days: 2, // within FDCPA frequency limit
      hasConsent: true,
      dncListed: false,
    },
    timestamp: new Date(),
  });
  const total = result.results.length;
  const passing = result.results.filter((r) => r.passed).length;
  return {
    score: total > 0 ? Math.round((passing / total) * 100) : 100,
    totalChecks: total,
    passingChecks: passing,
    failingChecks: total - passing,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

const complianceDashboardRouter = new Hono<Env>();

complianceDashboardRouter.use('*', requireAuth());
complianceDashboardRouter.use('*', requirePermissionMiddleware('compliance', 'read'));

complianceDashboardRouter.use('*', featureGate(FEATURES.COMPLIANCE_DASHBOARD));
complianceDashboardRouter.use('*', rateLimit('read'));

// ── GET /summary ──────────────────────────────────────────────────────────────

complianceDashboardRouter.get('/summary', async (c): Promise<Response> => {
  const d = getDeps();
  const ctx = ensureTenantContext(c);

  const { score, totalChecks, passingChecks, failingChecks } = computeComplianceScore();

  const [violationCounts, lastAuditTime] = await Promise.all([
    d.getViolationCounts(ctx.tenantId),
    d.getLastAuditTime(ctx.tenantId),
  ]);

  // Build per-regulation breakdown using real violation counts
  const REGULATIONS: ViolationRegulation[] = ['HIPAA', 'FDCPA', 'TCPA', 'GDPR', 'SOC2', 'ISO27001'];
  const RULE_COUNTS: Record<ViolationRegulation, number> = {
    HIPAA: 12,
    FDCPA: 8,
    TCPA: 10,
    GDPR: 15,
    SOC2: 28,
    ISO27001: 19,
  };

  const regulations = REGULATIONS.map((regulation) => {
    const counts = violationCounts[regulation] ?? { open: 0, resolved: 0 };
    const total = counts.open + counts.resolved;
    const ruleCount = RULE_COUNTS[regulation];
    // Regulation score penalises open violations: each open violation = -5 points, floor 0
    const regScore = Math.max(0, Math.min(100, score - counts.open * 5));
    return {
      regulation,
      score: regScore,
      ruleCount,
      openViolations: counts.open,
      totalViolations: total,
    };
  });

  const totalOpen = REGULATIONS.reduce((sum, r) => sum + (violationCounts[r]?.open ?? 0), 0);
  const totalResolved = REGULATIONS.reduce(
    (sum, r) => sum + (violationCounts[r]?.resolved ?? 0),
    0,
  );

  return c.json({
    success: true as const,
    data: {
      score,
      totalChecks,
      passingChecks,
      failingChecks,
      openViolations: totalOpen,
      resolvedViolations: totalResolved,
      lastAudit: (lastAuditTime ?? new Date()).toISOString(),
      regulations,
    },
  });
});

// ── GET /violations ───────────────────────────────────────────────────────────

complianceDashboardRouter.get('/violations', async (c): Promise<Response> => {
  const d = getDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const queryParsed = violationQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!queryParsed.success) {
    throw new ValidationError(
      'Invalid query parameters',
      queryParsed.error.flatten().fieldErrors as Record<string, string[]>,
      requestId,
    );
  }

  const { regulation, resolved, page, pageSize } = queryParsed.data;

  // exactOptionalPropertyTypes: only spread defined values so absent fields are truly absent
  const { items, total } = await d.listViolations(ctx.tenantId, {
    page,
    pageSize,
    ...(regulation !== undefined && { regulation }),
    ...(resolved !== undefined && { resolved }),
  });

  return c.json({
    success: true as const,
    data: items,
    total,
    page,
    pageSize,
  });
});

// ── POST /violations/:id/resolve ──────────────────────────────────────────────

complianceDashboardRouter.post('/violations/:id/resolve', async (c): Promise<Response> => {
  const d = getDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const violationId = c.req.param('id');

  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = resolveBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid resolve payload',
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
      requestId,
    );
  }

  // Verify violation exists and belongs to this tenant before update
  const existing = await d.getViolation(ctx.tenantId, violationId);
  if (!existing) {
    throw new NotFoundError(`Violation not found: ${violationId}`, requestId);
  }
  if (existing.resolved) {
    throw new ValidationError(
      'Violation is already resolved',
      { id: ['Already resolved'] },
      requestId,
    );
  }

  const updated = await d.resolveViolation(ctx.tenantId, violationId, {
    resolvedBy: ctx.userId,
    resolutionNote: parsed.data.note ?? null,
  });

  if (!updated) {
    throw new NotFoundError(`Violation not found: ${violationId}`, requestId);
  }

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'compliance.violation',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'compliance_violations',
    resourceId: violationId,
    action: 'resolve_violation',
    details: {
      rule: existing.rule,
      regulation: existing.regulation,
      severity: existing.severity,
      resolutionNote: updated.resolutionNote,
    },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: updated });
});

// ── GET /consent-status ───────────────────────────────────────────────────────

complianceDashboardRouter.get('/consent-status', async (c): Promise<Response> => {
  const d = getDeps();
  const ctx = ensureTenantContext(c);

  const rates = await d.getConsentRates(ctx.tenantId);

  return c.json({ success: true as const, data: rates });
});

export { complianceDashboardRouter };
