// apps/api/src/routes/developer-agents.ts
/**
 * Developer Agent Submission Routes
 *
 * SOC2 CC6.1 — Publisher-scoped: developers only see their own agents.
 * Rule 4 — Manifest validated via @ordr/sdk before any DB write.
 * Rule 9 — checkManifest() is a hard gate: no listing on failure.
 *
 * Endpoints:
 * GET  /v1/developers/agents        — list caller's submitted agents
 * POST /v1/developers/agents/submit — validate manifest + create listing
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { checkManifest } from '@ordr/sdk';
import type { AuditLogger } from '@ordr/audit';
import { ValidationError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Types ──────────────────────────────────────────────────────────

interface AgentListItem {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  readonly installCount: number;
  readonly createdAt: Date;
}

// ─── Input schema ────────────────────────────────────────────────────

const submitSchema = z.object({
  manifest: z.record(z.unknown()),
  packageHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'packageHash must be 64 lowercase hex characters (SHA-256)'),
  description: z.string().min(1, 'Description is required').max(2000),
});

// ─── Dependencies ────────────────────────────────────────────────────

interface AgentDeps {
  readonly auditLogger: AuditLogger;
  readonly listAgentsByPublisher: (publisherId: string) => Promise<AgentListItem[]>;
  readonly createMarketplaceListing: (data: {
    publisherId: string;
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
    manifest: Record<string, unknown>;
    packageHash: string;
  }) => Promise<AgentListItem>;
}

let deps: AgentDeps | null = null;

export function configureAgentRoutes(dependencies: AgentDeps): void {
  deps = dependencies;
}

// ─── Context helper ──────────────────────────────────────────────────

function ensureCtx(c: {
  get(key: 'tenantContext'): { userId: string } | undefined;
  get(key: 'requestId'): string;
}): {
  userId: string;
  requestId: string;
} {
  const ctx = c.get('tenantContext');
  if (!ctx) throw new Error('[ORDR:API] Auth required');
  return { userId: ctx.userId, requestId: c.get('requestId') };
}

// ─── Router ─────────────────────────────────────────────────────────

export const developerAgentsRouter = new Hono<Env>();

// GET /
developerAgentsRouter.get('/', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Agent routes not configured');
  const { userId } = ensureCtx(c);

  const agents = await deps.listAgentsByPublisher(userId);
  return c.json({ success: true as const, data: agents });
});

// POST /submit
developerAgentsRouter.post('/submit', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Agent routes not configured');
  const { userId, requestId } = ensureCtx(c);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid submission data',
      Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.') || 'general', [i.message]]),
      ),
      requestId,
    );
  }

  const { manifest, packageHash, description } = parsed.data;

  // Hard gate: validate manifest via @ordr/sdk (Rule 9)
  // checkManifest returns { valid, errors, warnings } — the shape we consume here.
  const validation = checkManifest(manifest);
  if (!validation.valid) {
    return c.json(
      {
        success: false as const,
        message: 'Manifest validation failed',
        errors: validation.errors,
        warnings: validation.warnings,
        requestId,
      },
      422,
    );
  }

  // Extract required fields from validated manifest
  const mf = manifest as {
    name: string;
    version: string;
    author: string;
    license: string;
  };

  const agent = await deps.createMarketplaceListing({
    publisherId: userId,
    name: mf.name,
    version: mf.version,
    description,
    author: mf.author,
    license: mf.license,
    manifest,
    packageHash,
  });

  // Audit: log IDs and status only — description/manifest excluded (Rule 6)
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.created',
    actorType: 'user',
    actorId: userId,
    resource: 'marketplace_agents',
    resourceId: agent.id,
    action: 'submit_agent',
    details: { status: agent.status },
    timestamp: new Date(),
  });

  return c.json({ success: true as const, data: agent }, 201);
});
