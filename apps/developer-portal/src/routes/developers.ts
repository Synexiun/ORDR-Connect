/**
 * Developer Account Routes — registration, profile, key rotation, usage
 *
 * SOC2 CC6.1 — Access control: API keys are SHA-256 hashed before storage.
 * ISO 27001 A.9.2.4 — Management of secret authentication information.
 * HIPAA §164.312(d) — Person or entity authentication.
 *
 * SECURITY:
 * - Raw API keys are returned ONCE on creation/rotation and NEVER stored
 * - API key hash is stored (SHA-256), prefix retained for identification
 * - All developer actions are audit-logged (Rule 3)
 * - Duplicate emails are rejected (Rule 4)
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import {
  ValidationError,
  ConflictError,
  AuthenticationError,
} from '@ordr/core';
import type { Env, DeveloperContext } from '../types.js';
import { hashApiKey } from '../middleware/api-key-auth.js';
import { requireApiKey } from '../middleware/api-key-auth.js';

// ---- Input Schemas ----------------------------------------------------------

const registerSchema = z.object({
  email: z.string().email().max(255),
  displayName: z.string().min(1).max(255).optional(),
  organization: z.string().max(255).optional(),
});

// ---- Types ------------------------------------------------------------------

interface DeveloperRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly organization: string | null;
  readonly apiKeyPrefix: string;
  readonly tier: 'free' | 'pro' | 'enterprise';
  readonly rateLimitRpm: number;
  readonly sandboxTenantId: string | null;
  readonly createdAt: Date;
  readonly lastActiveAt: Date | null;
  readonly status: 'active' | 'suspended' | 'revoked';
}

interface UsageRecord {
  readonly endpoint: string;
  readonly method: string;
  readonly statusCode: number;
  readonly latencyMs: number;
  readonly timestamp: Date;
}

interface DeveloperDependencies {
  readonly auditLogger: AuditLogger;
  readonly findByEmail: (email: string) => Promise<DeveloperRecord | null>;
  readonly findById: (id: string) => Promise<DeveloperRecord | null>;
  readonly createDeveloper: (data: {
    readonly email: string;
    readonly displayName?: string | undefined;
    readonly organization?: string | undefined;
    readonly apiKeyHash: string;
    readonly apiKeyPrefix: string;
  }) => Promise<DeveloperRecord>;
  readonly updateApiKey: (developerId: string, apiKeyHash: string, apiKeyPrefix: string) => Promise<void>;
  readonly getUsage: (developerId: string, limit: number) => Promise<readonly UsageRecord[]>;
}

let deps: DeveloperDependencies | null = null;

export function configureDeveloperRoutes(dependencies: DeveloperDependencies): void {
  deps = dependencies;
}

// ---- Helpers ----------------------------------------------------------------

function generateApiKey(): string {
  const prefix = 'devk_';
  const random = randomBytes(32).toString('hex');
  return `${prefix}${random}`;
}

function extractPrefix(apiKey: string): string {
  return apiKey.slice(0, 8);
}

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

// ---- Router -----------------------------------------------------------------

const developersRouter = new Hono<Env>();

// ── POST /v1/developers/register — create developer account ──────────────

developersRouter.post('/register', async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Developer routes not configured');

  const requestId = c.get('requestId') ?? 'unknown';

  // Validate input
  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
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
    throw new ValidationError('Invalid registration data', fieldErrors, requestId);
  }

  // Check duplicate email
  const existing = await deps.findByEmail(parsed.data.email);
  if (existing) {
    throw new ConflictError('A developer account with this email already exists', requestId);
  }

  // Generate API key (returned ONCE, stored as SHA-256 hash)
  const rawApiKey = generateApiKey();
  const apiKeyHash = hashApiKey(rawApiKey);
  const apiKeyPrefix = extractPrefix(rawApiKey);

  // Create developer account
  const developer = await deps.createDeveloper({
    email: parsed.data.email,
    displayName: parsed.data.displayName,
    organization: parsed.data.organization,
    apiKeyHash,
    apiKeyPrefix,
  });

  // Audit log
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.created',
    actorType: 'system',
    actorId: developer.id,
    resource: 'developer_accounts',
    resourceId: developer.id,
    action: 'register',
    details: { email: parsed.data.email },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: developer.id,
        email: developer.email,
        displayName: developer.displayName,
        organization: developer.organization,
        apiKey: rawApiKey, // Returned ONCE — never stored
        apiKeyPrefix: developer.apiKeyPrefix,
        tier: developer.tier,
        rateLimitRpm: developer.rateLimitRpm,
        status: developer.status,
        createdAt: developer.createdAt.toISOString(),
      },
    },
    201,
  );
});

// ── GET /v1/developers/me — get developer profile ────────────────────────

developersRouter.get('/me', requireApiKey(), async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Developer routes not configured');

  const ctx = ensureDeveloperContext(c);

  const developer = await deps.findById(ctx.developerId);
  if (!developer) {
    throw new AuthenticationError('Developer account not found');
  }

  return c.json({
    success: true as const,
    data: {
      id: developer.id,
      email: developer.email,
      displayName: developer.displayName,
      organization: developer.organization,
      apiKeyPrefix: developer.apiKeyPrefix,
      tier: developer.tier,
      rateLimitRpm: developer.rateLimitRpm,
      sandboxTenantId: developer.sandboxTenantId,
      createdAt: developer.createdAt.toISOString(),
      lastActiveAt: developer.lastActiveAt?.toISOString() ?? null,
      status: developer.status,
    },
  });
});

// ── POST /v1/developers/rotate-key — rotate API key ─────────────────────

developersRouter.post('/rotate-key', requireApiKey(), async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Developer routes not configured');

  const ctx = ensureDeveloperContext(c);
  const requestId = c.get('requestId') ?? 'unknown';

  // Generate new API key
  const rawApiKey = generateApiKey();
  const apiKeyHash = hashApiKey(rawApiKey);
  const apiKeyPrefix = extractPrefix(rawApiKey);

  // Update in database (old key invalidated immediately)
  await deps.updateApiKey(ctx.developerId, apiKeyHash, apiKeyPrefix);

  // Audit log
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.updated',
    actorType: 'user',
    actorId: ctx.developerId,
    resource: 'developer_accounts',
    resourceId: ctx.developerId,
    action: 'rotate_key',
    details: { newPrefix: apiKeyPrefix },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      apiKey: rawApiKey, // Returned ONCE — never stored
      apiKeyPrefix,
      message: 'API key rotated. Previous key is now invalid.',
    },
  });
});

// ── GET /v1/developers/usage — get usage stats ───────────────────────────

developersRouter.get('/usage', requireApiKey(), async (c) => {
  if (!deps) throw new Error('[ORDR:DEV-PORTAL] Developer routes not configured');

  const ctx = ensureDeveloperContext(c);

  const usage = await deps.getUsage(ctx.developerId, 100);

  return c.json({
    success: true as const,
    data: {
      developerId: ctx.developerId,
      tier: ctx.tier,
      rateLimitRpm: ctx.rateLimitRpm,
      recentRequests: usage.map((u) => ({
        endpoint: u.endpoint,
        method: u.method,
        statusCode: u.statusCode,
        latencyMs: u.latencyMs,
        timestamp: u.timestamp.toISOString(),
      })),
      totalRequests: usage.length,
    },
  });
});

export { developersRouter };
