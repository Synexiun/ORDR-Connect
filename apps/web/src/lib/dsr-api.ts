/**
 * DSR API Service — GDPR Data Subject Request lifecycle
 *
 * Typed wrappers over /api/v1/dsr endpoints.
 *
 * GDPR Art. 12  — 30-day response deadline tracked per request.
 * GDPR Art. 15/17/20 — access / erasure / portability rights.
 * SOC2 CC6.1 — All requests tenant-scoped and RBAC-gated.
 *
 * SECURITY: No PHI in request payloads — customer IDs only (Rule 6).
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type DsrType = 'access' | 'erasure' | 'portability';

export type DsrStatus =
  | 'pending'
  | 'approved'
  | 'processing'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface DsrRecord {
  readonly id: string;
  readonly customerId: string;
  readonly type: DsrType;
  readonly status: DsrStatus;
  readonly requestedBy: string;
  readonly reason: string | null;
  readonly deadlineAt: string;
  readonly completedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DsrExport {
  readonly download_url: string;
  readonly expires_at: string;
  readonly file_size_bytes: number | null;
  readonly checksum_sha256: string;
}

export interface DsrDetail extends DsrRecord {
  readonly export?: DsrExport;
}

export interface ListDsrResult {
  readonly items: DsrRecord[];
  readonly total: number;
  readonly overdue_count: number;
}

export interface ListDsrParams {
  status?: DsrStatus;
  type?: DsrType;
  page?: number;
  limit?: number;
}

// ── API ────────────────────────────────────────────────────────────

export const dsrApi = {
  list(params: ListDsrParams = {}): Promise<ListDsrResult> {
    const qs = new URLSearchParams();
    if (params.status !== undefined) qs.set('status', params.status);
    if (params.type !== undefined) qs.set('type', params.type);
    if (params.page !== undefined) qs.set('page', String(params.page));
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return apiClient.get<ListDsrResult>(`/v1/dsr${q ? `?${q}` : ''}`);
  },

  get(id: string): Promise<DsrDetail> {
    return apiClient.get<DsrDetail>(`/v1/dsr/${id}`);
  },

  create(params: {
    customerId: string;
    type: DsrType;
    reason?: string;
  }): Promise<{
    id: string;
    customerId: string;
    type: DsrType;
    status: DsrStatus;
    deadline_at: string;
  }> {
    return apiClient.post('/v1/dsr', params);
  },

  approve(id: string): Promise<DsrRecord> {
    return apiClient.post<DsrRecord>(`/v1/dsr/${id}/approve`);
  },

  reject(id: string, reason: string): Promise<DsrRecord> {
    return apiClient.post<DsrRecord>(`/v1/dsr/${id}/reject`, { reason });
  },

  cancel(id: string): Promise<DsrRecord> {
    return apiClient.delete<DsrRecord>(`/v1/dsr/${id}`);
  },
};
