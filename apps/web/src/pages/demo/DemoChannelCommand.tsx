/**
 * DemoChannelCommand — Channel Command Center
 *
 * Multi-channel delivery & routing intelligence dashboard.
 * Displays channel health, live message flow, and per-channel analytics.
 *
 * COMPLIANCE:
 * - No PHI in demo data (Rule 6)
 * - No secrets exposed (Rule 5)
 * - All data is synthetic mock data
 */

import { type ReactNode, type ComponentType, useState } from 'react';
import {
  Mail,
  Phone,
  MessageCircle,
  Smartphone,
  Globe,
  Send,
  Activity,
  Zap,
  TrendingUp,
  DollarSign,
  CheckCircle2,
  Clock,
  Timer,
  Target,
  Bot,
  ArrowUpRight,
  ArrowDownRight,
  Radio,
  Filter,
  ArrowRight,
  Info,
} from '../../components/icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChannelStatus = 'active' | 'degraded' | 'offline';
type MsgDirection = 'inbound' | 'outbound';
type MsgType = 'notification' | 'reply' | 'campaign' | 'automated';
type DeliveryStatus = 'delivered' | 'pending' | 'failed';

interface ChannelTemplate {
  name: string;
  uses: number;
}
interface RoutingRule {
  label: string;
  description: string;
}

interface Channel {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  dotColor: string;
  bgColor: string;
  status: ChannelStatus;
  volume24h: number;
  deliveryPct: number;
  avgCost: string;
  unitLabel: string;
  provider: string;
  hourlyVolume: number[];
  bounceRate: string;
  avgLatency: string;
  templates: ChannelTemplate[];
  routingRules: RoutingRule[];
}

interface MessageEvent {
  id: string;
  channelId: string;
  direction: MsgDirection;
  customer: string;
  messageType: MsgType;
  status: DeliveryStatus;
  timestamp: string;
}

type AccentColor = 'blue' | 'emerald' | 'amber' | 'purple';

interface KpiCard {
  label: string;
  value: string;
  change: string;
  positive: boolean;
  color: AccentColor;
  icon: ComponentType<{ className?: string }>;
}

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const CHANNELS: Channel[] = [
  {
    id: 'email',
    name: 'Email',
    icon: Mail,
    color: 'text-blue-400',
    dotColor: 'bg-blue-400',
    bgColor: 'bg-blue-500/10',
    status: 'active',
    volume24h: 8241,
    deliveryPct: 99.4,
    avgCost: '$0.002',
    unitLabel: 'msg',
    provider: 'SendGrid',
    hourlyVolume: [310, 280, 190, 120, 95, 140, 420, 580, 710, 690, 640, 520],
    bounceRate: '0.6%',
    avgLatency: '1.2s',
    templates: [
      { name: 'Payment Confirmation', uses: 2847 },
      { name: 'Appointment Reminder', uses: 1932 },
      { name: 'Welcome Onboarding', uses: 1204 },
      { name: 'Invoice Due Notice', uses: 891 },
    ],
    routingRules: [
      { label: 'VIP Customers', description: 'Priority queue + dedicated IP' },
      { label: 'Bulk Campaign', description: 'Throttled 500/min for deliverability' },
      { label: 'Transactional', description: 'Immediate send, bypass scheduling' },
    ],
  },
  {
    id: 'sms',
    name: 'SMS',
    icon: Smartphone,
    color: 'text-emerald-400',
    dotColor: 'bg-emerald-400',
    bgColor: 'bg-emerald-500/10',
    status: 'active',
    volume24h: 3847,
    deliveryPct: 98.7,
    avgCost: '$0.04',
    unitLabel: 'msg',
    provider: 'Twilio',
    hourlyVolume: [140, 120, 80, 60, 45, 70, 210, 340, 420, 390, 360, 280],
    bounceRate: '1.3%',
    avgLatency: '0.8s',
    templates: [
      { name: 'Payment Reminder', uses: 1423 },
      { name: 'OTP Verification', uses: 987 },
      { name: 'Delivery Update', uses: 764 },
    ],
    routingRules: [
      { label: 'Collections', description: 'SMS + Email dual-channel' },
      { label: 'Time-Sensitive', description: 'SMS preferred over email' },
    ],
  },
  {
    id: 'voice',
    name: 'Voice',
    icon: Phone,
    color: 'text-amber-400',
    dotColor: 'bg-amber-400',
    bgColor: 'bg-amber-500/10',
    status: 'active',
    volume24h: 1247,
    deliveryPct: 97.2,
    avgCost: '$0.12',
    unitLabel: 'call',
    provider: 'Twilio',
    hourlyVolume: [30, 20, 10, 8, 5, 15, 80, 140, 180, 170, 150, 120],
    bounceRate: '2.8%',
    avgLatency: '3.4s',
    templates: [
      { name: 'Collections IVR', uses: 542 },
      { name: 'Appointment Confirm', uses: 387 },
      { name: 'Satisfaction Survey', uses: 218 },
    ],
    routingRules: [
      { label: 'VIP Escalation', description: 'Direct to live agent queue' },
      { label: 'After Hours', description: 'Route to IVR self-service' },
      { label: 'Collections Past-Due', description: 'Automated IVR + agent fallback' },
    ],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: MessageCircle,
    color: 'text-emerald-400',
    dotColor: 'bg-emerald-400',
    bgColor: 'bg-emerald-500/10',
    status: 'active',
    volume24h: 1124,
    deliveryPct: 99.1,
    avgCost: '$0.01',
    unitLabel: 'msg',
    provider: 'Twilio',
    hourlyVolume: [50, 40, 25, 18, 12, 30, 90, 130, 160, 150, 140, 110],
    bounceRate: '0.9%',
    avgLatency: '1.0s',
    templates: [
      { name: 'Order Confirmation', uses: 412 },
      { name: 'Support Follow-up', uses: 328 },
      { name: 'Billing Notification', uses: 247 },
    ],
    routingRules: [
      { label: 'Preferred Channel', description: 'Use when customer opted-in' },
      { label: 'Rich Media', description: 'Route media-heavy messages here' },
    ],
  },
  {
    id: 'webchat',
    name: 'Web Chat',
    icon: Globe,
    color: 'text-purple-400',
    dotColor: 'bg-purple-400',
    bgColor: 'bg-purple-500/10',
    status: 'active',
    volume24h: 368,
    deliveryPct: 100,
    avgCost: '$0.00',
    unitLabel: 'session',
    provider: 'ORDR Native',
    hourlyVolume: [8, 5, 3, 2, 1, 4, 20, 40, 55, 50, 45, 35],
    bounceRate: '0.0%',
    avgLatency: '0.3s',
    templates: [
      { name: 'Greeting Flow', uses: 198 },
      { name: 'FAQ Bot', uses: 124 },
    ],
    routingRules: [
      { label: 'Bot-First', description: 'AI agent handles initial triage' },
      { label: 'Escalation', description: 'Transfer to human after 2 failed intents' },
    ],
  },
];

