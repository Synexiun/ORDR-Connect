/**
 * SampleDashboard — Real Estate AI Operations Demo
 *
 * Showcases the ORDR-Connect agentic topology pattern applied to
 * a real-estate vertical: lead routing, escrow coordination,
 * autonomous comms, and priority action queues.
 *
 * COMPLIANCE:
 * - No PHI in demo data (Rule 6)
 * - No secrets exposed (Rule 5)
 * - All data is synthetic mock data
 */

import { type ReactNode, useState, type SyntheticEvent } from 'react';
import {
  Send,
  Zap,
  Activity,
  Terminal,
  Sparkles,
  Network,
  AlertTriangle,
  Home,
  Key,
  Users,
  DollarSign,
  Mail,
  Phone,
  Flame,
  Building,
  MapPin,
  Inbox,
  Check,
  X,
} from '../components/icons';

// --- Types ---

interface LogEntry {
  id: number;
  agent: string;
  type: string;
  time: string;
  text: string;
  color: string;
  bg: string;
  actionable?: boolean;
  actionType?: 'email' | 'sms';
}

interface TopologyNode {
  id: string;
  name: string;
  type: 'core' | 'source' | 'comms' | 'entity' | 'escrow';
  x: number;
  y: number;
  size: number;
  status: 'active' | 'warning';
  metric: string;
}

interface TopologyLink {
  source: string;
  target: string;
  speed: number;
  load: number;
  warning?: boolean;
}

interface PriorityItem {
  id: number;
  type: 'email' | 'call' | 'doc';
  client: string;
  subject: string;
  score: number;
  time: string;
}

// --- Mock Data ---

const mockLogs: LogEntry[] = [
  {
    id: 1,
    agent: 'LeadGen',
    type: 'info',
    time: 'Just now',
    text: 'Ingested new lead from Zillow. Cross-referenced MLS; they are looking for 3BR+ in Irvine.',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
  },
  {
    id: 2,
    agent: 'Comms',
    type: 'action',
    time: '2m ago',
    text: 'Drafted follow-up email to Sarah Jenkins regarding 142 Ocean Ave. Tone: Urgent/Exclusive.',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
    actionable: true,
    actionType: 'email',
  },
  {
    id: 3,
    agent: 'Scout',
    type: 'success',
    time: '12m ago',
    text: 'Found 4 off-market properties matching the criteria for the Martinez family. Compiling portfolio.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
  },
  {
    id: 4,
    agent: 'Coordinator',
    type: 'alert',
    time: '18m ago',
    text: 'Escrow alert: Missing buyer signature on contingency removal for 992 Maple St.',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    actionable: true,
    actionType: 'sms',
  },
  {
    id: 5,
    agent: 'Comms',
    type: 'info',
    time: '34m ago',
    text: 'Automatically scheduled viewing for 10:00 AM tomorrow. Calendar invites sent.',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
  },
];

const mockNodes: TopologyNode[] = [
  {
    id: 'core',
    name: 'EstateOS AI Brain',
    type: 'core',
    x: 50,
    y: 50,
    size: 96,
    status: 'active',
    metric: '24 Tasks/m',
  },
  {
    id: 'zillow',
    name: 'Zillow & Trulia',
    type: 'source',
    x: 15,
    y: 20,
    size: 64,
    status: 'active',
    metric: '14 Leads/hr',
  },
  {
    id: 'mls',
    name: 'MLS Live Feed',
    type: 'source',
    x: 10,
    y: 50,
    size: 56,
    status: 'active',
    metric: 'Real-time',
  },
  {
    id: 'inbound',
    name: 'Agency Inbox (Email/SMS)',
    type: 'comms',
    x: 15,
    y: 80,
    size: 60,
    status: 'warning',
    metric: '5 Unread',
  },
  {
    id: 'buyers',
    name: 'Active Buyers',
    type: 'entity',
    x: 85,
    y: 20,
    size: 70,
    status: 'active',
    metric: '42 Active',
  },
  {
    id: 'sellers',
    name: 'Exclusive Listings',
    type: 'entity',
    x: 90,
    y: 50,
    size: 64,
    status: 'active',
    metric: '$24M Vol',
  },
  {
    id: 'escrow',
    name: 'Escrow & Closing',
    type: 'escrow',
    x: 85,
    y: 80,
    size: 50,
    status: 'warning',
    metric: '3 Pending',
  },
];

const mockLinks: TopologyLink[] = [
  { source: 'zillow', target: 'core', speed: 4, load: 85 },
  { source: 'mls', target: 'core', speed: 5, load: 90 },
  { source: 'inbound', target: 'core', speed: 2, load: 40, warning: true },
  { source: 'core', target: 'buyers', speed: 3, load: 75 },
  { source: 'core', target: 'sellers', speed: 4, load: 60 },
  { source: 'core', target: 'escrow', speed: 2, load: 30, warning: true },
];

