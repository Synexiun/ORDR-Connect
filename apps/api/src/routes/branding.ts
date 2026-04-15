/**
 * Branding Routes — White-label configuration CRUD
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, role-checked.
 * ISO 27001 A.14.1.2 — Custom domain security enforcement.
 * HIPAA §164.312(e)(1) — TLS 1.3 on custom domains.
 *
 * Endpoints:
 * GET    /v1/branding        — Returns current tenant's brand config (any auth user)
 * PUT    /v1/branding        — Updates brand config (admin only, audit-logged)
 * GET    /v1/branding/domain — Returns custom domain status
 * POST   /v1/branding/domain — Registers a custom domain (admin only, audit-logged)
 * DELETE /v1/branding/domain — Removes custom domain (admin only, audit-logged)
 *
 * SECURITY:
 * - tenant_id derived from JWT (Rule 2 — NEVER from client input)
 * - All write operations are audit-logged (Rule 3 — WORM)
 * - No secrets in brand config or CSS (Rule 5)
 * - Color values validated as hex format
 * - Domain format validated server-side
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import { ValidationError, NotFoundError, AuthorizationError, ConflictError } from '@ordr/core';
import type { TenantContext, BrandConfigUpdate, CustomDomainConfig } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requireRoleMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ---- Validation Schemas ----

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const updateBrandingSchema = z.object({
  logoUrl: z.string().url().max(2048).nullable().optional(),
  faviconUrl: z.string().url().max(2048).nullable().optional(),
  primaryColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Must be a valid hex color (e.g., #3b82f6)')
    .optional(),
  accentColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Must be a valid hex color (e.g., #10b981)')
    .optional(),
  bgColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Must be a valid hex color (e.g., #0f172a)')
    .optional(),
  textColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Must be a valid hex color (e.g., #e2e8f0)')
    .optional(),
  emailFromName: z.string().max(255).nullable().optional(),
  emailFromAddress: z.string().email().max(255).nullable().optional(),
  customCss: z.string().max(50000).nullable().optional(),
  footerText: z.string().max(1000).nullable().optional(),
});

/**
 * Domain validation: valid hostname format, no IP addresses, no localhost.
 * Minimum 2 labels (e.g., app.example.com), maximum 253 characters.
 */
/**
 * Linear-time domain regex: validates hostname labels separated by dots.
 * No nested quantifiers — safe against ReDoS.
 * Rejects localhost via Zod refinement below.
 */
const DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;

const registerDomainSchema = z.object({
  domain: z
    .string()
    .min(4)
    .max(253)
    .regex(DOMAIN_REGEX, 'Must be a valid domain name (e.g., app.example.com)')
    .refine((d) => !d.toLowerCase().includes('localhost'), 'localhost domains are not allowed'),
});

// ---- Dependencies (injected at startup) ----

interface BrandConfigRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly customDomain: string | null;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly bgColor: string;
  readonly textColor: string;
  readonly emailFromName: string | null;
  readonly emailFromAddress: string | null;
  readonly customCss: string | null;
  readonly footerText: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface BrandingDependencies {
  readonly auditLogger: AuditLogger;
  readonly getBrandConfig: (tenantId: string) => Promise<BrandConfigRecord | null>;
  readonly upsertBrandConfig: (
    tenantId: string,
    data: BrandConfigUpdate,
  ) => Promise<BrandConfigRecord>;
  readonly getBrandConfigByDomain: (domain: string) => Promise<BrandConfigRecord | null>;
  readonly setCustomDomain: (tenantId: string, domain: string) => Promise<BrandConfigRecord>;
  readonly removeCustomDomain: (tenantId: string) => Promise<boolean>;
}

let deps: BrandingDependencies | null = null;

export function configureBrandingRoutes(dependencies: BrandingDependencies): void {
  deps = dependencies;
}

// ---- Helpers ----

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
  get(key: 'requestId'): string;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthorizationError('Tenant context required');
  }
  return ctx;
}

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

// ---- Router ----

const brandingRouter = new Hono<Env>();

// All routes require authentication
brandingRouter.use('*', requireAuth());

// ---- GET / — get current tenant's brand config ----

