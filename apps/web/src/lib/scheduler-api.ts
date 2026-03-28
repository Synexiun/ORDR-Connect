/**
 * Scheduler API Service
 *
 * Typed wrappers over /api/v1/scheduler endpoints.
 *
 * SOC2 CC6.1 — Scheduler instances are tenant-scoped.
 * ISO 27001 A.12.4.1 — Job state transitions logged in audit chain.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type JobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_letter';

export interface SchedulerInstance {
  readonly id: string;
  readonly jobType: string;
  readonly tenantId: string;
  readonly status: JobStatus;
  readonly scheduledAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly payload: Record<string, unknown>;
  readonly error?: string;
  readonly createdAt: string;
}

export interface DeadLetterEntry {
  readonly id: string;
  readonly originalInstanceId: string;
  readonly jobType: string;
  readonly tenantId: string;
  readonly payload: Record<string, unknown>;
  readonly error: string;
  readonly attempts: number;
  readonly deadLetteredAt: string;
}

export interface ListSchedulerInstancesParams {
  status?: JobStatus;
  jobType?: string;
  limit?: number;
}

// ── API ────────────────────────────────────────────────────────────

export const schedulerApi = {
  /**
   * List scheduler job instances with optional filters.
   */
  listInstances(params: ListSchedulerInstancesParams = {}): Promise<SchedulerInstance[]> {
    const query = new URLSearchParams();
    if (params.status !== undefined) query.set('status', params.status);
    if (params.jobType !== undefined) query.set('jobType', params.jobType);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiClient
      .get<{
        success: boolean;
        data: SchedulerInstance[];
        total: number;
      }>(`/v1/scheduler/instances${qs ? `?${qs}` : ''}`)
      .then((r) => r.data);
  },

  /**
   * Get a specific scheduler job instance by ID.
   */
  getInstance(instanceId: string): Promise<SchedulerInstance> {
    return apiClient
      .get<{ success: boolean; data: SchedulerInstance }>(`/v1/scheduler/instances/${instanceId}`)
      .then((r) => r.data);
  },

  /**
   * List dead-letter queue entries.
   */
  listDeadLetter(): Promise<DeadLetterEntry[]> {
    return apiClient
      .get<{
        success: boolean;
        data: DeadLetterEntry[];
        total: number;
      }>('/v1/scheduler/dead-letter')
      .then((r) => r.data);
  },
};
