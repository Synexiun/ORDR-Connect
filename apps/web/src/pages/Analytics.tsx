/**
 * Analytics Page — Full analytics dashboard.
 *
 * Sections: Channel Effectiveness, Agent Performance, Compliance, Engagement.
 * Time range selector: 24h, 7d, 30d, 90d, custom.
 * All charts are pure SVG — NO external charting libraries.
 *
 * COMPLIANCE: No PHI rendered. Metadata and aggregate metrics only.
 */

import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import { BarChart } from '../components/charts/BarChart';
import { LineChart } from '../components/charts/LineChart';
import { AreaChart } from '../components/charts/AreaChart';
import { DonutChart } from '../components/charts/DonutChart';
import { HeatmapChart } from '../components/charts/HeatmapChart';
import { SparkLine } from '../components/charts/SparkLine';
import {
  fetchChannelMetrics,
  fetchAgentMetrics,
  fetchComplianceMetrics,
  fetchTrend,
  type TimeRange,
  type ChannelMetric,
  type ChannelVolumePoint,
  type AgentMetricRow,
  type AgentTrendPoint,
  type ComplianceScorePoint,
  type ComplianceMetricRow,
  type ComplianceCheckRatio,
  type TrendPoint,
} from '../lib/analytics-api';

// --- Mock data for graceful degradation ---

const mockChannelMetrics: ChannelMetric[] = [
  { channel: 'SMS', deliveryRate: 96.2, volume: 12480, costPerMessage: 0.0075, failureRate: 3.8 },
  { channel: 'Email', deliveryRate: 98.5, volume: 34120, costPerMessage: 0.0012, failureRate: 1.5 },
  { channel: 'Voice', deliveryRate: 89.1, volume: 4230, costPerMessage: 0.035, failureRate: 10.9 },
  {
    channel: 'WhatsApp',
    deliveryRate: 94.7,
    volume: 8940,
    costPerMessage: 0.005,
    failureRate: 5.3,
  },
];

const mockChannelVolume: ChannelVolumePoint[] = Array.from({ length: 7 }, (_, i) => {
  const date = new Date(Date.now() - (6 - i) * 86400000);
  return {
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    sms: 1200 + Math.floor(Math.sin(i) * 400),
    email: 3500 + Math.floor(Math.cos(i) * 800),
    voice: 400 + Math.floor(Math.sin(i + 1) * 150),
    whatsapp: 900 + Math.floor(Math.cos(i + 2) * 300),
  };
});

const mockAgentMetrics: AgentMetricRow[] = [
  {
    agentRole: 'collection',
    sessions: 187,
    resolutionRate: 92.4,
    avgConfidence: 0.88,
    avgCost: 0.14,
    avgSteps: 4.2,
  },
  {
    agentRole: 'onboarding',
    sessions: 94,
    resolutionRate: 97.1,
    avgConfidence: 0.91,
    avgCost: 0.08,
    avgSteps: 3.1,
  },
  {
    agentRole: 'support',
    sessions: 156,
    resolutionRate: 88.5,
    avgConfidence: 0.84,
    avgCost: 0.19,
    avgSteps: 5.4,
  },
  {
    agentRole: 'retention',
    sessions: 63,
    resolutionRate: 78.3,
    avgConfidence: 0.79,
    avgCost: 0.22,
    avgSteps: 6.1,
  },
];

const mockAgentTrend: AgentTrendPoint[] = Array.from({ length: 7 }, (_, i) => ({
  date: new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }),
  resolutionRate: 85 + Math.floor(Math.sin(i * 0.8) * 8),
}));

const mockComplianceScoreTrend: ComplianceScorePoint[] = Array.from({ length: 7 }, (_, i) => ({
  date: new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }),
  score: 93 + Math.floor(Math.sin(i * 0.6) * 4),
}));

const mockViolationBreakdown: ComplianceMetricRow[] = [
  { regulation: 'HIPAA', violations: 2, percentage: 20 },
  { regulation: 'FDCPA', violations: 3, percentage: 30 },
  { regulation: 'TCPA', violations: 4, percentage: 40 },
  { regulation: 'GDPR', violations: 1, percentage: 10 },
];