brandingRouter.get('/', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Branding routes not configured');

  const ctx = ensureTenantContext(c);

  const config = await deps.getBrandConfig(ctx.tenantId);

  if (!config) {
    // Return defaults if no config exists yet
    return c.json({
      success: true as const,
      data: {
        tenantId: ctx.tenantId,
        customDomain: null,
        logoUrl: null,
        faviconUrl: null,
        primaryColor: '#3b82f6',
        accentColor: '#10b981',
        bgColor: '#0f172a',
        textColor: '#e2e8f0',
        emailFromName: null,
        emailFromAddress: null,
        customCss: null,
        footerText: null,
      },
    });
  }

  return c.json({
    success: true as const,
    data: config,
  });
});

// ---- PUT / — update brand config (admin only) ----

brandingRouter.put('/', requireRoleMiddleware('tenant_admin'), rateLimit('write'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Branding routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = updateBrandingSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid branding data', parseZodErrors(parsed.error), requestId);
  }

  // Upsert brand config
  const updated = await deps.upsertBrandConfig(ctx.tenantId, parsed.data as BrandConfigUpdate);

  // Build change set for audit (field names only — no sensitive values)
  const changedFields = Object.keys(parsed.data);

  // Audit log — WORM (Rule 3)
  await deps.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'config.updated',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'white_label_configs',
    resourceId: updated.id,
    action: 'update_branding',
    details: { changedFields },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: updated,
  });
});

// ---- GET /domain — get custom domain status ----

brandingRouter.get('/domain', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Branding routes not configured');

  const ctx = ensureTenantContext(c);

  const config = await deps.getBrandConfig(ctx.tenantId);

  if (config === null || config.customDomain === null) {
    return c.json({
      success: true as const,
      data: null,
    });
  }

  const domainConfig: CustomDomainConfig = {
    domain: config.customDomain,
    tenantId: ctx.tenantId,
    sslStatus: 'pending',
    verifiedAt: null,
  };

  return c.json({
    success: true as const,
    data: domainConfig,
  });
});

// ---- POST /domain — register custom domain (admin only) ----

brandingRouter.post(
  '/domain',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Branding routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');

    // Validate input
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = registerDomainSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid domain', parseZodErrors(parsed.error), requestId);
    }

    const domain = parsed.data.domain.toLowerCase();

    // Check if domain is already taken by another tenant
    const existing = await deps.getBrandConfigByDomain(domain);
    if (existing && existing.tenantId !== ctx.tenantId) {
      throw new ConflictError('Domain is already registered by another tenant', requestId);
    }

    // Set custom domain
    const updated = await deps.setCustomDomain(ctx.tenantId, domain);

    // Audit log — WORM (Rule 3)
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'config.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'white_label_configs',
      resourceId: updated.id,
      action: 'register_domain',
      details: { domain },
      timestamp: new Date(),
    });

    const domainConfig: CustomDomainConfig = {
      domain,
      tenantId: ctx.tenantId,
      sslStatus: 'pending',
      verifiedAt: null,
    };

    return c.json(
      {
        success: true as const,
        data: domainConfig,
      },
      201,
    );
  },
);

// ---- DELETE /domain — remove custom domain (admin only) ----

brandingRouter.delete(
  '/domain',
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
  async (c) => {
    if (!deps) throw new Error('[ORDR:API] Branding routes not configured');

    const ctx = ensureTenantContext(c);
    const requestId = c.get('requestId');

    const config = await deps.getBrandConfig(ctx.tenantId);
    if (config === null || config.customDomain === null) {
      throw new NotFoundError('No custom domain configured', requestId);
    }

    const removedDomain = config.customDomain;
    const removed = await deps.removeCustomDomain(ctx.tenantId);
    if (!removed) {
      throw new NotFoundError('No custom domain configured', requestId);
    }

    // Audit log — WORM (Rule 3)
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'config.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'white_label_configs',
      resourceId: config.id,
      action: 'remove_domain',
      details: { domain: removedDomain },
      timestamp: new Date(),
    });

    return c.json({ success: true as const }, 200);
  },
);

export { brandingRouter };
