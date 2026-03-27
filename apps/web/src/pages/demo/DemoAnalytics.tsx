/**
 * DemoAnalytics — ORDR-Connect Analytics Hub
 *
 * ClickHouse-powered intelligence dashboard with real-time KPIs,
 * customer volume trends, channel distribution, agent performance,
 * activity heatmaps, and AI-generated insights.
 *
 * COMPLIANCE:
 * - No PHI in demo data (Rule 6)
 * - No secrets exposed (Rule 5)
 * - All data is synthetic mock data
 */

import { type ReactNode, useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Users,
  Bot,
  Mail,
  Brain,
  Download,
  ArrowUpRight,
  Clock,
  Sparkles,
  Star,
  Flame,
  Timer,
} from '../../components/icons';

// --- Types ---

type TimeRange = '7d' | '30d' | '90d';

interface KpiMetric {
  label: string;
  value: string;
  delta: string;
  icon: typeof DollarSign;
  iconColor: string;
  badgeColor: string;
  badgeIcon: typeof TrendingUp;
}

interface MonthlyVolume {
  month: string;
  newCustomers: number;
  churned: number;
}
interface ChannelSlice {
  name: string;
  pct: number;
  color: string;
  strokeColor: string;
}

interface AgentRow {
  name: string;
  successRate: number;
  confidence: number;
  actions24h: number;
  tokensUsed: string;
  cost: string;
}

interface HeatmapCell {
  day: number;
  hour: number;
  value: number;
}
interface AiInsight {
  id: number;
  text: string;
  confidence: number;
  action: string;
}
interface DonutSegment {
  offset: number;
  dashLen: number;
  color: string;
}

// --- Mock Data ---

const EMERALD_BADGE = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
const BLUE_BADGE = 'bg-blue-500/10 text-blue-400 border-blue-500/20';

const KPI_DATA: KpiMetric[] = [
  {
    label: 'Revenue (30d)',
    value: '$2.4M',
    delta: '+12.3%',
    icon: DollarSign,
    iconColor: 'text-amber-400',
    badgeColor: EMERALD_BADGE,
    badgeIcon: TrendingUp,
  },
  {
    label: 'Active Customers',
    value: '2,104',
    delta: '+4.7%',
    icon: Users,
    iconColor: 'text-blue-400',
    badgeColor: EMERALD_BADGE,
    badgeIcon: TrendingUp,
  },
  {
    label: 'Churn Rate',
    value: '1.7%',
    delta: '-0.3%',
    icon: Activity,
    iconColor: 'text-emerald-400',
    badgeColor: EMERALD_BADGE,
    badgeIcon: TrendingDown,
  },
  {
    label: 'Avg Response Time',
    value: '2.4m',
    delta: '-18%',
    icon: Timer,
    iconColor: 'text-purple-400',
    badgeColor: EMERALD_BADGE,
    badgeIcon: TrendingDown,
  },
  {
    label: 'Agent Success Rate',
    value: '94.2%',
    delta: '+2.1%',
    icon: Bot,
    iconColor: 'text-amber-400',
    badgeColor: EMERALD_BADGE,
    badgeIcon: TrendingUp,
  },
  {
    label: 'NPS Score',
    value: '72',
    delta: '+5',
    icon: Star,
    iconColor: 'text-blue-400',
    badgeColor: BLUE_BADGE,
    badgeIcon: TrendingUp,
  },
];

const MONTHLY_VOLUME: MonthlyVolume[] = [
  { month: 'Jan', newCustomers: 180, churned: 12 },
  { month: 'Feb', newCustomers: 210, churned: 15 },
  { month: 'Mar', newCustomers: 195, churned: 8 },
  { month: 'Apr', newCustomers: 245, churned: 11 },
  { month: 'May', newCustomers: 280, churned: 14 },
  { month: 'Jun', newCustomers: 310, churned: 10 },
  { month: 'Jul', newCustomers: 340, churned: 13 },
  { month: 'Aug', newCustomers: 365, churned: 9 },
  { month: 'Sep', newCustomers: 390, churned: 16 },
  { month: 'Oct', newCustomers: 420, churned: 12 },
  { month: 'Nov', newCustomers: 445, churned: 11 },
  { month: 'Dec', newCustomers: 470, churned: 8 },
];

