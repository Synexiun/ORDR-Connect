/**
 * DemoEventStream — ORDR-Connect Event Stream Page
 *
 * Event sourcing visualization: live Kafka event feed, topic monitoring,
 * CQRS command/query split, and Merkle tree audit chain integrity.
 *
 * COMPLIANCE:
 * - No PHI in demo data (Rule 6)
 * - No secrets exposed (Rule 5)
 * - All data is synthetic mock data
 */

import { type ReactNode, useState } from 'react';
import {
  Activity,
  Zap,
  Database,
  Layers,
  GitBranch,
  GitCommit,
  Server,
  Terminal,
  Clock,
  Timer,
  CheckCircle2,
  Shield,
  Eye,
  ArrowRight,
  ArrowLeft,
  Search,
  Hash,
  Lock,
  ScrollText,
  Boxes,
  X,
} from '../../components/icons';

// --- Interfaces ---

interface StreamEvent {
  id: number;
  timestamp: string;
  type: EventType;
  topic: string;
  partition: number;
  payload: string;
  payloadFull: string;
}

type EventType =
  | 'customer.created'
  | 'customer.updated'
  | 'agent.action'
  | 'compliance.check'
  | 'channel.delivered'
  | 'payment.received'
  | 'ticket.escalated';

interface KafkaTopic {
  id: string;
  name: string;
  partitions: number;
  messagesPerSec: string;
  lag: number;
  status: 'healthy' | 'warning';
  sparkline: number[];
}

interface CqrsEntry {
  id: number;
  operation: string;
  timestamp: string;
  latency: string;
}

interface MerkleNode {
  id: string;
  hash: string;
  x: number;
  y: number;
  level: number;
}

interface MerkleEdge {
  from: string;
  to: string;
}

interface KpiCard {
  label: string;
  value: string;
  textColor: string;
  icon: ReactNode;
  pulse: boolean;
  suffix?: string;
  suffixIcon?: string;
}

// --- Event Type Colors ---
const EC: Record<EventType, { badge: string; border: string }> = {
  'customer.created': {
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    border: 'border-blue-500/20',
  },
  'customer.updated': {
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    border: 'border-blue-500/20',
  },
  'agent.action': {
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    border: 'border-amber-500/20',
  },
  'compliance.check': {
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    border: 'border-emerald-500/20',
  },
  'channel.delivered': {
    badge: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    border: 'border-purple-500/20',
  },
  'payment.received': {
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    border: 'border-emerald-500/20',
  },
  'ticket.escalated': {
    badge: 'bg-red-500/15 text-red-400 border-red-500/30',
    border: 'border-red-500/20',
  },
};

