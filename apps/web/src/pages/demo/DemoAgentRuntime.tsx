/**
 * DemoAgentRuntime — Agent Runtime monitoring & orchestration page
 *
 * COMPLIANCE:
 * - No PHI in demo data (Rule 6)
 * - No secrets exposed (Rule 5)
 * - All data is synthetic mock data
 */

import { type ReactNode, useState } from 'react';
import {
  Bot,
  Brain,
  Cpu,
  Power,
  PauseCircle,
  Gauge,
  Target,
  Activity,
  Zap,
  Timer,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
  Terminal,
  Eye,
  Send,
  DollarSign,
  Users,
  ShieldCheck,
  Mail,
  Sparkles,
  Flame,
  Layers,
  ArrowRight,
} from '../../components/icons';

// --- Types ---

type AgentStatus = 'running' | 'idle' | 'paused';
type TimelineOutcome = 'success' | 'failure' | 'pending';

interface AgentPermission {
  tool: string;
  allowed: boolean;
}
interface BudgetMeter {
  label: string;
  used: number;
  limit: number;
  unit: string;
}

interface ReasoningStep {
  id: string;
  prompt: string;
  reasoning: string;
  action: string;
  outcome: string;
  confidence: number;
}

interface AgentCard {
  id: string;
  name: string;
  status: AgentStatus;
  confidence: number;
  actions: number;
  tokensUsed: number;
  lastAction: string;
  iconColor: string;
  bgColor: string;
  permissions: AgentPermission[];
  budgets: BudgetMeter[];
  reasoning: ReasoningStep[];
}

interface TimelineEntry {
  id: string;
  timestamp: string;
  agentName: string;
  agentColor: string;
  description: string;
  confidence: number;
  outcome: TimelineOutcome;
}

// --- Icon map ---

const AGENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  collections: DollarSign,
  support: Users,
  compliance: ShieldCheck,
  communications: Mail,
  analytics: Activity,
  triage: Flame,
};

// --- Helpers ---

const p = (t: string, a: boolean): AgentPermission => ({ tool: t, allowed: a });
const b = (l: string, u: number, lm: number, un: string): BudgetMeter => ({
  label: l,
  used: u,
  limit: lm,
  unit: un,
});
const r = (
  id: string,
  pr: string,
  re: string,
  ac: string,
  ou: string,
  c: number,
): ReasoningStep => ({ id, prompt: pr, reasoning: re, action: ac, outcome: ou, confidence: c });

// --- Mock Data ---

