/**
 * Realtime Routes — SSE streaming, event publishing, and channel statistics
 *
 * SOC2 CC7.2 — Real-time monitoring pipeline.
 * ISO 27001 A.8.16 — Monitoring activities.
 * HIPAA §164.312 — No PHI in SSE payloads; IDs and metadata only.
 *
 * GET /stream   — SSE connection authenticated via Authorization header (Phase 161).
 * POST /publish — Internal event broadcast (tenant_admin only).
 * GET /stats    — Channel statistics (tenant_admin only).
 *
 * Rule 2 (CLAUDE.md) forbids session tokens in URLs or query parameters.
 * Clients MUST use `fetch()` with an `Authorization: Bearer <jwt>` header
 * and parse the `text/event-stream` body manually — EventSource is
 * unsuitable because it cannot set custom headers.
 *
 * CRITICAL: Event payloads MUST NEVER contain plaintext PHI.
 * Use tokenized/pseudonymized IDs and metadata only.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { ChannelManager, EventPublisher } from '@ordr/realtime';
import { EVENT_CATEGORIES, createSSEHandler } from '@ordr/realtime';
import { ValidationError, AuthorizationError } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import { authenticateRequest } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import type { Env } from '../types.js';
import type { AuditLogger } from '@ordr/audit';
import { requireAuth } from '../middleware/auth.js';
import { requireRoleMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ─── Input Schemas ────────────────────────────────────────────────

const publishSchema = z.object({
  category: z.enum(EVENT_CATEGORIES as readonly [string, ...string[]]),
  type: z.string().min(1).max(200),
  data: z.record(z.unknown()),
  userIds: z.array(z.string().min(1).max(200)).optional(),
});

// ─── Dependencies (injected at startup) ──────────────────────────

interface RealtimeDeps {
  readonly channelManager: ChannelManager;
  readonly publisher: EventPublisher;
  readonly jwtConfig: JwtConfig;
  readonly auditLogger?: Pick<AuditLogger, 'log'>;
}

let deps: RealtimeDeps | null = null;

export function configureRealtimeRoutes(dependencies: RealtimeDeps): void {
  deps = dependencies;
}

// ─── Helpers ─────────────────────────────────────────────────────

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
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

// ─── Router ──────────────────────────────────────────────────────

const realtimeRouter = new Hono<Env>();

// ─── GET /stream — SSE connection ────────────────────────────────────────────
// SOC2 CC7.2 — Authenticated SSE for real-time tenant event streaming.
// ISO 27001 A.8.16 — Monitoring stream requires valid JWT.
// HIPAA §164.312 — No PHI in payload; IDs and metadata only.
//
// Phase 161: Authentication is via the Authorization header only. The old
// `?token=` query-param fallback was removed to comply with Rule 2 (no
// session tokens in URLs or query parameters). Clients must use fetch()
// + manual SSE parsing, since EventSource cannot set custom headers.

realtimeRouter.get('/stream', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Realtime routes not configured');

  const requestId = c.get('requestId');
  const authHeader = c.req.header('Authorization') ?? c.req.header('authorization');

  if (authHeader === undefined || authHeader.length === 0) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required — provide Authorization: Bearer <jwt>',
          correlationId: requestId,
        },
      },
      401,
    );
  }

  const result = await authenticateRequest({ authorization: authHeader }, deps.jwtConfig);

  if (!result.authenticated) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'AUTH_FAILED',
          message: 'Invalid or expired token',
          correlationId: requestId,
        },
      },
      401,
    );
  }

  // Set the verified tenant context so createSSEHandler can read it
  c.set('tenantContext', result.context);

  // Delegate to the SSE handler from @ordr/realtime
  const sseHandler = createSSEHandler(deps.channelManager, {
    heartbeatIntervalMs: 30_000,
  });

  return sseHandler.handleRequest(c);
});

// ─── POST /publish — Broadcast or target event ───────────────────────────────
// SOC2 CC7.2 — Internal publish restricted to tenant_admin role.
// ISO 27001 A.8.16 — Only authorized actors can inject events into tenant channels.
// HIPAA §164.312 — Event data validated at boundary; no PHI accepted.

realtimeRouter.post(
  '/publish',
  requireAuth(),
  requireRoleMiddleware('tenant_admin'),
  rateLimit('write'),
);

realtimeRouter.post('/publish', async (c): Promise<Response> => {
  if (!deps) throw new Error('[ORDR:API] Realtime routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  const body: unknown = await c.req.json().catch(() => null);
  const parsed = publishSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError(
      'Invalid publish request body',
      parseZodErrors(parsed.error),
      requestId,
    );
  }

  const { category, type, data, userIds } = parsed.data;

  let delivered: number;

  try {
    if (userIds !== undefined && userIds.length > 0) {
      // SOC2 CC6.1 — Targeted delivery to specific users within the tenant
      delivered = await deps.publisher.notifyUsers(ctx.tenantId, userIds, type, data);
    } else {
      // Broadcast to all connections in the tenant
      delivered = await deps.publisher.broadcastToTenant(ctx.tenantId, type, data);
    }
  } catch (err: unknown) {
    console.error(
      JSON.stringify({
        level: 'error',
        component: 'realtime',
        event: 'publish_failure',
        type,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
    );
    return c.json(
      {
        success: false as const,
        error: {
          code: 'PUBLISH_FAILED' as const,
          message: 'Failed to deliver realtime event',
          correlationId: requestId,
        },
      },
      502,
    );
  }

  if (deps.auditLogger) {
    await deps.auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'realtime.event_published',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'realtime_event',
      resourceId: requestId,
      action: 'publish',
      details: { category, type, delivered },
      timestamp: new Date(),
    });
  }

  return c.json({
    success: true as const,
    data: {
      delivered,
      category,
      type,
      tenantId: ctx.tenantId,
    },
    requestId,
  });
});

// ─── GET /stats — Channel statistics ─────────────────────────────────────────
// SOC2 CC7.2 — Operational visibility into active SSE connections.
// ISO 27001 A.8.16 — Restricted to tenant_admin role.

realtimeRouter.get('/stats', requireAuth(), requireRoleMiddleware('tenant_admin'));

realtimeRouter.get('/stats', (c): Response => {
  if (!deps) throw new Error('[ORDR:API] Realtime routes not configured');

  const requestId = c.get('requestId');

  const stats = deps.channelManager.getStats();

  return c.json({
    success: true as const,
    data: stats,
    requestId,
  });
});

export { realtimeRouter };
