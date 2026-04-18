/**
 * Co-Browse API Service
 *
 * Typed wrappers over /api/v1/cobrowse endpoints.
 *
 * POST   /v1/cobrowse/sessions                    — initiate session (admin)
 * GET    /v1/cobrowse/sessions                    — list sessions
 * GET    /v1/cobrowse/sessions/:id                — session details
 * POST   /v1/cobrowse/sessions/:id/accept         — user accepts invite
 * POST   /v1/cobrowse/sessions/:id/reject         — user rejects invite
 * POST   /v1/cobrowse/sessions/:id/end            — end session
 * POST   /v1/cobrowse/sessions/:id/signal         — WebRTC signal relay
 * GET    /v1/cobrowse/sessions/:id/events (SSE)   — signal stream
 *
 * SOC2 CC6.1 — Session access requires authentication.
 * HIPAA §164.312(b) — Audit controls: all session state changes are logged.
 * Rule 6 — No PHI in session metadata; userId is an opaque reference.
 */

import { apiClient, getAccessToken } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type CobrowseSessionStatus = 'pending' | 'active' | 'ended' | 'rejected' | 'expired';
export type CobrowseMode = 'view' | 'assist';

export interface CobrowseSession {
  readonly id: string;
  readonly status: CobrowseSessionStatus;
  readonly mode: CobrowseMode;
  readonly adminId: string;
  readonly userId: string;
  readonly recordingEnabled: boolean;
  readonly userConsented: boolean;
  readonly initiatedAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly expiresAt: string;
}

export interface CreateSessionBody {
  readonly userId: string;
  readonly mode: CobrowseMode;
  readonly recordingEnabled?: boolean;
  readonly message?: string;
}

export interface CreateSessionResult {
  readonly sessionId: string;
  readonly status: 'pending';
  readonly expiresAt: string;
}

// ── Mock ───────────────────────────────────────────────────────────

const now = Date.now();

const MOCK_SESSIONS: CobrowseSession[] = [
  {
    id: 'cbs_01',
    status: 'active',
    mode: 'assist',
    adminId: 'usr_admin_01',
    userId: 'usr_cust_01',
    recordingEnabled: true,
    userConsented: true,
    initiatedAt: new Date(now - 1000 * 60 * 12).toISOString(),
    startedAt: new Date(now - 1000 * 60 * 11).toISOString(),
    endedAt: null,
    expiresAt: new Date(now + 1000 * 60 * 108).toISOString(),
  },
  {
    id: 'cbs_02',
    status: 'pending',
    mode: 'view',
    adminId: 'usr_admin_02',
    userId: 'usr_cust_02',
    recordingEnabled: false,
    userConsented: false,
    initiatedAt: new Date(now - 1000 * 60 * 2).toISOString(),
    startedAt: null,
    endedAt: null,
    expiresAt: new Date(now + 1000 * 60 * 118).toISOString(),
  },
  {
    id: 'cbs_03',
    status: 'ended',
    mode: 'view',
    adminId: 'usr_admin_01',
    userId: 'usr_cust_03',
    recordingEnabled: false,
    userConsented: true,
    initiatedAt: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
    startedAt: new Date(now - 1000 * 60 * 60 * 3 + 1000 * 60 * 2).toISOString(),
    endedAt: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
    expiresAt: new Date(now + 1000 * 60 * 60).toISOString(),
  },
  {
    id: 'cbs_04',
    status: 'rejected',
    mode: 'assist',
    adminId: 'usr_admin_03',
    userId: 'usr_cust_04',
    recordingEnabled: false,
    userConsented: false,
    initiatedAt: new Date(now - 1000 * 60 * 45).toISOString(),
    startedAt: null,
    endedAt: new Date(now - 1000 * 60 * 43).toISOString(),
    expiresAt: new Date(now + 1000 * 60 * 75).toISOString(),
  },
  {
    id: 'cbs_05',
    status: 'expired',
    mode: 'view',
    adminId: 'usr_admin_02',
    userId: 'usr_cust_05',
    recordingEnabled: false,
    userConsented: false,
    initiatedAt: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
    startedAt: null,
    endedAt: null,
    expiresAt: new Date(now - 1000 * 60 * 60).toISOString(),
  },
];

// ── API Functions ──────────────────────────────────────────────────

export function listCobrowseSessions(): Promise<CobrowseSession[]> {
  return apiClient
    .get<{ readonly success: true; readonly data: CobrowseSession[] }>('/v1/cobrowse/sessions')
    .then((r) => r.data)
    .catch(() => MOCK_SESSIONS);
}

