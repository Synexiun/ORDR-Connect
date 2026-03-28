/**
 * SSO Routes — Enterprise Single Sign-On endpoints
 *
 * SOC2 CC6.1 — Centralized authentication via identity providers.
 * ISO 27001 A.9.2.1 — User registration via federated SSO.
 * HIPAA §164.312(d) — Person or entity authentication.
 *
 * Endpoints:
 * GET  /authorize     — Redirect to SSO provider
 * GET  /callback      — Handle SSO callback (exchange code for token)
 * GET  /connections    — List SSO connections for tenant (auth required)
 * POST /connections    — Create SSO connection (admin only)
 * DELETE /connections/:id — Delete SSO connection (admin only)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { SSOManager } from '@ordr/auth';
import type { AuditLogger } from '@ordr/audit';
import { AuthenticationError, ValidationError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requireRoleMiddleware } from '../middleware/auth.js';
import { featureGate, FEATURES } from '../middleware/plan-gate.js';
import { jsonErr } from '../lib/http.js';

// ─── Input Schemas ────────────────────────────────────────────────

const authorizeQuerySchema = z.object({
  connectionId: z.string().min(1, 'connectionId is required'),
  state: z.string().min(1, 'state is required').optional().default('default'),
});

const createConnectionSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['saml', 'oidc']),
  provider: z.enum(['okta', 'azure-ad', 'google', 'onelogin', 'custom']),
  metadata: z.string().min(1),
});

// ─── Dependencies ─────────────────────────────────────────────────

interface SSODependencies {
  readonly ssoManager: SSOManager;
  readonly auditLogger: AuditLogger;
}

let deps: SSODependencies | null = null;

export function configureSSORoutes(dependencies: SSODependencies): void {
  deps = dependencies;
}

// ─── Router ───────────────────────────────────────────────────────

const ssoRouter = new Hono<Env>();

// ─── GET /authorize ───────────────────────────────────────────────

ssoRouter.get('/authorize', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SSO routes not configured');
  }

  const requestId = c.get('requestId');

  const query = authorizeQuerySchema.safeParse({
    connectionId: c.req.query('connectionId'),
    state: c.req.query('state'),
  });

  if (!query.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of query.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) {
        existing.push(issue.message);
      } else {
        fieldErrors[field] = [issue.message];
      }
    }
    throw new ValidationError('Invalid SSO authorize request', fieldErrors, requestId);
  }

  // Extract tenant from connection (the connection knows its tenant)
  const { connectionId, state } = query.data;

  // For the authorize flow, we derive tenantId from the connection context.
  // In production, a tenant lookup is done via connection ID mapping.
  // Here, we pass a placeholder that the SSOManager resolves.
  const tenantId = c.req.query('tenantId');
  if (tenantId === undefined || tenantId.length === 0) {
    throw new ValidationError('tenantId query parameter is required', {}, requestId);
  }

  const result = await deps.ssoManager.getAuthorizationUrl(tenantId, connectionId, state);

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  return c.redirect(result.data, 302);
});

// ─── GET /callback ────────────────────────────────────────────────

ssoRouter.get('/callback', async (c): Promise<Response> => {
  if (!deps) {
    throw new Error('[ORDR:API] SSO routes not configured');
  }

  const requestId = c.get('requestId');

  const code = c.req.query('code');
  const state = c.req.query('state');

  if (code === undefined || state === undefined) {
    throw new AuthenticationError('Missing code or state parameter', requestId);
  }

  const result = await deps.ssoManager.handleCallback(code, state);

  if (!result.success) {
    return jsonErr(c, result.error);
  }

  // Audit log successful SSO authentication
  await deps.auditLogger.log({
    tenantId: 'system',
    eventType: 'auth.sso.success',
    actorType: 'system',
    actorId: result.data.id,
    resource: 'auth',
    resourceId: requestId,
    action: 'sso_callback',
    details: {
      email: result.data.email,
      connectionType: result.data.connectionType,
      idpId: result.data.idpId,
    },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      profile: {
        id: result.data.id,
        email: result.data.email,
        firstName: result.data.firstName,
        lastName: result.data.lastName,
        connectionType: result.data.connectionType,
      },
    },
  });
});

// ─── GET /connections ─────────────────────────────────────────────

ssoRouter.get(
  '/connections',
  requireAuth(),
  featureGate(FEATURES.SSO), // eslint-disable-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
  async (c): Promise<Response> => {
    if (!deps) {
      throw new Error('[ORDR:API] SSO routes not configured');
    }

    const ctx = c.get('tenantContext');
    if (!ctx) {
      const requestId = c.get('requestId');
      throw new AuthenticationError('Authentication required', requestId);
    }

    const result = await deps.ssoManager.getSSOConnections(ctx.tenantId);

    if (!result.success) {
      return jsonErr(c, result.error);
    }

    return c.json({
      success: true as const,
      data: result.data,
    });
  },
);

// ─── POST /connections ────────────────────────────────────────────

ssoRouter.post(
  '/connections',
  requireAuth(),
  featureGate(FEATURES.SSO), // eslint-disable-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) {
      throw new Error('[ORDR:API] SSO routes not configured');
    }

    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = createConnectionSchema.safeParse(body);

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
      throw new ValidationError('Invalid connection configuration', fieldErrors, requestId);
    }

    const result = await deps.ssoManager.createSSOConnection(ctx.tenantId, parsed.data);

    if (!result.success) {
      return jsonErr(c, result.error);
    }

    // Audit log
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'sso.connection.created',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'sso_connection',
      resourceId: result.data.id,
      action: 'create',
      details: {
        name: parsed.data.name,
        type: parsed.data.type,
        provider: parsed.data.provider,
      },
      timestamp: new Date(),
    });

    return c.json(
      {
        success: true as const,
        data: result.data,
      },
      201,
    );
  },
);

// ─── DELETE /connections/:id ──────────────────────────────────────

ssoRouter.delete(
  '/connections/:id',
  requireAuth(),
  featureGate(FEATURES.SSO), // eslint-disable-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    if (!deps) {
      throw new Error('[ORDR:API] SSO routes not configured');
    }

    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) {
      throw new AuthenticationError('Authentication required', requestId);
    }

    const connectionId = c.req.param('id');
    const result = await deps.ssoManager.deleteSSOConnection(ctx.tenantId, connectionId);

    if (!result.success) {
      return jsonErr(c, result.error);
    }

    // Audit log
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'sso.connection.deleted',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'sso_connection',
      resourceId: connectionId,
      action: 'delete',
      details: {},
      timestamp: new Date(),
    });

    return c.json({ success: true as const });
  },
);

export { ssoRouter };