const AGENTS: AgentCard[] = [
  {
    id: 'collections',
    name: 'Collections Agent',
    status: 'running',
    confidence: 0.94,
    actions: 847,
    tokensUsed: 124_800,
    lastAction: '12s ago',
    iconColor: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    permissions: [
      p('read_accounts', true),
      p('send_message', true),
      p('create_payment_plan', true),
      p('access_phi', false),
      p('delete_records', false),
    ],
    budgets: [
      b('Tokens', 124_800, 200_000, 'tok'),
      b('Actions', 847, 1_000, 'act'),
      b('Cost', 18.42, 25.0, '$'),
    ],
    reasoning: [
      r(
        'r1',
        'Account #4821 — 47 days past due, $2,340 balance',
        'Customer has history of late but eventual payment. SMS outreach preferred.',
        'send_sms_reminder',
        'Delivered. Opened within 3 min.',
        0.94,
      ),
      r(
        'r2',
        'Account #3190 — payment plan requested',
        'Balance $890. 3-month plan fits profile. Auto-approve threshold met.',
        'create_payment_plan',
        'Plan created. First payment scheduled.',
        0.97,
      ),
      r(
        'r3',
        'Account #7712 — dispute filed',
        'Dispute requires human review per compliance rule CR-22.',
        'escalate_to_human',
        'Routed to supervisor queue.',
        0.88,
      ),
    ],
  },
  {
    id: 'support',
    name: 'Support Agent',
    status: 'running',
    confidence: 0.89,
    actions: 623,
    tokensUsed: 98_200,
    lastAction: '4s ago',
    iconColor: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
    permissions: [
      p('read_tickets', true),
      p('reply_ticket', true),
      p('escalate', true),
      p('refund', false),
      p('access_phi', false),
    ],
    budgets: [
      b('Tokens', 98_200, 150_000, 'tok'),
      b('Actions', 623, 800, 'act'),
      b('Cost', 14.1, 20.0, '$'),
    ],
    reasoning: [
      r(
        'r1',
        'Ticket #8841 — "Cannot access billing portal"',
        'Common issue. KB article #214 matches. Auto-resolve with link.',
        'reply_with_kb_article',
        'Reply sent. Customer confirmed resolved.',
        0.92,
      ),
      r(
        'r2',
        'Ticket #8843 — "Incorrect charge on invoice"',
        'Financial dispute. Requires human escalation per policy.',
        'escalate_to_billing',
        'Escalated to billing team.',
        0.85,
      ),
      r(
        'r3',
        'Ticket #8845 — "Integration webhook failing"',
        'Technical issue. Webhook returning 503. Suggest retry config.',
        'reply_with_technical_guidance',
        'Reply sent. Awaiting response.',
        0.91,
      ),
    ],
  },
  {
    id: 'compliance',
    name: 'Compliance Agent',
    status: 'running',
    confidence: 0.97,
    actions: 156,
    tokensUsed: 34_600,
    lastAction: '1m ago',
    iconColor: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10',
    permissions: [
      p('scan_communications', true),
      p('flag_violation', true),
      p('block_message', true),
      p('read_audit_log', true),
      p('modify_policy', false),
    ],
    budgets: [
      b('Tokens', 34_600, 100_000, 'tok'),
      b('Actions', 156, 500, 'act'),
      b('Cost', 5.2, 15.0, '$'),
    ],
    reasoning: [
      r(
        'r1',
        'Outbound SMS — "Pay now or face consequences"',
        'Threatening language violates FDCPA. Block and flag.',
        'block_message',
        'Blocked. Violation logged. Agent warned.',
        0.99,
      ),
      r(
        'r2',
        'Email template audit — collections batch #47',
        'All 12 templates pass regulatory checks. No PHI detected.',
        'approve_batch',
        'Batch approved for delivery.',
        0.97,
      ),
      r(
        'r3',
        'Call recording #9021 — post-call analysis',
        'Mini-Miranda delivered. No violations detected.',
        'log_compliant',
        'Marked compliant in audit trail.',
        0.95,
      ),
    ],
  },
  {
    id: 'communications',
    name: 'Communications Agent',
    status: 'running',
    confidence: 0.86,
    actions: 412,
    tokensUsed: 76_400,
    lastAction: '8s ago',
    iconColor: 'text-purple-400',
    bgColor: 'bg-purple-400/10',
    permissions: [
      p('send_email', true),
      p('send_sms', true),
      p('schedule_call', true),
      p('send_bulk', false),
      p('access_phi', false),
    ],
    budgets: [
      b('Tokens', 76_400, 120_000, 'tok'),
      b('Actions', 412, 600, 'act'),
      b('Cost', 11.8, 18.0, '$'),
    ],
    reasoning: [
      r(
        'r1',
        'Customer #2241 — preferred channel: SMS, timezone: PST',
        'Within contact window. SMS template #8 matches context.',
        'send_sms',
        'Delivered. Read receipt confirmed.',
        0.9,
      ),
      r(
        'r2',
        'Customer #3380 — email bounce on last 2 attempts',
        'Email unreliable. Fallback to phone. Schedule IVR.',
        'schedule_ivr_call',
        'Call scheduled for 2:00 PM PST.',
        0.82,
      ),
      r(
        'r3',
        'Batch #51 — 34 customers due for follow-up',
        'Segment by channel preference. 22 SMS, 8 email, 4 phone.',
        'dispatch_batch',
        'All messages queued. 31/34 delivered.',
        0.87,
      ),
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics Agent',
    status: 'idle',
    confidence: 0.92,
    actions: 89,
    tokensUsed: 18_900,
    lastAction: '14m ago',
    iconColor: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
    permissions: [
      p('read_metrics', true),
      p('generate_report', true),
      p('query_clickhouse', true),
      p('write_data', false),
      p('access_phi', false),
    ],
    budgets: [
      b('Tokens', 18_900, 80_000, 'tok'),
      b('Actions', 89, 300, 'act'),
      b('Cost', 2.85, 10.0, '$'),
    ],
    reasoning: [
      r(
        'r1',
        'Daily summary — collections performance 2026-03-25',
        'Recovery rate up 3.2%. SMS channel outperforming email.',
        'generate_daily_report',
        'Report delivered to stakeholders.',
        0.95,
      ),
      r(
        'r2',
        'Anomaly detection — call volume spike at 11:00 AM',
        'Volume 2.4x normal. Correlates with batch #44 dispatch.',
        'log_anomaly_explained',
        'Anomaly marked as expected.',
        0.93,
      ),
      r(
        'r3',
        'Segment analysis — customers 60+ DPD',
        'Cluster shows 3 distinct payment behavior patterns.',
        'update_segment_model',
        'Model updated. 3 segments created.',
        0.88,
      ),
    ],
  },
  {
    id: 'triage',
    name: 'Triage Agent',
    status: 'paused',
    confidence: 0.71,
    actions: 34,
    tokensUsed: 8_200,
    lastAction: '42m ago',
    iconColor: 'text-red-400',
    bgColor: 'bg-red-400/10',
    permissions: [
      p('read_queue', true),
      p('assign_agent', true),
      p('prioritize', true),
      p('override_assignment', false),
      p('access_phi', false),
    ],
    budgets: [
      b('Tokens', 8_200, 50_000, 'tok'),
      b('Actions', 34, 200, 'act'),
      b('Cost', 1.2, 8.0, '$'),
    ],
    reasoning: [
      r(
        'r1',
        'Inbound request — unclear category, mixed signals',
        'Low confidence on classification. Multiple categories match.',
        'request_human_review',
        'Sent to human triage queue.',
        0.68,
      ),
      r(
        'r2',
        'Priority assessment — account #6610, VIP flag',
        'VIP customer with escalation history. Route to senior agent.',
        'assign_senior_agent',
        'Assigned to Agent S-12.',
        0.79,
      ),
      r(
        'r3',
        'Batch triage — 8 new inbound items',
        'Confidence below threshold on 3 items. Pausing for review.',
        'partial_triage_with_pause',
        'Agent paused. 5 routed, 3 pending.',
        0.71,
      ),
    ],
  },
];

const TIMELINE: TimelineEntry[] = [
  {
    id: 't1',
    timestamp: '14:32:18',
    agentName: 'Collections',
    agentColor: 'bg-amber-400/20 text-amber-400',
    description: 'Payment plan created for Account #4821',
    confidence: 0.94,
    outcome: 'success',
  },
  {
    id: 't2',
    timestamp: '14:32:14',
    agentName: 'Compliance',
    agentColor: 'bg-emerald-400/20 text-emerald-400',
    description: 'Blocked non-compliant SMS template',
    confidence: 0.99,
    outcome: 'success',
  },
  {
    id: 't3',
    timestamp: '14:32:06',
    agentName: 'Support',
    agentColor: 'bg-blue-400/20 text-blue-400',
    description: 'Auto-resolved Ticket #8841 with KB article',
    confidence: 0.92,
    outcome: 'success',
  },
  {
    id: 't4',
    timestamp: '14:31:58',
    agentName: 'Communications',
    agentColor: 'bg-purple-400/20 text-purple-400',
    description: 'Dispatched SMS batch #51 — 34 recipients',
    confidence: 0.87,
    outcome: 'success',
  },
  {
    id: 't5',
    timestamp: '14:31:42',
    agentName: 'Triage',
    agentColor: 'bg-red-400/20 text-red-400',
    description: 'Low confidence — escalated to human review',
    confidence: 0.68,
    outcome: 'pending',
  },
  {
    id: 't6',
    timestamp: '14:31:30',
    agentName: 'Analytics',
    agentColor: 'bg-blue-400/20 text-blue-400',
    description: 'Generated daily collections performance report',
    confidence: 0.95,
    outcome: 'success',
  },
  {
    id: 't7',
    timestamp: '14:31:12',
    agentName: 'Collections',
    agentColor: 'bg-amber-400/20 text-amber-400',
    description: 'Escalated dispute for Account #7712',
    confidence: 0.88,
    outcome: 'success',
  },
  {
    id: 't8',
    timestamp: '14:30:55',
    agentName: 'Compliance',
    agentColor: 'bg-emerald-400/20 text-emerald-400',
    description: 'Approved email template batch #47',
    confidence: 0.97,
    outcome: 'success',
  },
];

// --- Helpers ---

function confidenceColor(c: number): string {
  if (c >= 0.9) return 'bg-emerald-500';
  if (c >= 0.7) return 'bg-amber-500';
  return 'bg-red-500';
}

function confidenceText(c: number): string {
  if (c >= 0.9) return 'text-emerald-400';
  if (c >= 0.7) return 'text-amber-400';
  return 'text-red-400';
}

function statusBadge(status: AgentStatus): ReactNode {
  const m: Record<AgentStatus, { bg: string; tx: string; label: string }> = {
    running: { bg: 'bg-emerald-500/20', tx: 'text-emerald-400', label: 'RUNNING' },
    idle: { bg: 'bg-slate-500/20', tx: 'text-slate-400', label: 'IDLE' },
    paused: { bg: 'bg-amber-500/20', tx: 'text-amber-400', label: 'PAUSED' },
  };
  const s = m[status];
  return (
    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${s.bg} ${s.tx}`}>
      {s.label}
    </span>
  );
}

function outcomeBadge(outcome: TimelineOutcome): ReactNode {
  const m: Record<
    TimelineOutcome,
    { icon: React.ComponentType<{ className?: string }>; c: string }
  > = {
    success: { icon: CheckCircle2, c: 'text-emerald-400' },
    failure: { icon: AlertTriangle, c: 'text-red-400' },
    pending: { icon: Clock, c: 'text-amber-400' },
  };
  const o = m[outcome];
  const I = o.icon;
  return <I className={`h-3.5 w-3.5 ${o.c}`} />;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}
function pct(used: number, limit: number): number {
  return Math.min(Math.round((used / limit) * 100), 100);
}
function barColor(p: number): string {
  return p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : 'bg-blue-500';
}

// --- Sub-components ---

function KpiCard({
  icon: I,
  label,
  value,
  subtitle,
  accent,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subtitle?: string;
  accent: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <I className={`h-4 w-4 ${accent}`} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          {label}
        </span>
      </div>
      <div className="mt-2 font-mono text-2xl font-bold text-white">{value}</div>
      {subtitle !== undefined && (
        <p className="mt-0.5 font-mono text-[10px] text-slate-500">{subtitle}</p>
      )}
      {children}
    </div>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-all ${confidenceColor(confidence)}`}
          style={{ width: `${Math.round(confidence * 100)}%` }}
        />
      </div>
      <span className={`font-mono text-[10px] font-bold ${confidenceText(confidence)}`}>
        {confidence.toFixed(2)}
      </span>
    </div>
  );
}

