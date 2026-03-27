/**
 * DemoOperations — ORDR-Connect Operations Center
 *
 * Main operations hub showing agent orchestration topology,
 * real-time activity stream, and priority action queue.
 *
 * COMPLIANCE:
 * - No PHI in demo data (Rule 6)
 * - No secrets exposed (Rule 5)
 * - All data is synthetic mock data
 */

import { type ReactNode, useState, type SyntheticEvent } from 'react';
import {
  Zap,
  Activity,
  Terminal,
  Sparkles,
  Network,
  Bot,
  ShieldCheck,
  BarChart3,
  Database,
  Layers,
  Brain,
  Send,
  AlertTriangle,
  Check,
  X,
  Crosshair,
  Waypoints,
  Mail,
  Flame,
  CheckCircle2,
} from '../../components/icons';

// --- Interfaces ---

interface AgentLogEntry {
  id: number;
  agent: string;
  color: string;
  bg: string;
  time: string;
  text: string;
  actionable?: boolean;
  actionLabel?: string;
}

interface TopologyNode {
  id: string;
  name: string;
  type: 'core' | 'events' | 'graph' | 'channels' | 'agents' | 'compliance' | 'analytics';
  x: number;
  y: number;
  size: number;
  status: 'active' | 'warning';
  metric: string;
  detail: string;
}

interface TopologyLink {
  source: string;
  target: string;
  speed: number;
  load: number;
  warning?: boolean;
}

interface KpiCard {
  label: string;
  value: string;
  color: string;
  dotColor: string;
}

interface PriorityAction {
  id: number;
  title: string;
  description: string;
  score: number;
  type: 'escalation' | 'compliance' | 'agent';
}

// --- Mock Data ---

const agentLogs: AgentLogEntry[] = [
  {
    id: 1,
    agent: 'Collections',
    color: 'text-amber-400',
    bg: 'bg-amber-400',
    time: 'Just now',
    text: 'Initiated payment reminder sequence for account #4821. Confidence: 0.94',
    actionable: true,
    actionLabel: 'View Sequence',
  },
  {
    id: 2,
    agent: 'Support',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400',
    time: '2m ago',
    text: 'Auto-resolved ticket #1847 — password reset. Resolution time: 12s',
  },
  {
    id: 3,
    agent: 'Compliance',
    color: 'text-blue-400',
    bg: 'bg-blue-400',
    time: '8m ago',
    text: 'HIPAA audit scan complete. 0 violations detected. Next scan in 4h.',
  },
  {
    id: 4,
    agent: 'Comms',
    color: 'text-amber-400',
    bg: 'bg-amber-400',
    time: '14m ago',
    text: 'Drafted multi-channel outreach for 12 at-risk customers. Awaiting approval.',
    actionable: true,
    actionLabel: 'Review Drafts',
  },
  {
    id: 5,
    agent: 'Analytics',
    color: 'text-blue-400',
    bg: 'bg-blue-400',
    time: '22m ago',
    text: 'Customer churn prediction model updated. 3 new high-risk accounts flagged.',
  },
  {
    id: 6,
    agent: 'Collections',
    color: 'text-amber-400',
    bg: 'bg-amber-400',
    time: '31m ago',
    text: 'Escalated account #3907 to human review — confidence 0.63, below threshold.',
  },
];

