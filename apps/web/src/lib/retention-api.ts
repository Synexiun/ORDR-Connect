/**
 * Data Retention API Service
 *
 * Typed wrappers over /api/v1/data-retention endpoints.
 * Covers: policy management, purge job history, and GDPR/CCPA
 * cryptographic erasure queue.
 *
 * SECURITY:
 * - No PHI in retention responses — category + counts only — Rule 6
 * - Policy reduction below regulatory floor rejected server-side — Rule 4
 * - All policy changes WORM-logged with actor identity — Rule 3
 * - Erasure requests execute crypto_erasure (DEK destruction), not hard delete — Rule 1
 *
 * SOC 2 P5 | ISO 27001 A.8.10 | HIPAA §164.530(j) | GDPR Art. 17
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type DataCategory =
  | 'phi'
  | 'audit'
  | 'financial'
  | 'operational'
  | 'compliance'
  | 'analytics';

export type PurgeMethod = 'hard_delete' | 'crypto_erasure' | 'archive';
export type PurgeStatus = 'scheduled' | 'running' | 'completed' | 'failed';
export type ErasureRegulation = 'GDPR' | 'CCPA';
export type ErasureStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface RetentionPolicy {
  readonly id: string;
  readonly category: DataCategory;
  readonly displayName: string;
  readonly regulations: readonly string[];
  /** Regulatory floor — server rejects any update below this */
  readonly minimumRetentionDays: number;
  readonly currentRetentionDays: number;
  readonly sizeBytes: number;
  readonly recordCount: number;
  readonly oldestRecordAt: string;
  readonly nextPurgeDue: string | null;
  readonly purgeMethod: PurgeMethod;
  readonly lastUpdatedAt: string;
}

export interface PurgeJob {
  readonly id: string;
  readonly category: DataCategory;
  readonly scheduledAt: string;
  readonly completedAt: string | null;
  readonly recordsPurged: number;
  readonly bytesFreed: number;
  readonly status: PurgeStatus;
  readonly method: PurgeMethod;
  /** 'automatic' or internal user UUID */
  readonly triggeredBy: string;
  readonly errorMessage: string | null;
}

export interface ErasureRequest {
  readonly id: string;
  /** Internal customer UUID — never email/name */
  readonly customerId: string;
  readonly regulation: ErasureRegulation;
  readonly requestedAt: string;
  readonly verifiedAt: string | null;
  /** Deadline = verifiedAt + 30 days (GDPR) / 45 days (CCPA) */
  readonly deadline: string;
  readonly status: ErasureStatus;
  readonly method: 'crypto_erasure';
  readonly affectedRecords: number;
  readonly completedAt: string | null;
}

export interface RetentionStats {
  readonly totalSizeBytes: number;
  readonly upcomingPurges30d: number;
  readonly pendingErasures: number;
  readonly oldestDataDays: number;
}

export interface UpdatePolicyBody {
  readonly currentRetentionDays: number;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const retentionApi = {
  async listPolicies(): Promise<RetentionPolicy[]> {
    return apiClient.get<RetentionPolicy[]>('/data-retention/policies');
  },

  async updatePolicy(id: string, body: UpdatePolicyBody): Promise<RetentionPolicy> {
    return apiClient.put<RetentionPolicy>(`/data-retention/policies/${id}`, body);
  },

  async getStats(): Promise<RetentionStats> {
    return apiClient.get<RetentionStats>('/data-retention/stats');
  },

  async listPurgeJobs(): Promise<PurgeJob[]> {
    return apiClient.get<PurgeJob[]>('/data-retention/purge-jobs');
  },

  async listErasureRequests(): Promise<ErasureRequest[]> {
    return apiClient.get<ErasureRequest[]>('/data-retention/erasure-requests');
  },

  async executeErasure(id: string): Promise<void> {
    return apiClient.post(`/data-retention/erasure-requests/${id}/execute`, {});
  },
};
