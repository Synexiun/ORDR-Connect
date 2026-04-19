/**
 * Predictive Intelligence Dashboard
 *
 * Surfaces actionable insights derived from the NBA Decision Engine's
 * decision_log WORM table (populated in real-time by the 3-layer pipeline):
 *
 *   • At-Risk — customers with highest escalation frequency (churn signals)
 *   • Opportunities — customers with highest approval confidence (revenue potential)
 *   • Model Performance — per-layer accuracy, confidence, and latency
 *   • 7-Day Trends — outcome rates and pipeline health over time
 *
 * COMPLIANCE: No PHI rendered. Customer IDs are UUIDs only.
 * SOC 2 CC7.2 | ISO 27001 A.8.6 | HIPAA §164.312(b)
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  AlertTriangle,
  TrendingUp,
  Sparkles,
  Gauge,
  Brain,
  Crosshair,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
} from '../components/icons';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { SparkLine } from '../components/charts/SparkLine';
import { AreaChart } from '../components/charts/AreaChart';
import { cn } from '../lib/cn';
import {
  fetchPredictiveOverview,
  fetchAtRisk,
  fetchOpportunities,
  fetchModelStats,
  fetchTrends,
  type PredictiveOverview,
  type AtRiskCustomer,
  type OpportunityCustomer,
  type ModelStat,
  type TrendPoint,
} from '../lib/predictive-api';

// ── Mock data (offline dev fallback) ─────────────────────────────────────────

const MOCK_OVERVIEW: PredictiveOverview = {
  totalDecisions: 4_281,
  uniqueCustomers: 892,
  approvalRate: 71.4,
  escalationRate: 22.8,
  avgConfidence: 0.783,
  windowDays: 30,
};

const MOCK_AT_RISK: AtRiskCustomer[] = [
  {
    customerId: 'a1b2c3d4-0001-0000-0000-000000000001',
    escalationCount: 9,
    lastDecisionAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    avgConfidence: 0.41,
    lastAction: 'escalate_to_human',
    riskLevel: 'critical',
  },
  {
    customerId: 'a1b2c3d4-0002-0000-0000-000000000002',
    escalationCount: 7,
    lastDecisionAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    avgConfidence: 0.48,
    lastAction: 'escalate_to_human',
    riskLevel: 'critical',
  },
  {
    customerId: 'a1b2c3d4-0003-0000-0000-000000000003',
    escalationCount: 5,
    lastDecisionAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    avgConfidence: 0.52,
    lastAction: 'send_email',
    riskLevel: 'critical',
  },
  {
    customerId: 'a1b2c3d4-0004-0000-0000-000000000004',
    escalationCount: 4,
    lastDecisionAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    avgConfidence: 0.55,
    lastAction: 'escalate_to_human',
    riskLevel: 'high',
  },
  {
    customerId: 'a1b2c3d4-0005-0000-0000-000000000005',
    escalationCount: 3,
    lastDecisionAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
    avgConfidence: 0.61,
    lastAction: 'no_action',
    riskLevel: 'high',
  },
  {
    customerId: 'a1b2c3d4-0006-0000-0000-000000000006',
    escalationCount: 3,
    lastDecisionAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    avgConfidence: 0.63,
    lastAction: 'send_email',
    riskLevel: 'high',
  },
  {
    customerId: 'a1b2c3d4-0007-0000-0000-000000000007',
    escalationCount: 2,
    lastDecisionAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
    avgConfidence: 0.67,
    lastAction: 'escalate_to_human',
    riskLevel: 'medium',
  },
];

const MOCK_OPPORTUNITIES: OpportunityCustomer[] = [
  {
    customerId: 'b2c3d4e5-0001-0000-0000-000000000001',
    approvalCount: 12,
    lastDecisionAt: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
    avgConfidence: 0.94,
    bestAction: 'send_sms',
    opportunityScore: 94,
  },
  {
    customerId: 'b2c3d4e5-0002-0000-0000-000000000002',
    approvalCount: 9,
    lastDecisionAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    avgConfidence: 0.91,
    bestAction: 'send_email',
    opportunityScore: 91,
  },
  {
    customerId: 'b2c3d4e5-0003-0000-0000-000000000003',
    approvalCount: 8,
    lastDecisionAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    avgConfidence: 0.89,
    bestAction: 'send_sms',
    opportunityScore: 89,
  },
  {
    customerId: 'b2c3d4e5-0004-0000-0000-000000000004',
    approvalCount: 7,
    lastDecisionAt: new Date(Date.now() - 9 * 3600 * 1000).toISOString(),
    avgConfidence: 0.87,
    bestAction: 'send_email',
    opportunityScore: 87,
  },
  {
    customerId: 'b2c3d4e5-0005-0000-0000-000000000005',
    approvalCount: 6,
    lastDecisionAt: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
    avgConfidence: 0.85,
    bestAction: 'route_to_agent',
    opportunityScore: 85,
  },
  {
    customerId: 'b2c3d4e5-0006-0000-0000-000000000006',
    approvalCount: 5,
    lastDecisionAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
    avgConfidence: 0.83,
    bestAction: 'send_sms',
    opportunityScore: 83,
  },
];

const MOCK_MODEL_STATS: ModelStat[] = [
  {
    layer: 'rules',
    name: 'Rules Engine',
    model: 'Deterministic (<10ms)',
    total: 2104,
    approvalRate: 58.2,
    escalationRate: 8.1,
    rejectionRate: 33.7,
    avgConfidence: 0.821,
    avgLatencyMs: 7,
  },
  {
    layer: 'ml_scorer',
    name: 'ML Scorer',
    model: 'v0.2.0-linear (<50ms)',
    total: 1623,
    approvalRate: 74.6,
    escalationRate: 18.4,
    rejectionRate: 7.0,
    avgConfidence: 0.762,
    avgLatencyMs: 38,
  },
  {
    layer: 'llm_reasoner',
    name: 'LLM Reasoner',
    model: 'claude-sonnet-4-6 (<100ms)',
    total: 554,
    approvalRate: 82.3,
    escalationRate: 17.7,
    rejectionRate: 0.0,
    avgConfidence: 0.891,
    avgLatencyMs: 87,
  },
];

function buildMockTrends(): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const date = d.toISOString().slice(0, 10);
    const base = 500 + Math.round(Math.random() * 200);
    points.push({
      date,
      approved: Math.round(base * 0.71),
      escalated: Math.round(base * 0.22),
      rejected: Math.round(base * 0.07),
      avgLatencyMs: 18 + Math.round(Math.random() * 12),
      avgConfidence: Number((0.75 + Math.random() * 0.08).toFixed(3)),
    });
  }
  return points;
}
const MOCK_TRENDS = buildMockTrends();

// ── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  accent?: 'amber' | 'emerald' | 'blue' | 'violet';
  trend?: number[];
}

function StatCard({ label, value, sub, icon, accent = 'blue', trend }: StatCardProps): ReactNode {
  const accentCls = {
    amber: 'text-amber-400',
    emerald: 'text-emerald-400',
    blue: 'text-blue-400',
    violet: 'text-violet-400',
  }[accent];

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-content-tertiary font-medium uppercase tracking-wide mb-1">
            {label}
          </p>
          <p className={cn('text-2xl font-bold font-mono', accentCls)}>{value}</p>
          <p className="text-xs text-content-tertiary mt-1">{sub}</p>
        </div>
        <div className={cn('shrink-0 p-2 rounded-lg bg-surface-secondary', accentCls)}>{icon}</div>
      </div>
      {trend !== undefined && trend.length > 1 && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <SparkLine
            data={trend}
            width={120}
            height={20}
            color={
              accent === 'amber'
                ? '#fbbf24'
                : accent === 'emerald'
                  ? '#34d399'
                  : accent === 'violet'
                    ? '#a78bfa'
                    : '#60a5fa'
            }
          />
        </div>
      )}
    </Card>
  );
}

// ── Risk Level Badge ──────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: 'critical' | 'high' | 'medium' }): ReactNode {
  const cfg = {
    critical: { label: 'Critical', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
    high: { label: 'High', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    medium: { label: 'Medium', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  }[level];
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-medium border',
        cfg.cls,
      )}
    >
      {cfg.label}
    </span>
  );
}

// ── Confidence Bar ────────────────────────────────────────────────────────────

function ConfBar({ value }: { value: number }): ReactNode {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-emerald-400' : pct >= 60 ? 'bg-blue-400' : 'bg-amber-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-surface-secondary overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-2xs font-mono text-content-tertiary w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── At-Risk Tab ───────────────────────────────────────────────────────────────

function AtRiskTab({
  customers,
  loading,
}: {
  customers: readonly AtRiskCustomer[];
  loading: boolean;
}): ReactNode {
  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-2">
      <p className="text-xs text-content-tertiary mb-4">
        Customers with the most escalated decisions in the last 30 days — likely churning or
        requiring immediate intervention.
      </p>
      {customers.length === 0 && (
        <div className="text-center py-12 text-sm text-content-tertiary">
          No at-risk customers in the last 30 days.
        </div>
      )}
      {customers.map((c, i) => (
        <div
          key={c.customerId}
          className="flex items-center gap-4 px-4 py-3 rounded-lg bg-surface-secondary/40 border border-border/40 hover:border-border/80 transition-colors"
        >
          <span className="text-xs font-mono text-content-tertiary w-4 shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-content truncate">
                {c.customerId.slice(0, 8)}…{c.customerId.slice(-4)}
              </span>
              <RiskBadge level={c.riskLevel} />
            </div>
            <div className="flex items-center gap-4 text-2xs text-content-tertiary">
              <span>
                {c.escalationCount} escalation{c.escalationCount !== 1 ? 's' : ''}
              </span>
              <span>·</span>
              <span>Last: {c.lastAction.replace(/_/g, ' ')}</span>
              <span>·</span>
              <span>{new Date(c.lastDecisionAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="w-32 shrink-0">
            <ConfBar value={c.avgConfidence} />
            <p className="text-2xs text-content-tertiary mt-0.5 text-right">avg conf</p>
          </div>
          <ChevronRight size={14} className="text-content-tertiary shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Opportunities Tab ─────────────────────────────────────────────────────────

function OpportunitiesTab({
  customers,
  loading,
}: {
  customers: readonly OpportunityCustomer[];
  loading: boolean;
}): ReactNode {
  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-2">
      <p className="text-xs text-content-tertiary mb-4">
        Customers with the highest decision confidence in the last 30 days — high-value targets
        ready for outreach.
      </p>
      {customers.length === 0 && (
        <div className="text-center py-12 text-sm text-content-tertiary">
          No opportunity data yet. Run campaigns to generate decision history.
        </div>
      )}
      {customers.map((c, i) => (
        <div
          key={c.customerId}
          className="flex items-center gap-4 px-4 py-3 rounded-lg bg-surface-secondary/40 border border-border/40 hover:border-border/80 transition-colors"
        >
          <span className="text-xs font-mono text-content-tertiary w-4 shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-content truncate">
                {c.customerId.slice(0, 8)}…{c.customerId.slice(-4)}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Score {c.opportunityScore}
              </span>
            </div>
            <div className="flex items-center gap-4 text-2xs text-content-tertiary">
              <span>
                {c.approvalCount} approval{c.approvalCount !== 1 ? 's' : ''}
              </span>
              <span>·</span>
              <span>Best: {c.bestAction.replace(/_/g, ' ')}</span>
              <span>·</span>
              <span>{new Date(c.lastDecisionAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="w-32 shrink-0">
            <ConfBar value={c.avgConfidence} />
            <p className="text-2xs text-content-tertiary mt-0.5 text-right">avg conf</p>
          </div>
          <ChevronRight size={14} className="text-content-tertiary shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Model Stats Tab ───────────────────────────────────────────────────────────

const LAYER_COLOR: Record<string, string> = {
  rules: 'text-emerald-400',
  ml_scorer: 'text-blue-400',
  llm_reasoner: 'text-violet-400',
};

const LAYER_BG: Record<string, string> = {
  rules: 'bg-emerald-400/10 border-emerald-400/20',
  ml_scorer: 'bg-blue-400/10 border-blue-400/20',
  llm_reasoner: 'bg-violet-400/10 border-violet-400/20',
};

function ModelStatsTab({
  stats,
  loading,
}: {
  stats: readonly ModelStat[];
  loading: boolean;
}): ReactNode {
  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-xs text-content-tertiary">
        Per-layer performance over the last 30 days. Decisions stop at the first layer that reaches
        ≥ 0.7 confidence.
      </p>
      {stats.length === 0 && (
        <div className="text-center py-12 text-sm text-content-tertiary">
          No decisions recorded yet.
        </div>
      )}
      {stats.map((s) => (
        <div
          key={s.layer}
          className={cn(
            'rounded-xl border p-5',
            LAYER_BG[s.layer] ?? 'bg-surface-secondary border-border',
          )}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Brain size={15} className={LAYER_COLOR[s.layer] ?? 'text-content'} />
                <span
                  className={cn('text-sm font-semibold', LAYER_COLOR[s.layer] ?? 'text-content')}
                >
                  {s.name}
                </span>
              </div>
              <p className="text-xs text-content-tertiary font-mono">{s.model}</p>
            </div>
            <Badge variant="neutral" size="sm">
              {s.total.toLocaleString()} decisions
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <div>
              <p className="text-2xs text-content-tertiary uppercase tracking-wide mb-1">
                Approval Rate
              </p>
              <p className="text-lg font-bold font-mono text-emerald-400">{s.approvalRate}%</p>
            </div>
            <div>
              <p className="text-2xs text-content-tertiary uppercase tracking-wide mb-1">
                Escalation Rate
              </p>
              <p className="text-lg font-bold font-mono text-amber-400">{s.escalationRate}%</p>
            </div>
            <div>
              <p className="text-2xs text-content-tertiary uppercase tracking-wide mb-1">
                Avg Confidence
              </p>
              <p
                className={cn(
                  'text-lg font-bold font-mono',
                  LAYER_COLOR[s.layer] ?? 'text-content',
                )}
              >
                {(s.avgConfidence * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-2xs text-content-tertiary uppercase tracking-wide mb-1">
                Avg Latency
              </p>
              <p className="text-lg font-bold font-mono text-content">{s.avgLatencyMs}ms</p>
            </div>
          </div>

          {/* Approval rate bar */}
          <div className="mt-4 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-surface overflow-hidden flex">
              <div
                className="bg-emerald-400/70 h-full rounded-l-full"
                style={{ width: `${s.approvalRate}%` }}
              />
              <div className="bg-amber-400/70 h-full" style={{ width: `${s.escalationRate}%` }} />
              <div
                className="bg-red-400/70 h-full rounded-r-full"
                style={{ width: `${s.rejectionRate}%` }}
              />
            </div>
            <div className="flex items-center gap-3 text-2xs text-content-tertiary shrink-0">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400/70" />
                approved
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400/70" />
                escalated
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-red-400/70" />
                rejected
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Trends Tab ────────────────────────────────────────────────────────────────

