/**
 * useRealtimeEvents — Server-Sent Events hook for real-time ORDR-Connect updates.
 *
 * Connects to the SSE stream (default /api/v1/realtime/stream), routes typed
 * events to registered handlers, and auto-reconnects on disconnect.
 *
 * SECURITY (CLAUDE.md Rules 2, 3, 5):
 * - Phase 161: Auth is via `Authorization: Bearer <jwt>` header. The legacy
 *   `?token=` URL pattern was removed because Rule 2 forbids session tokens
 *   in URLs or query parameters.
 * - EventSource cannot set custom headers, so this hook uses `fetch()` with
 *   a manually-parsed `ReadableStream` of `text/event-stream` frames.
 * - Connection is not attempted if no in-memory access token is available.
 * - Received events are parsed and validated before handler dispatch.
 *
 * COMPLIANCE: No PHI in event payloads — events contain IDs + metadata only.
 */

import { useEffect, useRef } from 'react';
import { getAccessToken } from '../lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

type EventHandler = (data: Record<string, unknown>) => void;

export interface UseRealtimeEventsOptions {
  /** SSE endpoint — defaults to /api/v1/realtime/stream */
  endpoint?: string;
  /** Reconnect delay in milliseconds on disconnect. Default: 5000 */
  reconnectDelayMs?: number;
  /** Set false to disable auto-reconnect. Default: true */
  reconnect?: boolean;
}

// ─── Frame dispatch ────────────────────────────────────────────────────────

function dispatchFrame(
  handlers: Record<string, EventHandler>,
  eventType: string,
  raw: string,
): void {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return;

    // Server frames are shaped as { type, data }. Prefer the frame's `type`
    // so the SSE `event:` header and payload stay aligned, but fall back to
    // the header if the frame does not carry one.
    const obj = parsed as Record<string, unknown>;
    const type =
      typeof obj['type'] === 'string' && obj['type'].length > 0 ? obj['type'] : eventType;

    const handler = handlers[type];
    if (handler === undefined) return;

    const data =
      typeof obj['data'] === 'object' && obj['data'] !== null
        ? (obj['data'] as Record<string, unknown>)
        : {};
    handler(data);
  } catch {
    // Malformed frame — ignore silently.
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Subscribes to the ORDR-Connect SSE event stream.
 *
 * @param handlers - Map of `event.type` → handler function. Updated on every
 *   render without triggering a reconnect (handlers are stored in a ref).
 * @param options  - Connection options.
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

  // Keep handlers ref current without rebuilding the connect loop.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = (): void => {
      if (!reconnect) return;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        void runOnce();
      }, reconnectDelayMs);
    };

    const runOnce = async (): Promise<void> => {
      const token = getAccessToken();
      if (token === null || token === '') {
        // No token — do not attempt an unauthenticated connection.
        return;
      }

      controller = new AbortController();
      const localController = controller;

      try {
        const resp = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
          signal: localController.signal,
        });

        if (!resp.ok || resp.body === null) {
          scheduleReconnect();
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = 'message';
        let currentData = '';

        // for(;;) avoids @typescript-eslint/no-unnecessary-condition, which
        // flags `while (true)` as an always-truthy literal condition (same
        // pattern as cobrowse-api.ts:subscribeCobrowseEvents). Loop exits
        // when the server closes the stream (done) or the AbortController
        // fires, which surfaces as AbortError in the catch below.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line === '') {
              if (currentData.length > 0) {
                dispatchFrame(handlersRef.current, currentEvent, currentData);
              }
              currentEvent = 'message';
              currentData = '';
              continue;
            }
            if (line.startsWith(':')) continue; // comment / heartbeat
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              currentData =
                currentData.length > 0 ? `${currentData}\n${line.slice(6)}` : line.slice(6);
            }
          }
        }

        // Stream ended cleanly → reconnect if still mounted.
        scheduleReconnect();
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        scheduleReconnect();
      }
    };

    void runOnce();

    return () => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      // abort() makes reader.read() throw AbortError, which is caught above
      // without a reconnect — so we don't need a separate `closed` flag.
      controller?.abort();
      controller = null;
    };
  }, [endpoint, reconnectDelayMs, reconnect]);
}
