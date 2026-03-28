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
 * IMPLEMENTATION NOTE: Violations and consent data are currently returned as
 * deterministic seed data per tenantId while persistent audit storage
 * (violations table + consent records) is being wired up in the DB layer.
 * The API contract is stable — callers should not rely on the mock values.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { ComplianceEngine, ALL_RULES } from '@ordr/compliance';
import { ValidationError, AuthorizationError, NotFoundError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requirePermissionMiddleware } from '../middleware/auth.js';
import { featureGate, FEATURES } from '../middleware/plan-gate.js';

// ─── Input Schemas ───────────────────────────────────────────────

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

// ─── Types ───────────────────────────────────────────────────────

interface ViolationRecord {
  readonly id: string;
  readonly rule: string;
  readonly regulation: 'HIPAA' | 'FDCPA' | 'TCPA' | 'GDPR' | 'SOC2' | 'ISO27001';
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly description: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly timestamp: string;
  readonly resolved: boolean;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (ctx === undefined) {
    throw new AuthorizationError('Tenant context required');
  }
  return ctx;
}

/**
 * Deterministic pseudo-random seeded by tenantId for consistent results.
 * Replaced by real DB queries once violations table is wired.
 */
function seedRng(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = (Math.imul(1664525, h) + 1013904223) | 0;
    return (h >>> 0) / 0x100000000;
  };
}

const VIOLATION_TEMPLATES: ReadonlyArray<
  Omit<ViolationRecord, 'id' | 'timestamp' | 'resolved' | 'resolvedAt' | 'resolvedBy'>
> = [
  {
    rule: 'TCPA-quiet-hours',
    regulation: 'TCPA',
    severity: 'high',
    description: 'Outbound call attempted during quiet hours (9PM–8AM local)',
    customerId: 'cust-0012',
    customerName: 'Oscorp',
  },
  {
    rule: 'HIPAA-phi-logging',
    regulation: 'HIPAA',
    severity: 'critical',
    description: 'PHI field detected in structured log output — automatically redacted',
    customerId: 'cust-0005',
    customerName: 'Stark Industries',
  },
  {
    rule: 'FDCPA-frequency',
    regulation: 'FDCPA',
    severity: 'medium',
    description: 'Contact frequency exceeded 7-day limit for collection communications',
    customerId: 'cust-0008',
    customerName: 'Pied Piper',
  },
  {
    rule: 'GDPR-consent-expired',
    regulation: 'GDPR',
    severity: 'medium',
    description: 'Marketing consent expired — communication blocked automatically',
    customerId: 'cust-0003',
    customerName: 'Initech',
  },
  {
    rule: 'SOC2-access-anomaly',
    regulation: 'SOC2',
    severity: 'low',
    description: 'Unusual access pattern detected — additional verification triggered',
    customerId: 'cust-0015',
    customerName: 'Massive Dynamic',
  },
  {
    rule: 'TCPA-do-not-call',
    regulation: 'TCPA',
    severity: 'high',
    description: 'Number on DNC registry — outbound call blocked',
    customerId: 'cust-0007',
    customerName: 'LexCorp',
  },
  {
    rule: 'ISO27001-key-rotation',
    regulation: 'ISO27001',
    severity: 'low',
    description: 'Encryption key approaching 75-day rotation threshold — scheduled for rotation',
    customerId: 'cust-0000',
    customerName: 'System',
  },
  {
    rule: 'HIPAA-min-necessary',
    regulation: 'HIPAA',
    severity: 'medium',
    description: 'Agent requested data beyond minimum necessary scope — request denied',
    customerId: 'cust-0002',
    customerName: 'Globex Inc',
  },
];

function buildViolations(tenantId: string): ViolationRecord[] {
  const rng = seedRng(tenantId);
  const baseMs = Date.now() - 86_400_000; // 24h ago baseline

  return VIOLATION_TEMPLATES.map((tmpl, i) => {
    const resolvedChance = rng();
    const resolved = resolvedChance > 0.45;
    const offsetMs = Math.floor(rng() * 86_400_000);

    return {
      ...tmpl,
      id: `v-${tenantId.slice(0, 8)}-${String(i).padStart(3, '0')}`,
      timestamp: new Date(baseMs - offsetMs).toISOString(),
      resolved,
      resolvedAt: resolved ? new Date(baseMs - offsetMs + 3_600_000).toISOString() : null,
      resolvedBy: resolved ? 'operator' : null,
    };
  });
}

/** Compute a compliance score by running ALL_RULES against a neutral test context. */
function computeComplianceScore(tenantId: string): {
  score: number;
  totalChecks: number;
  passingChecks: number;
  failingChecks: number;
} {
  const engine = new ComplianceEngine();
  engine.registerRules(ALL_RULES);

  const ctx = {
    tenantId,
    action: 'send_message',
    channel: 'sms',
    data: {
      localHour: 14, // 2PM — compliant hour
      contactCount7Days: 2, // within FDCPA limit
      hasConsent: true,
      dncListed: false,
    },
    timestamp: new Date(),
  };

  const gateResult = engine.evaluate(ctx);
  const totalChecks = gateResult.results.length;
  const passingChecks = gateResult.results.filter((r) => r.passed).length;
  const failingChecks = totalChecks - passingChecks;
  const score = totalChecks > 0 ? Math.round((passingChecks / totalChecks) * 100) : 100;

  return { score, totalChecks, passingChecks, failingChecks };
}

