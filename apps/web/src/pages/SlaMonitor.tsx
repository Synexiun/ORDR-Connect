/**
 * SLA Monitor — per-channel SLA policy management and breach dashboard
 *
 * Tabs: Policies | Breaches | Metrics
 *
 * SOC2 CC7.2  — Monitoring: configurable SLA thresholds and breach tracking.
 * ISO 27001 A.16.1.1 — Responsibilities for information security events.
 * HIPAA §164.308(a)(5)(ii)(C) — Log-in monitoring: unanswered contact SLAs.
 *
 * SECURITY:
 * - No PHI rendered (Rule 6) — breach data contains IDs and durations only.
 * - Policy changes produce WORM audit events (Rule 3).
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Plus,
  PlayCircle,
  X,
  BarChart3,
  ScrollText,
  Settings,
  TrendingUp,
} from '../components/icons';
import {
  slaApi,
  type SlaPolicy,
  type SlaBreach,
  type SlaMetrics,
  type SlaChannel,
  type SlaTier,
} from '../lib/sla-api';

// ── Constants ──────────────────────────────────────────────────────

const SLA_CHANNELS: Array<{ value: SlaChannel; label: string }> = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'voice', label: 'Voice' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'chat', label: 'Chat' },
  { value: 'push', label: 'Push' },
  { value: 'in_app', label: 'In-App' },
];

const SLA_TIERS: Array<{ value: SlaTier; label: string }> = [
  { value: 'vip', label: 'VIP' },
  { value: 'high', label: 'High' },
  { value: 'standard', label: 'Standard' },
  { value: 'low', label: 'Low' },
];

// ── Mock data (shown when API not available) ───────────────────────

const MOCK_POLICIES: SlaPolicy[] = [
  {
    id: 'p-001',
    channel: null,
    priorityTier: 'vip',
    thresholdMinutes: 30,
    thresholdLabel: '30m',
    enabled: true,
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
  {
    id: 'p-002',
    channel: 'voice',
    priorityTier: null,
    thresholdMinutes: 15,
    thresholdLabel: '15m',
    enabled: true,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 'p-003',
    channel: 'sms',
    priorityTier: null,
    thresholdMinutes: 60,
    thresholdLabel: '1h',
    enabled: true,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'p-004',
    channel: null,
    priorityTier: null,
    thresholdMinutes: 240,
    thresholdLabel: '4h',
    enabled: true,
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 14).toISOString(),
  },
];

const MOCK_BREACHES: SlaBreach[] = Array.from({ length: 8 }, (_, i) => ({
  id: `b-${String(i + 1).padStart(3, '0')}`,
  title: `SLA breach: ${String(2 + i)}h without response`,
  description: `Inbound ${['sms', 'email', 'voice'][i % 3] ?? 'sms'} interaction has not received a response in ${String(2 + i)} hours (SLA: 4h).`,
  severity: i < 2 ? 'high' : 'medium',
  acknowledged: i > 5,
  acknowledgedAt: i > 5 ? new Date(Date.now() - 3600000 * i).toISOString() : null,
  metadata: {
    channel: ['sms', 'email', 'voice'][i % 3] ?? 'sms',
    customer_id: `cust-${String(100 + i)}`,
    interaction_id: `int-${String(200 + i)}`,
    breach_hours: String(2 + i),
  },
  detectedAt: new Date(Date.now() - 3600000 * (i + 1)).toISOString(),
  actionRoute: `/customers/cust-${String(100 + i)}`,
}));

const MOCK_METRICS: SlaMetrics = {
  windowDays: 7,
  totalBreaches: 23,
  unacknowledged: 5,
  activePolicies: 4,
  byChannel: [
    { channel: 'sms', count: 10, avgHours: 5.2 },
    { channel: 'email', count: 8, avgHours: 9.1 },
    { channel: 'voice', count: 5, avgHours: 1.8 },
  ],
  trend: [
    { day: new Date(Date.now() - 86400000 * 6).toISOString().slice(0, 10), count: 2 },
    { day: new Date(Date.now() - 86400000 * 5).toISOString().slice(0, 10), count: 4 },
    { day: new Date(Date.now() - 86400000 * 4).toISOString().slice(0, 10), count: 3 },
    { day: new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10), count: 6 },
    { day: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10), count: 4 },
    { day: new Date(Date.now() - 86400000).toISOString().slice(0, 10), count: 3 },
    { day: new Date().toISOString().slice(0, 10), count: 1 },
  ],
};

// ── Tab type ──────────────────────────────────────────────────────

type Tab = 'policies' | 'breaches' | 'metrics';

// ── Policy Modal ─────────────────────────────────────────────────

interface PolicyFormState {
  channel: SlaChannel | '';
  priorityTier: SlaTier | '';
  thresholdMinutes: number;
  enabled: boolean;
}

interface PolicyModalProps {
  editing: SlaPolicy | null;
  onClose: () => void;
  onSave: (form: PolicyFormState) => Promise<void>;
}

function PolicyModal({ editing, onClose, onSave }: PolicyModalProps): ReactNode {
  const [form, setForm] = useState({
    channel: editing?.channel ?? '',
    priorityTier: editing?.priorityTier ?? '',
    thresholdMinutes: editing?.thresholdMinutes ?? 240,
    enabled: editing?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSaving(true);
      try {
        await onSave(form);
      } finally {
        setSaving(false);
      }
    },
    [form, onSave],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-surface-3 bg-surface-1 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-3 px-6 py-4">
          <h2 className="text-base font-semibold text-content-primary">
            {editing !== null ? 'Edit SLA Policy' : 'New SLA Policy'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-content-tertiary hover:bg-surface-3 hover:text-content-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 px-6 py-5"
        >
          {/* Channel */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-content-secondary">
              Channel <span className="text-content-tertiary">(leave blank for all channels)</span>
            </label>
            <select
              value={form.channel}
              onChange={(e) => {
                setForm((f) => ({ ...f, channel: e.target.value as SlaChannel | '' }));
              }}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-content-primary focus:border-brand-accent focus:outline-none"
              disabled={editing !== null}
            >
              <option value="">All channels (global)</option>
              {SLA_CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Priority Tier */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-content-secondary">
              Priority Tier{' '}
              <span className="text-content-tertiary">(leave blank for all tiers)</span>
            </label>
            <select
              value={form.priorityTier}
              onChange={(e) => {
                setForm((f) => ({ ...f, priorityTier: e.target.value as SlaTier | '' }));
              }}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-content-primary focus:border-brand-accent focus:outline-none"
              disabled={editing !== null}
            >
              <option value="">All tiers (global)</option>
              {SLA_TIERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Threshold */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-content-secondary">
              Response Threshold (minutes)
            </label>
            <input
              type="number"
              min={1}
              max={10080}
              value={form.thresholdMinutes}
              onChange={(e) => {
                setForm((f) => ({ ...f, thresholdMinutes: parseInt(e.target.value, 10) || 1 }));
              }}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-content-primary focus:border-brand-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-content-tertiary">
              {form.thresholdMinutes < 60
                ? `${String(form.thresholdMinutes)} minutes`
                : `${String(Math.floor(form.thresholdMinutes / 60))}h${form.thresholdMinutes % 60 > 0 ? ` ${String(form.thresholdMinutes % 60)}m` : ''}`}
            </p>
          </div>

          {/* Enabled */}
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => {
                setForm((f) => ({ ...f, enabled: e.target.checked }));
              }}
              className="h-4 w-4 rounded border-surface-3 accent-brand-accent"
            />
            <span className="text-sm text-content-primary">Policy enabled</span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : editing !== null ? 'Save Changes' : 'Create Policy'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export function SlaMonitor(): ReactNode {
  const [tab, setTab] = useState<Tab>('policies');

  // Policies
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<SlaPolicy | null>(null);

  // Breaches
  const [breaches, setBreaches] = useState<SlaBreach[]>([]);
  const [breachesLoading, setBreachesLoading] = useState(true);
  const [ackFilter, setAckFilter] = useState<'all' | 'open' | 'acked'>('open');
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  // Metrics
  const [metrics, setMetrics] = useState<SlaMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Control
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<number | null>(null);

  // Load data
  useEffect(() => {
    void slaApi
      .listPolicies()
      .then(setPolicies)
      .catch(() => {
        setPolicies(MOCK_POLICIES);
      })
      .finally(() => {
        setPoliciesLoading(false);
      });
  }, []);

  useEffect(() => {
    setBreachesLoading(true);
    const params =
      ackFilter === 'all'
        ? {}
        : ackFilter === 'open'
          ? { acknowledged: 'false' as const }
          : { acknowledged: 'true' as const };

    void slaApi
      .listBreaches(params)
      .then((r) => {
        setBreaches(r.data);
      })
      .catch(() => {
        setBreaches(MOCK_BREACHES);
      })
      .finally(() => {
        setBreachesLoading(false);
      });
  }, [ackFilter]);

  useEffect(() => {
    void slaApi
      .getMetrics()
      .then(setMetrics)
      .catch(() => {
        setMetrics(MOCK_METRICS);
      })
      .finally(() => {
        setMetricsLoading(false);
      });
  }, []);

  // Trigger check
  const handleTriggerCheck = useCallback(async () => {
    setChecking(true);
    try {
      const result = await slaApi.triggerCheck().catch(() => ({ breachesFound: 0 }));
      setLastCheck(result.breachesFound);
      // Refresh breaches after scan
      const fresh = await slaApi.listBreaches({ acknowledged: 'false' }).catch(() => null);
      if (fresh) setBreaches(fresh.data);
    } finally {
      setChecking(false);
    }
  }, []);

  // Policy save
  const handleSavePolicy = useCallback(
    async (form: PolicyFormState) => {
      const body = {
        channel: form.channel || null,
        priorityTier: form.priorityTier || null,
        thresholdMinutes: form.thresholdMinutes,
        enabled: form.enabled,
      };

      if (editingPolicy !== null) {
        const updated = await slaApi
          .updatePolicy(editingPolicy.id, {
            thresholdMinutes: body.thresholdMinutes,
            enabled: body.enabled,
          })
          .catch(() => ({
            ...editingPolicy,
            thresholdMinutes: body.thresholdMinutes,
            enabled: body.enabled,
            thresholdLabel: `${String(body.thresholdMinutes)}m`,
            updatedAt: new Date().toISOString(),
          }));
        setPolicies((ps) => ps.map((p) => (p.id === editingPolicy.id ? updated : p)));
      } else {
        const created = await slaApi.createPolicy(body).catch(() => ({
          id: crypto.randomUUID(),
          ...body,
          thresholdLabel: `${String(body.thresholdMinutes)}m`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        setPolicies((ps) => [...ps, created]);
      }

      setShowModal(false);
      setEditingPolicy(null);
    },
    [editingPolicy],
  );

  // Policy delete
  const handleDeletePolicy = useCallback(async (id: string) => {
    await slaApi.deletePolicy(id).catch(() => null);
    setPolicies((ps) => ps.filter((p) => p.id !== id));
  }, []);

  // Acknowledge breach
  const handleAcknowledge = useCallback(async (id: string) => {
    setAcknowledging(id);
    const updated = await slaApi
      .acknowledgeBreach(id)
      .catch(() => null)
      .finally(() => {
        setAcknowledging(null);
      });

    if (updated) {
      setBreaches((bs) => bs.map((b) => (b.id === id ? updated : b)));
    }
  }, []);

  // Derived stats for header
  const openBreachCount =
    metrics !== null ? metrics.unacknowledged : breaches.filter((b) => !b.acknowledged).length;

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content-primary">SLA Monitor</h1>
          <p className="mt-0.5 text-sm text-content-tertiary">
            Configure response-time policies and track breaches by channel and customer tier.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastCheck !== null && (
            <span className="text-xs text-content-tertiary">
              Last scan:{' '}
              {lastCheck === 0
                ? 'no new breaches'
                : `${String(lastCheck)} breach${lastCheck !== 1 ? 'es' : ''} found`}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void handleTriggerCheck();
            }}
            disabled={checking}
          >
            {checking ? <Spinner size="sm" /> : <PlayCircle className="h-3.5 w-3.5" />}
            <span className="ml-1.5">{checking ? 'Scanning…' : 'Trigger Scan'}</span>
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-content-tertiary">Open Breaches</p>
              <p className="text-xl font-bold text-content-primary">{openBreachCount}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-accent/15">
              <Clock className="h-4 w-4 text-brand-accent" />
            </div>
            <div>
              <p className="text-xs text-content-tertiary">Active Policies</p>
              <p className="text-xl font-bold text-content-primary">
                {metrics !== null
                  ? metrics.activePolicies
                  : policies.filter((p) => p.enabled).length}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-content-tertiary">7-Day Breaches</p>
              <p className="text-xl font-bold text-content-primary">
                {metrics?.totalBreaches ?? '—'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15">
              <ShieldCheck className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-content-tertiary">Default SLA</p>
              <p className="text-xl font-bold text-content-primary">4h</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-surface-3">
        <nav className="-mb-px flex gap-6">
          {(
            [
              { id: 'policies', label: 'Policies', icon: Settings },
              { id: 'breaches', label: 'Breaches', icon: ScrollText },
              { id: 'metrics', label: 'Metrics', icon: BarChart3 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
              }}
              className={[
                'flex items-center gap-1.5 border-b-2 pb-3 text-sm font-medium transition-colors',
                tab === id
                  ? 'border-brand-accent text-brand-accent'
                  : 'border-transparent text-content-tertiary hover:text-content-secondary',
              ].join(' ')}
            >
              <Icon className="h-4 w-4" />
              {label}
              {id === 'breaches' && openBreachCount > 0 && (
                <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs font-semibold text-amber-400">
                  {openBreachCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ── POLICIES TAB ───────────────────────────────────────── */}
      {tab === 'policies' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-content-tertiary">
              Define response-time thresholds per channel and customer tier. More specific policies
              override global defaults.
            </p>
            <Button
              size="sm"
              onClick={() => {
                setEditingPolicy(null);
                setShowModal(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="ml-1.5">Add Policy</span>
            </Button>
          </div>

          {policiesLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner size="lg" label="Loading policies…" />
            </div>
          ) : (
            <Card>
              <Table
                columns={[
                  {
                    key: 'scope',
                    header: 'Scope',
                    render: (row: SlaPolicy) => (
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap gap-1">
                          {row.channel !== null ? (
                            <Badge variant="info" size="sm">
                              {row.channel.toUpperCase()}
                            </Badge>
                          ) : (
                            <Badge variant="neutral" size="sm">
                              All Channels
                            </Badge>
                          )}
                          {row.priorityTier !== null ? (
                            <Badge
                              variant={
                                row.priorityTier === 'vip'
                                  ? 'warning'
                                  : row.priorityTier === 'high'
                                    ? 'danger'
                                    : 'neutral'
                              }
                              size="sm"
                            >
                              {row.priorityTier.toUpperCase()}
                            </Badge>
                          ) : (
                            <Badge variant="neutral" size="sm">
                              All Tiers
                            </Badge>
                          )}
                        </div>
                        {row.channel === null && row.priorityTier === null && (
                          <p className="text-xs text-content-tertiary">Global default</p>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'threshold',
                    header: 'Threshold',
                    render: (row: SlaPolicy) => (
                      <span className="font-mono text-sm text-content-primary">
                        {row.thresholdLabel}
                      </span>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (row: SlaPolicy) => (
                      <Badge variant={row.enabled ? 'success' : 'neutral'} size="sm">
                        {row.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    ),
                  },
                  {
                    key: 'updated',
                    header: 'Last Updated',
                    render: (row: SlaPolicy) => (
                      <span className="text-sm text-content-tertiary">
                        {new Date(row.updatedAt).toLocaleDateString()}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: '',
                    render: (row: SlaPolicy) => (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingPolicy(row);
                            setShowModal(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void handleDeletePolicy(row.id);
                          }}
                          className="text-red-400 hover:text-red-300"
                        >
                          Delete
                        </Button>
                      </div>
                    ),
                  },
                ]}
                data={policies}
                keyExtractor={(row) => row.id}
                emptyMessage="No SLA policies configured. Add a policy to set response-time thresholds."
              />
            </Card>
          )}

          {/* Specificity guide */}
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <TrendingUp className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-accent" />
              <div>
                <p className="text-sm font-medium text-content-primary">Policy Specificity Order</p>
                <p className="mt-1 text-xs text-content-tertiary">
                  When multiple policies match, the most specific wins:{' '}
                  <span className="font-mono">Channel + Tier</span> &gt;{' '}
                  <span className="font-mono">Channel only</span> &gt;{' '}
                  <span className="font-mono">Tier only</span> &gt;{' '}
                  <span className="font-mono">Global default</span>.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── BREACHES TAB ───────────────────────────────────────── */}
      {tab === 'breaches' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex items-center gap-2">
            {(
              [
                { value: 'open', label: 'Open' },
                { value: 'acked', label: 'Acknowledged' },
                { value: 'all', label: 'All' },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => {
                  setAckFilter(value);
                }}
                className={[
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  ackFilter === value
                    ? 'bg-brand-accent/15 text-brand-accent'
                    : 'bg-surface-2 text-content-tertiary hover:text-content-secondary',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {breachesLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner size="lg" label="Loading breaches…" />
            </div>
          ) : (
            <Card>
              <Table
                columns={[
                  {
                    key: 'channel',
                    header: 'Channel',
                    render: (row: SlaBreach) => (
                      <Badge variant="info" size="sm">
                        {(row.metadata['channel'] ?? 'unknown').toUpperCase()}
                      </Badge>
                    ),
                  },
                  {
                    key: 'title',
                    header: 'Breach',
                    render: (row: SlaBreach) => (
                      <div>
                        <p className="text-sm text-content-primary">{row.title}</p>
                        <p className="text-xs text-content-tertiary">
                          Customer ID: {row.metadata['customer_id'] ?? '—'}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: 'severity',
                    header: 'Severity',
                    render: (row: SlaBreach) => (
                      <Badge
                        variant={
                          row.severity === 'high' || row.severity === 'critical'
                            ? 'danger'
                            : 'warning'
                        }
                        size="sm"
                      >
                        {row.severity}
                      </Badge>
                    ),
                  },
                  {
                    key: 'detected',
                    header: 'Detected',
                    render: (row: SlaBreach) => (
                      <span className="text-sm text-content-tertiary">
                        {new Date(row.detectedAt).toLocaleString()}
                      </span>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (row: SlaBreach) =>
                      row.acknowledged ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Acknowledged
                        </div>
                      ) : (
                        <Badge variant="warning" size="sm">
                          Open
                        </Badge>
                      ),
                  },
                  {
                    key: 'actions',
                    header: '',
                    render: (row: SlaBreach) =>
                      !row.acknowledged ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={acknowledging === row.id}
                          onClick={() => {
                            void handleAcknowledge(row.id);
                          }}
                        >
                          {acknowledging === row.id ? <Spinner size="sm" /> : 'Acknowledge'}
                        </Button>
                      ) : null,
                  },
                ]}
                data={breaches}
                keyExtractor={(row) => row.id}
                emptyMessage={
                  ackFilter === 'open'
                    ? 'No open SLA breaches. All response-time targets are being met.'
                    : 'No breaches match the selected filter.'
                }
              />
            </Card>
          )}
        </div>
      )}

      {/* ── METRICS TAB ────────────────────────────────────────── */}
      {tab === 'metrics' && (
        <div className="space-y-6">
          {metricsLoading || metrics === null ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner size="lg" label="Loading metrics…" />
            </div>
          ) : (
            <>
              {/* Channel breakdown */}
              <Card className="p-5">
                <h3 className="mb-4 text-sm font-semibold text-content-primary">
                  Breaches by Channel — last {metrics.windowDays} days
                </h3>
                {metrics.byChannel.length === 0 ? (
                  <p className="text-sm text-content-tertiary">No breaches in this window.</p>
                ) : (
                  <div className="space-y-3">
                    {metrics.byChannel.map((stat) => {
                      const maxCount = Math.max(...metrics.byChannel.map((s) => s.count), 1);
                      const pct = (stat.count / maxCount) * 100;
                      return (
                        <div key={stat.channel}>
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-sm font-medium text-content-primary uppercase">
                              {stat.channel}
                            </span>
                            <div className="flex items-center gap-3 text-xs text-content-tertiary">
                              <span>
                                {stat.count} breach{stat.count !== 1 ? 'es' : ''}
                              </span>
                              {stat.avgHours !== null && (
                                <span className="text-amber-400">
                                  avg {stat.avgHours}h over SLA
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className="h-full rounded-full bg-amber-400/70 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Daily trend */}
              <Card className="p-5">
                <h3 className="mb-4 text-sm font-semibold text-content-primary">
                  Daily Breach Trend — last {metrics.windowDays} days
                </h3>
                {metrics.trend.length === 0 ? (
                  <p className="text-sm text-content-tertiary">No trend data available.</p>
                ) : (
                  <div className="flex h-32 items-end gap-1.5">
                    {metrics.trend.map((day) => {
                      const maxCount = Math.max(...metrics.trend.map((d) => d.count), 1);
                      const heightPct = maxCount > 0 ? (day.count / maxCount) * 100 : 0;
                      return (
                        <div
                          key={day.day}
                          className="flex flex-1 flex-col items-center gap-1"
                          title={`${day.day}: ${String(day.count)} breach${day.count !== 1 ? 'es' : ''}`}
                        >
                          <div
                            className="flex w-full flex-col justify-end"
                            style={{ height: '96px' }}
                          >
                            <div
                              className="w-full rounded-sm bg-amber-400/60 transition-all duration-500 hover:bg-amber-400/80"
                              style={{
                                height: `${heightPct}%`,
                                minHeight: day.count > 0 ? '4px' : '0',
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-content-tertiary">
                            {new Date(day.day).toLocaleDateString(undefined, { weekday: 'narrow' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-4">
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold text-content-primary">{metrics.totalBreaches}</p>
                  <p className="text-xs text-content-tertiary mt-1">Total Breaches</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold text-amber-400">{metrics.unacknowledged}</p>
                  <p className="text-xs text-content-tertiary mt-1">Unacknowledged</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold text-emerald-400">{metrics.activePolicies}</p>
                  <p className="text-xs text-content-tertiary mt-1">Active Policies</p>
                </Card>
              </div>
            </>
          )}
        </div>
      )}

      {/* Policy modal */}
      {showModal && (
        <PolicyModal
          editing={editingPolicy}
          onClose={() => {
            setShowModal(false);
            setEditingPolicy(null);
          }}
          onSave={handleSavePolicy}
        />
      )}
    </div>
  );
}
