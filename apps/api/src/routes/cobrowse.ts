/**
 * Co-browsing / Remote Assistance Routes
 *
 * Enables admin users to view and assist users in real-time via WebRTC
 * screen sharing. Uses SSE for signaling (WebRTC offer/answer/ICE exchange).
 *
 * Flow:
 *   1. Admin POSTs /sessions → creates session, sends notification to user
 *   2. User GETs /sessions/:id/events (SSE) → receives invitation
 *   3. User accepts/rejects via POST /sessions/:id/accept|reject
 *   4. Both parties exchange WebRTC signals via POST /sessions/:id/signal
 *   5. Admin connects via SSE at /sessions/:id/events
 *   6. WebRTC P2P screen sharing established
 *   7. Either party ends session via POST /sessions/:id/end
 *
 * SECURITY:
 * - Admin must have role admin/support to initiate sessions
 * - User MUST explicitly accept before session becomes active
 * - Sessions are tenant-isolated and time-limited (max 2 hours)
 * - All sessions are audit-logged
 * - Recording requires explicit user consent
 *
 * SOC2 CC6.2 — Logical access controls: admin-initiated sessions require auth.
 * ISO 27001 A.11.2.4 — Remote assistance procedures documented.
 * HIPAA §164.310(c) — Workstation security: controlled remote access.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuditLogger } from '@ordr/audit';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CobrowseSessionStatus = 'pending' | 'active' | 'ended' | 'rejected' | 'expired';
export type CobrowseMode = 'view' | 'assist'; // view=readonly, assist=can annotate/highlight

export interface CobrowseSession {
  readonly id: string;
  readonly tenantId: string;
  readonly adminId: string;
  readonly adminName: string;
  readonly userId: string;
  status: CobrowseSessionStatus;
  readonly mode: CobrowseMode;
  readonly recordingEnabled: boolean;
  readonly userConsented: boolean;
  readonly initiatedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  readonly expiresAt: Date; // max 2 hours from creation
}

type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'annotation' | 'pointer' | 'end';

interface CobrowseSignal {
  readonly type: SignalType;
  readonly from: 'admin' | 'user';
  readonly payload: unknown;
  readonly timestamp: Date;
}

// ─── In-memory session store ──────────────────────────────────────────────────

const sessions = new Map<string, CobrowseSession>();

// SSE subscribers per session: sessionId -> Set<callback>
type SignalSubscriber = (signal: CobrowseSignal) => void | Promise<void>;
const signalSubscribers = new Map<string, Set<SignalSubscriber>>();

function publishSignal(sessionId: string, signal: CobrowseSignal): void {
  const subs = signalSubscribers.get(sessionId);
  if (subs !== undefined) for (const cb of subs) void cb(signal);
}

function subscribeSignals(sessionId: string, cb: SignalSubscriber): () => void {
  let subs = signalSubscribers.get(sessionId);
  if (subs === undefined) {
    subs = new Set();
    signalSubscribers.set(sessionId, subs);
  }
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// ─── Cleanup expired sessions (run every 10 min) ──────────────────────────────
setInterval(
  () => {
    const now = new Date();
    for (const [id, session] of sessions) {
      if (session.expiresAt < now && session.status !== 'ended') {
        sessions.set(id, { ...session, status: 'expired', endedAt: now });
      }
    }
  },
  10 * 60 * 1000,
).unref();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  userId: z.string().uuid(),
  mode: z.enum(['view', 'assist']).default('view'),
  recordingEnabled: z.boolean().default(false),
  message: z.string().max(500).optional(),
});

const signalSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice-candidate', 'annotation', 'pointer']),
  payload: z.unknown(),
});

// ─── Module-level deps ──────────────────────────────────────────────────────

let _auditLogger: Pick<AuditLogger, 'log'> | null = null;

export function configureCobrowseRoutes(deps: { auditLogger: Pick<AuditLogger, 'log'> }): void {
  _auditLogger = deps.auditLogger;
}

// ─── Router ──────────────────────────────────────────────────────────────────

const cobrowseRouter = new Hono<Env>();

// POST /sessions — Admin initiates a session
cobrowseRouter.post('/sessions', requireAuth(), rateLimit('write'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );

  // Only admin/support roles can initiate
  const hasPermission =
    ctx.roles.includes('admin') ||
    ctx.roles.includes('support') ||
    ctx.roles.includes('tenant_admin') ||
    ctx.roles.includes('super_admin');
  if (!hasPermission) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions to initiate remote assistance',
          correlationId: c.get('requestId'),
        },
      },
      403,
    );
  }

  const body: unknown = await c.req.json();
  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );

  if (parsed.data.userId === ctx.userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Cannot initiate session with yourself',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  }

  const now = new Date();
  const session: CobrowseSession = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    adminId: ctx.userId,
    adminName: ctx.userId, // In production: fetch user display name
    userId: parsed.data.userId,
    status: 'pending',
    mode: parsed.data.mode,
    recordingEnabled: parsed.data.recordingEnabled,
    userConsented: false,
    initiatedAt: now,
    expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours
  };

  sessions.set(session.id, session);

  // Notify user via signal that session was created
  publishSignal(session.id, {
    type: 'offer',
    from: 'admin',
    payload: {
      sessionId: session.id,
      adminName: session.adminName,
      mode: session.mode,
      recordingEnabled: session.recordingEnabled,
      message: parsed.data.message ?? '',
    },
    timestamp: now,
  });

  // WORM audit — cobrowse session created (HIPAA §164.310(c))
  if (_auditLogger) {
    await _auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'cobrowse.session_created',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'cobrowse_session',
      resourceId: session.id,
      action: 'create',
      details: { targetUserId: parsed.data.userId, mode: session.mode },
      timestamp: now,
    });
  }

  return c.json(
    {
      success: true as const,
      data: {
        sessionId: session.id,
        status: session.status,
        expiresAt: session.expiresAt.toISOString(),
      },
    },
    201,
  );
});

// GET /sessions — List sessions for current user
cobrowseRouter.get('/sessions', requireAuth(), (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const mySessions: object[] = [];
  for (const [, session] of sessions) {
    if (session.tenantId !== ctx.tenantId) continue;
    if (session.adminId === ctx.userId || session.userId === ctx.userId) {
      mySessions.push({
        id: session.id,
        status: session.status,
        mode: session.mode,
        adminId: session.adminId,
        userId: session.userId,
        initiatedAt: session.initiatedAt.toISOString(),
        startedAt: session.startedAt?.toISOString(),
      });
    }
  }
  return c.json({ success: true as const, data: mySessions });
});

// GET /sessions/:id — Get session info
cobrowseRouter.get('/sessions/:id', requireAuth(), (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const session = sessions.get(c.req.param('id'));
  if (session === undefined || session.tenantId !== ctx.tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found',
          correlationId: c.get('requestId'),
        },
      },
      404,
    );
  }
  if (session.adminId !== ctx.userId && session.userId !== ctx.userId) {
    return c.json(
      {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied', correlationId: c.get('requestId') },
      },
      403,
    );
  }
  return c.json({
    success: true as const,
    data: {
      id: session.id,
      status: session.status,
      mode: session.mode,
      recordingEnabled: session.recordingEnabled,
      initiatedAt: session.initiatedAt.toISOString(),
      startedAt: session.startedAt?.toISOString(),
      endedAt: session.endedAt?.toISOString(),
    },
  });
});

// POST /sessions/:id/accept — User accepts the session
cobrowseRouter.post('/sessions/:id/accept', requireAuth(), rateLimit('write'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const session = sessions.get(c.req.param('id'));
  if (session === undefined || session.tenantId !== ctx.tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found',
          correlationId: c.get('requestId'),
        },
      },
      404,
    );
  }
  if (session.userId !== ctx.userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only the invited user can accept',
          correlationId: c.get('requestId'),
        },
      },
      403,
    );
  }
  if (session.status !== 'pending') {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: `Session is ${session.status}`,
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  }
  const now = new Date();
  sessions.set(session.id, { ...session, status: 'active', startedAt: now, userConsented: true });
  publishSignal(session.id, {
    type: 'answer',
    from: 'user',
    payload: { accepted: true, userId: ctx.userId },
    timestamp: now,
  });

  // WORM audit — session accepted (HIPAA §164.310(c))
  if (_auditLogger) {
    await _auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'cobrowse.session_accepted',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'cobrowse_session',
      resourceId: session.id,
      action: 'update',
      details: { newStatus: 'active' },
      timestamp: now,
    });
  }

  return c.json({ success: true as const, data: { status: 'active' } });
});

// POST /sessions/:id/reject — User rejects
cobrowseRouter.post('/sessions/:id/reject', requireAuth(), rateLimit('write'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const session = sessions.get(c.req.param('id'));
  if (session === undefined || session.tenantId !== ctx.tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found',
          correlationId: c.get('requestId'),
        },
      },
      404,
    );
  }
  if (session.userId !== ctx.userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only the invited user can reject',
          correlationId: c.get('requestId'),
        },
      },
      403,
    );
  }
  const now = new Date();
  sessions.set(session.id, { ...session, status: 'rejected', endedAt: now });
  publishSignal(session.id, {
    type: 'end',
    from: 'user',
    payload: { rejected: true },
    timestamp: now,
  });

  // WORM audit — session rejected (HIPAA §164.310(c))
  if (_auditLogger) {
    await _auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'cobrowse.session_rejected',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'cobrowse_session',
      resourceId: session.id,
      action: 'update',
      details: { newStatus: 'rejected' },
      timestamp: now,
    });
  }

  return c.json({ success: true as const, data: { status: 'rejected' } });
});

// POST /sessions/:id/end — Either party ends the session
cobrowseRouter.post('/sessions/:id/end', requireAuth(), rateLimit('write'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const session = sessions.get(c.req.param('id'));
  if (session === undefined || session.tenantId !== ctx.tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found',
          correlationId: c.get('requestId'),
        },
      },
      404,
    );
  }
  if (session.adminId !== ctx.userId && session.userId !== ctx.userId) {
    return c.json(
      {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied', correlationId: c.get('requestId') },
      },
      403,
    );
  }
  const now = new Date();
  sessions.set(session.id, { ...session, status: 'ended', endedAt: now });
  publishSignal(session.id, {
    type: 'end',
    from: session.adminId === ctx.userId ? 'admin' : 'user',
    payload: { endedBy: ctx.userId },
    timestamp: now,
  });

  // WORM audit — session ended (HIPAA §164.310(c))
  if (_auditLogger) {
    await _auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'cobrowse.session_ended',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'cobrowse_session',
      resourceId: session.id,
      action: 'update',
      details: { newStatus: 'ended', endedBy: ctx.userId },
      timestamp: now,
    });
  }

  return c.json({ success: true as const, data: { status: 'ended' } });
});

// POST /sessions/:id/signal — WebRTC signaling relay (offer/answer/ICE/annotation)
cobrowseRouter.post('/sessions/:id/signal', requireAuth(), rateLimit('write'), async (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const session = sessions.get(c.req.param('id'));
  if (session === undefined || session.tenantId !== ctx.tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found',
          correlationId: c.get('requestId'),
        },
      },
      404,
    );
  }
  if (session.adminId !== ctx.userId && session.userId !== ctx.userId) {
    return c.json(
      {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied', correlationId: c.get('requestId') },
      },
      403,
    );
  }
  if (session.status !== 'active' && session.status !== 'pending') {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: `Session is ${session.status}`,
          correlationId: c.get('requestId'),
        },
      },
      400,
    );
  }
  const body: unknown = await c.req.json();
  const parsed = signalSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid signal',
          correlationId: c.get('requestId'),
        },
      },
      400,
    );

  const signal: CobrowseSignal = {
    type: parsed.data.type,
    from: session.adminId === ctx.userId ? 'admin' : 'user',
    payload: parsed.data.payload,
    timestamp: new Date(),
  };
  publishSignal(session.id, signal);
  return c.json({ success: true as const });
});

// GET /sessions/:id/events — SSE stream for signaling
cobrowseRouter.get('/sessions/:id/events', requireAuth(), (c) => {
  const ctx = c.get('tenantContext');
  if (ctx === undefined)
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
          correlationId: c.get('requestId'),
        },
      },
      401,
    );
  const session = sessions.get(c.req.param('id'));
  if (session === undefined || session.tenantId !== ctx.tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found',
          correlationId: c.get('requestId'),
        },
      },
      404,
    );
  }
  if (session.adminId !== ctx.userId && session.userId !== ctx.userId) {
    return c.json(
      {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied', correlationId: c.get('requestId') },
      },
      403,
    );
  }

  const role: 'admin' | 'user' = session.adminId === ctx.userId ? 'admin' : 'user';

  return streamSSE(c, async (stream) => {
    let unsubscribe: (() => void) | undefined;
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'connected', role, sessionId: session.id }),
        event: 'connected',
        id: '0',
      });
      let id = 1;
      unsubscribe = subscribeSignals(session.id, async (signal) => {
        // Only forward signals intended for the other party
        if (signal.from === role) return; // Don't echo back to sender
        try {
          await stream.writeSSE({
            data: JSON.stringify(signal),
            event: signal.type,
            id: String(id++),
          });
        } catch {
          // Disconnected — suppress
        }
      });
      // Heartbeat every 20s
      while (!stream.aborted) {
        await new Promise<void>((r) => setTimeout(r, 20_000));
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!stream.aborted) {
          await stream.writeSSE({
            data: JSON.stringify({ ts: Date.now() }),
            event: 'heartbeat',
            id: String(id++),
          });
        }
      }
    } finally {
      unsubscribe?.();
    }
  });
});

export { cobrowseRouter };