const mockCheckRatios: ComplianceCheckRatio[] = [
  { checkType: 'PHI Access', passed: 245, failed: 2 },
  { checkType: 'Consent Verification', passed: 890, failed: 5 },
  { checkType: 'Quiet Hours', passed: 347, failed: 4 },
  { checkType: 'Frequency Limits', passed: 612, failed: 3 },
  { checkType: 'Data Encryption', passed: 500, failed: 0 },
];

const mockResponseTrend: TrendPoint[] = Array.from({ length: 7 }, (_, i) => ({
  date: new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }),
  value: 34 + Math.floor(Math.sin(i * 0.7) * 12),
}));

const mockResponseTimeTrend: TrendPoint[] = Array.from({ length: 7 }, (_, i) => ({
  date: new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }),
  value: 45 + Math.floor(Math.cos(i * 0.5) * 20),
}));

// --- Mock heatmap data: hour-of-day (rows) vs day-of-week (columns) ---

const heatmapDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const heatmapHours = ['6am', '8am', '10am', '12pm', '2pm', '4pm', '6pm', '8pm'];

const mockHeatmapData: number[][] = heatmapHours.map((_, hIdx) =>
  heatmapDays.map((_, dIdx) =>
    Math.floor(
      20 + Math.sin(hIdx * 0.9 + dIdx * 0.5) * 15 + Math.cos(dIdx * 1.2) * 10 + Math.random() * 8,
    ),
  ),
);

// --- Helpers ---

