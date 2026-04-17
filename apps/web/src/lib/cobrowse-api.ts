/**
 * Co-Browse API Service
 *
 * Typed wrappers over /api/v1/cobrowse endpoints.
 *
 * POST   /v1/cobrowse/sessions               — initiate session (admin)
 * GET    /v1/cobrowse/sessions               — list sessions
 * GET    /v1/cobrowse/sessions/:id           — session details
 * POST   /v1/cobrowse/sessions/:id/accept    — user accepts invite
 * POST   /v1/cobrowse/sessions/:id/reject    — user rejects invite
 * POST   /v1/cobrowse/sessions/:id/end       — end session
 *
 * SOC2 CC6.1 — Session access requires authentication.
 * HIPAA §164.312(b) — Audit controls: all session state changes are logged.
 * Rule 6 — No PHI in session metadata; userId is an opaque reference.
 */

import { apiClient } from './api';

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
