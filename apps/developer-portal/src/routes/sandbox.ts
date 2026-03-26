/**
 * Sandbox Routes — isolated sandbox tenant management for developers
 *
 * SOC2 CC6.1 — Access control: sandbox tenants fully isolated via RLS.
 * ISO 27001 A.8.1.3 — Acceptable use of assets: sandboxes expire after 72h.
 * HIPAA §164.312(a)(1) — Access control: no cross-tenant data access.
 *
 * SECURITY:
 * - Sandbox tenants are fully isolated via existing RLS policies
 * - Max 1 active sandbox per developer (prevents resource abuse)
 * - 72-hour TTL with automatic expiration
 * - All sandbox actions are audit-logged (Rule 3)
 * - Sandbox data uses synthetic seed profiles (no real PHI)
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import {
  ValidationError,
  ConflictError,
  NotFoundError,
  AuthenticationError,
} from '@ordr/core';
import type { Env, DeveloperContext } from '../types.js';
import { requireApiKey } from '../middleware/api-key-auth.js';

// ---- Input Schemas ----------------------------------------------------------

const createSandboxSchema = z.object({
  seedDataProfile: z.enum(['minimal', 'collections', 'healthcare']).default('minimal'),
});

// ---- Types ------------------------------------------------------------------

interface SandboxRecord {
  readonly id: string;
  readonly developerId: string;
  readonly tenantId: string;
  readonly expiresAt: Date;
  readonly status: 'active' | 'expired' | 'destroyed';
  readonly createdAt: Date;
  readonly seedDataProfile: 'minimal' | 'collections' | 'healthcare';
}

interface SandboxDependencies {
  readonly auditLogger: AuditLogger;
  readonly findActiveSandbox: (developerId: string) => Promise<SandboxRecord | null>;
  readonly findSandboxById: (sandboxId: string, developerId: string) => Promise<SandboxRecord | null>;
  readonly createSandbox: (data: {
    readonly developerId: string;
    readonly tenantId: string;
    readonly expiresAt: Date;
    readonly seedDataProfile: 'minimal' | 'collections' | 'healthcare';
  }) => Promise<SandboxRecord>;
  readonly destroySandbox: (sandboxId: string) => Promise<void>;
  readonly resetSandbox: (sandboxId: string, seedDataProfile: 'minimal' | 'collections' | 'healthcare') => Promise<SandboxRecord>;
}

let deps: SandboxDependencies | null = null;

export function configureSandboxRoutes(dependencies: SandboxDependencies): void {
  deps = dependencies;
}

// ---- Constants --------------------------------------------------------------

const SANDBOX_TTL_HOURS = 72;

// ---- Helpers ----------------------------------------------------------------

function ensureDeveloperContext(c: {
  get(key: 'developerContext'): DeveloperContext | undefined;
  get(key: 'requestId'): string;
}): DeveloperContext {
  const ctx = c.get('developerContext');
  if (!ctx) {
    throw new AuthenticationError('Developer authentication required');
  }
  return ctx;
}

function isSandboxExpired(sandbox: SandboxRecord): boolean {
  return sandbox.status === 'expired' || sandbox.expiresAt.getTime() < Date.now();
}

// ---- Router -----------------------------------------------------------------

const sandboxRouter = new Hono<Env>();

// All sandbox routes require API key authentication
sandboxRouter.use('*', requireApiKey());

// ── POST /v1/sandbox — provision new sandbox ─────────────────────────────

sandboxRouter.post('/', async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Sandbox routes not configured');

  const ctx = ensureDeveloperContext(c);
  const requestId = c.get('requestId') ?? 'unknown';

  // Validate input
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSandboxSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) {
        existing.push(issue.message);
      } else {
        fieldErrors[field] = [issue.message];
      }
    }
    throw new ValidationError('Invalid sandbox request', fieldErrors, requestId);
  }

  // Check if developer already has an active sandbox
  const existingSandbox = await deps.findActiveSandbox(ctx.developerId);
  if (existingSandbox && !isSandboxExpired(existingSandbox)) {
    throw new ConflictError(
      'Developer already has an active sandbox. Destroy the existing one first.',
      requestId,
    );
  }

  // Generate sandbox tenant ID
  const tenantId = `sandbox_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  // Calculate expiration (72h TTL)
  const expiresAt = new Date(Date.now() + SANDBOX_TTL_HOURS * 60 * 60 * 1000);

  // Create sandbox
  const sandbox = await deps.createSandbox({
    developerId: ctx.developerId,
    tenantId,
    expiresAt,
    seedDataProfile: parsed.data.seedDataProfile,
  });

  // Audit log
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.created',
    actorType: 'user',
    actorId: ctx.developerId,
    resource: 'sandbox_tenants',
    resourceId: sandbox.id,
    action: 'provision',
    details: {
      sandboxTenantId: tenantId,
      seedDataProfile: parsed.data.seedDataProfile,
      expiresAt: expiresAt.toISOString(),
    },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: sandbox.id,
        tenantId: sandbox.tenantId,
        status: sandbox.status,
        seedDataProfile: sandbox.seedDataProfile,
        expiresAt: sandbox.expiresAt.toISOString(),
        createdAt: sandbox.createdAt.toISOString(),
      },
    },
    201,
  );
});

// ── GET /v1/sandbox — get current sandbox status ─────────────────────────

sandboxRouter.get('/', async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Sandbox routes not configured');

  const ctx = ensureDeveloperContext(c);
  const requestId = c.get('requestId') ?? 'unknown';

  const sandbox = await deps.findActiveSandbox(ctx.developerId);
  if (!sandbox) {
    throw new NotFoundError('No active sandbox found', requestId);
  }

  const expired = isSandboxExpired(sandbox);

  return c.json({
    success: true as const,
    data: {
      id: sandbox.id,
      tenantId: sandbox.tenantId,
      status: expired ? ('expired' as const) : sandbox.status,
      seedDataProfile: sandbox.seedDataProfile,
      expiresAt: sandbox.expiresAt.toISOString(),
      createdAt: sandbox.createdAt.toISOString(),
      isExpired: expired,
    },
  });
});

// ── DELETE /v1/sandbox — destroy sandbox immediately ─────────────────────

sandboxRouter.delete('/', async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Sandbox routes not configured');

  const ctx = ensureDeveloperContext(c);
  const requestId = c.get('requestId') ?? 'unknown';

  const sandbox = await deps.findActiveSandbox(ctx.developerId);
  if (!sandbox) {
    throw new NotFoundError('No active sandbox found', requestId);
  }

  await deps.destroySandbox(sandbox.id);

  // Audit log
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.deleted',
    actorType: 'user',
    actorId: ctx.developerId,
    resource: 'sandbox_tenants',
    resourceId: sandbox.id,
    action: 'destroy',
    details: { sandboxTenantId: sandbox.tenantId },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      message: 'Sandbox destroyed successfully',
    },
  });
});

// ── POST /v1/sandbox/reset — reset sandbox data ─────────────────────────

sandboxRouter.post('/reset', async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Sandbox routes not configured');

  const ctx = ensureDeveloperContext(c);
  const requestId = c.get('requestId') ?? 'unknown';

  const sandbox = await deps.findActiveSandbox(ctx.developerId);
  if (!sandbox) {
    throw new NotFoundError('No active sandbox found', requestId);
  }

  if (isSandboxExpired(sandbox)) {
    throw new NotFoundError('Sandbox has expired. Provision a new one.', requestId);
  }

  const reset = await deps.resetSandbox(sandbox.id, sandbox.seedDataProfile);

  // Audit log
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.updated',
    actorType: 'user',
    actorId: ctx.developerId,
    resource: 'sandbox_tenants',
    resourceId: sandbox.id,
    action: 'reset',
    details: { seedDataProfile: sandbox.seedDataProfile },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      id: reset.id,
      tenantId: reset.tenantId,
      status: reset.status,
      seedDataProfile: reset.seedDataProfile,
      expiresAt: reset.expiresAt.toISOString(),
      message: 'Sandbox data reset to initial seed state',
    },
  });
});

export { sandboxRouter };
