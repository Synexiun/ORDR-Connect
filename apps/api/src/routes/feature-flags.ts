/**
 * Feature Flag Routes — per-tenant runtime feature gating
 *
 * GET    /v1/feature-flags         — List all flags for tenant
 * POST   /v1/feature-flags         — Create a new flag (admin)
 * PUT    /v1/feature-flags/:name   — Update flag (admin)
 * DELETE /v1/feature-flags/:name   — Delete flag (admin)
 *
 * SOC2 CC6.1  — Tenant-scoped; admin-only writes.
 * ISO 27001 A.14.2.5 — Controlled feature rollout.
 *
 * SECURITY:
 * - tenantId ALWAYS from JWT, never client input (Rule 2)
 * - All write operations are audit-logged (Rule 3)
 * - No secrets/PHI in flag metadata (Rule 5, Rule 6)
 * - Flag names: kebab-case, max 100 chars — no injection vector
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requireRoleMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line security/detect-unsafe-regex -- character classes are disjoint ([a-z0-9] vs '-'), no ReDoS risk
const FLAG_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const createFlagSchema = z.object({
  flagName: z
    .string()
    .min(1)
    .max(100)
    .regex(FLAG_NAME_REGEX, 'Flag name must be kebab-case (e.g., "ai-suggestions")'),
  enabled: z.boolean().default(false),
  rolloutPct: z.number().int().min(0).max(100).default(100),
  description: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).default({}),
});

const updateFlagSchema = z.object({
  enabled: z.boolean().optional(),
  rolloutPct: z.number().int().min(0).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── Dependency Types ──────────────────────────────────────────────────────────

export interface FeatureFlagRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly flagName: string;
  readonly enabled: boolean;
  readonly rolloutPct: number;
  readonly description: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FeatureFlagDeps {
  readonly auditLogger: AuditLogger;
  readonly listFlags: (tenantId: string) => Promise<FeatureFlagRecord[]>;
  readonly getFlag: (tenantId: string, flagName: string) => Promise<FeatureFlagRecord | null>;
  readonly createFlag: (
    tenantId: string,
    data: {
      flagName: string;
      enabled: boolean;
      rolloutPct: number;
      description?: string;
      metadata: Record<string, unknown>;
    },
  ) => Promise<FeatureFlagRecord>;
  readonly updateFlag: (
    tenantId: string,
    flagName: string,
    data: {
      enabled?: boolean;
      rolloutPct?: number;
      description?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<FeatureFlagRecord | null>;
  readonly deleteFlag: (tenantId: string, flagName: string) => Promise<boolean>;
}

// ── Module-level deps ─────────────────────────────────────────────────────────

let deps: FeatureFlagDeps | null = null;

export function configureFeatureFlagRoutes(d: FeatureFlagDeps): void {
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

function zodErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// ── Router ────────────────────────────────────────────────────────────────────

const featureFlagsRouter = new Hono<Env>();

featureFlagsRouter.use('*', requireAuth());

// ── GET / — list flags (any authenticated user) ───────────────────────────────

featureFlagsRouter.get('/', rateLimit('read'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Feature flag routes not configured');
  const ctx = getTenantContext(c);
  const flags = await deps.listFlags(ctx.tenantId);
  return c.json({ success: true as const, data: flags });
});

// ── POST / — create flag (admin only) ─────────────────────────────────────────

featureFlagsRouter.post(
  '/',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Feature flag routes not configured');
    const ctx = getTenantContext(c);
    const requestId = c.get('requestId');

    const body: unknown = await c.req.json().catch(() => null);
    const parsed = createFlagSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid flag data', zodErrors(parsed.error), requestId);
    }

    // Check for duplicate
    const existing = await deps.getFlag(ctx.tenantId, parsed.data.flagName);
    if (existing) {
      throw new ConflictError(`Flag '${parsed.data.flagName}' already exists`, requestId);
    }

    const flag = await deps.createFlag(ctx.tenantId, {
      flagName: parsed.data.flagName,
      enabled: parsed.data.enabled,
      rolloutPct: parsed.data.rolloutPct,
      // exactOptionalPropertyTypes: only include description when present
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      metadata: parsed.data.metadata,
    });

    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'config.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'feature_flags',
      resourceId: flag.id,
      action: 'create_flag',
      details: { flagName: flag.flagName, enabled: flag.enabled },
      timestamp: new Date(),
    });

    return c.json({ success: true as const, data: flag }, 201);
  },
);

// ── PUT /:name — update flag (admin only) ──────────────────────────────────────

featureFlagsRouter.put(
  '/:name',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Feature flag routes not configured');
    const ctx = getTenantContext(c);
    const requestId = c.get('requestId');
    const flagName = c.req.param('name');

    const body: unknown = await c.req.json().catch(() => null);
    const parsed = updateFlagSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid flag update', zodErrors(parsed.error), requestId);
    }

    // exactOptionalPropertyTypes: strip undefined values so absent fields are truly absent
    const updateData: Parameters<typeof deps.updateFlag>[2] = {};
    if (parsed.data.enabled !== undefined) updateData.enabled = parsed.data.enabled;
    if (parsed.data.rolloutPct !== undefined) updateData.rolloutPct = parsed.data.rolloutPct;
    const desc = parsed.data.description;
    if (desc !== undefined) updateData.description = desc;
    if (parsed.data.metadata !== undefined) updateData.metadata = parsed.data.metadata;

    const updated = await deps.updateFlag(ctx.tenantId, flagName, updateData);
    if (!updated) {
      throw new NotFoundError(`Flag '${flagName}' not found`, requestId);
    }

    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'config.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'feature_flags',
      resourceId: updated.id,
      action: 'update_flag',
      details: { flagName, changedFields: Object.keys(parsed.data) },
      timestamp: new Date(),
    });

    return c.json({ success: true as const, data: updated });
  },
);

// ── DELETE /:name — delete flag (admin only) ───────────────────────────────────

featureFlagsRouter.delete(
  '/:name',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Feature flag routes not configured');
    const ctx = getTenantContext(c);
    const requestId = c.get('requestId');
    const flagName = c.req.param('name');

    const flag = await deps.getFlag(ctx.tenantId, flagName);
    if (!flag) {
      throw new NotFoundError(`Flag '${flagName}' not found`, requestId);
    }

    const deleted = await deps.deleteFlag(ctx.tenantId, flagName);
    if (!deleted) {
      throw new NotFoundError(`Flag '${flagName}' not found`, requestId);
    }

    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'config.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'feature_flags',
      resourceId: flag.id,
      action: 'delete_flag',
      details: { flagName },
      timestamp: new Date(),
    });

    return c.json({ success: true as const }, 200);
  },
);

export { featureFlagsRouter };
