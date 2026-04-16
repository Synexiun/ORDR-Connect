/**
 * Feature Flags Admin Console — per-tenant runtime feature gating.
 *
 * Operators can enable/disable flags, adjust rollout percentages, and
 * manage flag metadata. All writes are admin-only and WORM-audited server-side.
 *
 * SOC2 CC6.1  — Tenant-scoped; write access gated to tenant_admin.
 * ISO 27001 A.14.2.5 — Controlled feature rollout with audit trail.
 * SECURITY: No PHI in flag data (Rule 6). Tenant ID from JWT (Rule 2).
 */

import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Toggle } from '../components/ui/Toggle';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { Spinner } from '../components/ui/Spinner';
import {
  ToggleRight,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Zap,
  CheckCircle2,
  XCircle,
} from '../components/icons';
import {
  fetchFeatureFlags,
  createFeatureFlag,
  updateFeatureFlag,
  deleteFeatureFlag,
  type FeatureFlag,
  type CreateFlagPayload,
  type UpdateFlagPayload,
} from '../lib/feature-flags-api';

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_FLAGS: FeatureFlag[] = [
  {
    id: 'f1',
    tenantId: 't1',
    flagName: 'ai-suggestions',
    enabled: true,
    rolloutPct: 100,
    description: 'Enable AI-powered response suggestions in the ops center.',
    metadata: {},
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'f2',
    tenantId: 't1',
    flagName: 'voice-ivr-v2',
    enabled: true,
    rolloutPct: 25,
    description: 'New IVR flow with natural language understanding. Gradual rollout.',
    metadata: { experiment: 'ivr-nl-2026' },
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'f3',
    tenantId: 't1',
    flagName: 'cobrowse-beta',
    enabled: false,
    rolloutPct: 0,
    description: null,
    metadata: {},
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: 'f4',
    tenantId: 't1',
    flagName: 'fhir-export',
    enabled: true,
    rolloutPct: 50,
    description: 'FHIR R4 data export endpoint for healthcare customers.',
    metadata: { requires_baa: 'true' },
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'f5',
    tenantId: 't1',
    flagName: 'batch-sms-v2',
    enabled: false,
    rolloutPct: 0,
    description: 'New batch SMS pipeline with improved throughput and retry logic.',
    metadata: {},
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// eslint-disable-next-line security/detect-unsafe-regex -- character classes are disjoint ([a-z0-9] vs '-'), no ReDoS risk
const FLAG_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── RolloutBar ─────────────────────────────────────────────────────────────────

interface RolloutBarProps {
  pct: number;
}

function RolloutBar({ pct }: RolloutBarProps): ReactNode {
  const color =
    pct === 100
      ? 'bg-emerald-500'
      : pct >= 50
        ? 'bg-brand-accent'
        : pct > 0
          ? 'bg-amber-500'
          : 'bg-surface-tertiary';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-tertiary">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${String(pct)}%` }}
        />
      </div>
      <span className="tabular-nums text-sm text-content-secondary">{String(pct)}%</span>
    </div>
  );
}

// ── FlagModal ──────────────────────────────────────────────────────────────────

interface FlagFormState {
  flagName: string;
  enabled: boolean;
  rolloutPct: number;
  description: string;
}

interface FlagModalProps {
  open: boolean;
  editing: FeatureFlag | null;
  onClose: () => void;
  onSave: (form: FlagFormState) => Promise<void>;
}

function FlagModal({ open, editing, onClose, onSave }: FlagModalProps): ReactNode {
  const [form, setForm] = useState<FlagFormState>({
    flagName: '',
    enabled: false,
    rolloutPct: 100,
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    if (open) {
      setForm({
        flagName: editing?.flagName ?? '',
        enabled: editing?.enabled ?? false,
        rolloutPct: editing?.rolloutPct ?? 100,
        description: editing?.description ?? '',
      });
      setNameError('');
    }
  }, [open, editing]);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (editing === null && !FLAG_NAME_RE.test(form.flagName)) {
        setNameError('Must be kebab-case, e.g. "ai-suggestions"');
        return;
      }
      setSaving(true);
      try {
        await onSave(form);
        onClose();
      } finally {
        setSaving(false);
      }
    },
    [editing, form, onSave, onClose],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing !== null ? `Edit "${editing.flagName}"` : 'New Feature Flag'}
      size="md"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" form="flag-form" disabled={saving}>
            {saving ? <Spinner size="sm" /> : editing !== null ? 'Save Changes' : 'Create Flag'}
          </Button>
        </>
      }
    >
      <form
        id="flag-form"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-4"
      >
        {/* Flag Name */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">Flag Name</label>
          {editing !== null ? (
            <p className="rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-sm text-content">
              {editing.flagName}
            </p>
          ) : (
            <>
              <Input
                value={form.flagName}
                onChange={(e) => {
                  setForm((f) => ({ ...f, flagName: e.target.value }));
                  setNameError('');
                }}
                placeholder="ai-suggestions"
                className="font-mono"
                required
              />
              {nameError !== '' && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
              <p className="mt-1 text-xs text-content-tertiary">
                Lowercase letters, digits, and hyphens only (kebab-case).
              </p>
            </>
          )}
        </div>

        {/* Enabled */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-tertiary/40 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-content">Enabled</p>
            <p className="text-xs text-content-tertiary">Allow evaluation for this flag</p>
          </div>
          <Toggle
            checked={form.enabled}
            onChange={(v) => {
              setForm((f) => ({ ...f, enabled: v }));
            }}
          />
        </div>

        {/* Rollout Percentage */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">
            Rollout Percentage
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={form.rolloutPct}
              onChange={(e) => {
                setForm((f) => ({ ...f, rolloutPct: Number(e.target.value) }));
              }}
              className="h-2 w-full cursor-pointer accent-brand-accent"
            />
            <Input
              type="number"
              min="0"
              max="100"
              value={form.rolloutPct}
              onChange={(e) => {
                const v = Math.min(100, Math.max(0, Number(e.target.value)));
                setForm((f) => ({ ...f, rolloutPct: v }));
              }}
              className="w-20 text-center"
            />
          </div>
          <p className="mt-1 text-xs text-content-tertiary">
            Fraction of tenants/users that receive this flag as enabled.
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">
            Description <span className="font-normal text-content-tertiary">(optional)</span>
          </label>
          <Textarea
            value={form.description}
            onChange={(e) => {
              setForm((f) => ({ ...f, description: e.target.value }));
            }}
            placeholder="What does this flag control? When should it be enabled?"
            rows={3}
            maxLength={500}
          />
          <p className="mt-1 text-right text-xs text-content-tertiary">
            {String(form.description.length)}/500
          </p>
        </div>
      </form>
    </Modal>
  );
}

// ── DeleteConfirm ──────────────────────────────────────────────────────────────

interface DeleteConfirmProps {
  open: boolean;
  flagName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function DeleteConfirm({ open, flagName, onClose, onConfirm }: DeleteConfirmProps): ReactNode {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  }, [onConfirm]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete Feature Flag"
      size="sm"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={deleting}
          >
            {deleting ? <Spinner size="sm" /> : 'Delete Flag'}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div>
          <p className="text-sm text-content">
            Delete flag <span className="font-mono font-semibold text-content">{flagName}</span>?
          </p>
          <p className="mt-1 text-sm text-content-secondary">
            This is permanent and WORM-audited. Any code evaluating this flag will receive{' '}
            <code className="rounded bg-surface-tertiary px-1 text-xs">false</code> immediately.
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function FeatureFlags(): ReactNode {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingFlag, setEditingFlag] = useState<FeatureFlag | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FeatureFlag | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Load ──

  useEffect(() => {
    setLoading(true);
    void fetchFeatureFlags()
      .then((data) => {
        setFlags(data.length > 0 ? data : MOCK_FLAGS);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // ── Stats ──

  const stats = useMemo(() => {
    const total = flags.length;
    const enabled = flags.filter((f) => f.enabled).length;
    return { total, enabled, disabled: total - enabled };
  }, [flags]);

  // ── Filter ──

  const filtered = useMemo(() => {
    if (searchQuery.trim() === '') return flags;
    const q = searchQuery.toLowerCase();
    return flags.filter(
      (f) =>
        f.flagName.includes(q) ||
        (f.description !== null && f.description.toLowerCase().includes(q)),
    );
  }, [flags, searchQuery]);

  // ── Inline toggle ──

  const handleToggle = useCallback(async (flag: FeatureFlag) => {
    setTogglingId(flag.id);
    const next = !flag.enabled;
    setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, enabled: next } : f)));
    try {
      const updated = await updateFeatureFlag(flag.flagName, { enabled: next });
      setFlags((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    } catch {
      setFlags((prev) => prev.map((f) => (f.id === flag.id ? { ...f, enabled: flag.enabled } : f)));
    } finally {
      setTogglingId(null);
    }
  }, []);

  // ── Create / Edit ──

  const handleSave = useCallback(
    async (form: FlagFormState) => {
      if (editingFlag !== null) {
        const payload: UpdateFlagPayload = {
          enabled: form.enabled,
          rolloutPct: form.rolloutPct,
          description: form.description.trim() !== '' ? form.description.trim() : null,
        };
        const updated = await updateFeatureFlag(editingFlag.flagName, payload).catch(() => null);
        if (updated !== null) {
          setFlags((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
        }
      } else {
        const payload: CreateFlagPayload = {
          flagName: form.flagName,
          enabled: form.enabled,
          rolloutPct: form.rolloutPct,
        };
        if (form.description.trim() !== '') payload.description = form.description.trim();
        const created = await createFeatureFlag(payload).catch(() => null);
        if (created !== null) {
          setFlags((prev) => [created, ...prev]);
        }
      }
    },
    [editingFlag],
  );

  // ── Delete ──

  const handleDelete = useCallback(async () => {
    if (deleteTarget === null) return;
    await deleteFeatureFlag(deleteTarget.flagName).catch(() => null);
    setFlags((prev) => prev.filter((f) => f.id !== deleteTarget.id));
    setDeleteTarget(null);
  }, [deleteTarget]);

  // ── Render ──

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/10">
            <ToggleRight className="h-5 w-5 text-brand-accent" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-content">Feature Flags</h1>
            <p className="text-sm text-content-tertiary">
              Runtime feature gating with per-tenant rollout control
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setEditingFlag(null);
            setModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New Flag
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-brand-accent" />
            <div>
              <p className="text-2xl font-bold text-content">{String(stats.total)}</p>
              <p className="text-xs text-content-tertiary">Total Flags</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <div>
              <p className="text-2xl font-bold text-content">{String(stats.enabled)}</p>
              <p className="text-xs text-content-tertiary">Enabled</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 text-content-tertiary" />
            <div>
              <p className="text-2xl font-bold text-content">{String(stats.disabled)}</p>
              <p className="text-xs text-content-tertiary">Disabled</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Flags list */}
      <Card>
        <div className="border-b border-border px-4 py-3">
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            placeholder="Search flags…"
            className="max-w-sm"
          />
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" label="Loading flags" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-content-tertiary">
            {searchQuery !== '' ? 'No flags match your search.' : 'No feature flags yet.'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((flag) => (
              <div
                key={flag.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-surface-tertiary/30"
              >
                {/* Enable/Disable toggle */}
                <Toggle
                  checked={flag.enabled}
                  onChange={() => {
                    void handleToggle(flag);
                  }}
                  disabled={togglingId !== null}
                  size="sm"
                />

                {/* Name + description */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-semibold text-content">{flag.flagName}</code>
                    {flag.enabled ? (
                      <Badge variant="success">on</Badge>
                    ) : (
                      <Badge variant="neutral">off</Badge>
                    )}
                  </div>
                  {flag.description !== null && flag.description !== '' && (
                    <p className="mt-0.5 truncate text-xs text-content-tertiary">
                      {flag.description}
                    </p>
                  )}
                </div>

                {/* Rollout bar */}
                <div className="hidden sm:block">
                  <RolloutBar pct={flag.rolloutPct} />
                </div>

                {/* Last updated */}
                <p className="hidden w-24 text-right text-xs text-content-tertiary lg:block">
                  {formatDate(flag.updatedAt)}
                </p>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingFlag(flag);
                      setModalOpen(true);
                    }}
                    title="Edit flag"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDeleteTarget(flag);
                    }}
                    title="Delete flag"
                    className="text-red-500 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Modals */}
      <FlagModal
        open={modalOpen}
        editing={editingFlag}
        onClose={() => {
          setModalOpen(false);
        }}
        onSave={handleSave}
      />

      <DeleteConfirm
        open={deleteTarget !== null}
        flagName={deleteTarget?.flagName ?? ''}
        onClose={() => {
          setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}
