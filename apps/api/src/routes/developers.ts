/**
 * Developer Portal Routes — account management, API keys, sandbox provisioning
 *
 * SOC2 CC6.1 — Access control: developer-scoped, tier-enforced.
 * ISO 27001 A.9.4.2 — Secure log-on procedures for developer accounts.
 * HIPAA §164.312(d) — Entity authentication via hashed API keys.
 *
 * Endpoints:
 * POST   /v1/developers/register             — Register new developer account
 * POST   /v1/developers/login                — Authenticate developer (returns JWT)
 * GET    /v1/developers/me                   — Get current developer profile
 * POST   /v1/developers/keys                 — Create new API key (returns raw key ONCE)
 * GET    /v1/developers/keys                 — List API keys (prefix only, NEVER full key)
 * DELETE /v1/developers/keys/:keyId          — Revoke API key
 * POST   /v1/developers/sandbox              — Provision sandbox tenant
 * GET    /v1/developers/sandbox              — List sandbox tenants
 * DELETE /v1/developers/sandbox/:sandboxId   — Destroy sandbox
 *
 * SECURITY:
 * - API keys: SHA-256 hashed before storage (Rule 2 — NEVER store raw keys)
 * - Passwords: Argon2id hashed (Rule 2 — NO bcrypt, NO scrypt)
 * - All state changes audit-logged (Rule 3 — WORM)
 * - Zod validation on all inputs (Rule 4 — injection prevention)
 * - Sandbox limits enforced per tier (Rule 9 — agent safety / bounded resources)
 * - Correlation IDs in all error responses (Rule 7)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { JwtConfig } from '@ordr/auth';
import { createAccessToken, createApiKey } from '@ordr/auth';
import type { AuditLogger } from '@ordr/audit';
import {
  ValidationError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@ordr/core';
import { hashPassword, verifyPassword, randomUUID } from '@ordr/crypto';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';

// ─── Sandbox Tier Limits ────────────────────────────────────────────

const SANDBOX_LIMITS: Record<string, number> = {
  free: 1,
  pro: 5,
  enterprise: 20,
};

// ─── Input Schemas ──────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  name: z.string().min(1, 'Name is required').max(255),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${String(PASSWORD_MIN_LENGTH)} characters`)
    .max(PASSWORD_MAX_LENGTH),
  tier: z.enum(['free', 'pro', 'enterprise']).default('free'),
  organization: z.string().max(255).optional(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${String(PASSWORD_MIN_LENGTH)} characters`)
    .max(PASSWORD_MAX_LENGTH),
});

const createKeySchema = z.object({
  name: z.string().min(1, 'Key name is required').max(255),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const createSandboxSchema = z.object({
  name: z.string().min(1, 'Sandbox name is required').max(255),
  seedProfile: z.enum(['minimal', 'collections', 'healthcare']).default('minimal'),
});

// ─── Types ──────────────────────────────────────────────────────────

interface DeveloperRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly organization: string | null;
  readonly passwordHash: string;
  readonly tier: 'free' | 'pro' | 'enterprise';
  readonly rateLimitRpm: number;
  readonly status: 'active' | 'suspended' | 'revoked';
  readonly createdAt: Date;
  readonly lastActiveAt: Date | null;
}

interface DeveloperKeyRecord {
  readonly id: string;
  readonly developerId: string;
  readonly name: string;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

interface SandboxRecord {
  readonly id: string;
  readonly developerId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly seedDataProfile: string;
  readonly status: 'active' | 'expired' | 'destroyed';
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

// ─── Dependencies (injected at startup) ─────────────────────────────

interface DeveloperDependencies {
  readonly jwtConfig: JwtConfig;
  readonly auditLogger: AuditLogger;
  readonly findDeveloperByEmail: (email: string) => Promise<DeveloperRecord | null>;
  readonly findDeveloperById: (id: string) => Promise<DeveloperRecord | null>;
  readonly createDeveloper: (data: {
    email: string;
    displayName: string;
    organization: string | null;
    passwordHash: string;
    tier: string;
  }) => Promise<DeveloperRecord>;
  readonly createDeveloperKey: (data: {
    developerId: string;
    name: string;
    keyHash: string;
    keyPrefix: string;
    expiresAt: Date | null;
  }) => Promise<DeveloperKeyRecord>;
  readonly listDeveloperKeys: (developerId: string) => Promise<DeveloperKeyRecord[]>;
  readonly findKeyById: (developerId: string, keyId: string) => Promise<DeveloperKeyRecord | null>;
  readonly revokeKey: (developerId: string, keyId: string) => Promise<boolean>;
  readonly createSandbox: (data: {
    developerId: string;
    name: string;
    tenantId: string;
    seedDataProfile: string;
    expiresAt: Date;
  }) => Promise<SandboxRecord>;
  readonly listSandboxes: (developerId: string) => Promise<SandboxRecord[]>;
  readonly findSandboxById: (
    developerId: string,
    sandboxId: string,
  ) => Promise<SandboxRecord | null>;
  readonly destroySandbox: (developerId: string, sandboxId: string) => Promise<boolean>;
}

let deps: DeveloperDependencies | null = null;

export function configureDeveloperRoutes(dependencies: DeveloperDependencies): void {
  deps = dependencies;
}

// ─── Helpers ────────────────────────────────────────────────────────

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

function ensureDeveloperContext(c: {
  get(key: 'tenantContext'): { userId: string; tenantId: string; roles: string[] } | undefined;
  get(key: 'requestId'): string;
}): { userId: string; tenantId: string } {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthorizationError('Developer authentication required');
  }
  return { userId: ctx.userId, tenantId: ctx.tenantId };
}

// ─── Router ─────────────────────────────────────────────────────────

const developersRouter = new Hono<Env>();

// ─── POST /register — Create developer account ─────────────────────

developersRouter.post('/register', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Developer routes not configured');

  const requestId = c.get('requestId');

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid registration data', parseZodErrors(parsed.error), requestId);
  }

  const { email, name, password, tier, organization } = parsed.data;

  // Check for duplicate email
  const existing = await deps.findDeveloperByEmail(email);
  if (existing) {
    throw new ConflictError('Email already registered', requestId);
  }

  // Hash password with Argon2id (Rule 2 — NO bcrypt, NO scrypt)
  const passwordHash = await hashPassword(password);

  // Create developer account
  const developer = await deps.createDeveloper({
    email,
    displayName: name,
    organization: organization ?? null,
    passwordHash,
    tier,
  });

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.created',
    actorType: 'user',
    actorId: developer.id,
    resource: 'developer_accounts',
    resourceId: developer.id,
    action: 'register',
    details: { tier, email },
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
        tier: developer.tier,
        createdAt: developer.createdAt,
      },
    },
    201,
  );
});

// ─── POST /login — Authenticate developer ──────────────────────────

developersRouter.post('/login', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Developer routes not configured');

  const requestId = c.get('requestId');

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid login data', parseZodErrors(parsed.error), requestId);
  }

  const { email, password } = parsed.data;

  // Find developer
  const developer = await deps.findDeveloperByEmail(email);
  if (!developer) {
    throw new AuthenticationError('Invalid email or password', requestId);
  }

  // Check account status
  if (developer.status !== 'active') {
    throw new AuthenticationError('Account is not active', requestId);
  }

  // Verify password (Argon2id)
  const passwordValid = await verifyPassword(password, developer.passwordHash);
  if (!passwordValid) {
    // Audit failed login
    await deps.auditLogger.log({
      tenantId: 'developer-portal',
      eventType: 'auth.failed',
      actorType: 'user',
      actorId: developer.id,
      resource: 'developer_accounts',
      resourceId: developer.id,
      action: 'login',
      details: { reason: 'invalid_password' },
      timestamp: new Date(),
    });
    throw new AuthenticationError('Invalid email or password', requestId);
  }

  // Create JWT for developer
  const accessToken = await createAccessToken(deps.jwtConfig, {
    sub: developer.id,
    tid: 'developer-portal',
    role: 'tenant_admin' as const,
    permissions: [],
  });

  // Audit successful login
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'auth.login',
    actorType: 'user',
    actorId: developer.id,
    resource: 'developer_accounts',
    resourceId: developer.id,
    action: 'login',
    details: { method: 'password' },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      accessToken,
      tokenType: 'Bearer' as const,
      expiresIn: deps.jwtConfig.accessTokenTtl,
    },
  });
});

// ─── GET /me — Get developer profile ───────────────────────────────

developersRouter.get('/me', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Developer routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureDeveloperContext(c);

  const developer = await deps.findDeveloperById(userId);
  if (!developer) {
    throw new NotFoundError('Developer account not found', requestId);
  }

  return c.json({
    success: true as const,
    data: {
      id: developer.id,
      email: developer.email,
      displayName: developer.displayName,
      organization: developer.organization,
      tier: developer.tier,
      rateLimitRpm: developer.rateLimitRpm,
      status: developer.status,
      createdAt: developer.createdAt,
      lastActiveAt: developer.lastActiveAt,
    },
  });
});

// ─── POST /keys — Create API key ───────────────────────────────────

developersRouter.post('/keys', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Developer routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureDeveloperContext(c);

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid key creation data', parseZodErrors(parsed.error), requestId);
  }

  const { name, expiresInDays } = parsed.data;

  // Generate API key — raw key shown ONCE, only hash stored (Rule 2)
  const keyResult = createApiKey(userId, userId, name, []);

  const expiresAt =
    expiresInDays !== undefined ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

  // Store hashed key
  const keyRecord = await deps.createDeveloperKey({
    developerId: userId,
    name,
    keyHash: keyResult.keyHash,
    keyPrefix: keyResult.keyPrefix,
    expiresAt,
  });

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.created',
    actorType: 'user',
    actorId: userId,
    resource: 'developer_api_keys',
    resourceId: keyRecord.id,
    action: 'create_key',
    details: { name, expiresAt: expiresAt?.toISOString() ?? null },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: keyRecord.id,
        name: keyRecord.name,
        // Raw key shown ONCE — client must store it securely
        key: keyResult.key,
        prefix: keyRecord.keyPrefix,
        expiresAt: keyRecord.expiresAt,
        createdAt: keyRecord.createdAt,
      },
    },
    201,
  );
});

// ─── GET /keys — List API keys (prefix only) ───────────────────────

developersRouter.get('/keys', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Developer routes not configured');

  const { userId } = ensureDeveloperContext(c);

  const keys = await deps.listDeveloperKeys(userId);

  // Return prefix only — NEVER return full key or hash (Rule 2)
  const safeKeys = keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.keyPrefix,
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
  }));

  return c.json({
    success: true as const,
    data: safeKeys,
  });
});

// ─── DELETE /keys/:keyId — Revoke API key ──────────────────────────

developersRouter.delete('/keys/:keyId', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Developer routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureDeveloperContext(c);
  const keyId = c.req.param('keyId');

  // Verify key exists and belongs to this developer
  const key = await deps.findKeyById(userId, keyId);
  if (!key) {
    throw new NotFoundError('API key not found', requestId);
  }

  const revoked = await deps.revokeKey(userId, keyId);
  if (!revoked) {
    throw new NotFoundError('API key not found', requestId);
  }

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.deleted',
    actorType: 'user',
    actorId: userId,
    resource: 'developer_api_keys',
    resourceId: keyId,
    action: 'revoke_key',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ success: true as const }, 200);
});

// ─── POST /sandbox — Provision sandbox tenant ──────────────────────

developersRouter.post('/sandbox', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Developer routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureDeveloperContext(c);

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = createSandboxSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid sandbox data', parseZodErrors(parsed.error), requestId);
  }

  // Check developer tier and enforce sandbox limits
  const developer = await deps.findDeveloperById(userId);
  if (!developer) {
    throw new NotFoundError('Developer account not found', requestId);
  }

  const existingSandboxes = await deps.listSandboxes(userId);
  const activeSandboxes = existingSandboxes.filter((s) => s.status === 'active');
  const limit = SANDBOX_LIMITS[developer.tier] ?? 1;

  if (activeSandboxes.length >= limit) {
    throw new ValidationError(
      `Sandbox limit reached for ${developer.tier} tier (max ${String(limit)})`,
      {
        sandbox: [`Maximum ${String(limit)} active sandbox(es) allowed for ${developer.tier} tier`],
      },
      requestId,
    );
  }

  const { name, seedProfile } = parsed.data;
  const tenantId = `sandbox_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const sandbox = await deps.createSandbox({
    developerId: userId,
    name,
    tenantId,
    seedDataProfile: seedProfile,
    expiresAt,
  });

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.created',
    actorType: 'user',
    actorId: userId,
    resource: 'sandbox_tenants',
    resourceId: sandbox.id,
    action: 'provision_sandbox',
    details: { tenantId, seedProfile, name },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: sandbox.id,
        tenantId: sandbox.tenantId,
        name: sandbox.name,
        seedDataProfile: sandbox.seedDataProfile,
        status: sandbox.status,
        expiresAt: sandbox.expiresAt,
        createdAt: sandbox.createdAt,
      },
    },
    201,
  );
});

// ─── GET /sandbox — List sandbox tenants ────────────────────────────

developersRouter.get('/sandbox', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Developer routes not configured');

  const { userId } = ensureDeveloperContext(c);

  const sandboxes = await deps.listSandboxes(userId);

  const safeSandboxes = sandboxes.map((s) => ({
    id: s.id,
    tenantId: s.tenantId,
    name: s.name,
    seedDataProfile: s.seedDataProfile,
    status: s.status,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  }));

  return c.json({
    success: true as const,
    data: safeSandboxes,
  });
});

// ─── DELETE /sandbox/:sandboxId — Destroy sandbox ──────────────────

developersRouter.delete('/sandbox/:sandboxId', requireAuth(), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Developer routes not configured');

  const requestId = c.get('requestId');
  const { userId } = ensureDeveloperContext(c);
  const sandboxId = c.req.param('sandboxId');

  // Verify sandbox exists and belongs to this developer
  const sandbox = await deps.findSandboxById(userId, sandboxId);
  if (!sandbox) {
    throw new NotFoundError('Sandbox not found', requestId);
  }

  const destroyed = await deps.destroySandbox(userId, sandboxId);
  if (!destroyed) {
    throw new NotFoundError('Sandbox not found', requestId);
  }

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: 'developer-portal',
    eventType: 'data.deleted',
    actorType: 'user',
    actorId: userId,
    resource: 'sandbox_tenants',
    resourceId: sandboxId,
    action: 'destroy_sandbox',
    details: { tenantId: sandbox.tenantId },
    timestamp: new Date(),
  });

  return c.json({ success: true as const }, 200);
});

export { developersRouter };
