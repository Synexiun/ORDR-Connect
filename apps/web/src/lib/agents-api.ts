/**
 * Agents API Service
 *
 * Typed wrappers over /api/v1/agents endpoints.
 * Covers: trigger, sessions, HITL queue, kill switch.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type AgentRole =
  | 'lead_qualifier'
  | 'follow_up'
  | 'meeting_prep'
  | 'churn_detection'
  | 'collections'
  | 'support_triage'
  | 'escalation'
  | 'executive_briefing';

export type AutonomyLevel = 'rule_based' | 'router' | 'supervised' | 'autonomous' | 'full_autonomy';

export type SessionStatus = 'active' | 'completed' | 'killed' | 'escalated' | 'failed';

export interface AgentStep {
  readonly stepNumber: number;
  readonly action: string;
  readonly toolUsed: string | null;
  readonly confidence: number;
  readonly approved: boolean;
  readonly timestamp: string;
}

export interface AgentSession {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly agentRole: AgentRole;
  readonly status: SessionStatus;
  readonly autonomyLevel: AutonomyLevel;
  readonly steps: AgentStep[];
  readonly costCents: number;
  readonly confidenceScore: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly killReason: string | null;
}

export interface HitlItem {
  readonly id: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly action: string;
  readonly reason: string;
  readonly context: Record<string, unknown>;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface SessionListParams {
  page?: number;
  pageSize?: number;
  status?: SessionStatus;
  agentRole?: AgentRole;
}

export interface SessionListResponse {
  readonly success: true;
  readonly data: AgentSession[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface HitlListResponse {
  readonly success: true;
  readonly data: HitlItem[];
  readonly total: number;
}

// ── API Functions ──────────────────────────────────────────────────

export function triggerAgent(body: {
  readonly customerId: string;
  readonly agentRole: AgentRole;
  readonly autonomyLevel?: AutonomyLevel;
}): Promise<{ readonly success: true; readonly sessionId: string }> {
  return apiClient.post<{ readonly success: true; readonly sessionId: string }>(
    '/v1/agents/trigger',
    body,
  );
}

export function listSessions(params: SessionListParams = {}): Promise<SessionListResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  if (params.status !== undefined) query.set('status', params.status);
  if (params.agentRole !== undefined) query.set('agentRole', params.agentRole);
  const qs = query.toString();
  return apiClient.get<SessionListResponse>(`/v1/agents/sessions${qs.length > 0 ? `?${qs}` : ''}`);
}

export function getSession(
  sessionId: string,
): Promise<{ readonly success: true; readonly data: AgentSession }> {
  return apiClient.get<{ readonly success: true; readonly data: AgentSession }>(
    `/v1/agents/sessions/${sessionId}`,
  );
}

export async function killSession(sessionId: string, reason: string): Promise<void> {
  await apiClient.post(`/v1/agents/sessions/${sessionId}/kill`, { reason });
}

export function listHitl(): Promise<HitlListResponse> {
  return apiClient.get<HitlListResponse>('/v1/agents/hitl');
}

export async function approveHitl(hitlId: string, notes?: string): Promise<void> {
  await apiClient.post(`/v1/agents/hitl/${hitlId}/approve`, { notes });
}

export async function rejectHitl(hitlId: string, reason: string): Promise<void> {
  await apiClient.post(`/v1/agents/hitl/${hitlId}/reject`, { reason });
}
