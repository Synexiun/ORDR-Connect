/**
 * useRealtimeEvents — Server-Sent Events hook for real-time ORDR-Connect updates.
 *
 * Connects to the SSE stream at /v1/realtime/stream, routes typed events to registered
 * handlers, and auto-reconnects on disconnect.
 *
 * SECURITY (CLAUDE.md Rules 2, 3, 5):
 * - Token passed via query param (SSE does not support custom headers per spec)
 * - Backend must validate the `?token=` param against the in-memory session store
 * - Connection closed and not retried if no token is available (unauthenticated)
 * - All received events are parsed and validated before handler dispatch
 * - No sensitive data is stored in the hook — only routing to caller handlers
 *
 * COMPLIANCE: No PHI in event payloads — events contain IDs + metadata only.
 */

import { useEffect, useRef, useCallback } from 'react';
import { getAccessToken } from '../lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

type EventHandler = (data: Record<string, unknown>) => void;

export interface UseRealtimeEventsOptions {
  /** SSE endpoint — defaults to /api/v1/events/stream */
  endpoint?: string;
  /** Reconnect delay in milliseconds on disconnect. Default: 5000 */
  reconnectDelayMs?: number;
  /** Set false to disable auto-reconnect. Default: true */
  reconnect?: boolean;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Subscribes to the ORDR-Connect SSE event stream.
 *
 * @param handlers - Map of `event.type` → handler function. Updated on every render
 *   without reconnecting (handlers are stored in a ref).
 * @param options  - Connection options.
 *
 * @example
 * ```tsx
 * useRealtimeEvents({
 *   'agent.session_completed': () => void refetchSessions(),
 *   'agent.hitl_created': (data) => setHitlCount(data['count'] as number),
 * });
 * ```
 */
export function useRealtimeEvents(
  handlers: Record<string, EventHandler>,
  options: UseRealtimeEventsOptions = {},
): void {
  const {
    endpoint = '/api/v1/realtime/stream',
    reconnectDelayMs = 5_000,
    reconnect = true,
  } = options;

  const sourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef(handlers);
  // Keep handlers ref current without triggering reconnect on every render
  handlersRef.current = handlers;

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (token === null || token === '') {
      // No token — do not attempt SSE connection (unauthenticated)
      return;
    }

    // SSE does not support Authorization headers per the spec.
    // Backend must validate ?token= against the in-memory session store.
    // SOC2 CC6.1 — alternate authentication mechanism for streaming connections.
    const url = `${endpoint}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as unknown;
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !('type' in parsed) ||
          typeof (parsed as Record<string, unknown>)['type'] !== 'string'
        ) {
          return; // Malformed — ignore
        }
        const typedEvent = parsed as { type: string; data: Record<string, unknown> | undefined };
        const handler = handlersRef.current[typedEvent.type];
        if (handler) {
          handler(typedEvent.data ?? {});
        }
      } catch {
        // Malformed event — ignore silently
      }
    };

    es.onerror = () => {
      es.close();
      sourceRef.current = null;
      if (reconnect) {
        retryTimerRef.current = setTimeout(connect, reconnectDelayMs);
      }
    };
  }, [endpoint, reconnect, reconnectDelayMs]);

  useEffect(() => {
    connect();
    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
      }
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [connect]);
}
