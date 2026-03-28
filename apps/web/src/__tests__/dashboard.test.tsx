/**
 * Dashboard Page Tests
 *
 * Validates:
 * - Loading spinner shown initially
 * - Page heading "Dashboard" and subtitle "Operations overview"
 * - KPI card labels: Total Customers, Active Agents, Compliance Score, Revenue Collected
 * - Section headings: Revenue Trend, Channel Distribution, Delivery Trend, Agent Success Rate
 * - Quick Actions section and buttons
 * - System Health section with service names
 * - Agent Performance section labels
 * - Fallback renders without crashing on API failure
 *
 * COMPLIANCE: No PHI. SOC2 CC6.1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// ─── Mock chart + activity components ───────────────────────────

vi.mock('../components/charts/SparkLine', () => ({ SparkLine: () => null }));
vi.mock('../components/charts/DonutChart', () => ({ DonutChart: () => null }));
vi.mock('../components/charts/AreaChart', () => ({ AreaChart: () => null }));
vi.mock('../components/activity-feed/ActivityFeed', () => ({
  ActivityFeed: () => null,
}));

// ─── Mock hooks ──────────────────────────────────────────────────

vi.mock('../hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: () => undefined,
}));
vi.mock('../hooks/useInterval', () => ({
  useInterval: () => undefined,
}));

// ─── Mock analytics API ──────────────────────────────────────────

const mockFetchDashboardSummary = vi.fn();
const mockFetchRealTimeCounters = vi.fn();
const mockFetchChannelMetrics = vi.fn();
const mockFetchTrend = vi.fn();

vi.mock('../lib/analytics-api', () => ({
  fetchDashboardSummary: (...args: unknown[]) => mockFetchDashboardSummary(...args) as unknown,
  fetchRealTimeCounters: (...args: unknown[]) => mockFetchRealTimeCounters(...args) as unknown,
  fetchChannelMetrics: (...args: unknown[]) => mockFetchChannelMetrics(...args) as unknown,
  fetchTrend: (...args: unknown[]) => mockFetchTrend(...args) as unknown,
}));

import { Dashboard } from '../pages/Dashboard';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_SUMMARY = {
  totalCustomers: 1200,
  activeAgents: 5,
  complianceScore: 98.2,
  revenueCollected: 84000,
  messagesDelivered: 12500,
  hitlPending: 0,
};

const MOCK_REALTIME = {
  activeAgents: 3,
  messagesInFlight: 12,
  hitlPending: 0,
  complianceScore: 97.8,
  eventsPerMinute: 45,
};

const MOCK_CHANNEL_METRICS = {
  channels: [
    { channel: 'sms', deliveryRate: 96.5, volume: 4200, costPerMessage: 0.012, failureRate: 3.5 },
  ],
  volumeOverTime: [],
};

const MOCK_TREND = {
  success: true as const,
  metric: 'resolution_rate',
  data: [{ date: '2026-03-28', value: 94.5 }],
};

// ─── Setup / Teardown ────────────────────────────────────────────

function renderDashboard(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Dashboard)));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchDashboardSummary.mockResolvedValue(MOCK_SUMMARY);
  mockFetchRealTimeCounters.mockResolvedValue(MOCK_REALTIME);
  mockFetchChannelMetrics.mockResolvedValue({ success: true, data: MOCK_CHANNEL_METRICS });
  mockFetchTrend.mockResolvedValue(MOCK_TREND);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('Dashboard page', () => {
  it('shows loading spinner initially', () => {
    renderDashboard();
    expect(screen.getByText('Loading dashboard')).toBeDefined();
  });

  it('renders page heading after data loads', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeDefined();
    });
  });

  it('renders page subtitle "Operations overview"', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Operations overview')).toBeDefined();
    });
  });

  it('renders KPI label: Total Customers', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Total Customers')).toBeDefined();
    });
  });

  it('renders KPI label: Active Agents', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText('Active Agents').length).toBeGreaterThan(0);
    });
  });

  it('renders KPI label: Compliance Score', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText('Compliance Score').length).toBeGreaterThan(0);
    });
  });

  it('renders KPI label: Revenue Collected', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Revenue Collected')).toBeDefined();
    });
  });

  it('renders Revenue Trend card heading', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Revenue Trend — Last 30 Days')).toBeDefined();
    });
  });

  it('renders Channel Distribution card heading', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Channel Distribution')).toBeDefined();
    });
  });

  it('renders Quick Actions section', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Quick Actions')).toBeDefined();
    });
  });

  it('renders New Customer button', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText('New Customer').length).toBeGreaterThan(0);
    });
  });

  it('renders System Health section', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('System Health')).toBeDefined();
    });
  });

  it('renders service health items', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('API Gateway')).toBeDefined();
      expect(screen.getByText('PostgreSQL')).toBeDefined();
    });
  });

  it('renders Agent Performance section', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Agent Performance')).toBeDefined();
    });
  });

  it('renders Sessions Today label', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Sessions Today')).toBeDefined();
    });
  });

  it('calls fetchDashboardSummary on mount', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(mockFetchDashboardSummary).toHaveBeenCalledTimes(1);
    });
  });

  it('renders without crashing on API failure', async () => {
    mockFetchDashboardSummary.mockRejectedValue(new Error('Network error'));
    mockFetchRealTimeCounters.mockRejectedValue(new Error('Network error'));
    mockFetchChannelMetrics.mockRejectedValue(new Error('Network error'));
    mockFetchTrend.mockRejectedValue(new Error('Network error'));
    renderDashboard();
    await waitFor(
      () => {
        expect(screen.getByText('Dashboard')).toBeDefined();
      },
      { timeout: 5000 },
    );
  });
});