const MSG_EVENTS: MessageEvent[] = [
  {
    id: 'e1',
    channelId: 'sms',
    direction: 'outbound',
    customer: 'John D.',
    messageType: 'notification',
    status: 'delivered',
    timestamp: '2s ago',
  },
  {
    id: 'e2',
    channelId: 'email',
    direction: 'outbound',
    customer: 'Sarah M.',
    messageType: 'campaign',
    status: 'delivered',
    timestamp: '5s ago',
  },
  {
    id: 'e3',
    channelId: 'whatsapp',
    direction: 'inbound',
    customer: 'Alex K.',
    messageType: 'reply',
    status: 'delivered',
    timestamp: '8s ago',
  },
  {
    id: 'e4',
    channelId: 'voice',
    direction: 'outbound',
    customer: 'Maria L.',
    messageType: 'automated',
    status: 'delivered',
    timestamp: '12s ago',
  },
  {
    id: 'e5',
    channelId: 'email',
    direction: 'outbound',
    customer: 'James R.',
    messageType: 'notification',
    status: 'pending',
    timestamp: '15s ago',
  },
  {
    id: 'e6',
    channelId: 'webchat',
    direction: 'inbound',
    customer: 'Chen W.',
    messageType: 'reply',
    status: 'delivered',
    timestamp: '18s ago',
  },
  {
    id: 'e7',
    channelId: 'sms',
    direction: 'outbound',
    customer: 'Nina P.',
    messageType: 'campaign',
    status: 'delivered',
    timestamp: '22s ago',
  },
  {
    id: 'e8',
    channelId: 'email',
    direction: 'outbound',
    customer: 'Omar H.',
    messageType: 'automated',
    status: 'failed',
    timestamp: '28s ago',
  },
  {
    id: 'e9',
    channelId: 'whatsapp',
    direction: 'outbound',
    customer: 'Lisa T.',
    messageType: 'notification',
    status: 'delivered',
    timestamp: '34s ago',
  },
  {
    id: 'e10',
    channelId: 'voice',
    direction: 'inbound',
    customer: 'David B.',
    messageType: 'reply',
    status: 'delivered',
    timestamp: '41s ago',
  },
];