// --- Mock Data ---
const EVENTS: StreamEvent[] = [
  {
    id: 1,
    timestamp: '09:42:18.847',
    type: 'customer.updated',
    topic: 'ordr.customers',
    partition: 3,
    payload: '{"id":"c_4821","health":76}',
    payloadFull:
      '{"id":"c_4821","health_score":76,"segment":"mid-market","updated_fields":["health_score","last_interaction"],"source":"agent.collections"}',
  },
  {
    id: 2,
    timestamp: '09:42:18.623',
    type: 'agent.action',
    topic: 'ordr.agents',
    partition: 1,
    payload: '{"agent":"collections","action":"reminder_sent","confidence":0.94}',
    payloadFull:
      '{"agent":"collections","action":"reminder_sent","confidence":0.94,"target":"c_4821","channel":"sms","template":"payment_reminder_v3","token_cost":342}',
  },
  {
    id: 3,
    timestamp: '09:42:17.991',
    type: 'compliance.check',
    topic: 'ordr.compliance',
    partition: 0,
    payload: '{"standard":"HIPAA","result":"pass"}',
    payloadFull:
      '{"standard":"HIPAA","result":"pass","controls_checked":12,"violations":0,"scan_duration_ms":847,"next_scan":"2026-03-25T13:42:17Z"}',
  },
  {
    id: 4,
    timestamp: '09:42:17.445',
    type: 'channel.delivered',
    topic: 'ordr.channels',
    partition: 2,
    payload: '{"channel":"sms","status":"delivered"}',
    payloadFull:
      '{"channel":"sms","status":"delivered","provider":"twilio","message_sid":"SM8f3a...","recipient_ref":"c_4821","latency_ms":1240}',
  },
  {
    id: 5,
    timestamp: '09:42:16.892',
    type: 'payment.received',
    topic: 'ordr.payments',
    partition: 1,
    payload: '{"amount":1247.50,"currency":"USD"}',
    payloadFull:
      '{"amount":1247.50,"currency":"USD","customer_ref":"c_3190","method":"ach","reference":"PAY-28471","reconciled":true}',
  },
  {
    id: 6,
    timestamp: '09:42:16.234',
    type: 'ticket.escalated',
    topic: 'ordr.tickets',
    partition: 0,
    payload: '{"ticket":"T-1847","priority":"high"}',
    payloadFull:
      '{"ticket":"T-1847","priority":"high","customer_ref":"c_2901","reason":"sla_breach_imminent","assigned_agent":"support","escalation_level":2}',
  },
  {
    id: 7,
    timestamp: '09:42:15.778',
    type: 'agent.action',
    topic: 'ordr.agents',
    partition: 2,
    payload: '{"agent":"support","action":"auto_resolve"}',
    payloadFull:
      '{"agent":"support","action":"auto_resolve","ticket":"T-1843","resolution":"password_reset","confidence":0.98,"duration_ms":12400}',
  },
  {
    id: 8,
    timestamp: '09:42:15.123',
    type: 'customer.created',
    topic: 'ordr.customers',
    partition: 1,
    payload: '{"id":"c_4822","segment":"enterprise"}',
    payloadFull:
      '{"id":"c_4822","segment":"enterprise","source":"crm_import","initial_health":100,"assigned_csm":"agent.onboarding"}',
  },
  {
    id: 9,
    timestamp: '09:42:14.567',
    type: 'compliance.check',
    topic: 'ordr.compliance',
    partition: 0,
    payload: '{"standard":"SOC2","result":"pass"}',
    payloadFull:
      '{"standard":"SOC2","result":"pass","trust_criteria":"CC6.1","controls_checked":8,"violations":0}',
  },
  {
    id: 10,
    timestamp: '09:42:13.892',
    type: 'channel.delivered',
    topic: 'ordr.channels',
    partition: 4,
    payload: '{"channel":"email","status":"delivered"}',
    payloadFull:
      '{"channel":"email","status":"delivered","provider":"sendgrid","subject":"Invoice #INV-4821","recipient_ref":"c_3190","open_tracked":true}',
  },
  {
    id: 11,
    timestamp: '09:42:13.201',
    type: 'agent.action',
    topic: 'ordr.agents',
    partition: 0,
    payload: '{"agent":"analytics","action":"churn_prediction"}',
    payloadFull:
      '{"agent":"analytics","action":"churn_prediction","model":"xgb_v4","customers_scored":2841,"high_risk_flagged":3,"run_time_ms":4200}',
  },
  {
    id: 12,
    timestamp: '09:42:12.644',
    type: 'payment.received',
    topic: 'ordr.payments',
    partition: 3,
    payload: '{"amount":8420.00,"currency":"USD"}',
    payloadFull:
      '{"amount":8420.00,"currency":"USD","customer_ref":"c_1002","method":"wire","reference":"PAY-28472","reconciled":false}',
  },
];

const TOPICS: KafkaTopic[] = [
  {
    id: 'customers',
    name: 'ordr.customers',
    partitions: 8,
    messagesPerSec: '342',
    lag: 0,
    status: 'healthy',
    sparkline: [40, 65, 55, 80, 70, 85],
  },
  {
    id: 'agents',
    name: 'ordr.agents',
    partitions: 4,
    messagesPerSec: '567',
    lag: 12,
    status: 'warning',
    sparkline: [50, 70, 90, 85, 95, 88],
  },
  {
    id: 'compliance',
    name: 'ordr.compliance',
    partitions: 2,
    messagesPerSec: '89',
    lag: 0,
    status: 'healthy',
    sparkline: [20, 25, 22, 30, 28, 24],
  },
  {
    id: 'channels',
    name: 'ordr.channels',
    partitions: 6,
    messagesPerSec: '1,024',
    lag: 3,
    status: 'healthy',
    sparkline: [70, 85, 78, 92, 88, 95],
  },
  {
    id: 'payments',
    name: 'ordr.payments',
    partitions: 4,
    messagesPerSec: '156',
    lag: 0,
    status: 'healthy',
    sparkline: [30, 45, 38, 50, 42, 48],
  },
  {
    id: 'audit',
    name: 'ordr.audit',
    partitions: 2,
    messagesPerSec: '1,247',
    lag: 0,
    status: 'healthy',
    sparkline: [80, 90, 85, 95, 92, 98],
  },
];