const CHANNEL_SLICES: ChannelSlice[] = [
  { name: 'Email', pct: 55, color: 'bg-blue-400', strokeColor: '#60a5fa' },
  { name: 'SMS', pct: 26, color: 'bg-emerald-400', strokeColor: '#34d399' },
  { name: 'Voice', pct: 8, color: 'bg-amber-400', strokeColor: '#fbbf24' },
  { name: 'WhatsApp', pct: 8, color: 'bg-purple-400', strokeColor: '#c084fc' },
  { name: 'Web Chat', pct: 3, color: 'bg-slate-400', strokeColor: '#94a3b8' },
];

const AGENT_DATA: AgentRow[] = [
  {
    name: 'Collections',
    successRate: 96.2,
    confidence: 0.94,
    actions24h: 847,
    tokensUsed: '124K',
    cost: '$18.40',
  },
  {
    name: 'Support',
    successRate: 91.8,
    confidence: 0.89,
    actions24h: 623,
    tokensUsed: '89K',
    cost: '$13.20',
  },
  {
    name: 'Compliance',
    successRate: 99.1,
    confidence: 0.97,
    actions24h: 156,
    tokensUsed: '34K',
    cost: '$5.10',
  },
  {
    name: 'Communications',
    successRate: 88.4,
    confidence: 0.86,
    actions24h: 412,
    tokensUsed: '67K',
    cost: '$9.90',
  },
  {
    name: 'Analytics',
    successRate: 94.7,
    confidence: 0.92,
    actions24h: 89,
    tokensUsed: '156K',
    cost: '$23.40',
  },
  {
    name: 'Triage',
    successRate: 78.3,
    confidence: 0.71,
    actions24h: 34,
    tokensUsed: '12K',
    cost: '$1.80',
  },
];

const AI_INSIGHTS: AiInsight[] = [
  {
    id: 1,
    confidence: 0.91,
    action: 'Investigate',
    text: 'Customer churn risk elevated 23% in the SMB segment. Collections agent confidence correlates with 4pm-6pm window.',
  },
  {
    id: 2,
    confidence: 0.87,
    action: 'Apply',
    text: 'Email open rates dropped 8% week-over-week for enterprise tier. Subject line A/B test recommended for next campaign cycle.',
  },
  {
    id: 3,
    confidence: 0.94,
    action: 'Investigate',
    text: 'Agent token costs reduced 14% after prompt compression rollout. Analytics agent still consuming 2.3x median — optimization candidate.',
  },
  {
    id: 4,
    confidence: 0.82,
    action: 'Apply',
    text: 'NPS momentum positive across all segments. Voice channel satisfaction 12 points above SMS — consider routing high-value escalations to voice.',
  },
];

// --- Heatmap Data Generator ---

function generateHeatmapData(): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  const seed = [3, 7, 13, 17, 23, 29, 31];

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const isWeekday = day < 5;
      const isBusinessHour = hour >= 8 && hour <= 18;
      const isPeakHour = hour >= 10 && hour <= 15;

      let base = 5;
      if (isWeekday && isPeakHour) base = 70;
      else if (isWeekday && isBusinessHour) base = 45;
      else if (isWeekday) base = 10;
      else if (isBusinessHour) base = 20;

      const seedVal = seed[day] ?? 1;
      const noise = ((seedVal * (hour + 1) * 37) % 30) - 15;
      cells.push({ day, hour, value: Math.max(0, Math.min(100, base + noise)) });
    }
  }
  return cells;
}

const HEATMAP_DATA = generateHeatmapData();
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// --- SVG Chart Constants ---

const CHART_W = 560;
const CHART_H = 180;
const PAD_L = 40;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 28;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;
const Y_MAX_NEW = 500;
const Y_MAX_CHURN = 20;

// --- SVG Chart Helpers ---

function toLinePoints(data: MonthlyVolume[], key: 'newCustomers' | 'churned'): string {
  const max = key === 'newCustomers' ? Y_MAX_NEW : Y_MAX_CHURN;
  return data
    .map((d, i) => {
      const x = PAD_L + (i / (data.length - 1)) * PLOT_W;
      const y = PAD_T + PLOT_H - (d[key] / max) * PLOT_H;
      return `${x},${y}`;
    })
    .join(' ');
}

function toFillPolygon(data: MonthlyVolume[]): string {
  const pts = data.map((d, i) => {
    const x = PAD_L + (i / (data.length - 1)) * PLOT_W;
    const y = PAD_T + PLOT_H - (d.newCustomers / Y_MAX_NEW) * PLOT_H;
    return `${x},${y}`;
  });
  return pts.join(' ') + ` ${PAD_L + PLOT_W},${PAD_T + PLOT_H} ${PAD_L},${PAD_T + PLOT_H}`;
}

