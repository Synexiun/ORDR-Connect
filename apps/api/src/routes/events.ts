/**
 * Server-Sent Events Route — real-time event stream for the ORDR-Connect dashboard.
 *
 * GET /v1/events/stream?token=<jwt>
 *
 * SSE does not support custom headers per spec, so the JWT is passed via the
 * `?token=` query parameter and validated server-side.
 *
 * SOC2 CC6.1  — Auth required; token validated before stream is opened.
 * SOC2 CC7.2  — Real-time monitoring and alerting pipeline.
 * ISO 27001 A.8.16 — Monitoring activities.
 * HIPAA §164.312 — No PHI in event payloads; IDs and metadata only.
 *
 * Event types pushed to subscribers:
 *   agent.session_started    — { sessionId, agentRole, tenantId }
 *   agent.session_completed  — { sessionId, durationMs, resolved }
 *   agent.hitl_created       — { hitlId, sessionId, action, confidence }
 *   analytics.counters_updated — { activeAgents, hitlPending, complianceScore }
 *   system.heartbeat         — { ts } (every 30s — keeps connection alive)
 *
 * ARCHITECTURE NOTE: In production this connects to Kafka consumers and Redis
 * pub-sub for multi-instance fan-out. Currently uses an in-process EventBus
 * so events fired on the same Node.js instance reach all active SSE clients.
 * Suitable for single-instance dev/staging; replace EventBus with Redis
 * pub-sub before horizontal scaling.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authenticateRequest } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuthenticationError } from '@ordr/core';
import type { Env } from '../types.js';

// ─── In-Process Event Bus ────────────────────────────────────────
//
// Lightweight fan-out for broadcasting events to all active SSE connections
// on this process. Replace with a Redis pub-sub adapter for horizontal scale.

export interface SseEvent {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

type SseListener = (event: SseEvent) => void;

const listeners = new Set<SseListener>();

/**
 * Broadcast an event to all active SSE connections.
 * Call this from other route handlers after state-changing operations.
 *
 * @example
 * ```ts
 * broadcastEvent({ type: 'agent.hitl_created', data: { hitlId, sessionId } });
 * ```
 */
export function broadcastEvent(event: SseEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Individual listener errors must not affect other listeners
    }
  }
}

// ─── Dependencies ────────────────────────────────────────────────

interface EventsDependencies {
  readonly jwtConfig: JwtConfig;
}

let deps: EventsDependencies | null = null;

export function configureEventsRoute(dependencies: EventsDependencies): void {
  deps = dependencies;
}

// ─── Router ──────────────────────────────────────────────────────

const eventsRouter = new Hono<Env>();

// ─── GET /stream — SSE connection ───────────────────────────────

eventsRouter.get('/stream', async (c) => {
  const requestId = c.get('requestId');

  // Validate token from query param (SSE cannot use Authorization header)
  const token = new URL(c.req.url).searchParams.get('token');
  if (token === null || token === '') {
    return c.json(
      new AuthenticationError('Missing token query parameter', requestId).toSafeResponse(),
      401,
    );
  }

  // Authenticate: validate the JWT using the configured JwtConfig
  if (deps === null) {
    return c.json(
      new AuthenticationError('Events service not configured', requestId).toSafeResponse(),
      503,
    );
  }

  const authResult = await authenticateRequest(
    { authorization: `Bearer ${token}` },
    deps.jwtConfig,
  );

  if (!authResult.authenticated) {
    return c.json(
      new AuthenticationError('Invalid or expired token', requestId).toSafeResponse(),
      401,
    );
  }

  const tenantId = authResult.context.tenantId;

  return streamSSE(c, async (stream) => {
    // ── Send connected confirmation ──────────────────────────────
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({
        type: 'connected',
        data: { tenantId, ts: new Date().toISOString() },
      }),
    });

    // ── Register tenant-scoped event listener ────────────────────
    // Only forward events matching this tenant's tenantId.
    // SOC2 CC6.1 — multi-tenant isolation: no cross-tenant event leakage.
    const handleEvent = (event: SseEvent): void => {
      // Tenant isolation — skip events from other tenants
      if (typeof event.data['tenantId'] === 'string' && event.data['tenantId'] !== tenantId) {
        return;
      }

      // Write fires asynchronously; ignore write-after-close errors.
      stream
        .writeSSE({
          event: event.type,
          data: JSON.stringify({ type: event.type, data: event.data }),
        })
        .catch(() => {
          // Connection closed — remove listener
          listeners.delete(handleEvent);
        });
    };

    listeners.add(handleEvent);

    // ── Heartbeat every 30s — prevents proxy/LB timeouts ────────
    const heartbeatInterval = setInterval(() => {
      stream
        .writeSSE({
          event: 'system.heartbeat',
          data: JSON.stringify({
            type: 'system.heartbeat',
            data: { ts: new Date().toISOString() },
          }),
        })
        .catch(() => {
          clearInterval(heartbeatInterval);
          listeners.delete(handleEvent);
        });
    }, 30_000);

    // ── Keep stream open until client disconnects ────────────────
    // Hono's streamSSE closes when the callback resolves, so we wait
    // until the abort signal fires (client disconnect or server shutdown).
    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener('abort', () => {
        resolve();
      });
    });

    // ── Cleanup ──────────────────────────────────────────────────
    clearInterval(heartbeatInterval);
    listeners.delete(handleEvent);
  });
});

export { eventsRouter };
