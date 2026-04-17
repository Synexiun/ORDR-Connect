/**
 * Scheduler API Service
 *
 * Typed wrappers over /api/v1/scheduler endpoints.
 * Covers: job definition CRUD, manual triggers, instance inspection,
 * dead-letter queue management, and replay.
 *
 * SECURITY:
 * - All definitions and instances are tenant-scoped — Rule 2
 * - Definition mutations WORM-logged with actor identity — Rule 3
 * - Job payloads must not contain PHI — Rule 6
 * - Trigger and replay require scheduler.write RBAC — Rule 2
 *
 * SOC 2 CC7.2 | ISO 27001 A.8.6 | HIPAA §164.312(a)(1)
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_letter';

export type JobPriority = 'low' | 'normal' | 'high' | 'critical';
export type DefinitionStatus = 'active' | 'paused' | 'disabled';

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

export interface JobDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly jobType: string;
  readonly description: string;
  /** 5-part cron expression, or null for manual-only jobs */
  readonly cronSchedule: string | null;
  readonly status: DefinitionStatus;
  readonly maxAttempts: number;
  readonly timeoutSeconds: number;
  readonly priority: JobPriority;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly runCount: number;
  readonly failureCount: number;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface SchedulerStats {
  readonly activeDefinitions: number;
  readonly runningInstances: number;
  readonly failedToday: number;
  readonly deadLetterCount: number;
}

export interface CreateJobDefinitionBody {
  readonly jobType: string;
  readonly description: string;
  readonly cronSchedule: string | null;
  readonly maxAttempts: number;
  readonly timeoutSeconds: number;
  readonly priority: JobPriority;
}

export interface UpdateJobDefinitionBody {
  readonly description?: string;
  readonly cronSchedule?: string | null;
  readonly maxAttempts?: number;
  readonly timeoutSeconds?: number;
  readonly priority?: JobPriority;
  readonly status?: DefinitionStatus;
}

export interface ListSchedulerInstancesParams {
  status?: JobStatus;
  jobType?: string;
  limit?: number;
}

// ── API Client ─────────────────────────────────────────────────────────────

export const schedulerApi = {
  async getStats(): Promise<SchedulerStats> {
    return apiClient.get<SchedulerStats>('/scheduler/stats');
  },

  async listDefinitions(): Promise<JobDefinition[]> {
    return apiClient.get<JobDefinition[]>('/scheduler/definitions');
  },

  async createDefinition(body: CreateJobDefinitionBody): Promise<JobDefinition> {
    return apiClient.post<JobDefinition>('/scheduler/definitions', body);
  },

  async updateDefinition(id: string, body: UpdateJobDefinitionBody): Promise<JobDefinition> {
    return apiClient.put<JobDefinition>(`/scheduler/definitions/${id}`, body);
  },

  async deleteDefinition(id: string): Promise<void> {
    await apiClient.delete<unknown>(`/scheduler/definitions/${id}`);
  },

  async triggerNow(id: string): Promise<SchedulerInstance> {
    return apiClient.post<SchedulerInstance>(`/scheduler/definitions/${id}/trigger`, {});
  },

  async replayDead(deadLetterId: string): Promise<SchedulerInstance> {
    return apiClient.post<SchedulerInstance>(`/scheduler/dead-letter/${deadLetterId}/replay`, {});
  },

  listInstances(params: ListSchedulerInstancesParams = {}): Promise<SchedulerInstance[]> {
    const query = new URLSearchParams();
    if (params.status !== undefined) query.set('status', params.status);
    if (params.jobType !== undefined) query.set('jobType', params.jobType);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiClient
      .get<{ data: SchedulerInstance[] }>(`/scheduler/instances${qs !== '' ? `?${qs}` : ''}`)
      .then((r) => r.data);
  },

  getInstance(instanceId: string): Promise<SchedulerInstance> {
    return apiClient
      .get<{ data: SchedulerInstance }>(`/scheduler/instances/${instanceId}`)
      .then((r) => r.data);
  },

  listDeadLetter(): Promise<DeadLetterEntry[]> {
    return apiClient.get<{ data: DeadLetterEntry[] }>('/scheduler/dead-letter').then((r) => r.data);
  },
};