const KPI_CARDS: KpiCard[] = [
  {
    label: 'Messages Today',
    value: '14,827',
    change: '+12.3%',
    positive: true,
    color: 'blue',
    icon: Send,
  },
  {
    label: 'Delivery Rate',
    value: '99.2%',
    change: '+0.4%',
    positive: true,
    color: 'emerald',
    icon: CheckCircle2,
  },
  {
    label: 'Avg Response',
    value: '2.4m',
    change: '-18%',
    positive: true,
    color: 'amber',
    icon: Timer,
  },
  {
    label: 'Cost Today',
    value: '$847',
    change: '-6.2%',
    positive: true,
    color: 'purple',
    icon: DollarSign,
  },
];

const HOUR_LABELS = ['12a', '2a', '4a', '6a', '8a', '10a', '12p', '2p', '4p', '6p', '8p', '10p'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelById(id: string): Channel | undefined {
  return CHANNELS.find((c) => c.id === id);
}

const STATUS_STYLES: Record<ChannelStatus, { dot: string; text: string; label: string }> = {
  active: {
    dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]',
    text: 'text-emerald-400',
    label: 'Active',
  },
  degraded: {
    dot: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]',
    text: 'text-amber-400',
    label: 'Degraded',
  },
  offline: {
    dot: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]',
    text: 'text-red-400',
    label: 'Offline',
  },
};

const DELIVERY_BADGE: Record<DeliveryStatus, string> = {
  delivered: 'bg-emerald-500/10 text-emerald-400',
  pending: 'bg-amber-500/10 text-amber-400',
  failed: 'bg-red-500/10 text-red-400',
};

