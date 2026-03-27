/**
 * DemoCustomerIntel — Customer Intelligence Demo Page
 *
 * Interactive customer graph visualization with 360-degree intelligence
 * panels, health scoring, churn risk analysis, and relationship mapping.
 *
 * COMPLIANCE:
 * - No PHI in demo data (Rule 6)
 * - No secrets exposed (Rule 5)
 * - All data is synthetic mock data
 */

import { type ReactNode, useState, useCallback } from 'react';
import {
  Users,
  Heart,
  Globe,
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Mail,
  Phone,
  MessageCircle,
  Eye,
  Search,
  Filter,
  Sparkles,
  Network,
  Brain,
  X,
} from '../../components/icons';

// --- Types ---

interface CustomerNode {
  id: string;
  name: string;
  initials: string;
  health: number;
  revenue: number;
  segment: 'enterprise' | 'mid-market' | 'startup';
  x: number;
  y: number;
  status: 'healthy' | 'at-risk' | 'churning';
  connections: string[];
}

interface CustomerActivity {
  timestamp: string;
  description: string;
  type: 'email' | 'call' | 'ticket' | 'agent';
}

interface ChurnFactor {
  label: string;
  weight: number;
}

interface CustomerDetail {
  healthTrend: number[];
  lifecycleStage: 'Onboarding' | 'Active' | 'At-Risk' | 'Churning';
  emails: number;
  calls: number;
  tickets: number;
  agents: number;
  recentActivity: CustomerActivity[];
  churnRisk: number;
  churnFactors: ChurnFactor[];
}

interface KpiCard {
  label: string;
  value: string;
  icon: ReactNode;
  color: string;
  trend?: { direction: 'up' | 'down'; value: string };
}

interface TableRow {
  id: string;
  name: string;
  segment: string;
  health: number;
  revenue: string;
  lastContact: string;
  status: CustomerNode['status'];
}

// --- Mock Data ---

const NODES: CustomerNode[] = [
  {
    id: 'ac',
    name: 'Acme Corp',
    initials: 'AC',
    health: 92,
    revenue: 124000,
    segment: 'enterprise',
    x: 250,
    y: 120,
    status: 'healthy',
    connections: ['ts', 'gf', 'mc'],
  },
  {
    id: 'ts',
    name: 'TechStart Inc',
    initials: 'TS',
    health: 78,
    revenue: 45000,
    segment: 'mid-market',
    x: 450,
    y: 80,
    status: 'healthy',
    connections: ['ac', 'df'],
  },
  {
    id: 'gf',
    name: 'GlobalFin',
    initials: 'GF',
    health: 34,
    revenue: 89000,
    segment: 'enterprise',
    x: 160,
    y: 280,
    status: 'churning',
    connections: ['ac', 'sn'],
  },
  {
    id: 'df',
    name: 'DataFlow',
    initials: 'DF',
    health: 85,
    revenue: 67000,
    segment: 'mid-market',
    x: 520,
    y: 220,
    status: 'healthy',
    connections: ['ts', 'cb'],
  },
  {
    id: 'cb',
    name: 'CloudBase',
    initials: 'CB',
    health: 56,
    revenue: 23000,
    segment: 'startup',
    x: 620,
    y: 340,
    status: 'at-risk',
    connections: ['df', 'aw'],
  },
  {
    id: 'sn',
    name: 'SecureNet',
    initials: 'SN',
    health: 91,
    revenue: 156000,
    segment: 'enterprise',
    x: 100,
    y: 160,
    status: 'healthy',
    connections: ['gf', 'mc'],
  },
  {
    id: 'aw',
    name: 'AppWorks',
    initials: 'AW',
    health: 42,
    revenue: 12000,
    segment: 'startup',
    x: 580,
    y: 130,
    status: 'at-risk',
    connections: ['cb', 'nt'],
  },
  {
    id: 'mc',
    name: 'MegaCorp',
    initials: 'MC',
    health: 88,
    revenue: 234000,
    segment: 'enterprise',
    x: 340,
    y: 300,
    status: 'healthy',
    connections: ['ac', 'sn', 'df'],
  },
  {
    id: 'nt',
    name: 'NovaTech',
    initials: 'NT',
    health: 29,
    revenue: 8000,
    segment: 'startup',
    x: 470,
    y: 370,
    status: 'churning',
    connections: ['aw', 'cb'],
  },
];