function BudgetBar({ used, limit, label, unit }: BudgetMeter): ReactNode {
  const p_ = pct(used, limit);
  const fmtVal = (v: number) => (unit === '$' ? `$${v.toFixed(2)}` : fmt(v));
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-slate-500">{label}</span>
        <span className="font-mono text-[10px] text-slate-400">
          {fmtVal(used)} / {fmtVal(limit)}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-all ${barColor(p_)}`}
          style={{ width: `${p_}%` }}
        />
      </div>
    </div>
  );
}

// --- Main Component ---

export function DemoAgentRuntime(): ReactNode {
  const [selectedAgent, setSelectedAgent] = useState<AgentCard | null>(null);

  const totalUsed = AGENTS.reduce((s, a) => s + (a.budgets[0]?.used ?? 0), 0);
  const totalLimit = AGENTS.reduce((s, a) => s + (a.budgets[0]?.limit ?? 0), 0);
  const tokenPct = pct(totalUsed, totalLimit);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="font-mono text-2xl font-bold tracking-tight text-white">Agent Runtime</h1>
        <p className="font-mono text-xs text-slate-500">
          Multi-agent orchestration &amp; safety monitoring
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Bot}
          label="Total Agents"
          value="6"
          subtitle="2 idle"
          accent="text-amber-400"
        />
        <KpiCard icon={Target} label="Avg Confidence" value="0.91" accent="text-emerald-400">
          <div className="mt-2">
            <ConfidenceBar confidence={0.91} />
          </div>
        </KpiCard>
        <KpiCard
          icon={Zap}
          label="Actions Today"
          value="1,847"
          subtitle="+312 last hour"
          accent="text-blue-400"
        />
        <KpiCard
          icon={Gauge}
          label="Token Budget"
          value={`${tokenPct}%`}
          subtitle={`${fmt(totalUsed)} / ${fmt(totalLimit)}`}
          accent="text-amber-400"
        >
          <div className="mt-2 h-1.5 rounded-full bg-white/5">
            <div
              className={`h-full rounded-full transition-all ${barColor(tokenPct)}`}
              style={{ width: `${tokenPct}%` }}
            />
          </div>
        </KpiCard>
      </div>

      {/* Agent Cards */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-white" />
          <span className="font-mono text-sm uppercase tracking-widest text-white">
            Active Agents
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {AGENTS.map((agent) => {
            const Icon = AGENT_ICONS[agent.id] ?? Bot;
            const sel = selectedAgent?.id === agent.id;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  setSelectedAgent(agent);
                }}
                className={`rounded-xl border p-4 text-left backdrop-blur-md transition-all ${
                  sel
                    ? 'border-amber-500/30 bg-[#0d0d12]/90 shadow-[0_0_20px_rgba(251,191,36,0.08)]'
                    : 'border-white/5 bg-[#0d0d12]/80 hover:border-white/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${agent.bgColor}`}
                    >
                      <Icon className={`h-4 w-4 ${agent.iconColor}`} />
                    </div>
                    <span className="font-mono text-sm font-semibold text-white">{agent.name}</span>
                  </div>
                  {statusBadge(agent.status)}
                </div>
                <div className="mt-3">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Confidence
                  </span>
                  <div className="mt-1">
                    <ConfidenceBar confidence={agent.confidence} />
                  </div>
                </div>
                {agent.confidence < 0.75 && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1">
                    <AlertTriangle className="h-3 w-3 text-red-400" />
                    <span className="font-mono text-[10px] text-red-400">
                      Below safety threshold (0.7)
                    </span>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      Actions
                    </p>
                    <p className="font-mono text-sm font-bold text-white">{fmt(agent.actions)}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      Tokens
                    </p>
                    <p className="font-mono text-sm font-bold text-white">
                      {agent.tokensUsed >= 1000
                        ? `${(agent.tokensUsed / 1000).toFixed(1)}k`
                        : fmt(agent.tokensUsed)}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      Last
                    </p>
                    <p className="font-mono text-sm text-slate-400">{agent.lastAction}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-400 transition-colors hover:bg-amber-500/20">
                    <PauseCircle className="h-3 w-3" /> Pause
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 font-mono text-[10px] text-red-400 transition-colors hover:bg-red-500/20">
                    <Power className="h-3 w-3" /> Kill
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom: Timeline + Detail */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Timeline */}
        <div className="flex flex-col rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
          <div className="mb-3 flex items-center gap-2">
            <Timer className="h-4 w-4 text-white" />
            <span className="font-mono text-sm uppercase tracking-widest text-white">
              Execution Timeline
            </span>
          </div>
          <div className="demo-scrollbar flex-1 overflow-y-auto">
            <div className="relative ml-3 border-l border-white/10 pl-4">
              {TIMELINE.map((e) => (
                <div key={e.id} className="relative mb-4 last:mb-0">
                  <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0d0d12] bg-white/20" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-slate-600">{e.timestamp}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${e.agentColor}`}
                        >
                          {e.agentName}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[13px] text-slate-300">{e.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`font-mono text-[10px] font-bold ${confidenceText(e.confidence)}`}
                      >
                        {e.confidence.toFixed(2)}
                      </span>
                      {outcomeBadge(e.outcome)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Agent Detail */}
        <div className="flex flex-col rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
          <div className="mb-3 flex items-center gap-2">
            <Eye className="h-4 w-4 text-white" />
            <span className="font-mono text-sm uppercase tracking-widest text-white">
              Agent Detail
            </span>
          </div>
          {selectedAgent === null ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <Brain className="mx-auto h-10 w-10 text-slate-700" />
                <p className="mt-2 font-mono text-sm text-slate-600">
                  Select an agent to view details
                </p>
              </div>
            </div>
          ) : (
            <div className="demo-scrollbar flex-1 space-y-4 overflow-y-auto">
              {(() => {
                const Icon = AGENT_ICONS[selectedAgent.id] ?? Bot;
                return (
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${selectedAgent.bgColor}`}
                    >
                      <Icon className={`h-5 w-5 ${selectedAgent.iconColor}`} />
                    </div>
                    <div>
                      <h3 className="font-mono text-base font-bold text-white">
                        {selectedAgent.name}
                      </h3>
                      <div className="mt-0.5">{statusBadge(selectedAgent.status)}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Permissions */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-slate-500" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Permissions
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAgent.permissions.map((pm) => (
                    <span
                      key={pm.tool}
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${pm.allowed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400 line-through'}`}
                    >
                      {pm.tool}
                    </span>
                  ))}
                </div>
              </div>

              {/* Budget */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-slate-500" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Budget
                  </span>
                </div>
                <div className="space-y-2.5">
                  {selectedAgent.budgets.map((bm) => (
                    <BudgetBar key={bm.label} {...bm} />
                  ))}
                </div>
              </div>

              {/* Reasoning Chain */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5 text-slate-500" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    Reasoning Chain
                  </span>
                </div>
                <div className="space-y-3">
                  {selectedAgent.reasoning.map((step) => (
                    <div
                      key={step.id}
                      className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
                    >
                      <div className="flex items-start gap-1.5">
                        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                        <p className="font-mono text-[11px] text-amber-300">{step.prompt}</p>
                      </div>
                      <div className="ml-4 mt-1.5 flex items-start gap-1.5">
                        <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" />
                        <p className="font-mono text-[11px] text-slate-400">{step.reasoning}</p>
                      </div>
                      <div className="ml-4 mt-1.5 flex items-start gap-1.5">
                        <Send className="mt-0.5 h-3 w-3 shrink-0 text-blue-400" />
                        <p className="font-mono text-[11px] text-blue-300">{step.action}</p>
                      </div>
                      <div className="ml-4 mt-1.5 flex items-center justify-between">
                        <div className="flex items-start gap-1.5">
                          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                          <p className="font-mono text-[11px] text-emerald-300">{step.outcome}</p>
                        </div>
                        <span
                          className={`font-mono text-[10px] font-bold ${confidenceText(step.confidence)}`}
                        >
                          {step.confidence.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Kill Switch */}
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 font-mono text-sm font-bold text-red-400 transition-colors hover:bg-red-500/20"
              >
                <Power className="h-4 w-4" /> Kill Switch — Terminate Agent
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