const COMMANDS: CqrsEntry[] = [
  { id: 1, operation: 'CreateCustomer', timestamp: '09:42:15.123', latency: '14ms' },
  { id: 2, operation: 'UpdateHealth', timestamp: '09:42:18.847', latency: '8ms' },
  { id: 3, operation: 'SendMessage', timestamp: '09:42:17.445', latency: '22ms' },
  { id: 4, operation: 'EscalateTicket', timestamp: '09:42:16.234', latency: '11ms' },
];

const QUERIES: CqrsEntry[] = [
  { id: 1, operation: 'GetCustomer', timestamp: '09:42:19.012', latency: '3ms' },
  { id: 2, operation: 'ListAgents', timestamp: '09:42:18.901', latency: '5ms' },
  { id: 3, operation: 'FetchAnalytics', timestamp: '09:42:18.734', latency: '12ms' },
  { id: 4, operation: 'AuditSearch', timestamp: '09:42:18.501', latency: '7ms' },
];

const M_NODES: MerkleNode[] = [
  { id: 'root', hash: '0xa7f3e91d...b2c1', x: 180, y: 20, level: 0 },
  { id: 'int-l', hash: '0x3b8c12f4...9e07', x: 90, y: 70, level: 1 },
  { id: 'int-r', hash: '0xd4e7a620...1f83', x: 270, y: 70, level: 1 },
  { id: 'leaf-0', hash: '0x1f92bc4a...e301', x: 45, y: 120, level: 2 },
  { id: 'leaf-1', hash: '0x8a47d3e1...7b42', x: 135, y: 120, level: 2 },
  { id: 'leaf-2', hash: '0xc5f108b9...4d90', x: 225, y: 120, level: 2 },
  { id: 'leaf-3', hash: '0x6e2da71c...0af5', x: 315, y: 120, level: 2 },
];

const M_EDGES: MerkleEdge[] = [
  { from: 'root', to: 'int-l' },
  { from: 'root', to: 'int-r' },
  { from: 'int-l', to: 'leaf-0' },
  { from: 'int-l', to: 'leaf-1' },
  { from: 'int-r', to: 'leaf-2' },
  { from: 'int-r', to: 'leaf-3' },
];

// --- Helpers ---
function SparkBars({ values, tid }: { values: number[]; tid: string }): ReactNode {
  const max = Math.max(...values);
  const fills: Record<string, string> = {
    customers: 'fill-blue-400',
    agents: 'fill-amber-400',
    compliance: 'fill-emerald-400',
    channels: 'fill-purple-400',
    payments: 'fill-emerald-400',
    audit: 'fill-amber-400',
  };
  const c = fills[tid] ?? 'fill-slate-400';
  return (
    <svg width="48" height="20" viewBox="0 0 48 20" className="shrink-0">
      {values.map((v, i) => {
        const h = (v / max) * 16;
        return (
          <rect
            key={i}
            x={i * 8}
            y={20 - h}
            width={5}
            height={h}
            rx={1}
            className={c}
            fillOpacity={0.6 + (i / values.length) * 0.4}
          />
        );
      })}
    </svg>
  );
}

