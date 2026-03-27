import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { StatusDot } from '../components/ui/StatusDot';
import { ActivityFeed } from '../components/activity-feed/ActivityFeed';
import { SparkLine } from '../components/charts/SparkLine';
import { DonutChart } from '../components/charts/DonutChart';
import { AreaChart } from '../components/charts/AreaChart';
import { fetchDashboardSummary } from '../lib/analytics-api';
import {
  Users,
  Bot,
  ShieldCheck,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Plus,
  RefreshCw,
  BarChart3,
  Activity,
} from '../components/icons';

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
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

// --- Mock data ---

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

// Sparkline raw number arrays for KPI cards
const customerSparkData = [2210, 2340, 2480, 2520, 2610, 2740, 2847];
const agentSparkData = [9, 10, 11, 10, 12, 11, 12];
const complianceSparkData = [91, 93, 94, 93, 95, 95, 96];
const revenueSparkData = [980, 1020, 1080, 1120, 1190, 1240, 1284];

// Channel distribution mock data for DonutChart
const mockChannelDistribution = [
  { label: 'Email', value: 4280, color: '#3b82f6' },
  { label: 'SMS', value: 2150, color: '#10b981' },
  { label: 'Voice', value: 1340, color: '#f59e0b' },
  { label: 'Chat', value: 890, color: '#8b5cf6' },
  { label: 'Webhook', value: 520, color: '#06b6d4' },
];

// Revenue trend mock data for AreaChart (30 days)
const mockRevenueTrend = Array.from({ length: 30 }, (_, i) => ({
  x: new Date(Date.now() - (29 - i) * 86400000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }),
  y: Math.round(32000 + Math.sin(i * 0.3) * 8000 + i * 400 + Math.random() * 2000),
}));