const act = (t: string, d: string, tp: CustomerActivity['type']): CustomerActivity => ({
  timestamp: t,
  description: d,
  type: tp,
});
const cf = (l: string, w: number): ChurnFactor => ({ label: l, weight: w });

const DETAILS: Record<string, CustomerDetail> = {
  ac: {
    healthTrend: [78, 82, 85, 88, 90, 92],
    lifecycleStage: 'Active',
    emails: 24,
    calls: 8,
    tickets: 1,
    agents: 12,
    churnRisk: 4,
    recentActivity: [
      act('2h ago', 'Agent sent renewal proposal via email', 'agent'),
      act('1d ago', 'Support call — billing inquiry resolved', 'call'),
      act('3d ago', 'Opened feature request ticket #1042', 'ticket'),
      act('5d ago', 'Quarterly business review completed', 'email'),
    ],
    churnFactors: [cf('Strong engagement', -30), cf('High NPS score', -20)],
  },
  ts: {
    healthTrend: [70, 72, 74, 75, 76, 78],
    lifecycleStage: 'Active',
    emails: 18,
    calls: 5,
    tickets: 2,
    agents: 8,
    churnRisk: 15,
    recentActivity: [
      act('4h ago', 'Onboarding check-in email sent', 'email'),
      act('2d ago', 'Agent escalated integration issue', 'agent'),
      act('4d ago', 'Product demo scheduled for next week', 'call'),
    ],
    churnFactors: [cf('Slower feature adoption', 10), cf('Active support engagement', -8)],
  },
  gf: {
    healthTrend: [72, 65, 58, 48, 40, 34],
    lifecycleStage: 'Churning',
    emails: 31,
    calls: 12,
    tickets: 5,
    agents: 18,
    churnRisk: 78,
    recentActivity: [
      act('1h ago', 'Churn risk alert triggered — agent notified', 'agent'),
      act('6h ago', 'Missed scheduled call — no response', 'call'),
      act('2d ago', 'Opened 3 critical support tickets', 'ticket'),
      act('5d ago', 'Payment delayed — invoice 30 days overdue', 'email'),
    ],
    churnFactors: [
      cf('Engagement drop -62%', 35),
      cf('5 open support tickets', 25),
      cf('Payment 30d overdue', 18),
    ],
  },
  df: {
    healthTrend: [80, 82, 83, 84, 84, 85],
    lifecycleStage: 'Active',
    emails: 14,
    calls: 4,
    tickets: 0,
    agents: 6,
    churnRisk: 8,
    recentActivity: [
      act('3h ago', 'Monthly usage report delivered', 'agent'),
      act('1d ago', 'Renewed annual subscription', 'email'),
      act('6d ago', 'Completed API integration setup', 'ticket'),
    ],
    churnFactors: [cf('Consistent usage patterns', -25), cf('Recent renewal', -20)],
  },
  cb: {
    healthTrend: [68, 64, 62, 60, 58, 56],
    lifecycleStage: 'At-Risk',
    emails: 10,
    calls: 3,
    tickets: 3,
    agents: 5,
    churnRisk: 42,
    recentActivity: [
      act('5h ago', 'Agent flagged declining login frequency', 'agent'),
      act('2d ago', 'Support ticket about pricing concerns', 'ticket'),
      act('7d ago', 'Skipped product training session', 'email'),
    ],
    churnFactors: [
      cf('Login frequency -38%', 20),
      cf('Pricing concern raised', 15),
      cf('Skipped training', 7),
    ],
  },
  sn: {
    healthTrend: [85, 87, 88, 89, 90, 91],
    lifecycleStage: 'Active',
    emails: 20,
    calls: 7,
    tickets: 0,
    agents: 10,
    churnRisk: 3,
    recentActivity: [
      act('1h ago', 'Expansion opportunity identified by agent', 'agent'),
      act('3d ago', 'Executive sponsor call completed', 'call'),
      act('5d ago', 'New department onboarded — 14 seats added', 'email'),
    ],
    churnFactors: [cf('Active expansion', -35), cf('Executive sponsor engaged', -20)],
  },
  aw: {
    healthTrend: [58, 55, 52, 48, 45, 42],
    lifecycleStage: 'At-Risk',
    emails: 8,
    calls: 2,
    tickets: 4,
    agents: 3,
    churnRisk: 58,
    recentActivity: [
      act('8h ago', 'Agent sent re-engagement campaign', 'agent'),
      act('3d ago', 'No response to outreach email', 'email'),
      act('10d ago', 'Downgrade request submitted', 'ticket'),
    ],
    churnFactors: [
      cf('Downgrade request', 28),
      cf('No response to outreach', 18),
      cf('4 open tickets', 12),
    ],
  },
  mc: {
    healthTrend: [82, 84, 85, 86, 87, 88],
    lifecycleStage: 'Active',
    emails: 28,
    calls: 10,
    tickets: 1,
    agents: 15,
    churnRisk: 6,
    recentActivity: [
      act('30m ago', 'Upsell proposal generated by agent', 'agent'),
      act('1d ago', 'Strategic planning call with VP', 'call'),
      act('4d ago', 'Custom integration milestone delivered', 'ticket'),
      act('6d ago', 'NPS survey completed — score 9/10', 'email'),
    ],
    churnFactors: [cf('VP-level engagement', -30), cf('High NPS (9/10)', -25)],
  },
  nt: {
    healthTrend: [52, 48, 42, 38, 33, 29],
    lifecycleStage: 'Churning',
    emails: 6,
    calls: 1,
    tickets: 2,
    agents: 2,
    churnRisk: 85,
    recentActivity: [
      act('2h ago', 'Cancellation intent detected by agent', 'agent'),
      act('4d ago', 'Last login was 18 days ago', 'email'),
      act('12d ago', 'Competitor evaluation mentioned in ticket', 'ticket'),
    ],
    churnFactors: [
      cf('Cancellation intent detected', 40),
      cf('18 days since last login', 25),
      cf('Competitor evaluation', 20),
    ],
  },
};