// --- Component ---
export function DemoEventStream(): ReactNode {
  const [selectedEvent, setSelectedEvent] = useState<StreamEvent | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<KafkaTopic | null>(null);

  const KPIS: KpiCard[] = [
    {
      label: 'Events / sec',
      value: '1,247',
      textColor: 'text-amber-400',
      icon: <Zap className="h-4 w-4 text-amber-400" />,
      pulse: true,
    },
    {
      label: 'Total Events',
      value: '12.4M',
      textColor: 'text-blue-400',
      icon: <Database className="h-4 w-4 text-blue-400" />,
      pulse: false,
    },
    {
      label: 'Partitions',
      value: '24 / 24',
      textColor: 'text-emerald-400',
      icon: <Boxes className="h-4 w-4 text-emerald-400" />,
      pulse: false,
      suffix: 'healthy',
    },
    {
      label: 'Audit Chain',
      value: 'Verified',
      textColor: 'text-emerald-400',
      icon: <Shield className="h-4 w-4 text-emerald-400" />,
      pulse: false,
      suffixIcon: 'check',
    },
  ];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* ── Header + KPIs ── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2.5 text-xl font-bold text-white">
              <Activity className="h-5 w-5 text-amber-400" />
              Event Stream
            </h1>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              Event sourcing backbone — Kafka · CQRS · WORM Audit
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <span className="font-mono text-[10px] font-bold tracking-widest text-emerald-400">
              STREAMING
            </span>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-4 gap-3">
          {KPIS.map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md transition-colors hover:border-white/10"
            >
              <div className="mb-2 flex items-center gap-2">
                {k.pulse ? (
                  <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
                ) : (
                  k.icon
                )}
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  {k.label}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`font-mono text-2xl font-bold ${k.textColor}`}>{k.value}</span>
                {k.suffix !== undefined && (
                  <span className="font-mono text-[10px] text-emerald-500/70">{k.suffix}</span>
                )}
                {k.suffixIcon === 'check' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Middle Row: Live Feed + Kafka Topics ── */}
      <div className="flex flex-1 gap-6 overflow-hidden">
        {/* Live Event Feed */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-emerald-500/10 bg-black/40 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-white">
              <Terminal className="h-4 w-4 text-emerald-400" />
              Live Event Feed
            </h2>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] text-slate-600">{EVENTS.length} events</span>
              <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            </div>
          </div>

          <div className="demo-scrollbar flex-1 overflow-y-auto p-2">
            {EVENTS.map((evt) => {
              const c = EC[evt.type];
              const sel = selectedEvent?.id === evt.id;
              return (
                <div key={evt.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEvent(sel ? null : evt);
                    }}
                    className={`group flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-all ${
                      sel
                        ? `bg-white/[0.04] ${c.border} border`
                        : 'border border-transparent hover:bg-white/[0.02]'
                    }`}
                  >
                    <span className="shrink-0 pt-0.5 font-mono text-[10px] text-slate-600">
                      {evt.timestamp}
                    </span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${c.badge}`}
                    >
                      {evt.type}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-600">
                      [{evt.topic}] p:{evt.partition}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-400">
                      {evt.payload}
                    </span>
                    <Eye
                      className={`h-3 w-3 shrink-0 transition-opacity ${
                        sel
                          ? 'text-slate-400 opacity-100'
                          : 'text-slate-600 opacity-0 group-hover:opacity-100'
                      }`}
                    />
                  </button>

                  {/* Expanded payload panel */}
                  {sel && (
                    <div className="mx-3 mb-2 mt-1 rounded-lg border border-white/5 bg-black/40 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                          Full Payload
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEvent(null);
                          }}
                          className="text-slate-600 transition-colors hover:text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <pre className="font-mono text-[11px] leading-relaxed text-slate-300">
                        {JSON.stringify(JSON.parse(evt.payloadFull), null, 2)}
                      </pre>
                      <div className="mt-2 flex items-center gap-4 border-t border-white/5 pt-2">
                        <span className="font-mono text-[10px] text-slate-600">
                          <Hash className="mr-1 inline h-3 w-3" />
                          offset: {1847293 - evt.id}
                        </span>
                        <span className="font-mono text-[10px] text-slate-600">
                          <Clock className="mr-1 inline h-3 w-3" />
                          {evt.timestamp}
                        </span>
                        <span className="font-mono text-[10px] text-slate-600">
                          <Lock className="mr-1 inline h-3 w-3" />
                          sha256: 0x{((evt.id * 7919) % 65536).toString(16).padStart(4, '0')}...
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Kafka Topics Monitor */}
        <div className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/5 bg-[#0d0d12]/80 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-white">
              <Layers className="h-4 w-4 text-amber-400" />
              Kafka Topics
            </h2>
            <span className="font-mono text-[10px] text-slate-600">{TOPICS.length} topics</span>
          </div>

          <div className="demo-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
            {TOPICS.map((t) => {
              const sel = selectedTopic?.id === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedTopic(sel ? null : t);
                  }}
                  className={`group w-full rounded-lg p-3 text-left transition-all ${
                    sel
                      ? 'border border-amber-500/20 bg-amber-500/5'
                      : 'border border-transparent hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          t.status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                        }`}
                      />
                      <span className="font-mono text-[11px] font-medium text-white">{t.name}</span>
                    </div>
                    <SparkBars values={t.sparkline} tid={t.id} />
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
                      <Server className="h-3 w-3 text-slate-600" />
                      {t.partitions}p
                    </span>
                    <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
                      <Zap className="h-3 w-3 text-slate-600" />
                      {t.messagesPerSec}/s
                    </span>
                    <span
                      className={`flex items-center gap-1 font-mono text-[10px] ${t.lag > 0 ? 'text-amber-400' : 'text-slate-500'}`}
                    >
                      <Timer className="h-3 w-3 text-slate-600" />
                      lag: {t.lag}
                    </span>
                  </div>

                  {/* Expanded topic detail */}
                  {sel && (
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3">
                      {(
                        [
                          { l: 'Throughput', v: `${t.messagesPerSec}/s`, c: 'text-white' },
                          { l: 'Partitions', v: String(t.partitions), c: 'text-white' },
                          {
                            l: 'Consumer Lag',
                            v: String(t.lag),
                            c: t.lag > 0 ? 'text-amber-400' : 'text-emerald-400',
                          },
                          {
                            l: 'Status',
                            v: t.status === 'healthy' ? 'Healthy' : 'Warning',
                            c: t.status === 'healthy' ? 'text-emerald-400' : 'text-amber-400',
                          },
                        ] as const
                      ).map((d) => (
                        <div
                          key={d.l}
                          className="rounded border border-white/5 bg-black/30 px-2 py-1.5"
                        >
                          <span className="font-mono text-[9px] uppercase tracking-widest text-slate-600">
                            {d.l}
                          </span>
                          <p className={`font-mono text-sm font-bold ${d.c}`}>{d.v}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Bottom Row: CQRS + Merkle Tree ── */}
      <div className="flex gap-6">
        {/* CQRS Split View */}
        <div className="flex flex-1 flex-col rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
          <h3 className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-white">
            <GitBranch className="h-4 w-4 text-amber-400" />
            CQRS Split View
          </h3>

          <div className="grid flex-1 grid-cols-2 gap-3">
            {/* Commands Panel */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-3">
              <div className="mb-2 flex items-center gap-2">
                <ArrowRight className="h-3.5 w-3.5 text-amber-400" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
                  Commands
                </span>
                <span className="font-mono text-[9px] text-slate-600">(Write)</span>
              </div>
              <div className="space-y-1.5">
                {COMMANDS.map((cmd) => (
                  <div
                    key={cmd.id}
                    className="flex items-center justify-between rounded border border-white/5 bg-black/30 px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <GitCommit className="h-3 w-3 text-amber-500/60" />
                      <span className="font-mono text-[11px] text-white">{cmd.operation}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] text-slate-600">{cmd.timestamp}</span>
                      <span className="font-mono text-[9px] text-amber-500/70">{cmd.latency}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Queries Panel */}
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.03] p-3">
              <div className="mb-2 flex items-center gap-2">
                <ArrowLeft className="h-3.5 w-3.5 text-blue-400" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-blue-400">
                  Queries
                </span>
                <span className="font-mono text-[9px] text-slate-600">(Read)</span>
              </div>
              <div className="space-y-1.5">
                {QUERIES.map((q) => (
                  <div
                    key={q.id}
                    className="flex items-center justify-between rounded border border-white/5 bg-black/30 px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <Search className="h-3 w-3 text-blue-500/60" />
                      <span className="font-mono text-[11px] text-white">{q.operation}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] text-slate-600">{q.timestamp}</span>
                      <span className="font-mono text-[9px] text-blue-500/70">{q.latency}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Merkle Tree + Hash Chain */}
        <div className="flex w-[380px] shrink-0 flex-col rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
          <h3 className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-white">
            <ScrollText className="h-4 w-4 text-amber-400" />
            Merkle Tree — Audit Chain
          </h3>

          <div className="mb-3 flex justify-center">
            <svg width="360" height="150" viewBox="0 0 360 150" className="shrink-0">
              {M_EDGES.map((e) => {
                const f = M_NODES.find((n) => n.id === e.from);
                const t = M_NODES.find((n) => n.id === e.to);
                if (!f || !t) return null;
                return (
                  <line
                    key={`${e.from}-${e.to}`}
                    x1={f.x}
                    y1={f.y + 12}
                    x2={t.x}
                    y2={t.y - 4}
                    stroke="rgba(251,191,36,0.2)"
                    strokeWidth={1.5}
                    strokeDasharray="4,4"
                  />
                );
              })}
              {M_NODES.map((n) => {
                const isRoot = n.level === 0;
                const isLeaf = n.level === 2;
                return (
                  <g key={n.id}>
                    <rect
                      x={n.x - 40}
                      y={n.y - 10}
                      width={80}
                      height={22}
                      rx={4}
                      fill={isRoot ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)'}
                      stroke={isRoot ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'}
                      strokeWidth={1}
                    />
                    <text
                      x={n.x}
                      y={n.y + 4}
                      textAnchor="middle"
                      className={`font-mono text-[9px] ${
                        isRoot ? 'fill-amber-400' : isLeaf ? 'fill-slate-500' : 'fill-slate-400'
                      }`}
                    >
                      {n.hash}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="space-y-2 border-t border-white/5 pt-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Chain Length
              </span>
              <span className="font-mono text-[11px] font-bold text-white">1,847,293 events</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Last Verified
              </span>
              <span className="font-mono text-[11px] text-slate-400">2s ago</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Integrity
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                UNBROKEN
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                Root Hash
              </span>
              <span className="font-mono text-[11px] text-amber-400/80">0xa7f3e91d...b2c1</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
