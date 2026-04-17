/**
 * User Sessions API Service
 *
 * Typed wrappers over /api/v1/sessions endpoints.
 * Covers: active session list, per-session revocation, bulk revocation,
 * and failed login attempt history.
 *
 * SECURITY:
 * - Source IPs stored as SHA-256 hashes only (GDPR Art. 5(1)(c)) — Rule 6
 * - Geo stored as 2-letter country code only — no city/region — Rule 6
 * - Session revocation inserts JTI into Redis deny-list server-side — Rule 2
 * - All revocations WORM-logged with revoker identity — Rule 3
 * - isCurrent flag prevents self-lockout (server-derived, not client-supplied) — Rule 2
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.15 | HIPAA §164.312(a)(2)(iii)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'idle' | 'expired';
export type DeviceType = 'desktop' | 'mobile' | 'api';

export interface UserSession {
  readonly id: string;
  readonly jti: string;
  /** Internal user UUID — never email or name */
  readonly userId: string;
  /** Display name (first name + last initial only, for UI) */
  readonly userDisplayName: string;
  readonly userRole: string;
  /** SHA-256(IP) — GDPR data minimisation */
  readonly sourceIpHash: string | null;
  /** ISO 3166-1 alpha-2 country code only */
  readonly countryCode: string | null;
  readonly userAgent: string;
  readonly deviceType: DeviceType;
  readonly mfaVerified: boolean;
  readonly loginAt: string;
  readonly lastActiveAt: string;
  readonly expiresAt: string;
  readonly status: SessionStatus;
  /** Server-derived — never trust client claim */
  readonly isCurrent: boolean;
}

export interface FailedLoginAttempt {
  readonly id: string;
  readonly sourceIpHash: string;
  readonly countryCode: string | null;
  readonly userAgent: string;
  readonly attemptedAt: string;
  readonly reason: 'bad_password' | 'mfa_failed' | 'account_locked' | 'invalid_token';
}

export interface SessionStats {
  readonly activeSessions: number;
  readonly failedLogins24h: number;
  readonly avgSessionDurationHours: number;
  readonly mfaCoverage: number; // 0–100
}

// ── API Client ─────────────────────────────────────────────────────────────

export const sessionsApi = {
  async listSessions(): Promise<UserSession[]> {
    return apiClient.get<UserSession[]>('/sessions');
  },

  async getStats(): Promise<SessionStats> {
    return apiClient.get<SessionStats>('/sessions/stats');
  },

  async revokeSession(id: string): Promise<void> {
    return apiClient.post(`/sessions/${id}/revoke`, {});
  },

  async revokeAllOthers(): Promise<{ revoked: number }> {
    return apiClient.post<{ revoked: number }>('/sessions/revoke-others', {});
  },

  async listFailedLogins(limit?: number): Promise<FailedLoginAttempt[]> {
    const q = new URLSearchParams({ limit: String(limit ?? 20) });
    return apiClient.get<FailedLoginAttempt[]>(`/sessions/failed-logins?${q}`);
  },
};
