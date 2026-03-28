/**
 * Healthcare API service — typed wrappers for /api/v1/healthcare/* endpoints
 *
 * HIPAA §164.312(a)(1) — Access control: all calls require auth (JWT sent via cookie).
 * HIPAA §164.502(b)    — Minimum necessary: only tokenized, non-PHI fields returned.
 * No PHI is ever stored, transmitted, or rendered through this module.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface PatientQueueItem {
  tokenId: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  position: number;
  waitMinutes: number;
  department: string;
}

export interface AppointmentItem {
  id: string;
  patientToken: string;
  scheduledAt: string;
  durationMinutes: number;
  type: 'consultation' | 'follow-up' | 'procedure' | 'screening';
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
}

export interface CarePlanStatus {
  id: string;
  patientToken: string;
  phase: 'assessment' | 'planning' | 'implementation' | 'evaluation';
  completionPct: number;
  updatedAt: string;
}

export interface ComplianceStatus {
  level: 'green' | 'yellow' | 'red';
  hipaaScore: number;
  lastAuditDate: string;
  openFindings: number;
  checksPassed: number;
  checksTotal: number;
}

export interface AgentActivityItem {
  id: string;
  agentName: string;
  action: string;
  status: 'completed' | 'pending' | 'failed';
  timestamp: string;
  confidence: number;
}

// ─── API wrappers ────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1/healthcare${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Healthcare API error: ${String(res.status)} ${path}`);
  const json = (await res.json()) as { success: boolean; data: T };
  if (!json.success) throw new Error(`Healthcare API returned success=false for ${path}`);
  return json.data;
}

export async function getPatientQueue(): Promise<PatientQueueItem[]> {
  return get<PatientQueueItem[]>('/queue');
}

export async function getAppointments(): Promise<AppointmentItem[]> {
  return get<AppointmentItem[]>('/appointments');
}

export async function getCarePlans(): Promise<CarePlanStatus[]> {
  return get<CarePlanStatus[]>('/care-plans');
}

export async function getComplianceStatus(): Promise<ComplianceStatus> {
  return get<ComplianceStatus>('/compliance');
}

export async function getAgentActivity(): Promise<AgentActivityItem[]> {
  return get<AgentActivityItem[]>('/agent-activity');
}
