/**
 * Analytics API Helpers
 *
 * All functions use the existing apiClient from lib/api.ts which includes:
 * - Authorization header (in-memory token)
 * - X-Request-Id correlation header (audit trail)
 * - 401 auto-redirect
 *
 * COMPLIANCE: No PHI in request parameters or response handling.
 */

import { apiClient } from './api';

// --- Types ---

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'custom';

export interface DashboardSummary {
  totalCustomers: number;
  activeAgents: number;
  complianceScore: number;
  revenueCollected: number;
  messagesDelivered: number;
  hitlPending: number;
}

export interface ChannelMetric {
  channel: string;
  deliveryRate: number;
  volume: number;
  costPerMessage: number;
  failureRate: number;
}

export interface ChannelVolumePoint {
  date: string;
  sms: number;
  email: number;
  voice: number;
  whatsapp: number;
}

export interface ChannelMetricsResponse {
  channels: ChannelMetric[];
  volumeOverTime: ChannelVolumePoint[];
}

export interface AgentMetricRow {
  agentRole: string;
  sessions: number;
  resolutionRate: number;
  avgConfidence: number;
  avgCost: number;
  avgSteps: number;
}

export interface AgentTrendPoint {
  date: string;
  resolutionRate: number;
}

export interface AgentMetricsResponse {
  agents: AgentMetricRow[];
  trend: AgentTrendPoint[];
}

export interface ComplianceMetricRow {
  regulation: string;
  violations: number;
  percentage: number;
}

export interface ComplianceScorePoint {
  date: string;
  score: number;
}

export interface ComplianceCheckRatio {
  checkType: string;
  passed: number;
  failed: number;
}

export interface ComplianceMetricsResponse {
  scoreTrend: ComplianceScorePoint[];
  violationBreakdown: ComplianceMetricRow[];
  checkRatios: ComplianceCheckRatio[];
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendResponse {
  metric: string;
  data: TrendPoint[];
}

export interface RealTimeCounters {
  activeAgents: number;
  messagesInFlight: number;
  hitlPending: number;
  complianceScore: number;
  eventsPerMinute: number;
}

// --- Helpers ---

/** Convert TimeRange shorthand to ISO from/to/granularity for the backend. */
function timeRangeToDates(range: TimeRange): {
  from: string;
  to: string;
  granularity: string;
} {
  const now = new Date();
  const to = now.toISOString();
  switch (range) {
    case '24h':
      return { from: new Date(now.getTime() - 86_400_000).toISOString(), to, granularity: 'hour' };
    case '7d':
      return {
        from: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
        to,
        granularity: 'day',
      };
    case '30d':
      return {
        from: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
        to,
        granularity: 'day',
      };
    case '90d':
      return {
        from: new Date(now.getTime() - 90 * 86_400_000).toISOString(),
        to,
        granularity: 'week',
      };
    default:
      return {
        from: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
        to,
        granularity: 'day',
      };
  }
}

// --- API functions ---

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const res = await apiClient.get<{ readonly success: true; readonly data: DashboardSummary }>(
    '/v1/analytics/dashboard',
  );
  return res.data;
}

export async function fetchChannelMetrics(timeRange: TimeRange): Promise<ChannelMetricsResponse> {
  const { from, to, granularity } = timeRangeToDates(timeRange);
  const res = await apiClient.get<{
    readonly success: true;
    readonly data: ChannelMetricsResponse;
  }>(
    `/v1/analytics/channels?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=${granularity}`,
  );
  return res.data;
}

export async function fetchAgentMetrics(timeRange: TimeRange): Promise<AgentMetricsResponse> {
  const { from, to, granularity } = timeRangeToDates(timeRange);
  const res = await apiClient.get<{
    readonly success: true;
    readonly data: AgentMetricsResponse;
  }>(
    `/v1/analytics/agents?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=${granularity}`,
  );
  return res.data;
}

export async function fetchComplianceMetrics(
  timeRange: TimeRange,
): Promise<ComplianceMetricsResponse> {
  const { from, to, granularity } = timeRangeToDates(timeRange);
  const res = await apiClient.get<{
    readonly success: true;
    readonly data: ComplianceMetricsResponse;
  }>(
    `/v1/analytics/compliance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=${granularity}`,
  );
  return res.data;
}

export async function fetchTrend(metric: string, timeRange: TimeRange): Promise<TrendResponse> {
  const { from, to, granularity } = timeRangeToDates(timeRange);
  const res = await apiClient.get<{
    readonly success: true;
    readonly data: TrendPoint[];
    readonly metric: string;
  }>(
    `/v1/analytics/trends/${metric}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=${granularity}`,
  );
  return { metric: res.metric, data: res.data };
}

export async function fetchRealTimeCounters(): Promise<RealTimeCounters> {
  const res = await apiClient.get<{ readonly success: true; readonly data: RealTimeCounters }>(
    '/v1/analytics/real-time',
  );
  return res.data;
}
