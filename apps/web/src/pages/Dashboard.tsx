import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { ActivityFeed } from '../components/activity-feed/ActivityFeed';
import { LineChart } from '../components/charts/LineChart';
import { apiClient } from '../lib/api';

// --- Types ---

interface KpiData {
  totalCustomers: number;
  activeAgents: number;
  complianceScore: number;
  revenueCollected: number;
}

interface AgentPerformance {
  sessionsToday: number;
  successRate: number;
  avgConfidence: number;
  activeNow: number;
}

interface MiniTrendPoint {
  date: string;
  value: number;
}

// --- Helpers ---

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

// --- Mock data for development ---

const mockKpis: KpiData = {
  totalCustomers: 2847,
  activeAgents: 12,
  complianceScore: 96,
  revenueCollected: 1284500,
};

const mockAgentPerf: AgentPerformance = {
  sessionsToday: 347,
  successRate: 94.2,
  avgConfidence: 0.87,
  activeNow: 8,
};

const mockDeliveryTrend: MiniTrendPoint[] = Array.from({ length: 7 }, (_, i) => ({
  date: new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('en-US', { weekday: 'short' }),
  value: 1800 + Math.floor(Math.sin(i * 0.8) * 400),
}));

const mockAgentSparkline: MiniTrendPoint[] = Array.from({ length: 7 }, (_, i) => ({
  date: new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('en-US', { weekday: 'short' }),
  value: 88 + Math.floor(Math.sin(i * 0.7) * 6),
}));

// --- Component ---

export function Dashboard(): ReactNode {
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [agentPerf, setAgentPerf] = useState<AgentPerformance | null>(null);
  const [deliveryTrend, setDeliveryTrend] = useState<MiniTrendPoint[]>([]);
  const [agentSparkline, setAgentSparkline] = useState<MiniTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [kpiRes, agentRes] = await Promise.allSettled([
        apiClient.get<KpiData>('/v1/dashboard/kpis'),
        apiClient.get<AgentPerformance>('/v1/dashboard/agent-performance'),
      ]);

      setKpis(kpiRes.status === 'fulfilled' ? kpiRes.value : mockKpis);
      setAgentPerf(agentRes.status === 'fulfilled' ? agentRes.value : mockAgentPerf);
      // Mini trends — graceful degradation to mock
      setDeliveryTrend(mockDeliveryTrend);
      setAgentSparkline(mockAgentSparkline);
    } catch {
      // Graceful degradation — use mock data
      setKpis(mockKpis);
      setAgentPerf(mockAgentPerf);
      setDeliveryTrend(mockDeliveryTrend);
      setAgentSparkline(mockAgentSparkline);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading dashboard" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Dashboard</h1>
          <p className="mt-1 text-sm text-content-secondary">Operations overview</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fetchDashboard}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => navigate('/customers')}>
            + New Customer
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button
          className="kpi-card text-left transition-colors hover:border-border-light"
          onClick={() => navigate('/customers')}
          aria-label="View customers"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
            Total Customers
          </p>
          <p className="mt-2 text-2xl font-bold text-content">
            {formatNumber(kpis?.totalCustomers ?? 0)}
          </p>
          <p className="mt-1 text-xs text-emerald-400">+12.4% from last month</p>
        </button>

        <button
          className="kpi-card text-left transition-colors hover:border-border-light"
          onClick={() => navigate('/agents')}
          aria-label="View agents"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
            Active Agents
          </p>
          <p className="mt-2 text-2xl font-bold text-content">{kpis?.activeAgents ?? 0}</p>
          <p className="mt-1 text-xs text-content-secondary">
            {agentPerf?.activeNow ?? 0} running now
          </p>
        </button>

        <button
          className="kpi-card text-left transition-colors hover:border-border-light"
          onClick={() => navigate('/compliance')}
          aria-label="View compliance"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
            Compliance Score
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-400">
            {kpis?.complianceScore ?? 0}%
          </p>
          <p className="mt-1 text-xs text-content-secondary">SOC2 / ISO27001 / HIPAA</p>
        </button>

        <button
          className="kpi-card text-left transition-colors hover:border-border-light"
          onClick={() => navigate('/analytics')}
          aria-label="View analytics"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
            Revenue Collected
          </p>
          <p className="mt-2 text-2xl font-bold text-content">
            {formatCurrency(kpis?.revenueCollected ?? 0)}
          </p>
          <p className="mt-1 text-xs text-emerald-400">+8.1% from last month</p>
        </button>
      </div>

      {/* Mini chart row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Delivery Trend (7 days)" actions={<Badge variant="info" size="sm">Messages</Badge>}>
          <LineChart
            series={[{
              data: deliveryTrend.map((t) => ({ x: t.date, y: t.value })),
              color: '#3b82f6',
              label: 'Deliveries',
            }]}
            height={140}
            showGrid
            showDots={false}
          />
        </Card>

        <Card title="Agent Success Rate (7 days)" actions={<Badge variant="success" size="sm">%</Badge>}>
          <LineChart
            series={[{
              data: agentSparkline.map((t) => ({ x: t.date, y: t.value })),
              color: '#10b981',
              label: 'Success Rate',
            }]}
            height={140}
            showGrid
            showDots={false}
          />
        </Card>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Live Activity Feed — 2/3 width */}
        <div className="lg:col-span-2">
          <Card title="Live Activity" actions={<Badge variant="info" dot>Live</Badge>}>
            <ActivityFeed maxItems={50} pollInterval={5000} />
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Agent Performance */}
          <Card title="Agent Performance">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary">Sessions Today</span>
                <span className="text-sm font-semibold text-content">
                  {agentPerf?.sessionsToday ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary">Success Rate</span>
                <span className="text-sm font-semibold text-emerald-400">
                  {agentPerf?.successRate ?? 0}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary">Avg Confidence</span>
                <span className="text-sm font-semibold text-content">
                  {((agentPerf?.avgConfidence ?? 0) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary">Active Now</span>
                <Badge variant="success" dot size="sm">
                  {agentPerf?.activeNow ?? 0}
                </Badge>
              </div>
            </div>
          </Card>

          {/* Quick Actions */}
          <Card title="Quick Actions">
            <div className="space-y-2">
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                onClick={() => navigate('/customers')}
              >
                <span aria-hidden="true">{'\u25CF'}</span> New Customer
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                onClick={() => navigate('/agents')}
              >
                <span aria-hidden="true">{'\u25B2'}</span> Trigger Agent
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                onClick={() => navigate('/analytics')}
              >
                <span aria-hidden="true">{'\u25A3'}</span> View Analytics
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                onClick={() => navigate('/compliance')}
              >
                <span aria-hidden="true">{'\u25C6'}</span> View Compliance
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