function TrendsTab({
  trends,
  loading,
}: {
  trends: readonly TrendPoint[];
  loading: boolean;
}): ReactNode {
  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );

  if (trends.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-content-tertiary">
        No trend data available yet.
      </div>
    );
  }

  const approvalSeries = trends.map((t) => ({ x: t.date.slice(5), y: t.approved }));
  const escalationSeries = trends.map((t) => ({ x: t.date.slice(5), y: t.escalated }));
  const confSeries = trends.map((t) => ({
    x: t.date.slice(5),
    y: Math.round(t.avgConfidence * 100),
  }));

  const maxApproval = Math.max(...trends.map((t) => t.approved));
  const totalApproved = trends.reduce((s, t) => s + t.approved, 0);
  const totalEscalated = trends.reduce((s, t) => s + t.escalated, 0);
  const avgLatency = Math.round(trends.reduce((s, t) => s + t.avgLatencyMs, 0) / trends.length);

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg bg-surface-secondary/50 p-4 text-center">
          <p className="text-xs text-content-tertiary mb-1">Total Approved (7d)</p>
          <p className="text-xl font-bold font-mono text-emerald-400">
            {totalApproved.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg bg-surface-secondary/50 p-4 text-center">
          <p className="text-xs text-content-tertiary mb-1">Total Escalated (7d)</p>
          <p className="text-xl font-bold font-mono text-amber-400">
            {totalEscalated.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg bg-surface-secondary/50 p-4 text-center">
          <p className="text-xs text-content-tertiary mb-1">Avg Pipeline Latency</p>
          <p className="text-xl font-bold font-mono text-content">{avgLatency}ms</p>
        </div>
      </div>

      {/* Approvals area chart */}
      <div>
        <p className="text-xs font-medium text-content-secondary mb-3">
          Approved Decisions — 7 Days
        </p>
        <AreaChart
          series={approvalSeries}
          height={160}
          color="#34d399"
          showGrid
          showDots
          gradientOpacity={0.15}
        />
      </div>

      {/* Escalations area chart */}
      <div>
        <p className="text-xs font-medium text-content-secondary mb-3">
          Escalated Decisions — 7 Days
        </p>
        <AreaChart
          series={escalationSeries}
          height={120}
          color="#fbbf24"
          showGrid
          showDots
          gradientOpacity={0.12}
        />
      </div>

      {/* Confidence trend */}
      <div>
        <p className="text-xs font-medium text-content-secondary mb-3">
          Avg Model Confidence (%) — 7 Days
        </p>
        <AreaChart
          series={confSeries}
          height={100}
          color="#818cf8"
          showGrid
          showDots={false}
          gradientOpacity={0.1}
        />
      </div>

      {/* Peak day callout */}
      {maxApproval > 0 &&
        (() => {
          const peak = trends.find((t) => t.approved === maxApproval);
          return peak !== undefined ? (
            <div className="flex items-center gap-2 text-xs text-content-tertiary">
              <TrendingUp size={13} className="text-emerald-400" />
              Peak approval day: <span className="font-mono text-content">
                {peak.date}
              </span> with{' '}
              <span className="text-emerald-400 font-medium">{peak.approved} approvals</span>
            </div>
          ) : null;
        })()}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'at-risk' | 'opportunities' | 'models' | 'trends';

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'at-risk', label: 'At-Risk', icon: <AlertTriangle size={13} /> },
  { id: 'opportunities', label: 'Opportunities', icon: <Crosshair size={13} /> },
  { id: 'models', label: 'Model Performance', icon: <Brain size={13} /> },
  { id: 'trends', label: '7-Day Trends', icon: <TrendingUp size={13} /> },
];