const topologyNodes: TopologyNode[] = [
  {
    id: 'core',
    name: 'ORDR AI Core',
    type: 'core',
    x: 50,
    y: 50,
    size: 100,
    status: 'active',
    metric: '142 ops/min',
    detail: 'Multi-agent orchestrator processing 6 concurrent workflows. All safety gates nominal.',
  },
  {
    id: 'events',
    name: 'Kafka Events',
    type: 'events',
    x: 12,
    y: 22,
    size: 64,
    status: 'active',
    metric: '1,247 evt/s',
    detail: 'Event sourcing backbone. 4 partitions active, consumer lag < 50ms.',
  },
  {
    id: 'graph',
    name: 'Customer Graph',
    type: 'graph',
    x: 10,
    y: 50,
    size: 58,
    status: 'active',
    metric: '2,841 nodes',
    detail: 'Neo4j relationship graph. 12,400 edges mapped across customer interactions.',
  },
  {
    id: 'channels',
    name: 'Inbound Channels',
    type: 'channels',
    x: 12,
    y: 78,
    size: 60,
    status: 'warning',
    metric: '3 queued',
    detail: 'Email, SMS, and voice channels. 3 inbound messages awaiting agent triage.',
  },
  {
    id: 'agents',
    name: 'Agent Runtime',
    type: 'agents',
    x: 88,
    y: 22,
    size: 66,
    status: 'active',
    metric: '6 online',
    detail: 'LangGraph execution environment. All 6 agents healthy, avg latency 340ms.',
  },
  {
    id: 'compliance',
    name: 'Compliance Engine',
    type: 'compliance',
    x: 90,
    y: 50,
    size: 58,
    status: 'active',
    metric: '98.7%',
    detail: 'SOC 2 + ISO 27001 + HIPAA rules engine. Last audit pass: 2h ago.',
  },
  {
    id: 'analytics',
    name: 'Analytics Store',
    type: 'analytics',
    x: 88,
    y: 78,
    size: 60,
    status: 'active',
    metric: '24h window',
    detail: 'ClickHouse OLAP store. Rolling 24h aggregates across 14 metric dimensions.',
  },
];

const topologyLinks: TopologyLink[] = [
  { source: 'events', target: 'core', speed: 5, load: 90 },
  { source: 'graph', target: 'core', speed: 4, load: 70 },
  { source: 'channels', target: 'core', speed: 2, load: 35, warning: true },
  { source: 'core', target: 'agents', speed: 4, load: 80 },
  { source: 'core', target: 'compliance', speed: 3, load: 65 },
  { source: 'core', target: 'analytics', speed: 4, load: 75 },
];

const kpiCards: KpiCard[] = [
  { label: 'Active Agents', value: '6', color: 'text-emerald-400', dotColor: 'bg-emerald-500' },
  { label: 'Events / sec', value: '1,247', color: 'text-blue-400', dotColor: 'bg-blue-500' },
  { label: 'Customers', value: '2,841', color: 'text-amber-400', dotColor: 'bg-amber-500' },
  { label: 'Compliance', value: '98.7%', color: 'text-emerald-400', dotColor: 'bg-emerald-500' },
];

const priorityActions: PriorityAction[] = [
  {
    id: 1,
    type: 'escalation',
    title: 'VIP Ticket Escalation',
    description: 'Escalated ticket from enterprise customer — SLA breach in 18 min',
    score: 98,
  },
  {
    id: 2,
    type: 'compliance',
    title: 'Data Access Review',
    description: 'Compliance review needed for new data access pattern on tenant scope',
    score: 92,
  },
  {
    id: 3,
    type: 'agent',
    title: 'Low Confidence Action',
    description: 'Agent confidence below threshold (0.63) on collection action #3907',
    score: 87,
  },
];

// --- Helpers ---

function getNodeIcon(type: TopologyNode['type']): ReactNode {
  const shared = 'h-1/2 w-1/2 transition-colors';
  switch (type) {
    case 'core':
      return <Sparkles className={`${shared} text-amber-300`} />;
    case 'events':
      return <Activity className={`${shared} text-blue-300 group-hover:text-white`} />;
    case 'graph':
      return <Waypoints className={`${shared} text-emerald-300 group-hover:text-white`} />;
    case 'channels':
      return <Mail className={`${shared} text-amber-300 group-hover:text-white`} />;
    case 'agents':
      return <Bot className={`${shared} text-emerald-300 group-hover:text-white`} />;
    case 'compliance':
      return <ShieldCheck className={`${shared} text-blue-300 group-hover:text-white`} />;
    case 'analytics':
      return <BarChart3 className={`${shared} text-amber-300 group-hover:text-white`} />;
    default:
      return <Database className={`${shared} text-slate-300`} />;
  }
}

function getPriorityIcon(type: PriorityAction['type']): ReactNode {
  switch (type) {
    case 'escalation':
      return <Flame className="h-3.5 w-3.5 text-red-400" />;
    case 'compliance':
      return <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />;
    case 'agent':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
  }
}

