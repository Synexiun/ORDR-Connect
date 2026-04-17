/**
 * Escalation Rules
 *
 * Condition-based rule engine that auto-routes, notifies, and acts on
 * tickets matching defined criteria. Rules are priority-ordered
 * (first-match-wins) and individually togglable.
 *
 * SECURITY:
 * - Rule mutations WORM-logged with actor identity — Rule 3
 * - Auto-respond actions pass through compliance rules engine — Rule 9
 * - Agent assignment scoped to tenant pool server-side — Rule 2
 * - PHI must not appear in condition values or action config — Rule 6
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.25 | HIPAA §164.312(a)(1)
 */

import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronUp,
  ChevronDown,
  ToggleRight,
  Zap,
  AlertTriangle,
} from '../components/icons';
import {
  escalationApi,
  type EscalationRule,
  type EscalationStats,
  type TriggerEvent,
  type ConditionField,
  type ActionType,
} from '../lib/escalation-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_RULES: EscalationRule[] = [
  {
    id: 'rule-001',
    name: 'SLA Breach — Immediate Escalation',
    description: 'Fire the moment an SLA is breached; assign to tier-2 queue and notify manager.',
    enabled: true,
    priority: 1,
    conditionLogic: 'all',
    conditions: [
      { id: 'c1', field: 'sla_breach', operator: 'is_true', value: 'true' },
      { id: 'c2', field: 'ticket_priority', operator: 'not_equals', value: 'low' },
    ],
    actions: [
      { id: 'a1', type: 'assign_queue', config: { queue: 'tier-2-support' } },
      { id: 'a2', type: 'notify_manager', config: { channel: 'slack' } },
      { id: 'a3', type: 'set_priority', config: { priority: 'urgent' } },
    ],
    triggeredToday: 12,
    triggeredTotal: 1_892,
    lastTriggeredAt: '2026-04-17T04:12:00Z',
    createdAt: '2025-11-01T10:00:00Z',
    createdBy: 'ops-team',
  },
  {
    id: 'rule-002',
    name: 'Negative Sentiment — Senior Agent',
    description: 'Route tickets with strongly negative sentiment to a senior agent.',
    enabled: true,
    priority: 2,
    conditionLogic: 'all',
    conditions: [{ id: 'c3', field: 'sentiment_score', operator: 'less_than', value: '-0.6' }],
    actions: [
      { id: 'a4', type: 'assign_queue', config: { queue: 'senior-agents' } },
      { id: 'a5', type: 'add_tag', config: { tag: 'negative-sentiment' } },
    ],
    triggeredToday: 8,
    triggeredTotal: 934,
    lastTriggeredAt: '2026-04-17T03:45:00Z',
    createdAt: '2025-12-01T09:00:00Z',
    createdBy: 'cx-team',
  },
  {
    id: 'rule-003',
    name: 'Enterprise Tier — Priority Handling',
    description: 'Ensure enterprise customers always receive expedited handling.',
    enabled: true,
    priority: 3,
    conditionLogic: 'all',
    conditions: [
      { id: 'c4', field: 'customer_tier', operator: 'equals', value: 'enterprise' },
      { id: 'c5', field: 'ticket_age_hours', operator: 'greater_than', value: '2' },
    ],
    actions: [
      { id: 'a6', type: 'set_priority', config: { priority: 'high' } },
      { id: 'a7', type: 'notify_agent', config: { message: 'Enterprise customer waiting >2h' } },
      { id: 'a8', type: 'create_task', config: { task: 'Follow up with enterprise customer' } },
    ],
    triggeredToday: 4,
    triggeredTotal: 412,
    lastTriggeredAt: '2026-04-17T05:30:00Z',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'cx-team',
  },
  {
    id: 'rule-004',
    name: 'Unresponsive — Auto Follow-up',
    description: 'Send automated follow-up when no agent has responded within 4 hours.',
    enabled: true,
    priority: 4,
    conditionLogic: 'all',
    conditions: [
      { id: 'c6', field: 'unresponsive_hours', operator: 'greater_than', value: '4' },
      { id: 'c7', field: 'ticket_priority', operator: 'not_equals', value: 'low' },
    ],
    actions: [
      { id: 'a9', type: 'auto_respond', config: { template: 'follow-up-delay' } },
      { id: 'a10', type: 'notify_agent', config: { message: 'Ticket awaiting response >4h' } },
    ],
    triggeredToday: 23,
    triggeredTotal: 3_241,
    lastTriggeredAt: '2026-04-17T06:01:00Z',
    createdAt: '2026-02-01T11:00:00Z',
    createdBy: 'ops-team',
  },
  {
    id: 'rule-005',
    name: 'Low CSAT — Immediate Review',
    description: 'Flag resolved tickets with CSAT below 3 for quality review.',
    enabled: true,
    priority: 5,
    conditionLogic: 'all',
    conditions: [{ id: 'c8', field: 'csat_score', operator: 'less_than', value: '3' }],
    actions: [
      { id: 'a11', type: 'add_tag', config: { tag: 'low-csat-review' } },
      { id: 'a12', type: 'create_task', config: { task: 'QA review — low CSAT ticket' } },
    ],
    triggeredToday: 3,
    triggeredTotal: 287,
    lastTriggeredAt: '2026-04-17T02:18:00Z',
    createdAt: '2026-02-15T09:00:00Z',
    createdBy: 'qa-team',
  },
  {
    id: 'rule-006',
    name: 'Critical Channel — Webhook Alert',
    description: 'Trigger webhook for tickets arriving via the critical escalation channel.',
    enabled: false,
    priority: 6,
    conditionLogic: 'all',
    conditions: [{ id: 'c9', field: 'channel', operator: 'equals', value: 'critical-hotline' }],
    actions: [
      { id: 'a13', type: 'webhook', config: { url: 'https://ops.internal/escalation-hook' } },
      { id: 'a14', type: 'set_priority', config: { priority: 'urgent' } },
    ],
    triggeredToday: 0,
    triggeredTotal: 14,
    lastTriggeredAt: '2026-04-10T11:00:00Z',
    createdAt: '2026-03-01T10:00:00Z',
    createdBy: 'ops-team',
  },
];

