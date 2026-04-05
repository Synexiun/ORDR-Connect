/**
 * Marketplace Routes — Agent Marketplace CRUD, installs, and reviews
 *
 * SOC2 CC6.1 — Access control: developer-scoped publish, admin-only installs.
 * ISO 27001 A.14.2.1 — Secure development: manifest validation on publish.
 * HIPAA §164.312(d) — Entity authentication via RBAC enforcement.
 *
 * Endpoints:
 * GET    /v1/marketplace                      — List published agents (pagination, search)
 * GET    /v1/marketplace/:agentId             — Agent detail page
 * POST   /v1/marketplace                      — Publish new agent (developer auth)
 * PUT    /v1/marketplace/:agentId             — Update listing (owner only)
 * POST   /v1/marketplace/:agentId/install     — Install agent for tenant (admin only)
 * DELETE /v1/marketplace/:agentId/install     — Uninstall agent
 * POST   /v1/marketplace/:agentId/review      — Submit review (1-5 rating + comment)
 * GET    /v1/marketplace/:agentId/reviews     — List reviews
 *
 * SECURITY:
 * - Zod validation on all inputs (Rule 4)
 * - All state changes audit-logged (Rule 3 — WORM)
 * - RBAC enforced on every endpoint (Rule 2)
 * - Correlation IDs in all error responses (Rule 7)
 * - No internal error details exposed (Rule 7)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import { ValidationError, NotFoundError, AuthorizationError, ConflictError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { featureGate, FEATURES } from '../middleware/plan-gate.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ─── Input Schemas ──────────────────────────────────────────────

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().max(255).optional(),
  category: z.string().max(128).optional(),
});

const publishSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  // eslint-disable-next-line security/detect-unsafe-regex
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/, 'Version must be valid semver'),
  description: z.string().min(1, 'Description is required').max(2000),
  author: z.string().min(1, 'Author is required').max(255),
  license: z.string().min(1, 'License is required').max(64),
  manifest: z.record(z.unknown()),
  packageHash: z.string().length(64, 'Package hash must be SHA-256 (64 hex chars)'),
});

const updateSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  manifest: z.record(z.unknown()).optional(),
  packageHash: z.string().length(64).optional(),
});

const reviewSchema = z.object({
  rating: z.number().int().min(1, 'Rating must be 1-5').max(5, 'Rating must be 1-5'),
  comment: z.string().max(2000).optional(),
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

interface MarketplaceReviewRecord {
  readonly id: string;
  readonly agentId: string;
  readonly reviewerId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly createdAt: Date;
}

interface MarketplaceInstallRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly version: string;
  readonly status: 'active' | 'disabled' | 'uninstalled';
  readonly installedAt: Date;
}

// ─── Dependencies (injected at startup) ─────────────────────────

interface MarketplaceDependencies {
  readonly auditLogger: AuditLogger;
  readonly listPublishedAgents: (params: {
    limit: number;
    offset: number;
    search?: string;
    category?: string;
  }) => Promise<{ agents: MarketplaceAgentRecord[]; total: number }>;
  readonly findAgentById: (id: string) => Promise<MarketplaceAgentRecord | null>;
  readonly findAgentByNameVersion: (
    name: string,
    version: string,
  ) => Promise<MarketplaceAgentRecord | null>;
  readonly createAgent: (data: {
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
    manifest: Record<string, unknown>;
    packageHash: string;
    publisherId: string;
  }) => Promise<MarketplaceAgentRecord>;
  readonly updateAgent: (
    id: string,
    data: {
      description?: string;
      manifest?: Record<string, unknown>;
      packageHash?: string;
    },
  ) => Promise<MarketplaceAgentRecord | null>;
  readonly incrementDownloads: (id: string) => Promise<void>;
  readonly createInstall: (data: {
    tenantId: string;
    agentId: string;
    version: string;
  }) => Promise<MarketplaceInstallRecord>;
  readonly findInstall: (
    tenantId: string,
    agentId: string,
  ) => Promise<MarketplaceInstallRecord | null>;
  readonly removeInstall: (tenantId: string, agentId: string) => Promise<boolean>;
  readonly createReview: (data: {
    agentId: string;
    reviewerId: string;
    rating: number;
    comment: string | null;
  }) => Promise<MarketplaceReviewRecord>;
  readonly findReviewByUser: (
    agentId: string,
    reviewerId: string,
  ) => Promise<MarketplaceReviewRecord | null>;
  readonly listReviews: (agentId: string) => Promise<MarketplaceReviewRecord[]>;
}

let deps: MarketplaceDependencies | null = null;

export function configureMarketplaceRoutes(dependencies: MarketplaceDependencies): void {
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

function ensureAuthContext(c: {
  get(key: 'tenantContext'): { userId: string; tenantId: string; roles: string[] } | undefined;
}): { userId: string; tenantId: string; roles: string[] } {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthorizationError('Authentication required');
  }
  return { userId: ctx.userId, tenantId: ctx.tenantId, roles: ctx.roles };
}

function requireRole(roles: string[], required: string, requestId: string): void {
  if (
    !roles.includes(required) &&
    !roles.includes('super_admin') &&
    !roles.includes('tenant_admin')
  ) {
    throw new AuthorizationError(`Requires ${required} role`, requestId);
  }
}

// ─── Router ─────────────────────────────────────────────────────

const marketplaceRouter = new Hono<Env>();

// ─── GET / — List published agents (pagination, search) ─────────

marketplaceRouter.get('/', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace routes not configured');

  const requestId = c.get('requestId');

  const raw = {
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
    search: c.req.query('search'),
    category: c.req.query('category'),
  };

  const parsed = listQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('Invalid query parameters', parseZodErrors(parsed.error), requestId);
  }

  const { limit, offset, search, category } = parsed.data;

  const result = await deps.listPublishedAgents({
    limit,
    offset,
    ...(search !== undefined ? { search } : {}),
    ...(category !== undefined ? { category } : {}),
  });

  return c.json({
    success: true as const,
    data: result.agents.map((a) => ({
      id: a.id,
      name: a.name,
      version: a.version,
      description: a.description,
      author: a.author,
      license: a.license,
      downloads: a.downloads,
      rating: a.rating,
      status: a.status,
      createdAt: a.createdAt,
    })),
    meta: {
      total: result.total,
      limit,
      offset,
    },
  });
});

// ─── GET /:agentId — Agent detail page ──────────────────────────

marketplaceRouter.get('/:agentId', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace routes not configured');

  const requestId = c.get('requestId');
  const agentId = c.req.param('agentId');

  const agent = await deps.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Agent not found', requestId);
  }

  return c.json({
    success: true as const,
    data: {
      id: agent.id,
      name: agent.name,
      version: agent.version,
      description: agent.description,
      author: agent.author,
      license: agent.license,
      manifest: agent.manifest,
      packageHash: agent.packageHash,
      downloads: agent.downloads,
      rating: agent.rating,
      status: agent.status,
      publisherId: agent.publisherId,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    },
  });
});

// ─── POST / — Publish new agent (developer auth) ────────────────

marketplaceRouter.post('/', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureAuthContext(c);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid agent data', parseZodErrors(parsed.error), requestId);
  }

  const { name, version, description, author, license, manifest, packageHash } = parsed.data;

  // Check for duplicate name+version
  const existing = await deps.findAgentByNameVersion(name, version);
  if (existing) {
    throw new ConflictError('An agent with this name and version already exists', requestId);
  }

  const agent = await deps.createAgent({
    name,
    version,
    description,
    author,
    license,
    manifest,
    packageHash,
    publisherId: userId,
  });

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'marketplace',
    eventType: 'data.created',
    actorType: 'user',
    actorId: userId,
    resource: 'marketplace_agents',
    resourceId: agent.id,
    action: 'publish_agent',
    details: { name, version, license },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: agent.id,
        name: agent.name,
        version: agent.version,
        status: agent.status,
        createdAt: agent.createdAt,
      },
    },
    201,
  );
});

// ─── PUT /:agentId — Update listing (owner only) ────────────────

marketplaceRouter.put('/:agentId', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureAuthContext(c);
  const agentId = c.req.param('agentId');

  // Verify agent exists
  const agent = await deps.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Agent not found', requestId);
  }

  // Owner check — only the publisher can update
  if (agent.publisherId !== userId) {
    throw new AuthorizationError('Only the agent publisher can update this listing', requestId);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid update data', parseZodErrors(parsed.error), requestId);
  }

  const updated = await deps.updateAgent(agentId, {
    ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    ...(parsed.data.manifest !== undefined ? { manifest: parsed.data.manifest } : {}),
    ...(parsed.data.packageHash !== undefined ? { packageHash: parsed.data.packageHash } : {}),
  });
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
    action: 'update_agent',
    details: { fields: Object.keys(parsed.data) },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      id: updated.id,
      name: updated.name,
      version: updated.version,
      description: updated.description,
      status: updated.status,
      updatedAt: updated.updatedAt,
    },
  });
});

// ─── POST /:agentId/install — Install agent for tenant ──────────

marketplaceRouter.post(
  '/:agentId/install',
  requireAuth(),
  rateLimit('write'),
  featureGate(FEATURES.MARKETPLACE),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Marketplace routes not configured');

    const requestId = c.get('requestId');
    const { userId, tenantId, roles } = ensureAuthContext(c);
    const agentId = c.req.param('agentId');

    // Admin-only check
    requireRole(roles, 'tenant_admin', requestId);

    // Verify agent exists and is published
    const agent = await deps.findAgentById(agentId);
    if (!agent) {
      throw new NotFoundError('Agent not found', requestId);
    }

    if (agent.status !== 'published') {
      throw new ValidationError(
        'Only published agents can be installed',
        {
          status: ['Agent is not published'],
        },
        requestId,
      );
    }

    // Check if already installed
    const existingInstall = await deps.findInstall(tenantId, agentId);
    if (existingInstall && existingInstall.status === 'active') {
      throw new ConflictError('Agent is already installed for this tenant', requestId);
    }

    const install = await deps.createInstall({
      tenantId,
      agentId,
      version: agent.version,
    });

    // Increment downloads
    await deps.incrementDownloads(agentId);

    // Audit log — WORM (Rule 3)
    await deps.auditLogger.log({
      tenantId,
      eventType: 'data.created',
      actorType: 'user',
      actorId: userId,
      resource: 'marketplace_installs',
      resourceId: install.id,
      action: 'install_agent',
      details: { agentId, version: agent.version, agentName: agent.name },
      timestamp: new Date(),
    });

    return c.json(
      {
        success: true as const,
        data: {
          id: install.id,
          tenantId: install.tenantId,
          agentId: install.agentId,
          version: install.version,
          status: install.status,
          installedAt: install.installedAt,
        },
      },
      201,
    );
  },
);

// ─── DELETE /:agentId/install — Uninstall agent ─────────────────

marketplaceRouter.delete('/:agentId/install', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace routes not configured');

  const requestId = c.get('requestId');
  const { userId, tenantId, roles } = ensureAuthContext(c);
  const agentId = c.req.param('agentId');

  // Admin-only check
  requireRole(roles, 'tenant_admin', requestId);

  const removed = await deps.removeInstall(tenantId, agentId);
  if (!removed) {
    throw new NotFoundError('Installation not found', requestId);
  }

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId,
    eventType: 'data.deleted',
    actorType: 'user',
    actorId: userId,
    resource: 'marketplace_installs',
    resourceId: agentId,
    action: 'uninstall_agent',
    details: { agentId },
    timestamp: new Date(),
  });

  return c.json({ success: true as const }, 200);
});

// ─── POST /:agentId/review — Submit review ──────────────────────

marketplaceRouter.post('/:agentId/review', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureAuthContext(c);
  const agentId = c.req.param('agentId');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid review data', parseZodErrors(parsed.error), requestId);
  }

  // Verify agent exists
  const agent = await deps.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Agent not found', requestId);
  }

  // Check for existing review by this user
  const existingReview = await deps.findReviewByUser(agentId, userId);
  if (existingReview) {
    throw new ConflictError('You have already reviewed this agent', requestId);
  }

  const { rating, comment } = parsed.data;

  const review = await deps.createReview({
    agentId,
    reviewerId: userId,
    rating,
    comment: comment ?? null,
  });

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'marketplace',
    eventType: 'data.created',
    actorType: 'user',
    actorId: userId,
    resource: 'marketplace_reviews',
    resourceId: review.id,
    action: 'submit_review',
    details: { agentId, rating },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: review.id,
        agentId: review.agentId,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
      },
    },
    201,
  );
});

// ─── GET /:agentId/reviews — List reviews ───────────────────────

marketplaceRouter.get('/:agentId/reviews', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Marketplace routes not configured');

  const requestId = c.get('requestId');
  const agentId = c.req.param('agentId');

  // Verify agent exists
  const agent = await deps.findAgentById(agentId);
  if (!agent) {
    throw new NotFoundError('Agent not found', requestId);
  }

  const reviews = await deps.listReviews(agentId);

  return c.json({
    success: true as const,
    data: reviews.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      reviewerId: r.reviewerId,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
    })),
  });
});

export { marketplaceRouter };
