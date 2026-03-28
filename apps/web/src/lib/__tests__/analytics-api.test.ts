/**
 * Analytics API Tests
 *
 * Validates:
 * - fetchDashboardSummary → GET /v1/analytics/dashboard, unwraps data
 * - fetchChannelMetrics → GET with from/to/granularity params, unwraps data
 * - fetchAgentMetrics → granularity depends on timeRange
 * - fetchComplianceMetrics → returns ComplianceMetricsResponse
 * - fetchTrend → GET /v1/analytics/trends/:metric with time params
 * - fetchRealTimeCounters → GET /v1/analytics/real-time, unwraps data
 * - timeRange granularity mapping (24h→hour, 7d/30d→day, 90d→week)
 *
 * COMPLIANCE: No PHI in any test assertion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import {
  fetchDashboardSummary,
  fetchChannelMetrics,
  fetchAgentMetrics,
  fetchComplianceMetrics,
  fetchTrend,
  fetchRealTimeCounters,
} from '../analytics-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_DASHBOARD_SUMMARY = {
  totalCustomers: 1200,
  activeAgents: 5,
  complianceScore: 98.2,
  revenueCollected: 84000,
  messagesDelivered: 12500,
  hitlPending: 3,
};

const MOCK_CHANNEL_METRICS = {
  channels: [
    {
      channel: 'sms',
      deliveryRate: 96.5,
      volume: 4200,
      costPerMessage: 0.012,
      failureRate: 3.5,
    },
  ],
  volumeOverTime: [],
};

const MOCK_AGENT_METRICS = {
  agents: [
    {
      agentRole: 'collections',
      sessions: 120,
      resolutionRate: 89.2,
      avgConfidence: 0.87,
      avgCost: 0.14,
      avgSteps: 4.2,
    },
  ],
  trend: [],
};

const MOCK_COMPLIANCE_METRICS = {
  scoreTrend: [{ date: '2026-03-28', score: 98.2 }],
  violationBreakdown: [],
  checkRatios: [],
};

const MOCK_TREND_RESPONSE = {
  success: true as const,
  data: [{ date: '2026-03-28', value: 94.5 }],
  metric: 'resolution_rate',
};

const MOCK_REALTIME_COUNTERS = {
  activeAgents: 3,
  messagesInFlight: 12,
  hitlPending: 2,
  complianceScore: 97.8,
  eventsPerMinute: 45,
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ success: true, data: MOCK_DASHBOARD_SUMMARY });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('fetchDashboardSummary', () => {
  it('calls GET /v1/analytics/dashboard', async () => {
    await fetchDashboardSummary();
    expect(mockGet).toHaveBeenCalledWith('/v1/analytics/dashboard');
  });

  it('unwraps and returns the data payload', async () => {
    const result = await fetchDashboardSummary();
    expect(result.totalCustomers).toBe(1200);
    expect(result.complianceScore).toBe(98.2);
  });
});

describe('fetchChannelMetrics', () => {
  it('calls GET /v1/analytics/channels with from/to/granularity', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_CHANNEL_METRICS });
    await fetchChannelMetrics('7d');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('/v1/analytics/channels');
    expect(url).toContain('granularity=day');
  });

  it('uses granularity=hour for 24h range', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_CHANNEL_METRICS });
    await fetchChannelMetrics('24h');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('granularity=hour');
  });

  it('uses granularity=week for 90d range', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_CHANNEL_METRICS });
    await fetchChannelMetrics('90d');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('granularity=week');
  });

  it('uses granularity=day for 30d range', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_CHANNEL_METRICS });
    await fetchChannelMetrics('30d');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('granularity=day');
  });

  it('unwraps and returns the channel metrics data', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_CHANNEL_METRICS });
    const result = await fetchChannelMetrics('7d');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].channel).toBe('sms');
  });
});

describe('fetchAgentMetrics', () => {
  it('calls GET /v1/analytics/agents with time params', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_AGENT_METRICS });
    await fetchAgentMetrics('30d');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('/v1/analytics/agents');
    expect(url).toContain('from=');
    expect(url).toContain('to=');
  });

  it('unwraps and returns agent metrics data', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_AGENT_METRICS });
    const result = await fetchAgentMetrics('7d');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].agentRole).toBe('collections');
  });
});

describe('fetchComplianceMetrics', () => {
  it('calls GET /v1/analytics/compliance with time params', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_COMPLIANCE_METRICS });
    await fetchComplianceMetrics('7d');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('/v1/analytics/compliance');
    expect(url).toContain('granularity=day');
  });

  it('unwraps and returns compliance metrics data', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_COMPLIANCE_METRICS });
    const result = await fetchComplianceMetrics('30d');
    expect(result.scoreTrend).toHaveLength(1);
    expect(result.scoreTrend[0].score).toBe(98.2);
  });
});

describe('fetchTrend', () => {
  it('calls GET /v1/analytics/trends/:metric with time params', async () => {
    mockGet.mockResolvedValue(MOCK_TREND_RESPONSE);
    await fetchTrend('resolution_rate', '7d');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('/v1/analytics/trends/resolution_rate');
    expect(url).toContain('granularity=day');
  });

  it('returns TrendResponse with metric name and data', async () => {
    mockGet.mockResolvedValue(MOCK_TREND_RESPONSE);
    const result = await fetchTrend('resolution_rate', '7d');
    expect(result.metric).toBe('resolution_rate');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].value).toBe(94.5);
  });

  it('includes from/to URL params', async () => {
    mockGet.mockResolvedValue(MOCK_TREND_RESPONSE);
    await fetchTrend('delivery_rate', '24h');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('from=');
    expect(url).toContain('to=');
    expect(url).toContain('granularity=hour');
  });
});

describe('fetchRealTimeCounters', () => {
  it('calls GET /v1/analytics/real-time', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_REALTIME_COUNTERS });
    await fetchRealTimeCounters();
    expect(mockGet).toHaveBeenCalledWith('/v1/analytics/real-time');
  });

  it('unwraps and returns real-time counters', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_REALTIME_COUNTERS });
    const result = await fetchRealTimeCounters();
    expect(result.activeAgents).toBe(3);
    expect(result.hitlPending).toBe(2);
    expect(result.eventsPerMinute).toBe(45);
  });
});