const COLOR_MAP: Record<AccentColor, { border: string; glow: string; text: string; bg: string }> = {
  blue: {
    border: 'border-blue-500/20',
    glow: 'shadow-[0_0_20px_rgba(59,130,246,0.08)]',
    text: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  emerald: {
    border: 'border-emerald-500/20',
    glow: 'shadow-[0_0_20px_rgba(16,185,129,0.08)]',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  amber: {
    border: 'border-amber-500/20',
    glow: 'shadow-[0_0_20px_rgba(245,158,11,0.08)]',
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  purple: {
    border: 'border-purple-500/20',
    glow: 'shadow-[0_0_20px_rgba(168,85,247,0.08)]',
    text: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
};

const FILL_MAP: Record<string, string> = {
  'text-blue-400': '#60a5fa',
  'text-emerald-400': '#34d399',
  'text-amber-400': '#fbbf24',
  'text-purple-400': '#c084fc',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MiniSparkBars({ data, color }: { data: number[]; color: string }): ReactNode {
  const max = Math.max(...data);
  const barW = 6;
  const gap = 3;
  const h = 28;
  const w = data.length * (barW + gap) - gap;
  const fill = FILL_MAP[color] ?? '#fbbf24';
  return (
    <svg width={w} height={h} className="shrink-0 opacity-60">
      {data.map((v, i) => {
        const barH = max > 0 ? (v / max) * (h - 2) : 0;
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={h - barH}
            width={barW}
            height={barH}
            rx={1.5}
            fill={fill}
            opacity={0.7 + (i / data.length) * 0.3}
          />
        );
      })}
    </svg>
  );
}

function DetailBarChart({ data }: { data: number[] }): ReactNode {
  const max = Math.max(...data);
  const barW = 20;
  const gap = 6;
  const h = 100;
  const w = data.length * (barW + gap) - gap;
  return (
    <div className="demo-scrollbar overflow-x-auto">
      <svg width={w} height={h + 18} className="block">
        {data.map((v, i) => {
          const barH = max > 0 ? (v / max) * h : 0;
          return (
            <g key={i}>
              <rect
                x={i * (barW + gap)}
                y={h - barH}
                width={barW}
                height={barH}
                rx={3}
                fill="url(#barGrad)"
                opacity={0.8}
              />
              <text
                x={i * (barW + gap) + barW / 2}
                y={h + 14}
                textAnchor="middle"
                className="fill-slate-600 font-mono text-[8px]"
              >
                {HOUR_LABELS[i]}
              </text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.4" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function DemoChannelCommand(): ReactNode {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [flowFilter, setFlowFilter] = useState('all');

  const selected = selectedChannel !== null ? channelById(selectedChannel) : null;
  const filteredEvents =
    flowFilter === 'all' ? MSG_EVENTS : MSG_EVENTS.filter((e) => e.channelId === flowFilter);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* ---- HEADER ---- */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Channel Command Center</h1>
          <p className="mt-1 text-sm text-slate-500">
            Multi-channel delivery &amp; routing intelligence
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-[#0d0d12]/80 px-3 py-1.5">
          <Radio className="h-3 w-3 animate-pulse text-emerald-400" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">
            Live
          </span>
        </div>
      </div>

      {/* ---- KPI ROW ---- */}
      <div className="grid grid-cols-4 gap-4">
        {KPI_CARDS.map((kpi) => {
          const c = COLOR_MAP[kpi.color];
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={`rounded-xl border ${c.border} bg-[#0d0d12]/80 p-4 backdrop-blur-md ${c.glow}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  {kpi.label}
                </span>
                <div className={`rounded-lg ${c.bg} p-1.5`}>
                  <Icon className={`h-3.5 w-3.5 ${c.text}`} />
                </div>
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-white">{kpi.value}</p>
              <div className="mt-1 flex items-center gap-1">
                {kpi.positive ? (
                  <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 text-red-400" />
                )}
                <span
                  className={`font-mono text-xs ${kpi.positive ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {kpi.change}
                </span>
                <span className="font-mono text-[10px] text-slate-600">vs yesterday</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- CHANNEL STATUS GRID ---- */}
      <div>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Channel Status
        </h2>
        <div className="grid grid-cols-5 gap-3">
          {CHANNELS.map((ch) => {
            const Icon = ch.icon;
            const st = STATUS_STYLES[ch.status];
            const isSelected = selectedChannel === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  setSelectedChannel(isSelected ? null : ch.id);
                }}
                className={`group rounded-xl border bg-[#0d0d12]/80 p-4 text-left backdrop-blur-md transition-all duration-200 ${
                  isSelected
                    ? 'border-amber-500/30 shadow-[0_0_24px_rgba(245,158,11,0.08)]'
                    : 'border-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className={`rounded-lg ${ch.bgColor} p-2`}>
                    <Icon className={`h-5 w-5 ${ch.color}`} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`h-2 w-2 rounded-full ${st.dot}`} />
                    <span className={`font-mono text-[10px] ${st.text}`}>{st.label}</span>
                  </div>
                </div>
                <p className="mt-3 text-sm font-semibold text-white">{ch.name}</p>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Volume (24h)</span>
                    <span className="font-mono text-xs font-medium text-white">
                      {ch.volume24h.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Delivery</span>
                    <span className="font-mono text-xs font-medium text-emerald-400">
                      {ch.deliveryPct}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Avg Cost</span>
                    <span className="font-mono text-xs font-medium text-slate-300">
                      {ch.avgCost}/{ch.unitLabel}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex justify-center">
                  <MiniSparkBars data={ch.hourlyVolume.slice(-6)} color={ch.color} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- BOTTOM: LIVE FLOW + DETAIL PANEL ---- */}
      <div className="grid min-h-0 flex-1 grid-cols-5 gap-4">
        {/* Live Message Flow */}
        <div className="col-span-2 flex flex-col rounded-xl border border-white/5 bg-[#0d0d12]/80 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-semibold text-white">Live Message Flow</span>
            </div>
            <div className="flex items-center gap-1">
              <Filter className="h-3 w-3 text-slate-500" />
              <select
                value={flowFilter}
                onChange={(e) => {
                  setFlowFilter(e.target.value);
                }}
                className="cursor-pointer rounded border-none bg-transparent font-mono text-[10px] text-slate-400 outline-none focus:ring-0"
              >
                <option value="all">All Channels</option>
                {CHANNELS.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="demo-scrollbar flex-1 overflow-y-auto">
            {filteredEvents.map((evt, idx) => {
              const ch = channelById(evt.channelId);
              if (!ch) return null;
              const Icon = ch.icon;
              return (
                <div
                  key={evt.id}
                  className={`flex items-center gap-3 px-4 py-2.5 ${idx % 2 === 0 ? 'bg-white/[0.01]' : ''}`}
                >
                  <div className={`rounded-md ${ch.bgColor} p-1`}>
                    <Icon className={`h-3 w-3 ${ch.color}`} />
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    {evt.direction === 'outbound' ? '\u2192' : '\u2190'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-xs font-medium text-white">
                      {evt.direction === 'outbound' ? `${ch.name} to ` : `${ch.name} from `}
                      {evt.customer}
                    </span>
                    <span className="ml-1.5 text-[10px] capitalize text-slate-500">
                      {evt.messageType}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] ${DELIVERY_BADGE[evt.status]}`}
                  >
                    {evt.status}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-600">
                    {evt.timestamp}
                  </span>
                </div>
              );
            })}
            {filteredEvents.length === 0 && (
              <div className="flex items-center justify-center py-8 text-sm text-slate-600">
                No events for this filter
              </div>
            )}
          </div>
        </div>

        {/* Channel Detail Panel */}
        <div className="col-span-3 flex flex-col rounded-xl border border-white/5 bg-[#0d0d12]/80 backdrop-blur-md">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className={`rounded-lg ${selected.bgColor} p-2.5`}>
                    <selected.icon className={`h-6 w-6 ${selected.color}`} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{selected.name}</h3>
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`h-2 w-2 rounded-full ${STATUS_STYLES[selected.status].dot}`}
                      />
                      <span
                        className={`font-mono text-[10px] ${STATUS_STYLES[selected.status].text}`}
                      >
                        {STATUS_STYLES[selected.status].label}
                      </span>
                      <span className="text-[10px] text-slate-600">
                        &middot; Provider: {selected.provider}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-white/5 px-2.5 py-1">
                  <Zap className="h-3 w-3 text-amber-400" />
                  <span className="font-mono text-[10px] text-slate-400">
                    {selected.volume24h.toLocaleString()} / 24h
                  </span>
                </div>
              </div>
              <div className="demo-scrollbar flex-1 overflow-y-auto px-5 py-4">
                {/* Hourly Volume */}
                <div className="mb-5">
                  <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Hourly Volume (Last 12h)
                  </h4>
                  <DetailBarChart data={selected.hourlyVolume} />
                </div>
                {/* Performance Metrics */}
                <div className="mb-5">
                  <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Performance Metrics
                  </h4>
                  <div className="grid grid-cols-4 gap-3">
                    {(
                      [
                        {
                          label: 'Delivery Rate',
                          value: `${selected.deliveryPct}%`,
                          icon: TrendingUp,
                          accent: 'text-emerald-400',
                        },
                        {
                          label: 'Bounce Rate',
                          value: selected.bounceRate,
                          icon: ArrowDownRight,
                          accent: 'text-red-400',
                        },
                        {
                          label: 'Avg Latency',
                          value: selected.avgLatency,
                          icon: Clock,
                          accent: 'text-blue-400',
                        },
                        {
                          label: 'Cost / Unit',
                          value: selected.avgCost,
                          icon: DollarSign,
                          accent: 'text-purple-400',
                        },
                      ] as const
                    ).map((m) => (
                      <div
                        key={m.label}
                        className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <m.icon className={`h-3 w-3 ${m.accent}`} />
                          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                            {m.label}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-lg font-bold text-white">{m.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Top Templates */}
                <div className="mb-5">
                  <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Top Templates
                  </h4>
                  <div className="space-y-1.5">
                    {selected.templates.map((t) => (
                      <div
                        key={t.name}
                        className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <Bot className="h-3.5 w-3.5 text-slate-500" />
                          <span className="text-xs text-slate-300">{t.name}</span>
                        </div>
                        <span className="font-mono text-xs text-amber-400">
                          {t.uses.toLocaleString()} uses
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Routing Rules */}
                <div>
                  <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Routing Rules
                  </h4>
                  <div className="space-y-1.5">
                    {selected.routingRules.map((r) => (
                      <div
                        key={r.label}
                        className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                      >
                        <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                        <div>
                          <span className="text-xs font-medium text-white">{r.label}</span>
                          <p className="text-[11px] text-slate-500">{r.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-600">
              <Info className="h-8 w-8 text-slate-700" />
              <p className="text-sm">Select a channel to view detailed analytics</p>
            </div>
          )}
        </div>
      </div>

      {/* ---- BOTTOM STAT BAR ---- */}
      <div className="flex items-center justify-between rounded-lg border border-white/5 bg-[#0d0d12]/60 px-4 py-2 backdrop-blur-md">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <Target className="h-3 w-3 text-amber-400" />
            <span className="font-mono text-[10px] text-slate-500">Messages/sec:</span>
            <span className="font-mono text-[10px] font-bold text-white">12.4</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-blue-400" />
            <span className="font-mono text-[10px] text-slate-500">Queue depth:</span>
            <span className="font-mono text-[10px] font-bold text-white">847</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-emerald-400" />
            <span className="font-mono text-[10px] text-slate-500">Errors (1h):</span>
            <span className="font-mono text-[10px] font-bold text-red-400">3</span>
          </div>
        </div>
        <span className="font-mono text-[10px] text-slate-600">Last refresh: just now</span>
      </div>
    </div>
  );
}
