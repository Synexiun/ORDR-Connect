/**
 * Workflow API Service
 *
 * Typed wrappers over /api/v1/workflow endpoints.
 *
 * SOC2 CC6.1 — Workflow instances are tenant-scoped; tenantId sourced from JWT.
 * ISO 27001 A.12.4.1 — All state transitions are correlated by requestId in audit log.
 * HIPAA §164.312 — Workflow payloads MUST NOT contain PHI; use tokenized IDs only.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly description?: string;
  readonly steps: WorkflowStepDefinition[];
}

export interface WorkflowStepDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly config: Record<string, unknown>;
}

export interface WorkflowInstance {
  readonly id: string;
  readonly definitionId: string;
  readonly tenantId: string;
  readonly status: WorkflowStatus;
  readonly context: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly completedAt?: string;
  readonly error?: string;
}

export interface StartWorkflowParams {
  definitionId: string;
  context: {
    entityType: string;
    entityId: string;
    tenantId: string;
    variables?: Record<string, unknown>;
    correlationId: string;
    initiatedBy: string;
  };
}

export interface ListInstancesParams {
  status?: WorkflowStatus;
  limit?: number;
}

// ── API ────────────────────────────────────────────────────────────

export const workflowApi = {
  /**
   * List all built-in workflow definition templates.
   */
  listDefinitions(): Promise<WorkflowDefinition[]> {
    return apiClient
      .get<{
        success: boolean;
        data: WorkflowDefinition[];
        total: number;
      }>('/v1/workflow/definitions')
      .then((r) => r.data);
  },

  /**
   * Start a new workflow instance.
   * Returns 201 with the created instance.
   */
  startInstance(params: StartWorkflowParams): Promise<WorkflowInstance> {
    return apiClient
      .post<{ success: boolean; data: WorkflowInstance }>('/v1/workflow/instances', params)
      .then((r) => r.data);
  },

  /**
   * List workflow instances for the current tenant.
   */
  listInstances(params: ListInstancesParams = {}): Promise<WorkflowInstance[]> {
    const query = new URLSearchParams();
    if (params.status !== undefined) query.set('status', params.status);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiClient
      .get<{
        success: boolean;
        data: WorkflowInstance[];
        total: number;
      }>(`/v1/workflow/instances${qs ? `?${qs}` : ''}`)
      .then((r) => r.data);
  },

  /**
   * Get a specific workflow instance by ID.
   */
  getInstance(instanceId: string): Promise<WorkflowInstance> {
    return apiClient
      .get<{ success: boolean; data: WorkflowInstance }>(`/v1/workflow/instances/${instanceId}`)
      .then((r) => r.data);
  },

  /**
   * Pause a running workflow instance.
   */
  pauseInstance(instanceId: string): Promise<WorkflowInstance> {
    return apiClient
      .patch<{
        success: boolean;
        data: WorkflowInstance;
      }>(`/v1/workflow/instances/${instanceId}/pause`)
      .then((r) => r.data);
  },

  /**
   * Resume a paused workflow instance.
   */
  resumeInstance(instanceId: string): Promise<WorkflowInstance> {
    return apiClient
      .patch<{
        success: boolean;
        data: WorkflowInstance;
      }>(`/v1/workflow/instances/${instanceId}/resume`)
      .then((r) => r.data);
  },

  /**
   * Cancel a workflow instance.
   */
  cancelInstance(instanceId: string, reason: string): Promise<WorkflowInstance> {
    return apiClient
      .delete<{
        success: boolean;
        data: WorkflowInstance;
      }>(`/v1/workflow/instances/${instanceId}`, { headers: { 'X-Cancel-Reason': reason } })
      .then((r) => r.data);
  },
};
