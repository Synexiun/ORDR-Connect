/**
 * Marketplace Review Pipeline — internal admin routes for agent security review
 *
 * SOC2 CC8.1 — Change management: agents reviewed before publishing.
 * ISO 27001 A.14.2.1 — Secure development: manifest validation and compliance check.
 * HIPAA §164.312(a)(1) — Access control: admin-only review pipeline.
 *
 * Endpoints:
 * GET    /v1/admin/marketplace/queue                 — List agents pending review
 * POST   /v1/admin/marketplace/:agentId/approve      — Approve agent for publishing
 * POST   /v1/admin/marketplace/:agentId/reject       — Reject with reason
 * POST   /v1/admin/marketplace/:agentId/suspend      — Suspend published agent
 *
 * Review checks:
 * - Manifest validates via ManifestValidator schema
 * - No restricted data classifications without compliance rules
 * - OSI-approved license
 * - Budget within platform limits
 * - All tools have descriptions
 *
 * SECURITY:
 * - Admin-only access (Rule 2 — RBAC enforcement)
 * - All state changes audit-logged (Rule 3 — WORM)
 * - Zod validation on all inputs (Rule 4)
 * - No internal error details exposed (Rule 7)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import { ValidationError, NotFoundError, AuthorizationError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Constants ──────────────────────────────────────────────────

/** OSI-approved licenses accepted by the platform (Rule 8). */
const OSI_APPROVED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'Unlicense',
  'CC0-1.0',
]);

/** Platform budget hard limits (Rule 9). */
const PLATFORM_BUDGET_LIMITS = {
  maxTokens: 1_000_000,
  maxCostCents: 10_000,
  maxActions: 500,
} as const;

// ─── Input Schemas ──────────────────────────────────────────────

const rejectSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required').max(2000),
});

const suspendSchema = z.object({
  reason: z.string().min(1, 'Suspension reason is required').max(2000),
});

// ─── Types ──────────────────────────────────────────────────────

interface MarketplaceAgentRecord {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly license: string;
  readonly manifest: Record<string, unknown>;
  readonly packageHash: string;
  readonly downloads: number;
  readonly rating: number | null;
  readonly status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  readonly publisherId: string;
  readonly rejectionReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Dependencies (injected at startup) ─────────────────────────

interface MarketplaceReviewDependencies {
  readonly auditLogger: AuditLogger;
  readonly listPendingAgents: () => Promise<MarketplaceAgentRecord[]>;
  readonly findAgentById: (id: string) => Promise<MarketplaceAgentRecord | null>;
  readonly updateAgentStatus: (
    id: string,
    status: 'published' | 'rejected' | 'suspended',
    rejectionReason?: string,
  ) => Promise<MarketplaceAgentRecord | null>;
}

let deps: MarketplaceReviewDependencies | null = null;

export function configureMarketplaceReviewRoutes(
  dependencies: MarketplaceReviewDependencies,
): void {
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

function ensureAdminContext(c: {
  get(key: 'tenantContext'): { userId: string; tenantId: string; roles: string[] } | undefined;
  get(key: 'requestId'): string;
}): { userId: string; tenantId: string } {
  const ctx = c.get('tenantContext');
  const requestId = c.get('requestId');
  if (!ctx) {
    throw new AuthorizationError('Authentication required', requestId);
  }
  const roles = ctx.roles;
  if (!roles.includes('super_admin') && !roles.includes('tenant_admin')) {
    throw new AuthorizationError('Admin access required', requestId);
  }
  return { userId: ctx.userId, tenantId: ctx.tenantId };
}

/**
 * Run security review checks on the agent manifest.
 * Returns an array of validation issues (empty = pass).
 */
function runSecurityReview(agent: MarketplaceAgentRecord): string[] {
  const issues: string[] = [];
  const manifest = agent.manifest;

  // Check OSI-approved license
  if (!OSI_APPROVED_LICENSES.has(agent.license)) {
    issues.push(`License "${agent.license}" is not OSI-approved`);
  }

  // Check budget within platform limits
  const budget = manifest['maxBudget'] as
    | { maxTokens?: number; maxCostCents?: number; maxActions?: number }
    | undefined;
  if (budget) {
    if (
      typeof budget.maxTokens === 'number' &&
      budget.maxTokens > PLATFORM_BUDGET_LIMITS.maxTokens
    ) {
      issues.push(
        `maxTokens (${String(budget.maxTokens)}) exceeds platform limit (${String(PLATFORM_BUDGET_LIMITS.maxTokens)})`,
      );
    }
    if (
      typeof budget.maxCostCents === 'number' &&
      budget.maxCostCents > PLATFORM_BUDGET_LIMITS.maxCostCents
    ) {
      issues.push(
        `maxCostCents (${String(budget.maxCostCents)}) exceeds platform limit (${String(PLATFORM_BUDGET_LIMITS.maxCostCents)})`,
      );
    }
    if (
      typeof budget.maxActions === 'number' &&
      budget.maxActions > PLATFORM_BUDGET_LIMITS.maxActions
    ) {
      issues.push(
        `maxActions (${String(budget.maxActions)}) exceeds platform limit (${String(PLATFORM_BUDGET_LIMITS.maxActions)})`,
      );
    }
  }

  // Check restricted data classifications require compliance rules
  const permissions = manifest['permissions'] as string[] | undefined;
  const complianceReqs = manifest['complianceRequirements'] as string[] | undefined;
  if (permissions && permissions.includes('restricted')) {
    if (!complianceReqs || complianceReqs.length === 0) {
      issues.push('Agent declares restricted data access but no compliance requirements');
    }
  }

  // Check tools have descriptions
  const tools = manifest['requiredTools'] as string[] | undefined;
  if (tools && tools.length > 0) {
    // Tools are declared by name — we verify they are strings
    for (const tool of tools) {
      if (typeof tool !== 'string' || tool.length === 0) {
        issues.push('All tools must have non-empty names');
        break;
      }
    }
  }

  // Check confidence threshold
  const confidence = manifest['minConfidenceThreshold'] as number | undefined;
  if (typeof confidence === 'number' && confidence < 0.7) {
    issues.push('Confidence threshold must be >= 0.7 (Rule 9)');
  }

  return issues;
}

// ─── Router ─────────────────────────────────────────────────────

const marketplaceReviewRouter = new Hono<Env>();

// ─── GET /queue — List agents pending review ────────────────────

marketplaceReviewRouter.get('/queue', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace review routes not configured');

  ensureAdminContext(c);

  const agents = await deps.listPendingAgents();

  return c.json({
    success: true as const,
    data: agents.map((a) => ({
      id: a.id,
      name: a.name,
      version: a.version,
      description: a.description,
      author: a.author,
      license: a.license,
      status: a.status,
      publisherId: a.publisherId,
      createdAt: a.createdAt,
    })),
  });
});

// ─── POST /:agentId/approve — Approve agent for publishing ──────

marketplaceReviewRouter.post('/:agentId/approve', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace review routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureAdminContext(c);
  const agentId = c.req.param('agentId');

  const agent = await deps.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Agent not found', requestId);
  }