const mockTelemetry = {
  pipeline: '$42.5M',
  hotLeads: 12,
};

const priorityQueue: PriorityItem[] = [
  {
    id: 101,
    type: 'email',
    client: 'Michael Chang',
    subject: 'Offer strategy for 12 Cherry Ln',
    score: 98,
    time: '2m ago',
  },
  {
    id: 102,
    type: 'call',
    client: 'Sarah Jenkins',
    subject: 'Requested immediate tour of Ocean Ave',
    score: 95,
    time: '15m ago',
  },
  {
    id: 103,
    type: 'doc',
    client: 'Martinez Family',
    subject: 'Contingency removal needed today',
    score: 88,
    time: '1h ago',
  },
];

// --- Helpers ---

function getNodeIcon(type: TopologyNode['type']): ReactNode {
  switch (type) {
    case 'core':
      return <Sparkles className="h-1/2 w-1/2 text-amber-300" />;
    case 'source':
      return (
        <MapPin className="h-1/2 w-1/2 text-blue-300 transition-colors group-hover:text-white" />
      );
    case 'comms':
      return (
        <Inbox className="h-1/2 w-1/2 text-amber-300 transition-colors group-hover:text-white" />
      );
    case 'entity':
      return (
        <Users className="h-1/2 w-1/2 text-emerald-300 transition-colors group-hover:text-white" />
      );
    case 'escrow':
      return <Key className="h-1/2 w-1/2 text-red-300 transition-colors group-hover:text-white" />;
    default:
      return <Building className="h-1/2 w-1/2 text-slate-300" />;
  }
}

// --- Component ---

