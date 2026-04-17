/**
 * Predictive Intelligence API client
 *
 * Typed wrappers for /api/v1/predictive/* endpoints.
 * All responses contain UUID customer IDs only — no PHI.
 */

const BASE = '/api/v1/predictive';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PredictiveOverview {
  readonly totalDecisions: number;
  readonly uniqueCustomers: number;
  readonly approvalRate: number;
  readonly escalationRate: number;
  readonly avgConfidence: number;
  readonly windowDays: number;
}

export interface AtRiskCustomer {
  readonly customerId: string;
  readonly escalationCount: number;
  readonly lastDecisionAt: string;
  readonly avgConfidence: number;
  readonly lastAction: string;
  readonly riskLevel: 'critical' | 'high' | 'medium';
}

export interface OpportunityCustomer {
  readonly customerId: string;
  readonly approvalCount: number;
  readonly lastDecisionAt: string;
  readonly avgConfidence: number;
  readonly bestAction: string;
  readonly opportunityScore: number;
}

export interface ModelStat {
  readonly layer: 'rules' | 'ml_scorer' | 'llm_reasoner';
  readonly name: string;
  readonly model: string;
  readonly total: number;
  readonly approvalRate: number;
  readonly escalationRate: number;
  readonly rejectionRate: number;
  readonly avgConfidence: number;
  readonly avgLatencyMs: number;
}

export interface TrendPoint {
  readonly date: string;
  readonly approved: number;
  readonly escalated: number;
  readonly rejected: number;
  readonly avgLatencyMs: number;
  readonly avgConfidence: number;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const token = localStorage.getItem('auth_token') ?? '';
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: token !== '' ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`predictive API ${path}: ${res.status}`);
  const body = (await res.json()) as { success: boolean; data: T };
  if (!body.success) throw new Error(`predictive API ${path}: unexpected error`);
  return body.data;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function fetchPredictiveOverview(): Promise<PredictiveOverview> {
  return apiFetch<PredictiveOverview>('/overview');
}

export async function fetchAtRisk(limit = 20): Promise<readonly AtRiskCustomer[]> {
  return apiFetch<readonly AtRiskCustomer[]>(`/at-risk?limit=${limit}`);
}

export async function fetchOpportunities(limit = 20): Promise<readonly OpportunityCustomer[]> {
  return apiFetch<readonly OpportunityCustomer[]>(`/opportunities?limit=${limit}`);
}

export async function fetchModelStats(): Promise<readonly ModelStat[]> {
  return apiFetch<readonly ModelStat[]>('/model-stats');
}

export async function fetchTrends(): Promise<readonly TrendPoint[]> {
  return apiFetch<readonly TrendPoint[]>('/trends');
}