const MOCK_STATS: EscalationStats = {
  activeRules: 5,
  triggeredToday: 50,
  escalationsCreated: 48,
  avgResolutionHrs: 3.2,
};

const MOCK_HISTORY: TriggerEvent[] = [
  {
    id: 'evt-001',
    ruleId: 'rule-004',
    ruleName: 'Unresponsive — Auto Follow-up',
    ticketId: 'TKT-00892',
    triggeredAt: '2026-04-17T06:01:12Z',
    actionsExecuted: ['auto_respond', 'notify_agent'],
    outcome: 'success',
  },
  {
    id: 'evt-002',
    ruleId: 'rule-003',
    ruleName: 'Enterprise Tier — Priority Handling',
    ticketId: 'TKT-00891',
    triggeredAt: '2026-04-17T05:30:44Z',
    actionsExecuted: ['set_priority', 'notify_agent', 'create_task'],
    outcome: 'success',
  },
  {
    id: 'evt-003',
    ruleId: 'rule-001',
    ruleName: 'SLA Breach — Immediate Escalation',
    ticketId: 'TKT-00889',
    triggeredAt: '2026-04-17T04:12:07Z',
    actionsExecuted: ['assign_queue', 'notify_manager', 'set_priority'],
    outcome: 'success',
  },
  {
    id: 'evt-004',
    ruleId: 'rule-002',
    ruleName: 'Negative Sentiment — Senior Agent',
    ticketId: 'TKT-00887',
    triggeredAt: '2026-04-17T03:45:33Z',
    actionsExecuted: ['assign_queue', 'add_tag'],
    outcome: 'success',
  },
  {
    id: 'evt-005',
    ruleId: 'rule-004',
    ruleName: 'Unresponsive — Auto Follow-up',
    ticketId: 'TKT-00884',
    triggeredAt: '2026-04-17T03:00:02Z',
    actionsExecuted: ['auto_respond'],
    outcome: 'partial',
  },
  {
    id: 'evt-006',
    ruleId: 'rule-001',
    ruleName: 'SLA Breach — Immediate Escalation',
    ticketId: 'TKT-00881',
    triggeredAt: '2026-04-17T02:30:18Z',
    actionsExecuted: ['assign_queue', 'notify_manager', 'set_priority'],
    outcome: 'success',
  },
  {
    id: 'evt-007',
    ruleId: 'rule-005',
    ruleName: 'Low CSAT — Immediate Review',
    ticketId: 'TKT-00879',
    triggeredAt: '2026-04-17T02:18:55Z',
    actionsExecuted: ['add_tag', 'create_task'],
    outcome: 'success',
  },
  {
    id: 'evt-008',
    ruleId: 'rule-004',
    ruleName: 'Unresponsive — Auto Follow-up',
    ticketId: 'TKT-00876',
    triggeredAt: '2026-04-17T01:45:00Z',
    actionsExecuted: [],
    outcome: 'failed',
  },
];