function heatColor(v: number): string {
  if (v < 10) return '#0a0a0f';
  if (v < 25) return '#172554';
  if (v < 45) return '#1e3a8a';
  if (v < 65) return '#3b82f6';
  if (v < 80) return '#60a5fa';
  return '#fbbf24';
}

// --- Donut Helpers ---

const DONUT_R = 60;
const DONUT_STROKE = 18;
const DONUT_CIRC = 2 * Math.PI * DONUT_R;

function buildDonutSegments(slices: ChannelSlice[]): DonutSegment[] {
  const segments: DonutSegment[] = [];
  let cumulative = 0;

  for (const slice of slices) {
    const dashLen = (slice.pct / 100) * DONUT_CIRC;
    const offset = DONUT_CIRC - (cumulative / 100) * DONUT_CIRC + DONUT_CIRC * 0.25;
    segments.push({ offset, dashLen, color: slice.strokeColor });
    cumulative += slice.pct;
  }
  return segments;
}

// --- Table Column Definitions ---

const TABLE_HEADERS = ['Agent', 'Success Rate', 'Confidence', 'Actions', 'Tokens', 'Cost'];

// --- Component ---

export function DemoAnalytics(): ReactNode {
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>('30d');
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  const segments = buildDonutSegments(CHANNEL_SLICES);
  const newLine = toLinePoints(MONTHLY_VOLUME, 'newCustomers');
  const newFill = toFillPolygon(MONTHLY_VOLUME);
  const churnLine = toLinePoints(MONTHLY_VOLUME, 'churned');
  const yTicks = [0, 125, 250, 375, 500];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* ── Page Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-black tracking-tight text-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 shadow-[0_0_20px_rgba(251,191,36,0.15)]">
              <BarChart3 className="h-5 w-5 text-black" />
            </div>
            Analytics Hub
          </h1>
          <p className="mt-1 font-mono text-[11px] text-slate-500">
            ClickHouse-powered intelligence &middot; Real-time insights
          </p>
        </div>

        {/* Time Range Toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-[#0d0d12]/80 p-1">
          {(['7d', '30d', '90d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => {
                setSelectedTimeRange(range);
              }}
              className={`rounded-md px-3 py-1.5 font-mono text-[11px] font-bold tracking-wider transition-all duration-200 ${
                selectedTimeRange === range
                  ? 'bg-amber-500/15 text-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.1)]'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {range.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-6 gap-3">
        {KPI_DATA.map((kpi) => {
          const Icon = kpi.icon;
          const BadgeIcon = kpi.badgeIcon;
          return (
            <div
              key={kpi.label}
              className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md transition-colors hover:border-white/10"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  {kpi.label}
                </span>
                <Icon className={`h-4 w-4 ${kpi.iconColor}`} />
              </div>
              <div className="font-mono text-2xl font-bold text-white">{kpi.value}</div>
              <div className="mt-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-medium ${kpi.badgeColor}`}
                >
                  <BadgeIcon className="h-3 w-3" />
                  {kpi.delta}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Middle Top: Area Chart + Donut ── */}
      <div className="grid grid-cols-2 gap-6">
        {/* Customer Volume Area Chart */}
        <div className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                Customer Volume
              </h3>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Monthly new vs churned
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-blue-400">
                <span className="inline-block h-1.5 w-3 rounded-full bg-blue-400" />
                New
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-red-400">
                <span className="inline-block h-1.5 w-3 rounded-full bg-red-400" />
                Churned
              </span>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="analytics-area-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.30" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Y-axis gridlines */}
            {yTicks.map((val) => {
              const y = PAD_T + PLOT_H - (val / Y_MAX_NEW) * PLOT_H;
              return (
                <g key={val}>
                  <line
                    x1={PAD_L}
                    y1={y}
                    x2={PAD_L + PLOT_W}
                    y2={y}
                    stroke="rgba(255,255,255,0.04)"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_L - 6}
                    y={y + 3}
                    textAnchor="end"
                    fill="#64748b"
                    fontSize={9}
                    fontFamily="monospace"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* X-axis month labels */}
            {MONTHLY_VOLUME.map((d, i) => {
              const x = PAD_L + (i / (MONTHLY_VOLUME.length - 1)) * PLOT_W;
              return (
                <text
                  key={d.month}
                  x={x}
                  y={CHART_H - 4}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize={9}
                  fontFamily="monospace"
                >
                  {d.month}
                </text>
              );
            })}

            {/* Area fill + lines */}
            <polygon points={newFill} fill="url(#analytics-area-fill)" />
            <polyline
              points={newLine}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={churnLine}
              fill="none"
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="4,4"
            />

            {/* Data dots — new customers */}
            {MONTHLY_VOLUME.map((d, i) => {
              const x = PAD_L + (i / (MONTHLY_VOLUME.length - 1)) * PLOT_W;
              const y = PAD_T + PLOT_H - (d.newCustomers / Y_MAX_NEW) * PLOT_H;
              return <circle key={`new-${i}`} cx={x} cy={y} r={2.5} fill="#3b82f6" />;
            })}

            {/* Data dots — churned */}
            {MONTHLY_VOLUME.map((d, i) => {
              const x = PAD_L + (i / (MONTHLY_VOLUME.length - 1)) * PLOT_W;
              const y = PAD_T + PLOT_H - (d.churned / Y_MAX_CHURN) * PLOT_H;
              return <circle key={`churn-${i}`} cx={x} cy={y} r={2} fill="#ef4444" />;
            })}
          </svg>
        </div>

        {/* Channel Distribution Donut */}
        <div className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
          <div className="mb-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <Mail className="h-4 w-4 text-amber-400" />
              Channel Distribution
            </h3>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              Message volume by channel
            </p>
          </div>

          <div className="flex items-center justify-between">
            {/* Donut SVG */}
            <svg width={160} height={160} viewBox="0 0 160 160">
              <circle
                cx={80}
                cy={80}
                r={DONUT_R}
                fill="none"
                stroke="rgba(255,255,255,0.03)"
                strokeWidth={DONUT_STROKE}
              />
              {segments.map((seg, i) => (
                <circle
                  key={i}
                  cx={80}
                  cy={80}
                  r={DONUT_R}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={DONUT_STROKE}
                  strokeDasharray={`${seg.dashLen} ${DONUT_CIRC - seg.dashLen}`}
                  strokeDashoffset={seg.offset}
                  strokeLinecap="butt"
                  className="transition-opacity duration-200"
                />
              ))}
              <text
                x={80}
                y={76}
                textAnchor="middle"
                fill="white"
                fontSize={18}
                fontWeight="bold"
                fontFamily="monospace"
              >
                14.8K
              </text>
              <text
                x={80}
                y={92}
                textAnchor="middle"
                fill="#64748b"
                fontSize={9}
                fontFamily="monospace"
              >
                MESSAGES
              </text>
            </svg>

            {/* Legend */}
            <div className="flex flex-col gap-2.5 pr-2">
              {CHANNEL_SLICES.map((slice) => (
                <div key={slice.name} className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${slice.color}`} />
                  <span className="w-16 text-xs text-slate-300">{slice.name}</span>
                  <span className="font-mono text-xs font-bold text-white">{slice.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Middle Bottom: Agent Table + Heatmap ── */}
      <div className="grid grid-cols-2 gap-6">
        {/* Agent Performance Table */}
        <div className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <Bot className="h-4 w-4 text-emerald-400" />
                Agent Performance
              </h3>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                24h execution metrics
              </p>
            </div>
            <button className="flex items-center gap-1.5 rounded-lg border border-white/5 px-2.5 py-1 font-mono text-[10px] text-slate-500 transition-colors hover:border-white/10 hover:text-slate-300">
              <Download className="h-3 w-3" />
              Export
            </button>
          </div>

          <div className="demo-scrollbar overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="border-b border-white/5">
                  {TABLE_HEADERS.map((header, idx) => (
                    <th
                      key={header}
                      className={`pb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500 ${
                        idx < 2 ? 'text-left' : 'text-right'
                      }`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AGENT_DATA.map((agent) => {
                  const isLow = agent.successRate < 80;
                  const barColor = isLow
                    ? 'bg-red-500'
                    : agent.successRate >= 95
                      ? 'bg-emerald-500'
                      : 'bg-amber-500';
                  return (
                    <tr
                      key={agent.name}
                      onMouseEnter={() => {
                        setHoveredAgent(agent.name);
                      }}
                      onMouseLeave={() => {
                        setHoveredAgent(null);
                      }}
                      className={`border-b border-white/[0.02] transition-colors ${
                        hoveredAgent === agent.name ? 'bg-white/[0.02]' : ''
                      }`}
                    >
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <Brain className="h-3.5 w-3.5 text-amber-400" />
                          <span className="text-xs font-medium text-white">{agent.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
                            <div
                              className={`h-full rounded-full ${barColor}`}
                              style={{ width: `${agent.successRate}%` }}
                            />
                          </div>
                          <span
                            className={`font-mono text-xs ${isLow ? 'text-red-400' : 'text-white'}`}
                          >
                            {agent.successRate}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-mono text-xs text-slate-300">
                        {agent.confidence.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-xs text-slate-300">
                        {agent.actions24h.toLocaleString()}
                      </td>
                      <td className="py-2.5 text-right font-mono text-xs text-slate-300">
                        {agent.tokensUsed}
                      </td>
                      <td className="py-2.5 text-right font-mono text-xs font-medium text-amber-400">
                        {agent.cost}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Activity Heatmap */}
        <div className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
          <div className="mb-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <Flame className="h-4 w-4 text-amber-400" />
              Activity Heatmap
            </h3>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              Operations by day &amp; hour
            </p>
          </div>

          <svg viewBox="0 0 560 160" className="w-full" preserveAspectRatio="xMidYMid meet">
            {/* Hour labels */}
            {Array.from({ length: 24 }, (_, h) => (
              <text
                key={`hr-${h}`}
                x={42 + h * 21 + 10}
                y={10}
                textAnchor="middle"
                fill="#475569"
                fontSize={7}
                fontFamily="monospace"
              >
                {h}
              </text>
            ))}

            {/* Day rows + cells */}
            {DAY_LABELS.map((day, dayIdx) => (
              <g key={day}>
                <text
                  x={36}
                  y={22 + dayIdx * 19 + 12}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize={8}
                  fontFamily="monospace"
                >
                  {day}
                </text>
                {Array.from({ length: 24 }, (_, hourIdx) => {
                  const cell = HEATMAP_DATA.find((c) => c.day === dayIdx && c.hour === hourIdx);
                  const value = cell ? cell.value : 0;
                  return (
                    <rect
                      key={`${dayIdx}-${hourIdx}`}
                      x={42 + hourIdx * 21}
                      y={18 + dayIdx * 19}
                      width={18}
                      height={16}
                      rx={2}
                      fill={heatColor(value)}
                      className="transition-opacity duration-100 hover:opacity-80"
                    />
                  );
                })}
              </g>
            ))}

            {/* Color scale legend */}
            <text x={42} y={155} fill="#475569" fontSize={7} fontFamily="monospace">
              Low
            </text>
            {[0, 15, 30, 50, 70, 90].map((val, i) => (
              <rect
                key={`scale-${i}`}
                x={62 + i * 16}
                y={148}
                width={14}
                height={8}
                rx={1}
                fill={heatColor(val)}
              />
            ))}
            <text x={160} y={155} fill="#475569" fontSize={7} fontFamily="monospace">
              High
            </text>
          </svg>
        </div>
      </div>

      {/* ── Intelligence Feed ── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-white">
              <Sparkles className="h-4 w-4 text-amber-400" />
              Intelligence Feed
            </h3>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              AI-generated operational insights
            </p>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
            <Clock className="h-3 w-3" />
            Updated 4m ago
          </div>
        </div>

        <div className="demo-scrollbar flex gap-4 overflow-x-auto pb-2">
          {AI_INSIGHTS.map((insight) => (
            <div
              key={insight.id}
              className="flex min-w-[300px] max-w-[340px] shrink-0 flex-col rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md transition-colors hover:border-amber-500/20"
            >
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
                  AI Insight
                </span>
              </div>
              <p className="flex-1 text-xs leading-relaxed text-slate-300">{insight.text}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-mono text-[10px] text-slate-500">
                  Confidence:{' '}
                  <span
                    className={insight.confidence >= 0.9 ? 'text-emerald-400' : 'text-amber-400'}
                  >
                    {(insight.confidence * 100).toFixed(0)}%
                  </span>
                </span>
                <button className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1 font-mono text-[10px] font-medium text-amber-400 transition-colors hover:bg-amber-500/20">
                  <ArrowUpRight className="h-3 w-3" />
                  {insight.action}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