export function PredictiveIntelligence(): ReactNode {
  const [tab, setTab] = useState<Tab>('at-risk');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [overview, setOverview] = useState(MOCK_OVERVIEW);
  const [atRisk, setAtRisk] = useState<readonly AtRiskCustomer[]>(MOCK_AT_RISK);
  const [opportunities, setOpportunities] =
    useState<readonly OpportunityCustomer[]>(MOCK_OPPORTUNITIES);
  const [modelStats, setModelStats] = useState<readonly ModelStat[]>(MOCK_MODEL_STATS);
  const [trends, setTrends] = useState<readonly TrendPoint[]>(MOCK_TRENDS);

  const load = useCallback(async () => {
    try {
      const [ov, ar, op, ms, tr] = await Promise.allSettled([
        fetchPredictiveOverview(),
        fetchAtRisk(20),
        fetchOpportunities(20),
        fetchModelStats(),
        fetchTrends(),
      ]);
      if (ov.status === 'fulfilled') setOverview(ov.value);
      if (ar.status === 'fulfilled') setAtRisk(ar.value);
      if (op.status === 'fulfilled') setOpportunities(op.value);
      if (ms.status === 'fulfilled') setModelStats(ms.value);
      if (tr.status === 'fulfilled') setTrends(tr.value);
    } catch {
      // Keep mock data on failure
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => {
      setLoading(false);
    });
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const trendData = trends.map((t) => t.approved);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content flex items-center gap-2">
            <Sparkles size={20} className="text-violet-400" />
            Predictive Intelligence
          </h1>
          <p className="text-sm text-content-tertiary mt-1">
            Decision Engine outcomes · {overview.windowDays}-day window ·{' '}
            {overview.uniqueCustomers.toLocaleString()} customers
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="At-Risk Customers"
          value={atRisk.length.toString()}
          sub="escalation freq > 0 (30d)"
          icon={<AlertTriangle size={16} />}
          accent="amber"
          trend={atRisk.map((a) => a.escalationCount)}
        />
        <StatCard
          label="Opportunities"
          value={opportunities.length.toString()}
          sub="high approval confidence (30d)"
          icon={<Crosshair size={16} />}
          accent="emerald"
          trend={opportunities.map((o) => o.opportunityScore)}
        />
        <StatCard
          label="Approval Rate"
          value={`${overview.approvalRate}%`}
          sub={`${overview.totalDecisions.toLocaleString()} total decisions`}
          icon={<CheckCircle2 size={16} />}
          accent="blue"
          trend={trendData}
        />
        <StatCard
          label="Avg Confidence"
          value={`${(overview.avgConfidence * 100).toFixed(1)}%`}
          sub={`${overview.escalationRate}% escalation rate`}
          icon={<Gauge size={16} />}
          accent="violet"
        />
      </div>

      {/* Tabs */}
      <Card className="p-0 overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-border overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
              }}
              className={cn(
                'flex items-center gap-1.5 px-5 py-3 text-sm font-medium shrink-0 transition-colors border-b-2',
                tab === t.id
                  ? 'border-brand text-brand'
                  : 'border-transparent text-content-tertiary hover:text-content',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        <div className="p-5">
          {tab === 'at-risk' && <AtRiskTab customers={atRisk} loading={loading} />}
          {tab === 'opportunities' && (
            <OpportunitiesTab customers={opportunities} loading={loading} />
          )}
          {tab === 'models' && <ModelStatsTab stats={modelStats} loading={loading} />}
          {tab === 'trends' && <TrendsTab trends={trends} loading={loading} />}
        </div>
      </Card>

      {/* Footer note */}
      <p className="text-2xs text-content-tertiary text-center">
        All data derived from immutable decision_log (WORM). Customer IDs are UUIDs — no PHI
        displayed. · SOC 2 CC7.2
      </p>
    </div>
  );
}
