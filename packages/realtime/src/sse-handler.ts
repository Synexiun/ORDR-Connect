/**
 * @ordr/realtime — SSE Hono Handler
 *
 * Hono-compatible SSE endpoint handler for establishing
 * Server-Sent Events connections with authenticated clients.
 *
 * SOC2 CC6.1 — Connections authenticated via JWT tenant context.
 * ISO 27001 A.13.1.1 — SSE over TLS only in production.
 * HIPAA §164.312(d) — Entity authentication before connection.
 *
 * Usage:
 *   app.get('/events', createSSEHandler(channelManager));
 */

import type { ChannelManager } from './channels.js';
import type { EventCategory, RealtimeEvent } from './types.js';

// ─── Env Type (matches API Env) ─────────────────────────────────

interface RealtimeEnv {
  Variables: {
    requestId: string;
    tenantContext: {
      readonly tenantId: string;
      readonly userId: string;
      readonly roles: readonly string[];
      readonly permissions: readonly string[];
    } | undefined;
  };
}

// ─── SSE Serializer ─────────────────────────────────────────────

/**
 * Serialize a RealtimeEvent to SSE format.
 * Format: event: <type>\ndata: <json>\nid: <id>\n\n
 */
export function serializeSSEEvent(event: RealtimeEvent): string {
  const lines: string[] = [];
  lines.push(`event: ${event.type}`);
  lines.push(`data: ${JSON.stringify({
    id: event.id,
    category: event.category,
    type: event.type,
    data: event.data,
    timestamp: event.timestamp,
  })}`);
  lines.push(`id: ${event.id}`);
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

/**
 * Serialize a heartbeat/keep-alive comment.
 */
export function serializeHeartbeat(): string {
  return `: heartbeat ${new Date().toISOString()}\n\n`;
}

// ─── SSE Connection Handler ─────────────────────────────────────

export interface SSEHandlerOptions {
  /** Heartbeat interval in ms (default: 30000) */
  readonly heartbeatIntervalMs?: number;
  /** Default event categories to subscribe to */
  readonly defaultCategories?: readonly EventCategory[];
}

/**
 * Create a Hono-compatible SSE request handler.
 *
 * Returns an object with `handleRequest` that can be used in a route:
 *
 *   const sse = createSSEHandler(channelManager);
 *   app.get('/events', (c) => sse.handleRequest(c));
 *
 * NOTE: This returns a factory, not middleware, because SSE requires
 * streaming the Response object directly (not calling next()).
 */
export function createSSEHandler(
  channelManager: ChannelManager,
  options?: SSEHandlerOptions,
) {
  const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 30_000;
  const defaultCategories = options?.defaultCategories ?? [];

  return {
    /**
     * Handle an SSE connection request.
     * Returns a streaming Response with SSE headers.
     */
    handleRequest(context: {
      get: <K extends keyof RealtimeEnv['Variables']>(key: K) => RealtimeEnv['Variables'][K];
      req: { query: (key: string) => string | undefined };
    }): Response {
      const tenantContext = context.get('tenantContext');

      if (!tenantContext) {
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'AUTH_FAILED',
              message: 'Authentication required for SSE connection',
              correlationId: context.get('requestId') ?? 'unknown',
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Parse categories from query param
      const categoriesParam = context.req.query('categories');
      const categories: EventCategory[] = categoriesParam
        ? (categoriesParam.split(',') as EventCategory[])
        : [...defaultCategories];

      // Create SSE response stream
      const stream = new TransformStream();
      const writer = stream.writable.getWriter();
      const encoder = new TextEncoder();

      let isOpen = true;

      const sendFn = (event: RealtimeEvent): void => {
        if (!isOpen) return;
        const serialized = serializeSSEEvent(event);
        writer.write(encoder.encode(serialized)).catch(() => {
          isOpen = false;
        });
      };

      const closeFn = (): void => {
        isOpen = false;
        writer.close().catch(() => { /* already closed */ });
      };

      // Register the connection
      const subscription = channelManager.addConnection(
        tenantContext.tenantId,
        tenantContext.userId,
        categories,
        sendFn,
        closeFn,
      );

      // Send initial connection event
      const connectEvent: RealtimeEvent = {
        id: subscription.id,
        tenantId: tenantContext.tenantId,
        category: 'system',
        type: 'connected',
        data: {
          subscriptionId: subscription.id,
          categories: subscription.categories,
        },
        timestamp: new Date().toISOString(),
      };
      sendFn(connectEvent);

      // Heartbeat interval
      const heartbeatTimer = setInterval(() => {
        if (!isOpen) {
          clearInterval(heartbeatTimer);
          return;
        }
        const hb = serializeHeartbeat();
        writer.write(encoder.encode(hb)).catch(() => {
          isOpen = false;
          clearInterval(heartbeatTimer);
        });
        channelManager.heartbeat(tenantContext.tenantId, subscription.id);
      }, heartbeatIntervalMs);

      return new Response(stream.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-SSE-Subscription-Id': subscription.id,
        },
      });
    },
  };
}
