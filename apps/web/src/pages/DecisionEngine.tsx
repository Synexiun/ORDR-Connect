/**
 * Decision Engine Dashboard
 *
 * Observability and rule management for the 3-layer AI decision cascade:
 *   Layer 1 — Rules Engine  (<10 ms, deterministic)
 *   Layer 2 — ML Scorer    (<50 ms, calibrated model)
 *   Layer 3 — LLM Reasoner (<100 ms, Claude — only if confidence < 0.7)
 *
 * SECURITY:
 * - Decision records expose customer IDs only — no PHI in reasoning — Rule 6
 * - Rule mutations WORM-logged with actor identity — Rule 3
 * - Low-confidence decisions (<0.7) surface to human review — Rule 9
 * - All data tenant-scoped via JWT — Rule 2
 *
 * SOC 2 CC7.2 | ISO 27001 A.8.6 | HIPAA §164.312(a)(1)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Zap,
  Clock,
  Brain,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Pencil,
  Trash2,
  Plus,
  Filter,
  RefreshCw,
  ArrowUpDown,
  Shield,
  Activity,
} from '../components/icons';
import {
  decisionEngineApi,
  type DecisionRecord,
  type DecisionRule,
  type DecisionEngineStats,
  type LayerStats,
  type DecisionType,
  type DecisionLayer,
  type DecisionOutcome,
  type RuleConditionType,
  type RuleAction,
  type CreateRuleBody,
  type UpdateRuleBody,
} from '../lib/decision-engine-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_STATS: DecisionEngineStats = {
  totalToday: 48_291,
  avgLatencyMs: 23,
  rulesLayerPct: 61,
  mlLayerPct: 28,
  llmLayerPct: 11,
  avgConfidence: 0.87,
  lowConfidenceCount: 134,
};

const MOCK_LAYER_STATS: LayerStats[] = [
  { layer: 'rules', avgLatencyMs: 4, hitCount: 29_457, hitPct: 61, avgConfidence: 0.97 },
  { layer: 'ml_scorer', avgLatencyMs: 31, hitCount: 13_522, hitPct: 28, avgConfidence: 0.83 },
  { layer: 'llm_reasoner', avgLatencyMs: 89, hitCount: 5_312, hitPct: 11, avgConfidence: 0.74 },
];

const MOCK_RECORDS: DecisionRecord[] = [
  {
    id: 'dec-001',
    tenantId: 't1',
    decisionType: 'routing',
    layer: 'rules',
    confidence: 0.99,
    latencyMs: 3,
    outcome: 'approved',
    reasoning: 'Rule #4 matched: channel=sms, intent=payment → route_to_agent(billing-queue)',
    customerId: 'cust-8821',
    ruleId: 'rule-004',
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: 'dec-002',
    tenantId: 't1',
    decisionType: 'escalation',
    layer: 'ml_scorer',
    confidence: 0.82,
    latencyMs: 28,
    outcome: 'escalated',
    reasoning: 'ML: sentiment_score=0.21 (negative), churn_risk=0.78 → escalate to senior agent',
    customerId: 'cust-1143',
    ruleId: null,
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: 'dec-003',
    tenantId: 't1',
    decisionType: 'next_best_action',
    layer: 'llm_reasoner',
    confidence: 0.71,
    latencyMs: 94,
    outcome: 'approved',
    reasoning:
      'LLM: Customer referenced 3 prior failed contacts. Recommended send_follow_up with concession offer.',
    customerId: 'cust-3390',
    ruleId: null,
    createdAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  },
  {
    id: 'dec-004',
    tenantId: 't1',
    decisionType: 'compliance',
    layer: 'rules',
    confidence: 0.99,
    latencyMs: 2,
    outcome: 'rejected',
    reasoning: 'Rule #1 matched: TCPA do-not-call registry hit → reject outbound',
    customerId: 'cust-7712',
    ruleId: 'rule-001',
    createdAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
  },
  {
    id: 'dec-005',
    tenantId: 't1',
    decisionType: 'fraud',
    layer: 'ml_scorer',
    confidence: 0.91,
    latencyMs: 35,
    outcome: 'escalated',
    reasoning: 'ML: transaction_velocity=47/hr (threshold 20), geo_anomaly=true → flag_fraud',
    customerId: 'cust-5521',
    ruleId: null,
    createdAt: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
  },
  {
    id: 'dec-006',
    tenantId: 't1',
    decisionType: 'channel_selection',
    layer: 'rules',
    confidence: 0.99,
    latencyMs: 4,
    outcome: 'approved',
    reasoning: 'Rule #7 matched: channel_pref=email, time_zone=EST 9am → send via email',
    customerId: 'cust-2287',
    ruleId: 'rule-007',
    createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
  },
  {
    id: 'dec-007',
    tenantId: 't1',
    decisionType: 'sentiment',
    layer: 'llm_reasoner',
    confidence: 0.68,
    latencyMs: 102,
    outcome: 'deferred',
    reasoning:
      'LLM: Ambiguous sentiment. Customer message contains conflicting positive/negative signals. Deferred for human review.',
    customerId: 'cust-9934',
    ruleId: null,
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
  {
    id: 'dec-008',
    tenantId: 't1',
    decisionType: 'follow_up',
    layer: 'ml_scorer',
    confidence: 0.79,
    latencyMs: 29,
    outcome: 'approved',
    reasoning: 'ML: days_since_contact=8, engagement_score=0.62 → send_follow_up',
    customerId: 'cust-4410',
    ruleId: null,
    createdAt: new Date(Date.now() - 58 * 60 * 1000).toISOString(),
  },
];

const MOCK_RULES: DecisionRule[] = [
  {
    id: 'rule-001',
    tenantId: 't1',
    name: 'TCPA DNC Block',
    description: 'Block any outbound contact for customers on the TCPA do-not-call registry.',
    conditionType: 'tag_contains',
    conditionValue: 'tcpa_dnc',
    action: 'close',
    decisionType: 'compliance',
    priority: 1,
    enabled: true,
    hitCount: 891,
    createdAt: '2026-01-05T08:00:00Z',
    createdBy: 'admin@synexiun.com',
  },
  {
    id: 'rule-002',
    tenantId: 't1',
    name: 'Critical Sentiment Escalation',
    description: 'Escalate immediately when sentiment score is critically negative.',
    conditionType: 'sentiment_lt',
    conditionValue: '0.2',
    action: 'escalate',
    decisionType: 'escalation',
    priority: 2,
    enabled: true,
    hitCount: 342,
    createdAt: '2026-01-10T09:15:00Z',
    createdBy: 'admin@synexiun.com',
  },
  {
    id: 'rule-003',
    tenantId: 't1',
    name: 'Fraud Velocity Block',
    description: 'Flag accounts with >20 contact attempts per hour as potential fraud.',
    conditionType: 'attempts_gte',
    conditionValue: '20',
    action: 'flag_fraud',
    decisionType: 'fraud',
    priority: 3,
    enabled: true,
    hitCount: 28,
    createdAt: '2026-01-12T11:00:00Z',
    createdBy: 'ops@synexiun.com',
  },
  {
    id: 'rule-004',
    tenantId: 't1',
    name: 'SMS Payment Intent → Billing Queue',
    description: 'Route SMS contacts with payment intent directly to the billing team queue.',
    conditionType: 'intent_equals',
    conditionValue: 'payment',
    action: 'route_to_agent',
    decisionType: 'routing',
    priority: 4,
    enabled: true,
    hitCount: 4_213,
    createdAt: '2026-01-20T10:00:00Z',
    createdBy: 'ops@synexiun.com',
  },
  {
    id: 'rule-005',
    tenantId: 't1',
    name: 'Long Dormant Follow-Up',
    description: 'Send follow-up to contacts with no interaction in >30 days.',
    conditionType: 'age_days_gt',
    conditionValue: '30',
    action: 'send_follow_up',
    decisionType: 'follow_up',
    priority: 5,
    enabled: false,
    hitCount: 1_102,
    createdAt: '2026-02-01T14:30:00Z',
    createdBy: 'admin@synexiun.com',
  },
  {
    id: 'rule-006',
    tenantId: 't1',
    name: 'High-Value Customer Priority',
    description: 'Apply VIP tag to contacts with lifetime value above threshold.',
    conditionType: 'amount_gt',
    conditionValue: '10000',
    action: 'apply_tag',
    decisionType: 'routing',
    priority: 6,
    enabled: true,
    hitCount: 217,
    createdAt: '2026-02-15T09:00:00Z',
    createdBy: 'ops@synexiun.com',
  },
  {
    id: 'rule-007',
    tenantId: 't1',
    name: 'Email Channel Preference',
    description: 'Route to email channel when customer channel preference is set.',
    conditionType: 'channel_equals',
    conditionValue: 'email',
    action: 'route_to_agent',
    decisionType: 'channel_selection',
    priority: 7,
    enabled: true,
    hitCount: 8_441,
    createdAt: '2026-02-20T11:00:00Z',
    createdBy: 'admin@synexiun.com',
  },
];

// ── Config Maps ────────────────────────────────────────────────────────────

const LAYER_CONFIG: Record<
  DecisionLayer,
  { label: string; color: string; badge: string; icon: typeof Zap; maxMs: number }
> = {
  rules: {
    label: 'Rules Engine',
    color: 'text-emerald-400',
    badge: 'bg-emerald-500/15 text-emerald-400',
    icon: Zap,
    maxMs: 10,
  },
  ml_scorer: {
    label: 'ML Scorer',
    color: 'text-blue-400',
    badge: 'bg-blue-500/15 text-blue-400',
    icon: Activity,
    maxMs: 50,
  },
  llm_reasoner: {
    label: 'LLM Reasoner',
    color: 'text-violet-400',
    badge: 'bg-violet-500/15 text-violet-400',
    icon: Brain,
    maxMs: 100,
  },
};

const OUTCOME_BADGE: Record<DecisionOutcome, string> = {
  approved: 'bg-emerald-500/15 text-emerald-400',
  rejected: 'bg-red-500/15 text-danger',
  escalated: 'bg-amber-500/15 text-amber-400',
  deferred: 'bg-slate-500/15 text-content-secondary',
};

const OUTCOME_ICON: Record<DecisionOutcome, typeof CheckCircle2> = {
  approved: CheckCircle2,
  rejected: XCircle,
  escalated: AlertTriangle,
  deferred: Clock,
};

const DECISION_TYPE_LABEL: Record<DecisionType, string> = {
  routing: 'Routing',
  escalation: 'Escalation',
  follow_up: 'Follow-up',
  sentiment: 'Sentiment',
  compliance: 'Compliance',
  fraud: 'Fraud',
  next_best_action: 'Next Best Action',
  channel_selection: 'Channel Selection',
};

const CONDITION_TYPE_LABEL: Record<RuleConditionType, string> = {
  sentiment_lt: 'Sentiment <',
  sentiment_gt: 'Sentiment >',
  intent_equals: 'Intent =',
  entity_contains: 'Entity contains',
  channel_equals: 'Channel =',
  age_days_gt: 'Age (days) >',
  amount_gt: 'Amount ($) >',
  priority_equals: 'Priority =',
  tag_contains: 'Tag contains',
  attempts_gte: 'Attempts ≥',
};

const ACTION_LABEL: Record<RuleAction, string> = {
  route_to_agent: 'Route to Agent',
  escalate: 'Escalate',
  send_follow_up: 'Send Follow-up',
  flag_compliance: 'Flag: Compliance',
  flag_fraud: 'Flag: Fraud',
  close: 'Close',
  defer: 'Defer',
  apply_tag: 'Apply Tag',
};

const CONDITION_TYPE_OPTIONS: RuleConditionType[] = [
  'sentiment_lt',
  'sentiment_gt',
  'intent_equals',
  'entity_contains',
  'channel_equals',
  'age_days_gt',
  'amount_gt',
  'priority_equals',
  'tag_contains',
  'attempts_gte',
];

const ACTION_OPTIONS: RuleAction[] = [
  'route_to_agent',
  'escalate',
  'send_follow_up',
  'flag_compliance',
  'flag_fraud',
  'close',
  'defer',
  'apply_tag',
];

const DECISION_TYPE_OPTIONS: DecisionType[] = [
  'routing',
  'escalation',
  'follow_up',
  'sentiment',
  'compliance',
  'fraud',
  'next_best_action',
  'channel_selection',
];

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtConfidence(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function fmtLatency(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

// ── Stat Card ──────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Zap;
  accent?: string;
}

function StatCard({ label, value, sub, icon: Icon, accent = 'text-brand-400' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex items-start gap-3">
      <div className={cn('mt-0.5 shrink-0', accent)}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-content-tertiary mb-0.5">{label}</p>
        <p className="text-xl font-semibold text-content leading-none">{value}</p>
        {sub !== undefined && <p className="text-xs text-content-secondary mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ── Pipeline Diagram ───────────────────────────────────────────────────────

function PipelineDiagram({ layerStats }: { layerStats: LayerStats[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-content mb-4">Decision Pipeline</h2>
      <div className="flex items-center gap-2">
        {layerStats.map((ls, i) => {
          const cfg = LAYER_CONFIG[ls.layer];
          const Icon = cfg.icon;
          return (
            <div key={ls.layer} className="flex items-center gap-2 flex-1">
              <div className="flex-1 rounded-xl border border-border bg-surface-secondary p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={16} className={cfg.color} />
                  <span className="text-sm font-medium text-content">{cfg.label}</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-content-tertiary">Hit rate</span>
                    <span className={cn('font-semibold', cfg.color)}>{ls.hitPct}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-surface-tertiary overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', {
                        'bg-emerald-500': ls.layer === 'rules',
                        'bg-blue-500': ls.layer === 'ml_scorer',
                        'bg-violet-500': ls.layer === 'llm_reasoner',
                      })}
                      style={{ width: `${ls.hitPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs pt-1">
                    <span className="text-content-tertiary">Avg latency</span>
                    <span className="text-content-secondary font-medium">
                      {fmtLatency(ls.avgLatencyMs)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-content-tertiary">Avg confidence</span>
                    <span className="text-content-secondary font-medium">
                      {fmtConfidence(ls.avgConfidence)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-content-tertiary">Decisions</span>
                    <span className="text-content-secondary font-medium">
                      {fmtNumber(ls.hitCount)}
                    </span>
                  </div>
                </div>
              </div>
              {i < layerStats.length - 1 && (
                <ChevronRight size={16} className="text-content-tertiary shrink-0" />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-content-tertiary mt-3">
        Each decision cascades to the next layer only when confidence &lt; 0.70. LLM Reasoner is the
        final fallback — decisions below 0.70 here surface to human review.
      </p>
    </div>
  );
}

// ── Decision Log Tab ───────────────────────────────────────────────────────

interface DecisionLogTabProps {
  records: DecisionRecord[];
}

function DecisionLogTab({ records }: DecisionLogTabProps) {
  const [typeFilter, setTypeFilter] = useState<DecisionType | ''>('');
  const [layerFilter, setLayerFilter] = useState<DecisionLayer | ''>('');
  const [outcomeFilter, setOutcomeFilter] = useState<DecisionOutcome | ''>('');
  const [selected, setSelected] = useState<DecisionRecord | null>(null);

  const filtered = records.filter(
    (r) =>
      (typeFilter === '' || r.decisionType === typeFilter) &&
      (layerFilter === '' || r.layer === layerFilter) &&
      (outcomeFilter === '' || r.outcome === outcomeFilter),
  );

  return (
    <div className="flex gap-4 min-h-0">
      <div className="flex-1 min-w-0 space-y-3">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <Filter size={14} className="text-content-tertiary" />
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as DecisionType | '');
            }}
            className="rounded-lg border border-border bg-surface-secondary text-content text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All Types</option>
            {DECISION_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {DECISION_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <select
            value={layerFilter}
            onChange={(e) => {
              setLayerFilter(e.target.value as DecisionLayer | '');
            }}
            className="rounded-lg border border-border bg-surface-secondary text-content text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All Layers</option>
            {(Object.keys(LAYER_CONFIG) as DecisionLayer[]).map((l) => (
              <option key={l} value={l}>
                {LAYER_CONFIG[l].label}
              </option>
            ))}
          </select>
          <select
            value={outcomeFilter}
            onChange={(e) => {
              setOutcomeFilter(e.target.value as DecisionOutcome | '');
            }}
            className="rounded-lg border border-border bg-surface-secondary text-content text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All Outcomes</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="escalated">Escalated</option>
            <option value="deferred">Deferred</option>
          </select>
          <span className="ml-auto text-xs text-content-tertiary">{filtered.length} records</span>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-secondary">
                <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">
                  Customer
                </th>
                <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Type</th>
                <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Layer</th>
                <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">
                  Confidence
                </th>
                <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Outcome</th>
                <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Latency</th>
                <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const layerCfg = LAYER_CONFIG[r.layer];
                const OutcomeIcon = OUTCOME_ICON[r.outcome];
                const isLowConf = r.confidence < 0.7;
                return (
                  <tr
                    key={r.id}
                    onClick={() => {
                      setSelected(r === selected ? null : r);
                    }}
                    className={cn(
                      'border-b border-border cursor-pointer transition-colors last:border-0',
                      r === selected ? 'bg-brand-500/8' : 'hover:bg-surface-secondary',
                    )}
                  >
                    <td className="px-3 py-2.5 font-mono text-content-secondary">{r.customerId}</td>
                    <td className="px-3 py-2.5 text-content">
                      {DECISION_TYPE_LABEL[r.decisionType]}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-medium',
                          layerCfg.badge,
                        )}
                      >
                        {layerCfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          'font-semibold',
                          isLowConf ? 'text-amber-400' : 'text-content',
                        )}
                      >
                        {fmtConfidence(r.confidence)}
                      </span>
                      {isLowConf && (
                        <span className="ml-1 text-amber-400 text-[10px]">⚠ review</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                          OUTCOME_BADGE[r.outcome],
                        )}
                      >
                        <OutcomeIcon size={10} />
                        {r.outcome}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-content-secondary">
                      {fmtLatency(r.latencyMs)}
                    </td>
                    <td className="px-3 py-2.5 text-content-tertiary">
                      {relativeTime(r.createdAt)}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-content-tertiary">
                    No records match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail panel */}
      {selected !== null && (
        <div className="w-72 shrink-0 rounded-xl border border-border bg-surface p-4 space-y-4 self-start">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-content">Decision Detail</h3>
            <button
              onClick={() => {
                setSelected(null);
              }}
              className="text-content-tertiary hover:text-content transition-colors"
            >
              <XCircle size={16} />
            </button>
          </div>
          <div className="space-y-2.5 text-xs">
            <Row label="ID" value={selected.id} mono />
            <Row label="Customer" value={selected.customerId} mono />
            <Row label="Type" value={DECISION_TYPE_LABEL[selected.decisionType]} />
            <Row label="Layer" value={LAYER_CONFIG[selected.layer].label} />
            <Row label="Outcome" value={selected.outcome} />
            <Row label="Confidence" value={fmtConfidence(selected.confidence)} />
            <Row label="Latency" value={fmtLatency(selected.latencyMs)} />
            {selected.ruleId !== null && <Row label="Rule ID" value={selected.ruleId} mono />}
            <Row label="Timestamp" value={new Date(selected.createdAt).toLocaleString()} />
          </div>
          <div>
            <p className="text-xs text-content-tertiary mb-1.5">Reasoning</p>
            <p className="text-xs text-content bg-surface-secondary rounded-lg p-2.5 leading-relaxed">
              {selected.reasoning}
            </p>
          </div>
          {selected.confidence < 0.7 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
              <p className="text-xs text-amber-400 font-medium">Human Review Required</p>
              <p className="text-xs text-amber-400/70 mt-0.5">
                Confidence below 0.70 threshold — this decision was surfaced to the review queue.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-content-tertiary shrink-0">{label}</span>
      <span className={cn('text-content text-right break-all', mono && 'font-mono text-[10px]')}>
        {value}
      </span>
    </div>
  );
}

// ── Rule Modal ─────────────────────────────────────────────────────────────

interface RuleModalProps {
  rule: DecisionRule | null;
  onClose: () => void;
  onSave: (body: CreateRuleBody | UpdateRuleBody) => Promise<void>;
}

function RuleModal({ rule, onClose, onSave }: RuleModalProps) {
  const isEdit = rule !== null;
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [conditionType, setConditionType] = useState<RuleConditionType>(
    rule?.conditionType ?? 'sentiment_lt',
  );
  const [conditionValue, setConditionValue] = useState(rule?.conditionValue ?? '');
  const [action, setAction] = useState<RuleAction>(rule?.action ?? 'route_to_agent');
  const [decisionType, setDecisionType] = useState<DecisionType>(rule?.decisionType ?? 'routing');
  const [priority, setPriority] = useState(rule?.priority ?? 10);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    if (name.trim().length < 2) {
      setErr('Name must be at least 2 characters.');
      return;
    }
    if (conditionValue.trim() === '') {
      setErr('Condition value is required.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        conditionType,
        conditionValue: conditionValue.trim(),
        action,
        decisionType,
        priority,
      });
      onClose();
    } catch {
      setErr('Failed to save rule. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <h2 className="text-sm font-semibold text-content">
            {isEdit ? 'Edit Rule' : 'Create Rule'}
          </h2>
          <button
            onClick={onClose}
            className="text-content-tertiary hover:text-content transition-colors"
          >
            <XCircle size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Rule Name</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="e.g. TCPA DNC Block"
              className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-content-tertiary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              rows={2}
              className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-content-tertiary resize-none"
            />
          </div>

          {/* Decision type + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-content-secondary mb-1.5">Decision Type</label>
              <select
                value={decisionType}
                onChange={(e) => {
                  setDecisionType(e.target.value as DecisionType);
                }}
                className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {DECISION_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {DECISION_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-content-secondary mb-1.5">
                Priority (lower = first)
              </label>
              <input
                type="number"
                min={1}
                max={999}
                value={priority}
                onChange={(e) => {
                  setPriority(Number(e.target.value));
                }}
                className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Condition */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Condition</label>
            <div className="flex gap-2">
              <select
                value={conditionType}
                onChange={(e) => {
                  setConditionType(e.target.value as RuleConditionType);
                }}
                className="flex-1 rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {CONDITION_TYPE_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_TYPE_LABEL[c]}
                  </option>
                ))}
              </select>
              <input
                value={conditionValue}
                onChange={(e) => {
                  setConditionValue(e.target.value);
                }}
                placeholder="value"
                className="w-28 rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-content-tertiary"
              />
            </div>
          </div>

          {/* Action */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Action</label>
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value as RuleAction);
              }}
              className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
          </div>

          {err !== '' && (
            <p className="text-xs text-danger flex items-center gap-1.5">
              <AlertTriangle size={12} /> {err}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 pt-3 pb-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-content-secondary hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Spinner size="xs" />}
            {isEdit ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Rule Modal ──────────────────────────────────────────────────────

function DeleteRuleModal({
  rule,
  onClose,
  onConfirm,
}: {
  rule: DecisionRule;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handle() {
    setDeleting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full p-2 bg-red-500/15">
            <Trash2 size={16} className="text-danger" />
          </div>
          <h2 className="text-sm font-semibold text-content">Delete Rule</h2>
        </div>
        <p className="text-sm text-content-secondary">
          Delete <span className="font-medium text-content">"{rule.name}"</span>? This action is
          WORM-logged and cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-content-secondary hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handle}
            disabled={deleting}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {deleting && <Spinner size="xs" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rules Tab ──────────────────────────────────────────────────────────────

interface RulesTabProps {
  rules: DecisionRule[];
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onEdit: (rule: DecisionRule) => void;
  onDelete: (rule: DecisionRule) => void;
  onCreate: () => void;
}

function RulesTab({ rules, onToggle, onEdit, onDelete, onCreate }: RulesTabProps) {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-content-tertiary">
          {rules.filter((r) => r.enabled).length} of {rules.length} rules active — evaluated in
          priority order (lowest first, first-match-wins)
        </p>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors"
        >
          <Plus size={13} />
          New Rule
        </button>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-secondary">
              <th className="text-left px-3 py-2.5 text-content-tertiary font-medium w-10">
                <ArrowUpDown size={12} />
              </th>
              <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Name</th>
              <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Type</th>
              <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Condition</th>
              <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Action</th>
              <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Hits</th>
              <th className="text-left px-3 py-2.5 text-content-tertiary font-medium">Status</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((rule) => (
              <tr
                key={rule.id}
                className={cn(
                  'border-b border-border last:border-0 transition-colors',
                  rule.enabled ? '' : 'opacity-50',
                )}
              >
                <td className="px-3 py-2.5 text-content-tertiary font-mono">{rule.priority}</td>
                <td className="px-3 py-2.5">
                  <p className="font-medium text-content">{rule.name}</p>
                  <p className="text-content-tertiary mt-0.5 leading-relaxed">{rule.description}</p>
                </td>
                <td className="px-3 py-2.5 text-content-secondary">
                  {DECISION_TYPE_LABEL[rule.decisionType]}
                </td>
                <td className="px-3 py-2.5 font-mono text-content-secondary">
                  {CONDITION_TYPE_LABEL[rule.conditionType]}{' '}
                  <span className="text-content">{rule.conditionValue}</span>
                </td>
                <td className="px-3 py-2.5 text-content-secondary">{ACTION_LABEL[rule.action]}</td>
                <td className="px-3 py-2.5 text-content-secondary">{fmtNumber(rule.hitCount)}</td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => {
                      void onToggle(rule.id, !rule.enabled);
                    }}
                    className={cn(
                      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                      rule.enabled ? 'bg-brand-600' : 'bg-surface-tertiary',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm',
                        rule.enabled ? 'translate-x-4' : 'translate-x-0.5',
                      )}
                    />
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      onClick={() => {
                        onEdit(rule);
                      }}
                      className="p-1.5 rounded hover:bg-surface-secondary text-content-tertiary hover:text-content transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => {
                        onDelete(rule);
                      }}
                      className="p-1.5 rounded hover:bg-red-500/10 text-content-tertiary hover:text-danger transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-content-tertiary">
                  No rules defined. Create a rule to start the decision cascade.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function DecisionEngine() {
  const [stats, setStats] = useState<DecisionEngineStats | null>(null);
  const [layerStats, setLayerStats] = useState<LayerStats[]>([]);
  const [records, setRecords] = useState<DecisionRecord[]>([]);
  const [rules, setRules] = useState<DecisionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'log' | 'rules'>('log');
  const [ruleModal, setRuleModal] = useState<{ open: boolean; rule: DecisionRule | null }>({
    open: false,
    rule: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<DecisionRule | null>(null);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    try {
      const [s, ls, rec, rul] = await Promise.all([
        decisionEngineApi.getStats(),
        decisionEngineApi.getLayerStats(),
        decisionEngineApi.listRecords({ limit: 50 }),
        decisionEngineApi.listRules(),
      ]);
      if (seq !== loadRef.current) return;
      setStats(s);
      setLayerStats(ls);
      setRecords(rec);
      setRules(rul);
    } catch {
      if (seq !== loadRef.current) return;
      setStats(MOCK_STATS);
      setLayerStats(MOCK_LAYER_STATS);
      setRecords(MOCK_RECORDS);
      setRules(MOCK_RULES);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggleRule(id: string, enabled: boolean) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
    try {
      await decisionEngineApi.updateRule(id, { enabled });
    } catch {
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !enabled } : r)));
    }
  }

  async function handleSaveRule(body: CreateRuleBody | UpdateRuleBody) {
    if (ruleModal.rule !== null) {
      const updated = await decisionEngineApi.updateRule(ruleModal.rule.id, body as UpdateRuleBody);
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } else {
      const created = await decisionEngineApi.createRule(body as CreateRuleBody);
      setRules((prev) => [...prev, created]);
    }
  }

  async function handleDeleteRule() {
    if (deleteTarget === null) return;
    await decisionEngineApi.deleteRule(deleteTarget.id);
    setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
  }

  const TABS = [
    { id: 'log' as const, label: 'Decision Log' },
    { id: 'rules' as const, label: `Rules (${rules.length})` },
  ];

  return (
    <div className="h-full flex flex-col bg-surface-secondary">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border bg-surface">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-content">Decision Engine</h1>
            <p className="text-xs text-content-tertiary mt-0.5">
              3-layer AI cascade — Rules → ML Scorer → LLM Reasoner
            </p>
          </div>
          <button
            onClick={() => {
              void load();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-content-secondary hover:bg-surface-secondary border border-border transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {loading && stats === null ? (
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Decisions Today"
              value={fmtNumber(stats?.totalToday ?? 0)}
              sub={`${fmtLatency(stats?.avgLatencyMs ?? 0)} avg latency`}
              icon={Zap}
              accent="text-brand-400"
            />
            <StatCard
              label="Rules Layer"
              value={`${stats?.rulesLayerPct ?? 0}%`}
              sub="deterministic, <10ms"
              icon={Shield}
              accent="text-emerald-400"
            />
            <StatCard
              label="LLM Layer"
              value={`${stats?.llmLayerPct ?? 0}%`}
              sub="fallback, <100ms"
              icon={Brain}
              accent="text-violet-400"
            />
            <StatCard
              label="Low Confidence"
              value={fmtNumber(stats?.lowConfidenceCount ?? 0)}
              sub="surfaced for human review"
              icon={AlertTriangle}
              accent="text-amber-400"
            />
          </div>

          {/* Pipeline Diagram */}
          <PipelineDiagram layerStats={layerStats} />

          {/* Tabs */}
          <div className="space-y-4">
            <div className="flex gap-1 border-b border-border">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                  }}
                  className={cn(
                    'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                    tab === t.id
                      ? 'border-brand-500 text-brand-400'
                      : 'border-transparent text-content-secondary hover:text-content',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'log' && <DecisionLogTab records={records} />}
            {tab === 'rules' && (
              <RulesTab
                rules={rules}
                onToggle={handleToggleRule}
                onEdit={(r) => {
                  setRuleModal({ open: true, rule: r });
                }}
                onDelete={setDeleteTarget}
                onCreate={() => {
                  setRuleModal({ open: true, rule: null });
                }}
              />
            )}
          </div>
        </div>
      )}

      {ruleModal.open && (
        <RuleModal
          rule={ruleModal.rule}
          onClose={() => {
            setRuleModal({ open: false, rule: null });
          }}
          onSave={handleSaveRule}
        />
      )}

      {deleteTarget !== null && (
        <DeleteRuleModal
          rule={deleteTarget}
          onClose={() => {
            setDeleteTarget(null);
          }}
          onConfirm={handleDeleteRule}
        />
      )}
    </div>
  );
}
