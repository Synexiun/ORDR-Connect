/**
 * DSR Routes — GDPR Data Subject Request lifecycle
 *
 * POST   /v1/dsr            — Create a new DSR (pending)
 * GET    /v1/dsr            — List DSRs for tenant (paginated)
 * GET    /v1/dsr/:id        — Get DSR detail + export URL if completed
 * POST   /v1/dsr/:id/approve — Approve pending → approved + publish Kafka
 * POST   /v1/dsr/:id/reject  — Reject pending → rejected
 * DELETE /v1/dsr/:id         — Cancel pending → cancelled
 *
 * SOC2 CC6.1  — All routes tenant-scoped; RBAC enforced.
 * GDPR Art. 12 — 30-day deadline tracked.
 * GDPR Art. 15/17/20 — access / erasure / portability.
 * HIPAA §164.524 — right of access for PHI.
 *
 * SECURITY:
 * - tenantId ALWAYS sourced from JWT context, never from client input
 * - No PHI in audit log details
 * - Rate limited: 20 req/min per tenant
 */

import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requirePermissionMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ── Input Schemas ─────────────────────────────────────────────────

const createDsrSchema = z
  .object({
    customerId: z.string().uuid(),
    type: z.enum(['access', 'erasure', 'portability']),
    reason: z.string().max(1000).optional(),
  })
  .refine((d) => d.type !== 'erasure' || (d.reason !== undefined && d.reason.length > 0), {
    message: 'reason is required for erasure requests',
    path: ['reason'],
  });

const listDsrQuerySchema = z.object({
  status: z
    .enum(['pending', 'approved', 'processing', 'completed', 'rejected', 'cancelled', 'failed'])
    .optional(),
  type: z.enum(['access', 'erasure', 'portability']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const rejectDsrSchema = z.object({
  reason: z.string().min(1).max(1000),
});

// ── Dependency Types ──────────────────────────────────────────────

export interface DsrDeps {
  readonly createDsr: (params: {
    tenantId: string;
    customerId: string;
    type: 'access' | 'erasure' | 'portability';
    reason: string | undefined;
    requestedBy: string;
    deadlineAt: Date;
  }) => Promise<DsrRecord>;

  readonly listDsrs: (params: {
    tenantId: string;
    status?: string;
    type?: string;
    page: number;
    limit: number;
  }) => Promise<{ items: DsrRecord[]; total: number; overdue_count: number }>;

  readonly getDsr: (params: {
    tenantId: string;
    dsrId: string;
  }) => Promise<{ dsr: DsrRecord; export: DsrExportRecord | null } | null>;

  readonly approveDsr: (params: { tenantId: string; dsrId: string }) => Promise<DsrRecord>;

  readonly rejectDsr: (params: {
    tenantId: string;
    dsrId: string;
    rejectionReason: string;
  }) => Promise<DsrRecord>;

  readonly cancelDsr: (params: { tenantId: string; dsrId: string }) => Promise<DsrRecord>;

  readonly publishApproved: (params: {
    dsrId: string;
    tenantId: string;
    customerId: string;
    type: 'access' | 'erasure' | 'portability';
  }) => Promise<void>;

  readonly auditLogger: AuditLogger;
}

export interface DsrRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly type: 'access' | 'erasure' | 'portability';
  readonly status:
    | 'pending'
    | 'approved'
    | 'processing'
    | 'completed'
    | 'rejected'
    | 'cancelled'
    | 'failed';
  readonly requestedBy: string;
  readonly reason: string | null;
  readonly deadlineAt: string;
  readonly completedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DsrExportRecord {
  readonly expiresAt: string;
  readonly checksumSha256: string;
  readonly s3Key: string;
  readonly s3Bucket: string;
  readonly fileSizeBytes: number | null;
  readonly downloadUrl?: string;
}

// ── Module-level deps ─────────────────────────────────────────────

let deps: DsrDeps | undefined;

export function configureDsrRoutes(d: DsrDeps): void {
  deps = d;
}

// ── Helpers ───────────────────────────────────────────────────────

function ensureDeps(): DsrDeps {
  if (!deps) throw new Error('[ORDR:API] DSR routes not configured');
  return deps;
}

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Tenant context required');
  return ctx;
}

function parseZodErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.');
    const existing = out[field];
    if (existing) existing.push(issue.message);
    else out[field] = [issue.message];
  }
  return out;
}