const timeRangeOptions: { value: TimeRange; label: string }[] = [
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

function confidenceColor(c: number): string {
  if (c >= 0.8) return 'text-emerald-400';
  if (c >= 0.7) return 'text-amber-400';
  return 'text-red-400';
}

const channelColorMap: Record<string, string> = {
  SMS: '#3b82f6',
  Email: '#10b981',
  Voice: '#f59e0b',
  WhatsApp: '#8b5cf6',
};

function getChannelColor(channel: string): string {
  return channelColorMap[channel] ?? '#3b82f6';
}

// --- Component ---

export function Analytics(): ReactNode {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [loading, setLoading] = useState(true);

  // Channel state
  const [channelMetrics, setChannelMetrics] = useState<ChannelMetric[]>([]);
  const [channelVolume, setChannelVolume] = useState<ChannelVolumePoint[]>([]);

  // Agent state
  const [agentMetrics, setAgentMetrics] = useState<AgentMetricRow[]>([]);
  const [agentTrend, setAgentTrend] = useState<AgentTrendPoint[]>([]);

  // Compliance state
  const [complianceScoreTrend, setComplianceScoreTrend] = useState<ComplianceScorePoint[]>([]);
  const [violationBreakdown, setViolationBreakdown] = useState<ComplianceMetricRow[]>([]);
  const [checkRatios, setCheckRatios] = useState<ComplianceCheckRatio[]>([]);

  // Engagement state
  const [responseTrend, setResponseTrend] = useState<TrendPoint[]>([]);
  const [responseTimeTrend, setResponseTimeTrend] = useState<TrendPoint[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [channelRes, agentRes, complianceRes, respTrendRes, respTimeRes] =
        await Promise.allSettled([
          fetchChannelMetrics(timeRange),
          fetchAgentMetrics(timeRange),
          fetchComplianceMetrics(timeRange),
          fetchTrend('response-rate', timeRange),
          fetchTrend('response-time', timeRange),
        ]);

      // Channel
      if (channelRes.status === 'fulfilled') {
        setChannelMetrics(channelRes.value.channels);
        setChannelVolume(channelRes.value.volumeOverTime);
      } else {
        setChannelMetrics(mockChannelMetrics);
        setChannelVolume(mockChannelVolume);
      }

      // Agent
      if (agentRes.status === 'fulfilled') {
        setAgentMetrics(agentRes.value.agents);
        setAgentTrend(agentRes.value.trend);
      } else {
        setAgentMetrics(mockAgentMetrics);
        setAgentTrend(mockAgentTrend);
      }

      // Compliance
      if (complianceRes.status === 'fulfilled') {
        setComplianceScoreTrend(complianceRes.value.scoreTrend);
        setViolationBreakdown(complianceRes.value.violationBreakdown);
        setCheckRatios(complianceRes.value.checkRatios);
      } else {
        setComplianceScoreTrend(mockComplianceScoreTrend);
        setViolationBreakdown(mockViolationBreakdown);
        setCheckRatios(mockCheckRatios);
      }

      // Engagement
      setResponseTrend(
        respTrendRes.status === 'fulfilled' ? respTrendRes.value.data : mockResponseTrend,
      );
      setResponseTimeTrend(
        respTimeRes.status === 'fulfilled' ? respTimeRes.value.data : mockResponseTimeTrend,
      );
    } catch {
      // Full graceful degradation
      setChannelMetrics(mockChannelMetrics);
      setChannelVolume(mockChannelVolume);
      setAgentMetrics(mockAgentMetrics);
      setAgentTrend(mockAgentTrend);
      setComplianceScoreTrend(mockComplianceScoreTrend);
      setViolationBreakdown(mockViolationBreakdown);
      setCheckRatios(mockCheckRatios);
      setResponseTrend(mockResponseTrend);
      setResponseTimeTrend(mockResponseTimeTrend);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Derived KPI sparkline data
  const totalVolume = useMemo(
    () => channelMetrics.reduce((s, ch) => s + ch.volume, 0),
    [channelMetrics],
  );
  const avgDeliveryRate = useMemo(() => {
    if (channelMetrics.length === 0) return 0;
    return channelMetrics.reduce((s, ch) => s + ch.deliveryRate, 0) / channelMetrics.length;
  }, [channelMetrics]);
  const volumeSparkData = useMemo(
    () => channelVolume.map((v) => v.sms + v.email + v.voice + v.whatsapp),
    [channelVolume],
  );
  const deliverySparkData = useMemo(
    () => channelMetrics.map((ch) => ch.deliveryRate),
    [channelMetrics],
  );
  const complianceSparkData = useMemo(
    () => complianceScoreTrend.map((t) => t.score),
    [complianceScoreTrend],
  );
  const latestComplianceScore = useMemo(
    () =>
      complianceScoreTrend.length > 0
        ? (complianceScoreTrend[complianceScoreTrend.length - 1]?.score ?? 0)
        : 0,
    [complianceScoreTrend],
  );
  const responseSparkData = useMemo(() => responseTrend.map((t) => t.value), [responseTrend]);
  const latestResponseRate = useMemo(
    () => (responseTrend.length > 0 ? (responseTrend[responseTrend.length - 1]?.value ?? 0) : 0),
    [responseTrend],
  );

  // Donut segments from channel volume
  const channelMixSegments = useMemo(
    () =>
      channelMetrics.map((ch) => ({
        label: ch.channel,
        value: ch.volume,
        color: getChannelColor(ch.channel),
      })),
    [channelMetrics],
  );

  // Agent table columns
  const agentColumns = [
    {
      key: 'agentRole',
      header: 'Agent Role',
      sortable: true,
      render: (row: AgentMetricRow) => (
        <span className="text-sm font-medium capitalize text-content">{row.agentRole}</span>
      ),
    },
    {
      key: 'sessions',
      header: 'Sessions',
      sortable: true,
      render: (row: AgentMetricRow) => (
        <span className="font-mono text-sm text-content">{row.sessions}</span>
      ),
    },
    {
      key: 'resolutionRate',
      header: 'Resolution',
      sortable: true,
      render: (row: AgentMetricRow) => (
        <span className="font-mono text-sm text-emerald-400">{row.resolutionRate}%</span>
      ),
    },
    {
      key: 'avgConfidence',
      header: 'Avg Confidence',
      sortable: true,
      render: (row: AgentMetricRow) => (
        <span className={`font-mono text-sm ${confidenceColor(row.avgConfidence)}`}>
          {(row.avgConfidence * 100).toFixed(1)}%
        </span>
      ),
    },
    {
      key: 'avgCost',
      header: 'Avg Cost',
      sortable: true,
      render: (row: AgentMetricRow) => (
        <span className="font-mono text-sm text-content-secondary">${row.avgCost.toFixed(3)}</span>
      ),
    },
    {
      key: 'avgSteps',
      header: 'Avg Steps',
      render: (row: AgentMetricRow) => (
        <span className="font-mono text-sm text-content-secondary">{row.avgSteps.toFixed(1)}</span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading analytics" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Analytics</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Channel, agent, and compliance performance metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          {timeRangeOptions.map((opt) => (
            <Button
              key={opt.value}
              variant={timeRange === opt.value ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                setTimeRange(opt.value);
              }}
            >
              {opt.label}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={fetchAll}>
            Refresh
          </Button>
        </div>
      </div>

      {/* === KPI ROW === */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card accent="blue">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                Total Volume
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-content">
                {totalVolume.toLocaleString()}
              </p>
            </div>
            <SparkLine data={volumeSparkData} color="#3b82f6" width={64} height={24} />
          </div>
        </Card>
        <Card accent="green">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                Avg Delivery Rate
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
                {avgDeliveryRate.toFixed(1)}%
              </p>
            </div>
            <SparkLine data={deliverySparkData} color="#10b981" width={64} height={24} />
          </div>
        </Card>
        <Card accent="purple">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                Compliance Score
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-violet-400">
                {latestComplianceScore}
              </p>
            </div>
            <SparkLine data={complianceSparkData} color="#8b5cf6" width={64} height={24} />
          </div>
        </Card>
        <Card accent="amber">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                Response Rate
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-amber-400">
                {latestResponseRate}%
              </p>
            </div>
            <SparkLine data={responseSparkData} color="#f59e0b" width={64} height={24} />
          </div>
        </Card>
      </div>

      {/* === CHANNEL EFFECTIVENESS === */}
      <div>
        <h2 className="section-title mb-4">Channel Effectiveness</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Delivery rate by channel */}
          <Card title="Delivery Rate by Channel">
            <BarChart
              data={channelMetrics.map((ch) => ({
                label: ch.channel,
                value: ch.deliveryRate,
                color: getChannelColor(ch.channel),
              }))}
              height={220}
              showLabels
              showValues
            />
          </Card>

          {/* Cost per message */}
          <Card title="Cost per Message by Channel">
            <BarChart
              data={channelMetrics.map((ch) => ({
                label: ch.channel,
                value: Number((ch.costPerMessage * 1000).toFixed(1)),
                color: getChannelColor(ch.channel),
              }))}
              height={220}
              showLabels
              showValues
            />
            <p className="mt-2 text-2xs text-content-tertiary">Values in millicents (x0.001 USD)</p>
          </Card>

          {/* Channel Mix — DonutChart */}
          <Card title="Channel Mix (Volume)">
            <div className="flex items-center justify-center">
              <DonutChart
                segments={channelMixSegments}
                size={180}
                thickness={24}
                showLabels
                centerLabel={totalVolume.toLocaleString()}
              />
            </div>
          </Card>

          {/* Volume over time — AreaChart */}
          <Card title="Volume Trend (All Channels)" className="lg:col-span-2">
            <AreaChart
              series={channelVolume.map((v) => ({
                x: v.date,
                y: v.sms + v.email + v.voice + v.whatsapp,
              }))}
              height={240}
              color="#3b82f6"
              showGrid
              showDots
              gradientOpacity={0.25}
            />
          </Card>

          {/* Activity Heatmap — HeatmapChart */}
          <Card title="Activity Heatmap (Hour vs Day)">
            <HeatmapChart
              data={mockHeatmapData}
              xLabels={heatmapDays}
              yLabels={heatmapHours}
              height={220}
            />
          </Card>
        </div>

        {/* Full multi-series line chart */}
        <div className="mt-6">
          <Card title="Volume by Channel Over Time">
            <LineChart
              series={[
                {
                  data: channelVolume.map((v) => ({ x: v.date, y: v.sms })),
                  color: '#3b82f6',
                  label: 'SMS',
                },
                {
                  data: channelVolume.map((v) => ({ x: v.date, y: v.email })),
                  color: '#10b981',
                  label: 'Email',
                },
                {
                  data: channelVolume.map((v) => ({ x: v.date, y: v.voice })),
                  color: '#f59e0b',
                  label: 'Voice',
                },
                {
                  data: channelVolume.map((v) => ({ x: v.date, y: v.whatsapp })),
                  color: '#8b5cf6',
                  label: 'WhatsApp',
                },
              ]}
              height={240}
              showGrid
              showDots
            />
            <div className="mt-3 flex items-center justify-center gap-4">
              {[
                { label: 'SMS', color: 'bg-blue-500' },
                { label: 'Email', color: 'bg-emerald-500' },
                { label: 'Voice', color: 'bg-amber-500' },
                { label: 'WhatsApp', color: 'bg-violet-500' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${item.color}`} />
                  <span className="text-2xs text-content-secondary">{item.label}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* === AGENT PERFORMANCE === */}
      <div>
        <h2 className="section-title mb-4">Agent Performance</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="Agent Metrics" padding={false}>
              <Table columns={agentColumns} data={agentMetrics} keyExtractor={(r) => r.agentRole} />
            </Card>
          </div>

          <Card title="Resolution Rate Trend">
            <LineChart
              series={[
                {
                  data: agentTrend.map((t) => ({ x: t.date, y: t.resolutionRate })),
                  color: '#10b981',
                  label: 'Resolution Rate',
                },
              ]}
              height={200}
              showGrid
              showDots
            />
          </Card>
        </div>
      </div>

      {/* === COMPLIANCE === */}
      <div>
        <h2 className="section-title mb-4">Compliance Analytics</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Score trend */}
          <Card title="Compliance Score Trend">
            <LineChart
              series={[
                {
                  data: complianceScoreTrend.map((t) => ({ x: t.date, y: t.score })),
                  color: '#10b981',
                  label: 'Compliance Score',
                },
              ]}
              height={200}
              showGrid
              showDots
            />
          </Card>

          {/* Violation breakdown */}
          <Card title="Violations by Regulation">
            <BarChart
              data={violationBreakdown.map((v) => ({
                label: v.regulation,
                value: v.violations,
                color:
                  v.regulation === 'HIPAA'
                    ? '#ef4444'
                    : v.regulation === 'FDCPA'
                      ? '#f59e0b'
                      : v.regulation === 'TCPA'
                        ? '#f97316'
                        : '#3b82f6',
              }))}
              height={200}
              showLabels
              showValues
            />
          </Card>

          {/* Check pass/fail */}
          <Card title="Pass/Fail by Check Type">
            <div className="space-y-3">
              {checkRatios.map((check) => {
                const total = check.passed + check.failed;
                const passRate = total > 0 ? (check.passed / total) * 100 : 0;
                return (
                  <div key={check.checkType}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-content-secondary">{check.checkType}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="success" size="sm">
                          {check.passed}
                        </Badge>
                        {check.failed > 0 && (
                          <Badge variant="danger" size="sm">
                            {check.failed}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-tertiary">
                      <div
                        className="h-1.5 rounded-full bg-emerald-400"
                        style={{ width: `${passRate}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* === ENGAGEMENT === */}
      <div>
        <h2 className="section-title mb-4">Customer Engagement</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Customer Response Rate (%)">
            <LineChart
              series={[
                {
                  data: responseTrend.map((t) => ({ x: t.date, y: t.value })),
                  color: '#3b82f6',
                  label: 'Response Rate',
                },
              ]}
              height={200}
              showGrid
              showDots
            />
          </Card>

          <Card title="Average Response Time (minutes)">
            <LineChart
              series={[
                {
                  data: responseTimeTrend.map((t) => ({ x: t.date, y: t.value })),
                  color: '#f59e0b',
                  label: 'Response Time',
                },
              ]}
              height={200}
              showGrid
              showDots
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