// --- Component ---

export function DemoOperations(): ReactNode {
  const [command, setCommand] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);

  const handleCommandSubmit = (e: SyntheticEvent): void => {
    e.preventDefault();
    if (!command.trim()) return;
    setIsProcessing(true);
    setTimeout(() => {
      setCommand('');
      setIsProcessing(false);
    }, 1500);
  };

  return (
    <div className="flex h-full flex-col p-6">
      {/* Command Bar */}
      <form
        onSubmit={handleCommandSubmit}
        className={`mb-6 flex items-center rounded-xl border backdrop-blur-xl transition-all duration-300 ${
          isProcessing
            ? 'border-amber-500/50 bg-[#0d0d12] shadow-[0_0_20px_rgba(251,191,36,0.15)]'
            : 'border-white/10 bg-[#0d0d12]'
        }`}
      >
        <div className="pl-4 pr-3 text-amber-400">
          {isProcessing ? (
            <Terminal className="h-5 w-5 animate-pulse" />
          ) : (
            <Zap className="h-5 w-5" />
          )}
        </div>
        <input
          type="text"
          value={command}
          onChange={(e) => {
            setCommand(e.target.value);
          }}
          placeholder="Instruct ORDR AI... (e.g., 'Analyze churn risk for enterprise tier')"
          className="flex-1 border-none bg-transparent py-3 text-sm font-medium text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-0"
        />
        <div className="flex items-center gap-2 pr-3">
          <button
            type="submit"
            className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-1.5 text-amber-400 transition-colors hover:bg-amber-500/20"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>

      {/* Three-Panel Layout */}
      <div className="flex flex-1 gap-6 overflow-hidden">
        {/* LEFT — Agent Activity Stream */}
        <aside className="flex w-[320px] shrink-0 flex-col">
          <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-white">
              <Activity className="h-4 w-4 text-amber-400" />
              Agent Activity
            </h2>
            <span className="font-mono text-[10px] text-slate-600">LIVE</span>
          </div>

          <div className="demo-scrollbar flex-1 space-y-3 overflow-y-auto pr-2">
            {agentLogs.map((log) => (
              <div
                key={log.id}
                className="group relative cursor-default overflow-hidden rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md transition-colors hover:border-white/10"
              >
                <div className={`absolute left-0 top-0 h-full w-1 ${log.bg}/50`} />
                <div className="mb-2 flex items-center justify-between">
                  <div
                    className={`flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider ${log.color}`}
                  >
                    <Brain className="h-3 w-3" />[ {log.agent} ]
                  </div>
                  <span className="font-mono text-[10px] text-slate-500">{log.time}</span>
                </div>
                <p className="text-sm font-light leading-relaxed text-slate-300">{log.text}</p>
                {log.actionable === true && (
                  <div className="mt-3 flex gap-2">
                    <button className="flex flex-1 items-center justify-center gap-2 rounded border border-amber-500/20 bg-amber-500/10 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20">
                      <Crosshair className="h-3 w-3" />
                      {log.actionLabel}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* CENTER — Operations Topology */}
        <section className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#0a0a0f]/60 shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          {/* Topology Header */}
          <div className="absolute left-6 top-6 z-20 flex flex-col gap-1">
            <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-white">
              <Network className="h-4 w-4 text-amber-400" /> Operations Topology
            </h2>
            <p className="font-mono text-[10px] text-slate-500">
              Live agent orchestration &amp; data flow
            </p>
          </div>

          <div className="absolute right-6 top-6 z-20">
            {selectedNode !== null && (
              <button
                onClick={() => {
                  setSelectedNode(null);
                }}
                className="flex items-center gap-1 font-mono text-xs text-slate-500 transition-colors hover:text-white"
              >
                <X className="h-3 w-3" /> Clear Selection
              </button>
            )}
          </div>

          {/* SVG Flow Lines */}
          <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full">
            <defs>
              <linearGradient id="ops-flow-amber" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(251,191,36,0)" />
                <stop offset="50%" stopColor="rgba(251,191,36,0.6)" />
                <stop offset="100%" stopColor="rgba(251,191,36,0)" />
              </linearGradient>
              <linearGradient id="ops-flow-red" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(239,68,68,0)" />
                <stop offset="50%" stopColor="rgba(239,68,68,0.8)" />
                <stop offset="100%" stopColor="rgba(239,68,68,0)" />
              </linearGradient>
            </defs>
            {topologyLinks.map((link, idx) => {
              const src = topologyNodes.find((n) => n.id === link.source);
              const tgt = topologyNodes.find((n) => n.id === link.target);
              if (!src || !tgt) return null;
              return (
                <g key={idx}>
                  <line
                    x1={`${src.x}%`}
                    y1={`${src.y}%`}
                    x2={`${tgt.x}%`}
                    y2={`${tgt.y}%`}
                    stroke="rgba(255,255,255,0.03)"
                    strokeWidth={4}
                  />
                  <line
                    x1={`${src.x}%`}
                    y1={`${src.y}%`}
                    x2={`${tgt.x}%`}
                    y2={`${tgt.y}%`}
                    stroke={link.warning === true ? 'url(#ops-flow-red)' : 'url(#ops-flow-amber)'}
                    strokeWidth={link.load / 20}
                    className="data-flow-animation"
                    style={{ animationDuration: `${6 - link.speed}s`, strokeDasharray: '15, 35' }}
                  />
                </g>
              );
            })}
          </svg>

          {/* Topology Nodes */}
          {topologyNodes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            const isCore = node.type === 'core';
            const isSource = ['events', 'graph', 'channels'].includes(node.type);

            return (
              <div
                key={node.id}
                onClick={() => {
                  setSelectedNode(node);
                }}
                className="group absolute z-10 flex cursor-pointer flex-col items-center justify-center transition-all duration-500 ease-out"
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="relative">
                  {isCore && (
                    <>
                      <div className="absolute inset-0 scale-[1.4] animate-[spin_12s_linear_infinite] rounded-full border border-amber-500/20" />
                      <div className="absolute inset-0 scale-[1.7] animate-[spin_18s_linear_infinite_reverse] rounded-full border border-blue-500/20" />
                    </>
                  )}
                  {node.status === 'warning' && (
                    <div className="absolute inset-0 animate-ping scale-[1.3] rounded-full border-2 border-red-500/40" />
                  )}

                  <div
                    className={`relative z-10 flex items-center justify-center rounded-2xl backdrop-blur-md transition-all duration-300 ${
                      isCore
                        ? 'border-2 border-amber-500 bg-gradient-to-br from-[#1a1500] to-[#0d0d12] shadow-[0_0_40px_rgba(251,191,36,0.15)]'
                        : 'border border-white/10 bg-[#0d0d12] hover:border-amber-400/50'
                    } ${isSelected && !isCore ? 'ring-2 ring-amber-400 ring-offset-4 ring-offset-[#060608] border-amber-400' : ''} ${
                      isSource ? 'rounded-l-full rounded-r-xl' : ''
                    } ${!isSource && !isCore ? 'rounded-r-full rounded-l-xl' : ''}`}
                    style={{ width: `${node.size}px`, height: `${node.size}px` }}
                  >
                    {getNodeIcon(node.type)}
                  </div>
                </div>

                <div
                  className={`pointer-events-none mt-4 flex flex-col items-center transition-all duration-300 ${
                    isSelected || isCore
                      ? 'opacity-100 transform-none'
                      : 'translate-y-2 opacity-0 group-hover:transform-none group-hover:opacity-100'
                  }`}
                >
                  <div className="flex flex-col items-center rounded-lg border border-white/10 bg-[#0d0d12]/90 px-3 py-1.5 shadow-xl backdrop-blur">
                    <span className="whitespace-nowrap text-sm font-bold text-white">
                      {node.name}
                    </span>
                    <span
                      className={`mt-0.5 font-mono text-[10px] ${node.status === 'warning' ? 'text-red-400' : 'text-amber-400'}`}
                    >
                      {node.metric}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {/* RIGHT — KPIs + Priority Queue / Node Inspector */}
        <aside className="flex w-[360px] shrink-0 flex-col gap-4">
          {/* KPI Grid */}
          <div className="grid grid-cols-2 gap-3">
            {kpiCards.map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md transition-colors hover:border-white/10"
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <div className={`h-2 w-2 rounded-full ${kpi.dotColor} animate-pulse`} />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    {kpi.label}
                  </span>
                </div>
                <p className={`font-mono text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
              </div>
            ))}
          </div>

          {/* Priority Queue or Node Inspector */}
          {!selectedNode ? (
            <div className="relative flex flex-1 flex-col overflow-hidden rounded-xl border border-amber-500/10 bg-[#0d0d12]/80 p-5 backdrop-blur-md">
              <h3 className="mb-4 flex items-center gap-2 border-b border-white/10 pb-2 font-mono text-xs uppercase tracking-widest text-amber-500">
                <Zap className="h-4 w-4" /> Priority Action Queue
              </h3>

              <div className="demo-scrollbar flex-1 space-y-3 overflow-y-auto pr-2">
                {priorityActions.map((item) => (
                  <div
                    key={item.id}
                    className="group cursor-pointer rounded-xl border border-white/5 bg-white/[0.02] p-3 transition-colors hover:border-amber-500/30"
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {getPriorityIcon(item.type)}
                        <span className="text-xs font-bold text-white">{item.title}</span>
                      </div>
                      <div className="flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                        <Flame className="h-2.5 w-2.5" /> {item.score}
                      </div>
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-slate-400">
                      {item.description}
                    </p>

                    <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <button className="flex flex-1 items-center justify-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 py-1.5 font-mono text-[10px] text-amber-400 hover:bg-amber-500/20">
                        <Check className="h-3 w-3" /> Review
                      </button>
                      <button className="flex flex-1 items-center justify-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 py-1.5 font-mono text-[10px] text-emerald-400 hover:bg-emerald-500/20">
                        <CheckCircle2 className="h-3 w-3" /> Approve
                      </button>
                      <button className="rounded border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-[10px] text-slate-400 hover:bg-white/10">
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="relative flex flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0d0d12]/80 p-5 backdrop-blur-md">
              <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 bg-amber-500/5 blur-[50px]" />

              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-2">
                <h3 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-slate-500">
                  <Layers className="h-4 w-4" /> Node Inspector
                </h3>
                <button
                  onClick={() => {
                    setSelectedNode(null);
                  }}
                  className="flex items-center gap-1 font-mono text-[10px] text-slate-500 transition-colors hover:text-white"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              </div>

              <div className="flex flex-1 flex-col">
                <div className="mb-6 flex items-center gap-3">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-lg border ${
                      selectedNode.status === 'warning'
                        ? 'border-red-500/30 bg-red-500/10'
                        : 'border-white/10 bg-white/5'
                    }`}
                  >
                    {getNodeIcon(selectedNode.type)}
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-white">{selectedNode.name}</h4>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-amber-500">
                      {selectedNode.type === 'core' ? 'AI Orchestrator' : selectedNode.type}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      Metric
                    </p>
                    <p className="font-mono text-xl font-bold text-white">{selectedNode.metric}</p>
                  </div>

                  <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      Status
                    </p>
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full ${selectedNode.status === 'warning' ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`}
                      />
                      <span
                        className={`font-mono text-xs font-bold ${selectedNode.status === 'warning' ? 'text-red-400' : 'text-emerald-400'}`}
                      >
                        {selectedNode.status === 'warning' ? 'ATTENTION REQUIRED' : 'OPERATIONAL'}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-500/20 bg-amber-900/10 p-3">
                    <p className="font-mono text-xs leading-relaxed text-amber-100/70">
                      {selectedNode.detail}
                    </p>
                  </div>

                  {selectedNode.type !== 'core' && (
                    <div className="flex gap-2">
                      <button className="flex flex-1 items-center justify-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 py-2 font-mono text-[10px] text-amber-400 transition-colors hover:bg-amber-500/20">
                        <Crosshair className="h-3 w-3" /> Inspect Logs
                      </button>
                      <button className="flex flex-1 items-center justify-center gap-1 rounded border border-white/10 bg-white/5 py-2 font-mono text-[10px] text-slate-300 transition-colors hover:bg-white/10">
                        <Activity className="h-3 w-3" /> View Metrics
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