// ── Config ─────────────────────────────────────────────────────────────────

const FIELD_LABEL: Record<ConditionField, string> = {
  sla_breach: 'SLA Breached',
  sla_minutes_remaining: 'SLA Minutes Remaining',
  ticket_age_hours: 'Ticket Age (hours)',
  sentiment_score: 'Sentiment Score',
  customer_tier: 'Customer Tier',
  ticket_priority: 'Ticket Priority',
  channel: 'Channel',
  unresponsive_hours: 'Unresponsive (hours)',
  csat_score: 'CSAT Score',
  tag: 'Has Tag',
};

const ACTION_LABEL: Record<ActionType, string> = {
  assign_queue: 'Assign Queue',
  assign_agent: 'Assign Agent',
  set_priority: 'Set Priority',
  notify_agent: 'Notify Agent',
  notify_manager: 'Notify Manager',
  auto_respond: 'Auto Respond',
  add_tag: 'Add Tag',
  create_task: 'Create Task',
  webhook: 'Webhook',
};

const ACTION_COLOR: Record<ActionType, string> = {
  assign_queue: 'bg-blue-500/10 text-blue-400',
  assign_agent: 'bg-blue-500/10 text-blue-400',
  set_priority: 'bg-red-500/10 text-red-400',
  notify_agent: 'bg-amber-500/10 text-amber-400',
  notify_manager: 'bg-orange-500/10 text-orange-400',
  auto_respond: 'bg-emerald-500/10 text-emerald-400',
  add_tag: 'bg-purple-500/10 text-purple-400',
  create_task: 'bg-cyan-500/10 text-cyan-400',
  webhook: 'bg-surface-secondary text-content-secondary',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Rules Tab ──────────────────────────────────────────────────────────────

function RulesTab({
  rules,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  rules: EscalationRule[];
  onToggle: (id: string, enabled: boolean) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}): ReactNode {
  const [expanded, setExpanded] = useState(new Set<string>());

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-2">
      {rules.map((rule, idx) => {
        const isExpanded = expanded.has(rule.id);
        const isFirst = idx === 0;
        const isLast = idx === rules.length - 1;

        return (
          <div
            key={rule.id}
            className={cn(
              'rounded-xl border bg-surface transition-colors',
              rule.enabled ? 'border-border' : 'border-border opacity-60',
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Priority badge */}
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-xs font-bold text-content-tertiary">
                {rule.priority}
              </span>

              {/* Title */}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-content">{rule.name}</p>
                <p className="text-xs text-content-tertiary">{rule.description}</p>
              </div>

              {/* Stats */}
              <div className="hidden items-center gap-4 text-xs text-content-tertiary sm:flex">
                <span>
                  <span className="font-medium text-content">{rule.triggeredToday}</span> today
                </span>
                <span>
                  <span className="font-medium text-content">
                    {rule.triggeredTotal.toLocaleString()}
                  </span>{' '}
                  total
                </span>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    onMoveUp(rule.id);
                  }}
                  disabled={isFirst}
                  className="rounded p-1 text-content-tertiary hover:bg-surface-secondary hover:text-content disabled:opacity-30"
                  title="Move up (increase priority)"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    onMoveDown(rule.id);
                  }}
                  disabled={isLast}
                  className="rounded p-1 text-content-tertiary hover:bg-surface-secondary hover:text-content disabled:opacity-30"
                  title="Move down (decrease priority)"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    onToggle(rule.id, !rule.enabled);
                  }}
                  className={cn(
                    'relative ml-1 inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    rule.enabled ? 'bg-brand-accent' : 'bg-surface-tertiary',
                  )}
                  title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                >
                  <span
                    className={cn(
                      'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                      rule.enabled ? 'translate-x-4.5' : 'translate-x-0.5',
                    )}
                  />
                </button>
                <button
                  onClick={() => {
                    toggle(rule.id);
                  }}
                  className="ml-1 rounded p-1 text-content-tertiary hover:bg-surface-secondary hover:text-content"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Expanded Detail */}
            {isExpanded && (
              <div className="border-t border-border px-4 pb-4 pt-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Conditions */}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                      Conditions (
                      {rule.conditionLogic === 'all' ? 'ALL must match' : 'ANY must match'})
                    </p>
                    <div className="space-y-1.5">
                      {rule.conditions.map((cond) => (
                        <div
                          key={cond.id}
                          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs"
                        >
                          <span className="font-medium text-content-secondary">
                            {FIELD_LABEL[cond.field]}
                          </span>
                          <span className="text-content-tertiary">
                            {cond.operator.replace('_', ' ')}
                          </span>
                          {cond.operator !== 'is_true' && (
                            <code className="rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-brand-accent">
                              {cond.value}
                            </code>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                      Actions (execute in order)
                    </p>
                    <div className="space-y-1.5">
                      {rule.actions.map((action, i) => (
                        <div
                          key={action.id}
                          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs"
                        >
                          <span className="shrink-0 text-content-tertiary">{i + 1}.</span>
                          <span
                            className={cn(
                              'shrink-0 rounded px-1.5 py-0.5 font-medium',
                              ACTION_COLOR[action.type],
                            )}
                          >
                            {ACTION_LABEL[action.type]}
                          </span>
                          {Object.entries(action.config).map(([k, v]) => (
                            <span key={k} className="truncate text-content-tertiary">
                              {v}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-4 text-xs text-content-tertiary">
                  <span>
                    Created by {rule.createdBy} on {formatDate(rule.createdAt)}
                  </span>
                  {rule.lastTriggeredAt !== null && (
                    <span>Last triggered {formatTime(rule.lastTriggeredAt)}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── History Tab ────────────────────────────────────────────────────────────

function HistoryTab({ events }: { events: TriggerEvent[] }): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Rule</th>
              <th className="px-4 py-3">Ticket</th>
              <th className="px-4 py-3">Actions Executed</th>
              <th className="px-4 py-3">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((evt) => (
              <tr key={evt.id} className="hover:bg-surface-secondary/50">
                <td className="px-4 py-3 font-mono text-xs text-content-secondary">
                  {formatTime(evt.triggeredAt)}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-content">{evt.ruleName}</p>
                  <p className="text-2xs text-content-tertiary">{evt.ruleId}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-content-secondary">
                  {evt.ticketId}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {evt.actionsExecuted.length > 0 ? (
                      evt.actionsExecuted.map((a) => (
                        <span
                          key={a}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-2xs font-medium',
                            ACTION_COLOR[a],
                          )}
                        >
                          {ACTION_LABEL[a]}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-content-tertiary">none</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {evt.outcome === 'success' ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Success
                    </span>
                  ) : evt.outcome === 'partial' ? (
                    <span className="flex items-center gap-1 text-xs text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> Partial
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-red-400">
                      <XCircle className="h-3.5 w-3.5" /> Failed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  bg: string;
}): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className={cn('mb-3 inline-flex rounded-lg p-2', bg)}>{icon}</div>
      <p className="text-2xl font-bold text-content">{value}</p>
      <p className="mt-0.5 text-xs text-content-tertiary">{label}</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

type Tab = 'rules' | 'history';

export function EscalationRules(): ReactNode {
  const [tab, setTab] = useState<Tab>('rules');
  const [stats, setStats] = useState<EscalationStats | null>(null);
  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [history, setHistory] = useState<TriggerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    try {
      const [s, r, h] = await Promise.all([
        escalationApi.getStats(),
        escalationApi.listRules(),
        escalationApi.listTriggerHistory(),
      ]);
      if (seq !== loadRef.current) return;
      setStats(s);
      setRules(r);
      setHistory(h);
    } catch {
      if (seq !== loadRef.current) return;
      setStats(MOCK_STATS);
      setRules(MOCK_RULES);
      setHistory(MOCK_HISTORY);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    setRules((prev) => prev.map((r): EscalationRule => (r.id === id ? { ...r, enabled } : r)));
    try {
      const updated = await escalationApi.toggleRule(id, { enabled });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch {
      // optimistic update stands
    }
  }, []);

  const handleMoveUp = useCallback(
    async (id: string) => {
      setRules((prev) => {
        const idx = prev.findIndex((r) => r.id === id);
        if (idx <= 0) return prev;
        const next = [...prev];
        const a = next[idx - 1];
        const b = next[idx];
        if (a === undefined || b === undefined) return prev;
        next[idx - 1] = { ...b, priority: b.priority - 1 };
        next[idx] = { ...a, priority: a.priority + 1 };
        return next;
      });
      try {
        const ordered = rules
          .map((r, i) => ({ ...r, newIdx: r.id === id ? i - 1 : i }))
          .sort((a, b) => a.newIdx - b.newIdx)
          .map((r) => r.id);
        await escalationApi.reorderRules({ orderedIds: ordered });
      } catch {
        // optimistic update stands
      }
    },
    [rules],
  );

  const handleMoveDown = useCallback(
    async (id: string) => {
      setRules((prev) => {
        const idx = prev.findIndex((r) => r.id === id);
        if (idx < 0 || idx >= prev.length - 1) return prev;
        const next = [...prev];
        const a = next[idx];
        const b = next[idx + 1];
        if (a === undefined || b === undefined) return prev;
        next[idx] = { ...b, priority: b.priority - 1 };
        next[idx + 1] = { ...a, priority: a.priority + 1 };
        return next;
      });
      try {
        const ordered = rules
          .map((r, i) => ({ ...r, newIdx: r.id === id ? i + 1 : i }))
          .sort((a, b) => a.newIdx - b.newIdx)
          .map((r) => r.id);
        await escalationApi.reorderRules({ orderedIds: ordered });
      } catch {
        // optimistic update stands
      }
    },
    [rules],
  );

  const TABS: { id: Tab; label: string }[] = [
    { id: 'rules', label: 'Rules' },
    { id: 'history', label: 'Trigger History' },
  ];

  const activeRules = rules.filter((r) => r.enabled).length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading escalation rules" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-content">Escalation Rules</h1>
        <p className="mt-1 text-sm text-content-tertiary">
          Condition-based routing · First-match-wins priority · {activeRules} of {rules.length}{' '}
          rules active
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<ToggleRight className="h-5 w-5 text-blue-400" />}
          label="Active Rules"
          value={String(stats?.activeRules ?? 0)}
          bg="bg-blue-500/10"
        />
        <StatCard
          icon={<Zap className="h-5 w-5 text-amber-400" />}
          label="Triggered Today"
          value={String(stats?.triggeredToday ?? 0)}
          bg="bg-amber-500/10"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
          label="Escalations Created"
          value={String(stats?.escalationsCreated ?? 0)}
          bg="bg-emerald-500/10"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-purple-400" />}
          label="Avg Resolution"
          value={`${stats !== null ? stats.avgResolutionHrs.toFixed(1) : '—'} hrs`}
          bg="bg-purple-500/10"
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
              }}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-b-2 border-brand-accent text-brand-accent'
                  : 'text-content-tertiary hover:text-content',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'rules' && (
        <>
          <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Rules execute in priority order — the first matching rule wins. Drag (or use arrows) to
            reorder.
          </div>
          <RulesTab
            rules={rules}
            onToggle={(id, enabled) => {
              void handleToggle(id, enabled);
            }}
            onMoveUp={(id) => {
              void handleMoveUp(id);
            }}
            onMoveDown={(id) => {
              void handleMoveDown(id);
            }}
          />
        </>
      )}
      {tab === 'history' && <HistoryTab events={history} />}
    </div>
  );
}