const TABLE_ROWS: TableRow[] = [
  {
    id: 'nt',
    name: 'NovaTech',
    segment: 'Startup',
    health: 29,
    revenue: '$8K',
    lastContact: '4d ago',
    status: 'churning',
  },
  {
    id: 'gf',
    name: 'GlobalFin',
    segment: 'Enterprise',
    health: 34,
    revenue: '$89K',
    lastContact: '6h ago',
    status: 'churning',
  },
  {
    id: 'aw',
    name: 'AppWorks',
    segment: 'Startup',
    health: 42,
    revenue: '$12K',
    lastContact: '3d ago',
    status: 'at-risk',
  },
  {
    id: 'cb',
    name: 'CloudBase',
    segment: 'Startup',
    health: 56,
    revenue: '$23K',
    lastContact: '2d ago',
    status: 'at-risk',
  },
  {
    id: 'ts',
    name: 'TechStart Inc',
    segment: 'Mid-Market',
    health: 78,
    revenue: '$45K',
    lastContact: '2d ago',
    status: 'healthy',
  },
  {
    id: 'ac',
    name: 'Acme Corp',
    segment: 'Enterprise',
    health: 92,
    revenue: '$124K',
    lastContact: '1d ago',
    status: 'healthy',
  },
];

const KPI_CARDS: KpiCard[] = [
  {
    label: 'TOTAL CUSTOMERS',
    value: '2,841',
    icon: <Users className="h-4 w-4" />,
    color: 'text-white',
  },
  {
    label: 'ACTIVE',
    value: '2,104',
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: 'text-emerald-400',
  },
  {
    label: 'AT-RISK',
    value: '312',
    icon: <AlertTriangle className="h-4 w-4" />,
    color: 'text-amber-400',
    trend: { direction: 'up', value: '+18' },
  },
  {
    label: 'CHURNED (30D)',
    value: '47',
    icon: <TrendingDown className="h-4 w-4" />,
    color: 'text-red-400',
  },
  {
    label: 'HEALTH SCORE AVG',
    value: '76.4',
    icon: <Heart className="h-4 w-4" />,
    color: 'text-blue-400',
  },
];

// --- Helpers ---

function hc(health: number): 'emerald' | 'amber' | 'red' {
  return health >= 70 ? 'emerald' : health >= 50 ? 'amber' : 'red';
}