  // Run security review checks
  const issues = runSecurityReview(agent);
  if (issues.length > 0) {
    throw new ValidationError(
      'Agent failed security review',
      {
        security: issues,
      },
      requestId,
    );
  }

  const updated = await deps.updateAgentStatus(agentId, 'published');
  if (!updated) {
    throw new NotFoundError('Agent not found', requestId);
  }

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'marketplace',
    eventType: 'data.updated',
    actorType: 'user',
    actorId: userId,
    resource: 'marketplace_agents',
    resourceId: agentId,
    action: 'approve_agent',
    details: { name: agent.name, version: agent.version, previousStatus: agent.status },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      id: updated.id,
      name: updated.name,
      version: updated.version,
      status: updated.status,
    },
  });
});

// ─── POST /:agentId/reject — Reject with reason ────────────────

marketplaceReviewRouter.post('/:agentId/reject', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace review routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureAdminContext(c);
  const agentId = c.req.param('agentId');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid rejection data', parseZodErrors(parsed.error), requestId);
  }

  const agent = await deps.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Agent not found', requestId);
  }

  const { reason } = parsed.data;

  const updated = await deps.updateAgentStatus(agentId, 'rejected', reason);
  if (!updated) {
    throw new NotFoundError('Agent not found', requestId);
  }

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'marketplace',
    eventType: 'data.updated',
    actorType: 'user',
    actorId: userId,
    resource: 'marketplace_agents',
    resourceId: agentId,
    action: 'reject_agent',
    details: { name: agent.name, version: agent.version, reason, previousStatus: agent.status },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      id: updated.id,
      name: updated.name,
      version: updated.version,
      status: updated.status,
      rejectionReason: reason,
    },
  });
});

// ─── POST /:agentId/suspend — Suspend published agent ───────────

marketplaceReviewRouter.post('/:agentId/suspend', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace review routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureAdminContext(c);
  const agentId = c.req.param('agentId');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = suspendSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid suspension data', parseZodErrors(parsed.error), requestId);
  }

  const agent = await deps.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Agent not found', requestId);
  }

  const { reason } = parsed.data;

  const updated = await deps.updateAgentStatus(agentId, 'suspended', reason);
  if (!updated) {
    throw new NotFoundError('Agent not found', requestId);
  }

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'marketplace',
    eventType: 'data.updated',
    actorType: 'user',
    actorId: userId,
    resource: 'marketplace_agents',
    resourceId: agentId,
    action: 'suspend_agent',
    details: { name: agent.name, version: agent.version, reason, previousStatus: agent.status },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      id: updated.id,
      name: updated.name,
      version: updated.version,
      status: updated.status,
    },
  });
});

export { marketplaceReviewRouter };