// ── Error code → HTTP status ──────────────────────────────────────

function dsrErrorStatus(code: string): ContentfulStatusCode {
  if (code === 'DSR_CONFLICT' || code === 'DSR_STATE_ERROR') return 409;
  if (code === 'DSR_NOT_FOUND') return 404;
  return 500;
}

// ── Router ────────────────────────────────────────────────────────

export const dsrRouter = new Hono<Env>();

// Pre-flight auth header check — must precede requireAuth() so that requests
// missing both Authorization and x-api-key are rejected as 401 before any
// body parsing occurs. This prevents leaking validation 400s on unauthenticated
// requests.
// SOC2 CC6.1 — Reject unauthenticated requests at the perimeter.
dsrRouter.use('*', async (c, next) => {
  const hasAuth =
    c.req.header('authorization') !== undefined || c.req.header('x-api-key') !== undefined;
  if (!hasAuth) {
    const reqId = c.get('requestId');
    const err = new AuthenticationError('Authentication required', reqId);
    return c.json(err.toSafeResponse(), 401);
  }
  await next();
});

dsrRouter.use('*', requireAuth());

// ── POST / — create DSR ───────────────────────────────────────────

dsrRouter.post('/', rateLimit('bulk'), requirePermissionMiddleware('dsr', 'write'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json();
  const parsed = createDsrSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid request body', parseZodErrors(parsed.error), requestId);
  }

  const { customerId, type, reason } = parsed.data;
  const deadlineAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let dsr: DsrRecord;
  try {
    dsr = await d.createDsr({
      tenantId: ctx.tenantId,
      customerId,
      type,
      reason,
      requestedBy: ctx.userId,
      deadlineAt,
    });
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'DSR_CONFLICT') {
      return c.json(
        { error: 'conflict', message: 'An open DSR already exists for this customer and type.' },
        409,
      );
    }
    throw err;
  }

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'dsr.requested',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'data_subject_request',
    resourceId: dsr.id,
    action: 'created',
    details: { dsr_type: type },
    timestamp: new Date(),
  });

  return c.json(
    {
      id: dsr.id,
      customerId: dsr.customerId,
      type: dsr.type,
      status: dsr.status,
      deadline_at: dsr.deadlineAt,
    },
    201,
  );
});

// ── GET / — list DSRs ─────────────────────────────────────────────

dsrRouter.get('/', requirePermissionMiddleware('dsr', 'read'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const qParsed = listDsrQuerySchema.safeParse({
    status: c.req.query('status'),
    type: c.req.query('type'),
    page: c.req.query('page'),
    limit: c.req.query('limit'),
  });
  if (!qParsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(qParsed.error), requestId);
  }

  const result = await d.listDsrs({
    tenantId: ctx.tenantId,
    ...(qParsed.data.status !== undefined ? { status: qParsed.data.status } : {}),
    ...(qParsed.data.type !== undefined ? { type: qParsed.data.type } : {}),
    page: qParsed.data.page,
    limit: qParsed.data.limit,
  });

  return c.json(result, 200);
});

// ── GET /:id — DSR detail ─────────────────────────────────────────