const STATUS_BADGE: Record<CustomerNode['status'], { label: string; bg: string; text: string }> = {
  healthy: { label: 'Healthy', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  'at-risk': { label: 'At-Risk', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  churning: { label: 'Churning', bg: 'bg-red-500/10', text: 'text-red-400' },
};

const LIFECYCLE_BADGE: Record<CustomerDetail['lifecycleStage'], { bg: string; text: string }> = {
  Onboarding: { bg: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-400' },
  Active: { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400' },
  'At-Risk': { bg: 'bg-amber-500/10 border-amber-500/20', text: 'text-amber-400' },
  Churning: { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400' },
};

const ACT_ICONS: Record<CustomerActivity['type'], ReactNode> = {
  email: <Mail className="h-3 w-3 text-blue-400" />,
  call: <Phone className="h-3 w-3 text-emerald-400" />,
  ticket: <MessageCircle className="h-3 w-3 text-amber-400" />,
  agent: <Brain className="h-3 w-3 text-purple-400" />,
};

function nodeR(rev: number): number {
  if (rev >= 150000) return 32;
  if (rev >= 80000) return 28;
  if (rev >= 40000) return 24;
  return rev >= 20000 ? 20 : 17;
}

const STROKE: Record<CustomerNode['status'], string> = {
  healthy: 'rgba(52,211,153,0.7)',
  'at-risk': 'rgba(251,191,36,0.7)',
  churning: 'rgba(248,113,113,0.7)',
};
const FILL: Record<CustomerNode['status'], string> = {
  healthy: 'rgba(52,211,153,0.12)',
  'at-risk': 'rgba(251,191,36,0.12)',
  churning: 'rgba(248,113,113,0.12)',
};
const GLOW: Record<CustomerNode['status'], string> = {
  healthy: 'rgba(52,211,153,0.3)',
  'at-risk': 'rgba(251,191,36,0.3)',
  churning: 'rgba(248,113,113,0.3)',
};
const BAR_C: Record<'emerald' | 'amber' | 'red', string> = {
  emerald: 'rgba(52,211,153,0.5)',
  amber: 'rgba(251,191,36,0.5)',
  red: 'rgba(248,113,113,0.5)',
};
const SOLID: Record<'emerald' | 'amber' | 'red', string> = {
  emerald: 'rgb(52,211,153)',
  amber: 'rgb(251,191,36)',
  red: 'rgb(248,113,113)',
};

// Build unique edge list
const EDGES: Array<{ from: CustomerNode; to: CustomerNode }> = [];
const _seen = new Set<string>();
for (const n of NODES) {
  for (const cid of n.connections) {
    const key = [n.id, cid].sort().join('-');
    if (!_seen.has(key)) {
      _seen.add(key);
      const t = NODES.find((x) => x.id === cid);
      if (t) EDGES.push({ from: n, to: t });
    }
  }
}

// --- Component ---

export function DemoCustomerIntel(): ReactNode {
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const toggle = useCallback((id: string) => {
    setSelectedCustomer((p) => (p === id ? null : id));
  }, []);

  const selNode = NODES.find((n) => n.id === selectedCustomer) ?? null;
  const selDetail = selectedCustomer !== null ? (DETAILS[selectedCustomer] ?? null) : null;
  const filteredIds = new Set(
    searchQuery !== ''
      ? NODES.filter((n) => n.name.toLowerCase().includes(searchQuery.toLowerCase())).map(
          (n) => n.id,
        )
      : NODES.map((n) => n.id),
  );

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-black tracking-tight text-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 shadow-[0_0_20px_rgba(251,191,36,0.15)]">
              <Network className="h-5 w-5 text-black" />
            </div>
            Customer Intelligence
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Relationship graph, health scoring &amp; churn prediction
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-[#0d0d12]/80 px-3 py-2">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Filter customers..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
              className="w-40 bg-transparent text-sm text-slate-300 placeholder-slate-600 focus:outline-none"
            />
            {searchQuery !== '' && (
              <button
                onClick={() => {
                  setSearchQuery('');
                }}
                className="text-slate-500 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <button className="flex items-center gap-2 rounded-lg border border-white/5 bg-[#0d0d12]/80 px-3 py-2 text-sm text-slate-400 hover:text-white">
            <Filter className="h-4 w-4" /> Filters
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-4">
        {KPI_CARDS.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                {k.label}
              </span>
              <span className={k.color}>{k.icon}</span>
            </div>
            <div className="flex items-end justify-between">
              <span className={`font-mono text-2xl font-bold ${k.color}`}>{k.value}</span>
              {k.trend && (
                <span className="flex items-center gap-1 font-mono text-xs text-amber-400">
                  <TrendingUp className="h-3 w-3" />
                  {k.trend.value}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Middle: Graph + 360 Panel */}
      <div className="flex min-h-0 flex-1 gap-6">
        {/* Graph */}
        <div className="flex flex-1 flex-col rounded-xl border border-white/5 bg-[#0d0d12]/80 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <h2 className="flex items-center gap-2 font-mono text-sm uppercase tracking-widest text-white">
              <Globe className="h-4 w-4 text-amber-400" /> Relationship Graph
            </h2>
            <div className="flex items-center gap-4">
              {(['emerald', 'amber', 'red'] as const).map((c, i) => (
                <span
                  key={c}
                  className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500"
                >
                  <span className={`h-2 w-2 rounded-full bg-${c}-400`} />{' '}
                  {['Healthy', 'At-Risk', 'Churning'][i]}
                </span>
              ))}
            </div>
          </div>
          <div className="relative flex-1 overflow-hidden">
            <svg
              className="h-full w-full"
              viewBox="0 0 720 420"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <filter id="ng">
                  <feGaussianBlur stdDeviation="6" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {/* Edges */}
              {EDGES.map(({ from, to }) => {
                const dim =
                  searchQuery !== '' && (!filteredIds.has(from.id) || !filteredIds.has(to.id));
                return (
                  <g key={`${from.id}-${to.id}`} opacity={dim ? 0.08 : 1}>
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="rgba(255,255,255,0.04)"
                      strokeWidth={2}
                    />
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="rgba(251,191,36,0.25)"
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                      className="data-flow-animation"
                      style={{ animationDuration: '3s' }}
                    />
                  </g>
                );
              })}
              {/* Nodes */}
              {NODES.map((n) => {
                const r = nodeR(n.revenue);
                const sel = selectedCustomer === n.id;
                const dim = searchQuery !== '' && !filteredIds.has(n.id);
                return (
                  <g
                    key={n.id}
                    className="cursor-pointer"
                    onClick={() => {
                      toggle(n.id);
                    }}
                    opacity={dim ? 0.15 : 1}
                  >
                    {sel && (
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={r + 8}
                        fill="none"
                        stroke={STROKE[n.status]}
                        strokeWidth={2}
                        opacity={0.5}
                        className="pulse-ring"
                      />
                    )}
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={r + 3}
                      fill={GLOW[n.status]}
                      filter="url(#ng)"
                      opacity={sel ? 0.6 : 0.3}
                    />
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={r}
                      fill={FILL[n.status]}
                      stroke={STROKE[n.status]}
                      strokeWidth={sel ? 2.5 : 1.5}
                    />
                    <text
                      x={n.x}
                      y={n.y + 1}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="white"
                      fontSize={r > 24 ? 13 : 11}
                      fontFamily="ui-monospace, monospace"
                      fontWeight="bold"
                    >
                      {n.initials}
                    </text>
                    <text
                      x={n.x}
                      y={n.y + r + 14}
                      textAnchor="middle"
                      fill="rgba(148,163,184,0.8)"
                      fontSize={10}
                      fontFamily="ui-monospace, monospace"
                    >
                      {n.name}
                    </text>
                    <text
                      x={n.x}
                      y={n.y + r + 26}
                      textAnchor="middle"
                      fill="rgba(148,163,184,0.4)"
                      fontSize={9}
                      fontFamily="ui-monospace, monospace"
                    >
                      ${Math.round(n.revenue / 1000)}K
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* 360 Panel */}
        <div className="demo-scrollbar w-[380px] overflow-y-auto rounded-xl border border-white/5 bg-[#0d0d12]/80 backdrop-blur-md">
          {selNode && selDetail ? (
            <div className="flex flex-col">
              {/* Header */}
              <div className="border-b border-white/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">{selNode.name}</h3>
                  <button
                    onClick={() => {
                      setSelectedCustomer(null);
                    }}
                    className="text-slate-500 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-400">
                    {selNode.segment}
                  </span>
                  {(() => {
                    const lc = LIFECYCLE_BADGE[selDetail.lifecycleStage];
                    return (
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${lc.bg} ${lc.text}`}
                      >
                        {selDetail.lifecycleStage}
                      </span>
                    );
                  })()}
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <div className="flex flex-col items-center">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      Health
                    </span>
                    <span className={`font-mono text-2xl font-bold text-${hc(selNode.health)}-400`}>
                      {selNode.health}
                    </span>
                  </div>
                  <div className="flex flex-1 items-end gap-1">
                    {selDetail.healthTrend.map((v, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                          height: `${Math.max(8, (v / 100) * 40)}px`,
                          backgroundColor: BAR_C[hc(v)],
                        }}
                        title={`Month ${i + 1}: ${v}`}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[10px] text-slate-600">6mo</span>
                </div>
              </div>
              {/* Interactions */}
              <div className="border-b border-white/5 p-4">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Interactions
                </span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    ['emails', Mail, 'blue', 'emails'] as const,
                    ['calls', Phone, 'emerald', 'calls'] as const,
                    ['tickets', MessageCircle, 'amber', 'tickets'] as const,
                    ['agents', Brain, 'purple', 'agent'] as const,
                  ].map(([key, Icon, col, lbl]) => (
                    <div
                      key={key}
                      className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2"
                    >
                      <Icon className={`h-3.5 w-3.5 text-${col}-400`} />
                      <span className="font-mono text-sm font-bold text-white">
                        {selDetail[key]}
                      </span>
                      <span className="text-[10px] text-slate-500">{lbl}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Recent Activity */}
              <div className="border-b border-white/5 p-4">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Recent Activity
                </span>
                <div className="mt-2 space-y-2">
                  {selDetail.recentActivity.map((a, i) => (
                    <div key={i} className="flex gap-3 rounded-lg bg-white/[0.02] px-3 py-2">
                      <div className="mt-0.5">{ACT_ICONS[a.type]}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-relaxed text-slate-300">{a.description}</p>
                        <span className="font-mono text-[10px] text-slate-600">{a.timestamp}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Churn Risk */}
              <div className="border-b border-white/5 p-4">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Churn Risk
                </span>
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className={`font-mono text-2xl font-bold text-${hc(100 - selDetail.churnRisk)}-400`}
                  >
                    {selDetail.churnRisk}%
                  </span>
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${selDetail.churnRisk}%`,
                          backgroundColor:
                            selDetail.churnRisk >= 60
                              ? SOLID.red
                              : selDetail.churnRisk >= 30
                                ? SOLID.amber
                                : SOLID.emerald,
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {selDetail.churnFactors.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{f.label}</span>
                      <span
                        className={`font-mono text-[11px] ${f.weight > 0 ? 'text-red-400' : 'text-emerald-400'}`}
                      >
                        {f.weight > 0 ? '+' : ''}
                        {f.weight}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Actions */}
              <div className="p-4">
                <div className="flex flex-col gap-2">
                  <button className="flex items-center justify-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/20">
                    <Eye className="h-4 w-4" /> View Full Profile
                  </button>
                  <div className="flex gap-2">
                    <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-400 hover:bg-blue-500/20">
                      <Mail className="h-3.5 w-3.5" /> Send Outreach
                    </button>
                    <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-2 text-xs font-medium text-purple-400 hover:bg-purple-500/20">
                      <Brain className="h-3.5 w-3.5" /> Assign Agent
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-white/[0.03]">
                <Sparkles className="h-8 w-8 text-amber-400/40" />
              </div>
              <p className="text-sm font-medium text-slate-400">Click a customer node to view</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-slate-600">
                360 Intelligence
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Customer Table */}
      <div className="rounded-xl border border-white/5 bg-[#0d0d12]/80 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="flex items-center gap-2 font-mono text-sm uppercase tracking-widest text-white">
            <Activity className="h-4 w-4 text-amber-400" /> Customer Overview
          </h2>
          <span className="font-mono text-[10px] text-slate-600">
            Sorted by health (at-risk first)
          </span>
        </div>
        <div className="demo-scrollbar overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Name', 'Segment', 'Health', 'Revenue', 'Last Contact', 'Status'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-widest text-slate-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TABLE_ROWS.map((row) => {
                const badge = STATUS_BADGE[row.status];
                const color = hc(row.health);
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-white/[0.02] transition-colors hover:bg-white/[0.03]"
                    onClick={() => {
                      toggle(row.id);
                    }}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-white">{row.name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-400">
                        {row.segment}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${row.health}%`, backgroundColor: SOLID[color] }}
                          />
                        </div>
                        <span className={`font-mono text-xs font-bold text-${color}-400`}>
                          {row.health}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-slate-300">{row.revenue}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.lastContact}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${badge.bg} ${badge.text}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