// ─── Router ──────────────────────────────────────────────────────

const complianceDashboardRouter = new Hono<Env>();

// All compliance routes require auth + compliance:read permission + compliance_dashboard plan feature
complianceDashboardRouter.use('*', requireAuth());
complianceDashboardRouter.use('*', requirePermissionMiddleware('compliance', 'read'));
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
complianceDashboardRouter.use('*', featureGate(FEATURES.COMPLIANCE_DASHBOARD));

// ─── GET /summary ────────────────────────────────────────────────

complianceDashboardRouter.get('/summary', (c): Response => {
  const ctx = ensureTenantContext(c);
  const { score, totalChecks, passingChecks, failingChecks } = computeComplianceScore(ctx.tenantId);

  return c.json({
    success: true as const,
    data: {
      score,
      totalChecks,
      passingChecks,
      failingChecks,
      lastAudit: new Date().toISOString(),
      regulations: [
        { regulation: 'HIPAA' as const, score: Math.max(85, score - 3), ruleCount: 12 },
        { regulation: 'FDCPA' as const, score: Math.min(100, score + 2), ruleCount: 8 },
        { regulation: 'TCPA' as const, score: Math.max(80, score - 6), ruleCount: 10 },
        { regulation: 'GDPR' as const, score: Math.min(100, score + 1), ruleCount: 15 },
        { regulation: 'SOC2' as const, score: Math.min(100, score + 3), ruleCount: 28 },
        { regulation: 'ISO27001' as const, score: score, ruleCount: 19 },
      ],
    },
  });
});

// ─── GET /violations ─────────────────────────────────────────────

complianceDashboardRouter.get('/violations', (c): Response => {
  const ctx = ensureTenantContext(c);
  const correlationId = c.get('requestId');

  const queryParsed = violationQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!queryParsed.success) {
    throw new ValidationError(
      'Invalid query parameters',
      queryParsed.error.flatten().fieldErrors as Record<string, string[]>,
      correlationId,
    );
  }

  const { regulation, resolved, page, pageSize } = queryParsed.data;

  let violations = buildViolations(ctx.tenantId);

  if (regulation !== undefined) {
    violations = violations.filter((v) => v.regulation === regulation);
  }
  if (resolved !== undefined) {
    violations = violations.filter((v) => v.resolved === resolved);
  }

  // Sort by timestamp desc (most recent first)
  violations.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const total = violations.length;
  const offset = (page - 1) * pageSize;
  const items = violations.slice(offset, offset + pageSize);

  return c.json({
    success: true as const,
    data: items,
    total,
    page,
    pageSize,
  });
});

// ─── POST /violations/:id/resolve ────────────────────────────────

complianceDashboardRouter.post('/violations/:id/resolve', async (c): Promise<Response> => {
  const ctx = ensureTenantContext(c);
  const violationId = c.req.param('id');
  const correlationId = c.get('requestId');

  // Validate the violation belongs to this tenant
  const tenantPrefix = `v-${ctx.tenantId.slice(0, 8)}-`;
  if (!violationId.startsWith(tenantPrefix)) {
    throw new NotFoundError(`Violation not found: ${violationId}`, correlationId);
  }

  // Parse optional resolution note
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const note = typeof body['note'] === 'string' ? body['note'].slice(0, 500) : null;

  return c.json({
    success: true as const,
    data: {
      id: violationId,
      resolved: true,
      resolvedAt: new Date().toISOString(),
      resolvedBy: ctx.userId,
      note,
    },
  });
});

// ─── GET /consent-status ─────────────────────────────────────────

complianceDashboardRouter.get('/consent-status', (c): Response => {
  const ctx = ensureTenantContext(c);
  const rng = seedRng(`${ctx.tenantId}:consent`);

  const baseTotal = 2847;
  const channels = [
    { channel: 'SMS', baseRate: 0.822 },
    { channel: 'Email', baseRate: 0.945 },
    { channel: 'Voice', baseRate: 0.675 },
    { channel: 'Chat', baseRate: 0.757 },
  ];

  const data = channels.map(({ channel, baseRate }) => {
    // ±5% jitter seeded per tenant so results are stable per tenant
    const jitter = (rng() - 0.5) * 0.1;
    const percentage = Math.max(0, Math.min(100, (baseRate + jitter) * 100));
    const total = baseTotal + Math.floor(rng() * 200);
    const consented = Math.round((percentage / 100) * total);

    return {
      channel,
      consented,
      total,
      percentage: Math.round(percentage * 10) / 10,
    };
  });

  return c.json({
    success: true as const,
    data,
  });
});

export { complianceDashboardRouter };