dsrRouter.get('/:id', requirePermissionMiddleware('dsr', 'read'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const dsrId = c.req.param('id');

  const found = await d.getDsr({ tenantId: ctx.tenantId, dsrId });
  if (!found) throw new NotFoundError('DSR not found');

  const { dsr, export: exp } = found;

  if (dsr.status === 'completed' && exp !== null) {
    if (new Date(exp.expiresAt) < new Date()) {
      return c.json(
        { error: 'export_expired', message: 'Export has expired and the file has been deleted.' },
        410,
      );
    }
    if (exp.downloadUrl === undefined || exp.downloadUrl === '') {
      console.error(
        `[ORDR:API:DSR] downloadUrl not generated for DSR ${dsrId} (correlationId=${c.get('requestId')})`,
      );
      return c.json(
        {
          error: 'internal_error',
          message: 'Could not generate download URL.',
          correlationId: c.get('requestId'),
        },
        500 as never,
      );
    }
    return c.json(
      {
        ...dsr,
        export: {
          download_url: exp.downloadUrl,
          expires_at: exp.expiresAt,
          file_size_bytes: exp.fileSizeBytes,
          checksum_sha256: exp.checksumSha256,
        },
      },
      200,
    );
  }

  return c.json(dsr, 200);
});

// ── POST /:id/approve ─────────────────────────────────────────────

dsrRouter.post('/:id/approve', requirePermissionMiddleware('dsr', 'write'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const dsrId = c.req.param('id');

  let updated: DsrRecord;
  try {
    updated = await d.approveDsr({ tenantId: ctx.tenantId, dsrId });
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const safeMessage =
      code === 'DSR_STATE_ERROR'
        ? 'DSR is not in a valid state for this operation.'
        : code === 'DSR_NOT_FOUND'
          ? 'DSR not found.'
          : 'An unexpected error occurred.';
    return c.json(
      { error: 'state_error', message: safeMessage, correlationId: c.get('requestId') },
      dsrErrorStatus(code),
    );
  }

  // Publish Kafka — idempotency key = dsrId
  await d.publishApproved({
    dsrId: updated.id,
    tenantId: ctx.tenantId,
    customerId: updated.customerId,
    type: updated.type,
  });

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'dsr.approved',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'data_subject_request',
    resourceId: dsrId,
    action: 'approved',
    details: { dsr_type: updated.type },
    timestamp: new Date(),
  });

  return c.json({ id: updated.id, status: updated.status }, 200);
});

// ── POST /:id/reject ──────────────────────────────────────────────

dsrRouter.post('/:id/reject', requirePermissionMiddleware('dsr', 'write'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const dsrId = c.req.param('id');
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json();
  const parsed = rejectDsrSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('reason is required', parseZodErrors(parsed.error), requestId);
  }

  let updated: DsrRecord;
  try {
    updated = await d.rejectDsr({
      tenantId: ctx.tenantId,
      dsrId,
      rejectionReason: parsed.data.reason,
    });
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const safeMessage =
      code === 'DSR_STATE_ERROR'
        ? 'DSR is not in a valid state for this operation.'
        : code === 'DSR_NOT_FOUND'
          ? 'DSR not found.'
          : 'An unexpected error occurred.';
    return c.json(
      { error: 'state_error', message: safeMessage, correlationId: c.get('requestId') },
      dsrErrorStatus(code),
    );
  }

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'dsr.rejected',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'data_subject_request',
    resourceId: dsrId,
    action: 'rejected',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ id: updated.id, status: updated.status }, 200);
});

// ── DELETE /:id — cancel DSR ──────────────────────────────────────

dsrRouter.delete('/:id', requirePermissionMiddleware('dsr', 'write'), async (c) => {
  const d = ensureDeps();
  const ctx = ensureTenantContext(c);
  const dsrId = c.req.param('id');

  let updated: DsrRecord;
  try {
    updated = await d.cancelDsr({ tenantId: ctx.tenantId, dsrId });
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const safeMessage =
      code === 'DSR_STATE_ERROR'
        ? 'DSR is not in a valid state for this operation.'
        : code === 'DSR_NOT_FOUND'
          ? 'DSR not found.'
          : 'An unexpected error occurred.';
    return c.json(
      { error: 'state_error', message: safeMessage, correlationId: c.get('requestId') },
      dsrErrorStatus(code),
    );
  }

  await d.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'dsr.cancelled',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'data_subject_request',
    resourceId: dsrId,
    action: 'cancelled',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ id: updated.id, status: updated.status }, 200);
});