// System health statuses
const systemHealth = [
  { name: 'API Gateway', status: 'success' as const, latency: '12ms' },
  { name: 'Kafka Cluster', status: 'success' as const, latency: '3ms' },
  { name: 'PostgreSQL', status: 'success' as const, latency: '8ms' },
  { name: 'Redis Cache', status: 'success' as const, latency: '1ms' },
  { name: 'Agent Runtime', status: 'warning' as const, latency: '145ms' },
];

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
      const summary = await fetchDashboardSummary();
      setKpis({
        totalCustomers: summary.totalCustomers,
        activeAgents: summary.activeAgents,
        complianceScore: summary.complianceScore,
        revenueCollected: summary.revenueCollected,
      });
      setAgentPerf({ ...mockAgentPerf, activeNow: summary.activeAgents });
      setDeliveryTrend(mockDeliveryTrend);
      setAgentSparkline(mockAgentSparkline);
    } catch {
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

  // Delta values for KPI cards
  const customerDelta: number = 12.4;
  const revenueDelta: number = 8.1;
  const complianceDelta: number = 1.2;
  const agentDelta: number = -2.3;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Operations overview</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={fetchDashboard}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => navigate('/customers')}
          >
            New Customer
          </Button>
        </div>
      </div>

      {/* KPI Cards — accent-bordered Cards with SparkLines */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Customers */}
        <button
          className="text-left"
          onClick={() => navigate('/customers')}
          aria-label="View customers"
        >
          <Card
            accent="blue"
            className="h-full transition-transform duration-150 hover:scale-[1.02]"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-kpi-blue" />
                  <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
                    Total Customers
                  </p>
                </div>
                <p className="mt-2 text-2xl font-bold font-mono text-content">
                  {formatNumber(kpis?.totalCustomers ?? 0)}
                </p>
                <div className="mt-1 flex items-center gap-1">
                  {customerDelta >= 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-400">
                      <TrendingUp className="h-3 w-3" />+{customerDelta}%
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-400">
                      <TrendingDown className="h-3 w-3" />
                      {customerDelta}%
                    </span>
                  )}
                  <span className="text-2xs text-content-tertiary">vs last month</span>
                </div>
              </div>
              <SparkLine
                data={customerSparkData}
                width={72}
                height={28}
                color="#3b82f6"
                strokeWidth={1.5}
                className="mt-1 opacity-80"
              />
            </div>
          </Card>
        </button>

        {/* Active Agents */}
        <button className="text-left" onClick={() => navigate('/agents')} aria-label="View agents">
          <Card
            accent="green"
            className="h-full transition-transform duration-150 hover:scale-[1.02]"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-kpi-green" />
                  <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
                    Active Agents
                  </p>
                </div>
                <p className="mt-2 text-2xl font-bold font-mono text-content">
                  {kpis?.activeAgents ?? 0}
                </p>
                <div className="mt-1 flex items-center gap-1">
                  {agentDelta >= 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-400">
                      <TrendingUp className="h-3 w-3" />+{agentDelta}%
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-400">
                      <TrendingDown className="h-3 w-3" />
                      {agentDelta}%
                    </span>
                  )}
                  <span className="text-2xs text-content-tertiary">
                    {agentPerf?.activeNow ?? 0} running now
                  </span>
                </div>
              </div>
              <SparkLine
                data={agentSparkData}
                width={72}
                height={28}
                color="#22c55e"
                strokeWidth={1.5}
                className="mt-1 opacity-80"
              />
            </div>
          </Card>
        </button>

        {/* Compliance Score */}
        <button
          className="text-left"
          onClick={() => navigate('/compliance')}
          aria-label="View compliance"
        >
          <Card
            accent="purple"
            className="h-full transition-transform duration-150 hover:scale-[1.02]"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-kpi-purple" />
                  <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
                    Compliance Score
                  </p>
                </div>
                <p className="mt-2 text-2xl font-bold font-mono text-kpi-green">
                  {kpis?.complianceScore ?? 0}%
                </p>
                <div className="mt-1 flex items-center gap-1">
                  {complianceDelta >= 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-400">
                      <TrendingUp className="h-3 w-3" />+{complianceDelta}%
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-400">
                      <TrendingDown className="h-3 w-3" />
                      {complianceDelta}%
                    </span>
                  )}
                  <span className="text-2xs text-content-tertiary">SOC 2 / ISO / HIPAA</span>
                </div>
              </div>
              <SparkLine
                data={complianceSparkData}
                width={72}
                height={28}
                color="#a855f7"
                strokeWidth={1.5}
                className="mt-1 opacity-80"
              />
            </div>
          </Card>
        </button>

        {/* Revenue Collected */}
        <button
          className="text-left"
          onClick={() => navigate('/analytics')}
          aria-label="View analytics"
        >
          <Card
            accent="amber"
            className="h-full transition-transform duration-150 hover:scale-[1.02]"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-kpi-amber" />
                  <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
                    Revenue Collected
                  </p>
                </div>
                <p className="mt-2 text-2xl font-bold font-mono text-content">
                  {formatCurrency(kpis?.revenueCollected ?? 0)}
                </p>
                <div className="mt-1 flex items-center gap-1">
                  {revenueDelta >= 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-400">
                      <TrendingUp className="h-3 w-3" />+{revenueDelta}%
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-400">
                      <TrendingDown className="h-3 w-3" />
                      {revenueDelta}%
                    </span>
                  )}
                  <span className="text-2xs text-content-tertiary">vs last month</span>
                </div>
              </div>
              <SparkLine
                data={revenueSparkData}
                width={72}
                height={28}
                color="#f59e0b"
                strokeWidth={1.5}
                className="mt-1 opacity-80"
              />
            </div>
          </Card>
        </button>
      </div>

      {/* Revenue Trend + Channel Distribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Revenue AreaChart — spans 2/3 */}
        <div className="lg:col-span-2">
          <Card
            title="Revenue Trend — Last 30 Days"
            accent="blue"
            actions={
              <Badge variant="info" size="sm">
                <Activity className="h-3 w-3" />
                Monthly
              </Badge>
            }
          >
            <AreaChart
              series={mockRevenueTrend}
              height={220}
              color="#3b82f6"
              showGrid
              showDots={false}
              gradientOpacity={0.25}
            />
          </Card>
        </div>

        {/* Channel Distribution DonutChart — 1/3 */}
        <Card
          title="Channel Distribution"
          accent="purple"
          actions={
            <Badge variant="neutral" size="sm">
              All time
            </Badge>
          }
        >
          <div className="flex items-center justify-center py-2">
            <DonutChart
              segments={mockChannelDistribution}
              size={160}
              thickness={20}
              showLabels
              centerLabel={formatNumber(
                mockChannelDistribution.reduce((sum, s) => sum + s.value, 0),
              )}
            />
          </div>
        </Card>
      </div>

      {/* Delivery + Agent sparkline row (preserved from original) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Delivery Trend — Last 7 Days"
          actions={
            <Badge variant="info" size="sm">
              Messages
            </Badge>
          }
        >
          <AreaChart
            series={deliveryTrend.map((t) => ({ x: t.date, y: t.value }))}
            height={140}
            color="#3b82f6"
            showGrid
            showDots={false}
            gradientOpacity={0.2}
          />
        </Card>

        <Card
          title="Agent Success Rate — Last 7 Days"
          actions={
            <Badge variant="success" size="sm">
              %
            </Badge>
          }
        >
          <AreaChart
            series={agentSparkline.map((t) => ({ x: t.date, y: t.value }))}
            height={140}
            color="#22c55e"
            showGrid
            showDots={false}
            gradientOpacity={0.2}
          />
        </Card>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Live Activity Feed — 2/3 width */}
        <div className="lg:col-span-2">
          <Card
            title="Live Activity"
            actions={
              <Badge variant="info" dot>
                Live
              </Badge>
            }
          >
            <ActivityFeed maxItems={50} pollInterval={5000} />
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Agent Performance */}
          <Card title="Agent Performance" accent="green">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary">Sessions Today</span>
                <span className="text-2xl font-bold font-mono text-content">
                  {agentPerf?.sessionsToday ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary">Success Rate</span>
                <span className="text-2xl font-bold font-mono text-kpi-green">
                  {agentPerf?.successRate ?? 0}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary">Avg Confidence</span>
                <span className="text-2xl font-bold font-mono text-content">
                  {((agentPerf?.avgConfidence ?? 0) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary">Active Now</span>
                <div className="flex items-center gap-2">
                  <StatusDot status="success" pulse size="sm" />
                  <span className="text-2xl font-bold font-mono text-content">
                    {agentPerf?.activeNow ?? 0}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* System Health */}
          <Card title="System Health" accent="blue">
            <div className="space-y-3">
              {systemHealth.map((service) => (
                <div key={service.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusDot
                      status={service.status}
                      pulse={service.status === 'warning'}
                      size="sm"
                    />
                    <span className="text-sm text-content-secondary">{service.name}</span>
                  </div>
                  <span className="text-xs font-mono text-content-tertiary">{service.latency}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Quick Actions */}
          <Card title="Quick Actions">
            <div className="space-y-2">
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                icon={<Users className="h-3.5 w-3.5" />}
                onClick={() => navigate('/customers')}
              >
                New Customer
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                icon={<Bot className="h-3.5 w-3.5" />}
                onClick={() => navigate('/agents')}
              >
                Trigger Agent
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                onClick={() => navigate('/analytics')}
              >
                View Analytics
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
                onClick={() => navigate('/compliance')}
              >
                View Compliance
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
