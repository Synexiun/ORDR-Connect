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

// --- API functions ---

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const res = await apiClient.get<{ readonly success: true; readonly data: DashboardSummary }>(
    '/v1/analytics/dashboard',
  );
  return res.data;
}

export async function fetchChannelMetrics(timeRange: TimeRange): Promise<ChannelMetricsResponse> {
  return apiClient.get<ChannelMetricsResponse>(`/v1/analytics/channels?range=${timeRange}`);
}

export async function fetchAgentMetrics(timeRange: TimeRange): Promise<AgentMetricsResponse> {
  return apiClient.get<AgentMetricsResponse>(`/v1/analytics/agents?range=${timeRange}`);
}

export async function fetchComplianceMetrics(
  timeRange: TimeRange,
): Promise<ComplianceMetricsResponse> {
  return apiClient.get<ComplianceMetricsResponse>(`/v1/analytics/compliance?range=${timeRange}`);
}

export async function fetchTrend(metric: string, timeRange: TimeRange): Promise<TrendResponse> {
  return apiClient.get<TrendResponse>(`/v1/analytics/trends/${metric}?range=${timeRange}`);
}

export async function fetchRealTimeCounters(): Promise<RealTimeCounters> {
  const res = await apiClient.get<{ readonly success: true; readonly data: RealTimeCounters }>(
    '/v1/analytics/real-time',
  );
  return res.data;
}