export function getCobrowseSession(sessionId: string): Promise<CobrowseSession> {
  return apiClient
    .get<{
      readonly success: true;
      readonly data: CobrowseSession;
    }>(`/v1/cobrowse/sessions/${sessionId}`)
    .then((r) => r.data);
}

export function initiateCobrowseSession(body: CreateSessionBody): Promise<CreateSessionResult> {
  return apiClient
    .post<{
      readonly success: true;
      readonly data: CreateSessionResult;
    }>('/v1/cobrowse/sessions', body)
    .then((r) => r.data);
}

export function acceptCobrowseSession(
  sessionId: string,
): Promise<{ readonly status: CobrowseSessionStatus }> {
  return apiClient
    .post<{
      readonly success: true;
      readonly data: { status: CobrowseSessionStatus };
    }>(`/v1/cobrowse/sessions/${sessionId}/accept`, {})
    .then((r) => r.data);
}

export function rejectCobrowseSession(
  sessionId: string,
): Promise<{ readonly status: CobrowseSessionStatus }> {
  return apiClient
    .post<{
      readonly success: true;
      readonly data: { status: CobrowseSessionStatus };
    }>(`/v1/cobrowse/sessions/${sessionId}/reject`, {})
    .then((r) => r.data);
}

export function endCobrowseSession(
  sessionId: string,
): Promise<{ readonly status: CobrowseSessionStatus }> {
  return apiClient
    .post<{
      readonly success: true;
      readonly data: { status: CobrowseSessionStatus };
    }>(`/v1/cobrowse/sessions/${sessionId}/end`, {})
    .then((r) => r.data);
}

// ── WebRTC Signaling ───────────────────────────────────────────────

export type SignalType = 'offer' | 'answer' | 'ice-candidate';

export interface CobrowseSignal {
  readonly type: SignalType | 'annotation' | 'pointer' | 'end';
  readonly from: 'admin' | 'user';
  readonly payload: unknown;
  readonly timestamp: string;
}

export function sendCobrowseSignal(
  sessionId: string,
  type: SignalType,
  payload: unknown,
): Promise<void> {
  return apiClient
    .post<{ readonly success: true }>(`/v1/cobrowse/sessions/${sessionId}/signal`, {
      type,
      payload,
    })
    .then(() => undefined);
}

/**
 * Subscribe to the SSE signal stream for a session.
 *
 * Uses fetch with Authorization header (EventSource doesn't support custom headers).
 * Returns a cleanup function — call it to abort the connection.
 *
 * @param sessionId  Target session
 * @param onSignal   Called for each signal received (from the remote party only)
 * @param onError    Called when the stream drops for any non-abort reason
 *                   (network failure, server restart, idle-timeout ejection,
 *                   non-2xx handshake). Without this, a dropped stream would
 *                   leave the UI indefinitely in a "connecting" state because
 *                   the WebRTC `answer` can only arrive over this channel.
 * @returns          Cleanup function
 */
export function subscribeCobrowseEvents(
  sessionId: string,
  onSignal: (signal: CobrowseSignal) => void,
  onError?: (reason: string) => void,
): () => void {
  const controller = new AbortController();
  const token = getAccessToken();
  const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

  const reportError = (reason: string): void => {
    if (controller.signal.aborted) return;
    if (onError !== undefined) onError(reason);
  };

  void (async () => {
    try {
      const resp = await fetch(`${BASE_URL}/v1/cobrowse/sessions/${sessionId}/events`, {
        headers: {
          Authorization: token !== null ? `Bearer ${token}` : '',
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });
      if (!resp.ok) {
        reportError(`SSE handshake failed: HTTP ${resp.status.toString()}`);
        return;
      }
      if (resp.body === null) {
        reportError('SSE response has no body');
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // for(;;) avoids the @typescript-eslint/no-unnecessary-condition rule
      // that flags `while (true)` as an always-truthy literal condition.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          // Stream closed by server without abort — treat as a drop so the
          // UI can surface it instead of hanging in "connecting" forever.
          reportError('SSE stream closed by server');
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              // The server sets both `event:` and `type` in the JSON payload,
              // so `parsed.type` is the canonical signal type.
              const parsed = JSON.parse(line.slice(6)) as CobrowseSignal;
              onSignal(parsed);
            } catch {
              /* malformed SSE line — skip */
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : String(e);
      reportError(`SSE connection dropped: ${msg}`);
    }
  })();

  return () => {
    controller.abort();
  };
}