export function SampleDashboard(): ReactNode {
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
    <div className="flex min-h-screen flex-col overflow-hidden bg-[#060608] font-sans text-slate-300 selection:bg-amber-500/30">
      {/* Background Glows */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMSkiLz48L3N2Zz4=')] opacity-80" />
      <div className="pointer-events-none fixed left-[-10%] top-[-20%] z-0 h-[50%] w-[50%] rounded-full bg-amber-900/10 blur-[150px]" />
      <div className="pointer-events-none fixed bottom-[-20%] right-[-10%] z-0 h-[50%] w-[50%] rounded-full bg-blue-900/10 blur-[150px]" />

      {/* Header / Command Bar */}
      <header className="relative z-50 flex items-center justify-between px-8 pb-4 pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 shadow-[0_0_20px_rgba(251,191,36,0.2)]">
            <Home className="h-6 w-6 text-black" strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-black tracking-tighter text-white">
            ESTATE<span className="font-light text-amber-400">OS</span>
          </h1>
        </div>

        <form
          onSubmit={handleCommandSubmit}
          className={`relative flex w-full max-w-2xl items-center rounded-xl border backdrop-blur-xl transition-all duration-300 ${
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
            placeholder="Instruct the Agency AI... (e.g., 'Draft a personalized outreach email to all hot buyers')"
            className="flex-1 border-none bg-transparent py-3 text-sm font-medium text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-0"
          />
          <div className="flex items-center gap-2 pr-2">
            <button
              type="submit"
              className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-1.5 text-amber-400 transition-colors hover:bg-amber-500/20"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            <span className="font-mono text-xs font-bold tracking-widest text-emerald-400">
              AI ACTIVE
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex flex-1 gap-6 overflow-hidden px-8 pb-8">
        {/* Left Panel: Agent Logs */}
        <aside className="flex w-[320px] flex-col gap-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="flex items-center gap-2 font-mono text-sm uppercase tracking-widest text-white">
              <Activity className="h-4 w-4 text-amber-400" />
              AI Activity Stream
            </h2>
          </div>

          <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto pr-2">
            {mockLogs.map((log) => (
              <div
                key={log.id}
                className="group relative cursor-default overflow-hidden rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md transition-colors hover:border-white/10"
              >
                <div
                  className={`absolute left-0 top-0 h-full w-1 ${log.bg.replace('/10', '/50')}`}
                />
                <div className="mb-2 flex items-center justify-between">
                  <div
                    className={`flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider ${log.color}`}
                  >
                    <Terminal className="h-3 w-3" />[ {log.agent} ]
                  </div>
                  <span className="font-mono text-[10px] text-slate-500">{log.time}</span>
                </div>
                <p className="text-sm font-light leading-relaxed text-slate-300">{log.text}</p>
                {log.actionable === true && (
                  <div className="mt-3 flex gap-2">
                    <button className="flex flex-1 items-center justify-center gap-2 rounded border border-amber-500/20 bg-amber-500/10 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20">
                      {log.actionType === 'email' ? (
                        <Mail className="h-3 w-3" />
                      ) : (
                        <Phone className="h-3 w-3" />
                      )}
                      Review &amp; Send
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* Center: Topology */}
        <section className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/5 bg-[#0a0a0f]/60 shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          <div className="absolute left-6 top-6 z-20 flex flex-col gap-1">
            <h2 className="flex items-center gap-2 font-mono text-xl tracking-widest text-white">
              <Network className="h-5 w-5 text-amber-400" /> LEAD ROUTING TOPOLOGY
            </h2>
            <p className="font-mono text-xs text-slate-500">
              Live deal flow &amp; comms interception
            </p>
          </div>

          <div className="absolute right-6 top-6 z-20">
            {selectedNode !== null && (
              <button
                onClick={() => {
                  setSelectedNode(null);
                }}
                className="flex items-center gap-1 font-mono text-xs text-slate-500 hover:text-white"
              >
                <X className="h-3 w-3" /> Clear Selection
              </button>
            )}
          </div>

          {/* SVG Lines */}
          <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full">
            <defs>
              <linearGradient id="flow-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(251,191,36,0)" />
                <stop offset="50%" stopColor="rgba(251,191,36,0.6)" />
                <stop offset="100%" stopColor="rgba(251,191,36,0)" />
              </linearGradient>
              <linearGradient id="flow-gradient-warning" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(239,68,68,0)" />
                <stop offset="50%" stopColor="rgba(239,68,68,0.8)" />
                <stop offset="100%" stopColor="rgba(239,68,68,0)" />
              </linearGradient>
            </defs>
            {mockLinks.map((link, idx) => {
              const sourceNode = mockNodes.find((n) => n.id === link.source);
              const targetNode = mockNodes.find((n) => n.id === link.target);
              if (!sourceNode || !targetNode) return null;
              return (
                <g key={idx}>
                  <line
                    x1={`${sourceNode.x}%`}
                    y1={`${sourceNode.y}%`}
                    x2={`${targetNode.x}%`}
                    y2={`${targetNode.y}%`}
                    stroke="rgba(255,255,255,0.03)"
                    strokeWidth={4}
                  />
                  <line
                    x1={`${sourceNode.x}%`}
                    y1={`${sourceNode.y}%`}
                    x2={`${targetNode.x}%`}
                    y2={`${targetNode.y}%`}
                    stroke={
                      link.warning === true ? 'url(#flow-gradient-warning)' : 'url(#flow-gradient)'
                    }
                    strokeWidth={link.load / 20}
                    className="data-flow-animation"
                    style={{ animationDuration: `${6 - link.speed}s`, strokeDasharray: '15, 35' }}
                  />
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {mockNodes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            const isCore = node.type === 'core';

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
                        ? 'border-2 border-amber-500 bg-gradient-to-br from-[#1a1500] to-[#0d0d12] shadow-[0_0_40px_rgba(251,191,36,0.15)] shadow-inner'
                        : 'border border-white/10 bg-[#0d0d12] hover:border-amber-400/50'
                    } ${isSelected && !isCore ? 'ring-2 ring-amber-400 ring-offset-4 ring-offset-[#060608] border-amber-400' : ''} ${
                      ['source', 'comms'].includes(node.type) ? 'rounded-l-full rounded-r-xl' : ''
                    } ${['entity', 'escrow'].includes(node.type) ? 'rounded-r-full rounded-l-xl' : ''}`}
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

        {/* Right Panel */}
        <aside className="relative flex w-[360px] flex-col gap-4">
          {/* Pipeline Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative overflow-hidden rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
              <div className="absolute -bottom-4 -right-4 opacity-5">
                <DollarSign className="h-24 w-24" />
              </div>
              <h3 className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase text-slate-500">
                Total Pipeline
              </h3>
              <p className="text-xl font-bold text-white">{mockTelemetry.pipeline}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
              <h3 className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase text-slate-500">
                <Flame className="h-3 w-3 text-amber-500" /> Hot Leads
              </h3>
              <p className="text-xl font-bold text-white">{mockTelemetry.hotLeads}</p>
            </div>
          </div>

          {/* Priority Queue or Node Inspector */}
          {!selectedNode ? (
            <div className="relative flex flex-1 flex-col overflow-hidden rounded-xl border border-amber-500/10 bg-[#0d0d12]/80 p-5 backdrop-blur-md">
              <h3 className="mb-4 flex items-center gap-2 border-b border-white/10 pb-2 font-mono text-xs uppercase tracking-widest text-amber-500">
                <Zap className="h-4 w-4" /> AI Priority Action Queue
              </h3>

              <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto pr-2">
                {priorityQueue.map((item) => (
                  <div
                    key={item.id}
                    className="group cursor-pointer rounded-xl border border-white/5 bg-white/[0.02] p-3 transition-colors hover:border-amber-500/30"
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {item.type === 'email' && <Mail className="h-3 w-3 text-blue-400" />}
                        {item.type === 'call' && <Phone className="h-3 w-3 text-emerald-400" />}
                        {item.type === 'doc' && <Key className="h-3 w-3 text-red-400" />}
                        <span className="text-xs font-bold text-white">{item.client}</span>
                      </div>
                      <div className="flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                        <Flame className="h-2.5 w-2.5" /> {item.score}
                      </div>
                    </div>
                    <p className="mb-3 text-xs text-slate-400">{item.subject}</p>

                    <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      {item.type === 'email' && (
                        <button className="flex flex-1 items-center justify-center gap-1 rounded border border-blue-500/20 bg-blue-500/10 py-1.5 font-mono text-[10px] text-blue-400 hover:bg-blue-500/20">
                          <Check className="h-3 w-3" /> Approve Draft
                        </button>
                      )}
                      {item.type === 'call' && (
                        <button className="flex flex-1 items-center justify-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 py-1.5 font-mono text-[10px] text-emerald-400 hover:bg-emerald-500/20">
                          <Phone className="h-3 w-3" /> Initiate Call
                        </button>
                      )}
                      {item.type === 'doc' && (
                        <button className="flex flex-1 items-center justify-center gap-1 rounded border border-red-500/20 bg-red-500/10 py-1.5 font-mono text-[10px] text-red-400 hover:bg-red-500/20">
                          <AlertTriangle className="h-3 w-3" /> Ping Escrow
                        </button>
                      )}
                      <button className="rounded border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-[10px] text-slate-300 hover:bg-white/10">
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

              <h3 className="mb-4 flex items-center gap-2 border-b border-white/10 pb-2 font-mono text-xs uppercase tracking-widest text-slate-500">
                Node Inspector
              </h3>

              <div className="flex h-full flex-col">
                <div className="mb-6 flex items-center gap-3">
                  <div
                    className={`rounded-lg border p-3 ${
                      selectedNode.status === 'warning'
                        ? 'border-red-500/30 bg-red-500/10 text-red-400'
                        : 'border-white/10 bg-white/5 text-slate-300'
                    }`}
                  >
                    {getNodeIcon(selectedNode.type)}
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-white">{selectedNode.name}</h4>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-amber-500">
                      {selectedNode.type === 'core' ? 'AI Engine' : selectedNode.type}
                    </p>
                  </div>
                </div>

                {selectedNode.type === 'comms' ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                      <p className="mb-2 font-mono text-[10px] text-slate-500">
                        LIVE INBOX INTELLIGENCE
                      </p>
                      <p className="mb-3 text-sm text-slate-300">
                        AI is currently monitoring 3 connected inboxes. Found 5 emails requiring
                        response.
                      </p>
                      <button className="w-full rounded border border-amber-500/30 bg-amber-500/10 py-2 font-mono text-xs text-amber-400 hover:bg-amber-500/20">
                        Auto-Draft All Responses
                      </button>
                    </div>
                  </div>
                ) : selectedNode.type === 'entity' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3">
                      <div>
                        <p className="mb-1 font-mono text-[10px] text-slate-500">
                          AGGREGATE MATCH SCORE
                        </p>
                        <p className="font-mono text-xl text-white">
                          92% <span className="text-xs text-emerald-400">High Probability</span>
                        </p>
                      </div>
                      <Flame className="h-8 w-8 text-amber-500/50" />
                    </div>
                    <div className="mt-4 space-y-2 text-xs">
                      <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-slate-400">Auto-Emails Sent (24h)</span>
                        <span className="text-white">18</span>
                      </div>
                      <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-slate-400">Showings Scheduled</span>
                        <span className="text-white">4</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                      <p className="mb-1 font-mono text-[10px] text-slate-500">METRIC</p>
                      <p className="font-mono text-xl text-white">{selectedNode.metric}</p>
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-900/10 p-3">
                      <p className="font-mono text-xs leading-relaxed text-amber-100/70">
                        Agentic monitoring is active. Routing patterns are optimized for conversion
                        speed.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* Custom Animations */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(251,191,36,0.5); }
        @keyframes dashFlow { from { stroke-dashoffset: 50; } to { stroke-dashoffset: 0; } }
        .data-flow-animation { animation-name: dashFlow; animation-timing-function: linear; animation-iteration-count: infinite; }
      `,
        }}
      />
    </div>
  );
}
