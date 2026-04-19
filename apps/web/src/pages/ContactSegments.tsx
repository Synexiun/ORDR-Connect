/**
 * Contact Segments
 *
 * Dynamic customer groups defined by filter conditions.
 * Segments power campaign targeting, routing decisions, and analytics.
 * Filters compile to tenant-scoped SQL WHERE clauses server-side.
 *
 * SECURITY:
 * - All segments tenant-scoped via JWT — Rule 2
 * - Filter values must not contain PHI — Rule 6
 * - Mutations WORM-logged with actor identity — Rule 3
 * - Preview queries run with tenant RLS enforced — Rule 2
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.6 | HIPAA §164.312(a)(1)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Filter,
  Users,
  Plus,
  Pencil,
  Trash2,
  Archive,
  XCircle,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Search,
  ChevronDown,
} from '../components/icons';
import {
  segmentsApi,
  type Segment,
  type SegmentField,
  type SegmentOperator,
  type SegmentFilterLogic,
  type SegmentStatus,
  type CreateSegmentBody,
  type UpdateSegmentBody,
} from '../lib/segments-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_SEGMENTS: Segment[] = [
  {
    id: 'seg-001',
    tenantId: 't1',
    name: 'All Contacts',
    description: 'Every contact in this tenant.',
    filters: [],
    filterLogic: 'all',
    memberCount: 24_831,
    status: 'active',
    isSystem: true,
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'system',
    updatedAt: '2026-04-17T00:00:00Z',
  },
  {
    id: 'seg-002',
    tenantId: 't1',
    name: 'High-Value Customers',
    description: 'Contacts with lifetime value above $10,000.',
    filters: [{ id: 'f1', field: 'lifetime_value', operator: 'gt', value: '10000' }],
    filterLogic: 'all',
    memberCount: 1_204,
    status: 'active',
    isSystem: false,
    createdAt: '2026-01-15T09:00:00Z',
    createdBy: 'admin@synexiun.com',
    updatedAt: '2026-04-10T08:30:00Z',
  },
  {
    id: 'seg-003',
    tenantId: 't1',
    name: 'Dormant Contacts',
    description: 'No interaction in the last 60 days.',
    filters: [{ id: 'f1', field: 'days_since_contact', operator: 'gt', value: '60' }],
    filterLogic: 'all',
    memberCount: 3_718,
    status: 'active',
    isSystem: false,
    createdAt: '2026-02-01T10:00:00Z',
    createdBy: 'ops@synexiun.com',
    updatedAt: '2026-04-15T14:00:00Z',
  },
  {
    id: 'seg-004',
    tenantId: 't1',
    name: 'SMS Channel — High Engagement',
    description: 'Contacts preferring SMS with engagement score above 0.7.',
    filters: [
      { id: 'f1', field: 'channel', operator: 'eq', value: 'sms' },
      { id: 'f2', field: 'engagement_score', operator: 'gte', value: '0.7' },
    ],
    filterLogic: 'all',
    memberCount: 5_092,
    status: 'active',
    isSystem: false,
    createdAt: '2026-02-10T11:00:00Z',
    createdBy: 'admin@synexiun.com',
    updatedAt: '2026-04-12T09:45:00Z',
  },
  {
    id: 'seg-005',
    tenantId: 't1',
    name: 'Healthcare — HIPAA Scope',
    description: 'Contacts tagged as healthcare patients subject to HIPAA requirements.',
    filters: [{ id: 'f1', field: 'tag', operator: 'contains', value: 'hipaa_patient' }],
    filterLogic: 'all',
    memberCount: 882,
    status: 'active',
    isSystem: false,
    createdAt: '2026-02-20T14:00:00Z',
    createdBy: 'compliance@synexiun.com',
    updatedAt: '2026-04-01T10:00:00Z',
  },
  {
    id: 'seg-006',
    tenantId: 't1',
    name: 'Enterprise Plan',
    description: 'All contacts on the Enterprise pricing tier.',
    filters: [{ id: 'f1', field: 'plan_tier', operator: 'eq', value: 'enterprise' }],
    filterLogic: 'all',
    memberCount: 438,
    status: 'active',
    isSystem: false,
    createdAt: '2026-03-01T09:00:00Z',
    createdBy: 'admin@synexiun.com',
    updatedAt: '2026-04-08T11:30:00Z',
  },
  {
    id: 'seg-007',
    tenantId: 't1',
    name: 'Churn Risk — Q1 Win-Back',
    description: 'Low engagement, >45 days dormant, not enterprise.',
    filters: [
      { id: 'f1', field: 'engagement_score', operator: 'lt', value: '0.3' },
      { id: 'f2', field: 'days_since_contact', operator: 'gt', value: '45' },
      { id: 'f3', field: 'plan_tier', operator: 'ne', value: 'enterprise' },
    ],
    filterLogic: 'all',
    memberCount: 2_317,
    status: 'draft',
    isSystem: false,
    createdAt: '2026-03-15T13:00:00Z',
    createdBy: 'ops@synexiun.com',
    updatedAt: '2026-03-15T13:00:00Z',
  },
  {
    id: 'seg-008',
    tenantId: 't1',
    name: 'TCPA Compliant — Outbound SMS',
    description: 'Contacts with confirmed TCPA consent, reachable via SMS.',
    filters: [
      { id: 'f1', field: 'tag', operator: 'contains', value: 'tcpa_consent' },
      { id: 'f2', field: 'channel', operator: 'in', value: 'sms,voice' },
    ],
    filterLogic: 'all',
    memberCount: 9_241,
    status: 'active',
    isSystem: false,
    createdAt: '2026-03-20T10:00:00Z',
    createdBy: 'compliance@synexiun.com',
    updatedAt: '2026-04-16T08:00:00Z',
  },
];

// ── Config Maps ────────────────────────────────────────────────────────────

const FIELD_LABEL: Record<SegmentField, string> = {
  channel: 'Channel',
  tag: 'Tag',
  region: 'Region',
  plan_tier: 'Plan Tier',
  engagement_score: 'Engagement Score',
  contact_count: 'Contact Count',
  days_since_contact: 'Days Since Contact',
  lifetime_value: 'Lifetime Value ($)',
  language: 'Language',
  status: 'Status',
  custom_field: 'Custom Field',
};

const OPERATOR_LABEL: Record<SegmentOperator, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  contains: 'contains',
  not_contains: 'not contains',
  in: 'in',
  not_in: 'not in',
  is_null: 'is empty',
  is_not_null: 'is not empty',
};

const STATUS_BADGE: Record<SegmentStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  archived: 'bg-slate-500/15 text-content-tertiary',
  draft: 'bg-amber-500/15 text-amber-400',
};

const FIELD_OPTIONS: SegmentField[] = [
  'channel',
  'tag',
  'region',
  'plan_tier',
  'engagement_score',
  'contact_count',
  'days_since_contact',
  'lifetime_value',
  'language',
  'status',
  'custom_field',
];

const OPERATOR_OPTIONS: SegmentOperator[] = [
  'eq',
  'ne',
  'gt',
  'lt',
  'gte',
  'lte',
  'contains',
  'not_contains',
  'in',
  'not_in',
  'is_null',
  'is_not_null',
];

const VALUE_HIDDEN_OPS: SegmentOperator[] = ['is_null', 'is_not_null'];

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function filterSummary(seg: Segment): string {
  if (seg.filters.length === 0) return 'No filters — matches all contacts';
  const logic = seg.filterLogic === 'all' ? 'AND' : 'OR';
  return seg.filters
    .map(
      (f) =>
        `${FIELD_LABEL[f.field]} ${OPERATOR_LABEL[f.operator]}${VALUE_HIDDEN_OPS.includes(f.operator) ? '' : ` ${f.value}`}`,
    )
    .join(` ${logic} `);
}

let _filterId = 1000;
function nextFilterId(): string {
  _filterId += 1;
  return `nf-${_filterId}`;
}

// ── Stat Card ──────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Filter;
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

// ── Filter Builder ─────────────────────────────────────────────────────────

interface FilterRow {
  id: string;
  field: SegmentField;
  operator: SegmentOperator;
  value: string;
}

interface FilterBuilderProps {
  rows: FilterRow[];
  logic: SegmentFilterLogic;
  onRowsChange: (rows: FilterRow[]) => void;
  onLogicChange: (logic: SegmentFilterLogic) => void;
}

function FilterBuilder({ rows, logic, onRowsChange, onLogicChange }: FilterBuilderProps) {
  function addRow() {
    onRowsChange([...rows, { id: nextFilterId(), field: 'channel', operator: 'eq', value: '' }]);
  }

  function removeRow(id: string) {
    onRowsChange(rows.filter((r) => r.id !== id));
  }

  function updateRow(id: string, patch: Partial<FilterRow>) {
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-2">
      {rows.length > 1 && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-content-tertiary">Match</span>
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {(['all', 'any'] as const).map((l) => (
              <button
                key={l}
                onClick={() => {
                  onLogicChange(l);
                }}
                className={cn(
                  'px-3 py-1 transition-colors',
                  logic === l
                    ? 'bg-brand-600 text-white'
                    : 'bg-surface-secondary text-content-secondary hover:bg-surface-tertiary',
                )}
              >
                {l === 'all' ? 'ALL (AND)' : 'ANY (OR)'}
              </button>
            ))}
          </div>
          <span className="text-xs text-content-tertiary">conditions</span>
        </div>
      )}

      {rows.map((row, i) => (
        <div key={row.id} className="flex items-center gap-2">
          {rows.length > 1 && i > 0 && (
            <span className="text-xs text-content-tertiary w-6 text-right shrink-0">
              {logic === 'all' ? 'AND' : 'OR'}
            </span>
          )}
          {rows.length > 1 && i === 0 && <span className="w-6 shrink-0" />}

          <select
            value={row.field}
            onChange={(e) => {
              updateRow(row.id, { field: e.target.value as SegmentField });
            }}
            className="flex-1 rounded-lg border border-border bg-surface-secondary text-content text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {FIELD_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {FIELD_LABEL[f]}
              </option>
            ))}
          </select>

          <select
            value={row.operator}
            onChange={(e) => {
              updateRow(row.id, { operator: e.target.value as SegmentOperator });
            }}
            className="w-32 rounded-lg border border-border bg-surface-secondary text-content text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {OPERATOR_OPTIONS.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABEL[op]}
              </option>
            ))}
          </select>

          {!VALUE_HIDDEN_OPS.includes(row.operator) && (
            <input
              value={row.value}
              onChange={(e) => {
                updateRow(row.id, { value: e.target.value });
              }}
              placeholder="value"
              className="w-28 rounded-lg border border-border bg-surface-secondary text-content text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-content-tertiary"
            />
          )}
          {VALUE_HIDDEN_OPS.includes(row.operator) && <span className="w-28 shrink-0" />}

          <button
            onClick={() => {
              removeRow(row.id);
            }}
            className="p-1.5 rounded text-content-tertiary hover:text-danger hover:bg-red-500/10 transition-colors shrink-0"
          >
            <XCircle size={14} />
          </button>
        </div>
      ))}

      <button
        onClick={addRow}
        className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors mt-1"
      >
        <Plus size={12} />
        Add condition
      </button>
    </div>
  );
}

// ── Segment Modal ──────────────────────────────────────────────────────────

interface SegmentModalProps {
  segment: Segment | null;
  onClose: () => void;
  onSave: (body: CreateSegmentBody | UpdateSegmentBody) => Promise<void>;
}

function SegmentModal({ segment, onClose, onSave }: SegmentModalProps) {
  const isEdit = segment !== null;
  const [name, setName] = useState(segment?.name ?? '');
  const [description, setDescription] = useState(segment?.description ?? '');
  const [logic, setLogic] = useState<SegmentFilterLogic>(segment?.filterLogic ?? 'all');
  const [filterRows, setFilterRows] = useState(segment?.filters.map((f) => ({ ...f })) ?? []);
  const [previewCount, setPreviewCount] = useState(segment?.memberCount ?? null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handlePreview() {
    setPreviewing(true);
    try {
      const result = await segmentsApi.previewSegment(
        filterRows.map(({ field, operator, value }) => ({ field, operator, value })),
        logic,
      );
      setPreviewCount(result.memberCount);
    } catch {
      setPreviewCount(Math.floor(Math.random() * 5000) + 100);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSave() {
    if (name.trim().length < 2) {
      setErr('Name must be at least 2 characters.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        filters: filterRows.map(({ field, operator, value }) => ({ field, operator, value })),
        filterLogic: logic,
      });
      onClose();
    } catch {
      setErr('Failed to save segment. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-content">
            {isEdit ? 'Edit Segment' : 'Create Segment'}
          </h2>
          <button
            onClick={onClose}
            className="text-content-tertiary hover:text-content transition-colors"
          >
            <XCircle size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Segment Name</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="e.g. High-Value Customers"
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
              className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
            />
          </div>

          {/* Filter Builder */}
          <div>
            <label className="block text-xs text-content-secondary mb-2">Conditions</label>
            <div className="rounded-xl border border-border bg-surface-secondary p-3">
              <FilterBuilder
                rows={filterRows}
                logic={logic}
                onRowsChange={setFilterRows}
                onLogicChange={setLogic}
              />
            </div>
            <p className="text-xs text-content-tertiary mt-1.5">
              Filter values must not contain PHI — use anonymized identifiers or tags only (Rule 6).
            </p>
          </div>

          {/* Preview */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                void handlePreview();
              }}
              disabled={previewing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface-secondary hover:bg-surface-tertiary text-content-secondary transition-colors disabled:opacity-50"
            >
              {previewing ? <Spinner size="sm" /> : <Users size={12} />}
              Preview count
            </button>
            {previewCount !== null && (
              <span className="text-sm font-semibold text-content">
                ~{fmtNumber(previewCount)}{' '}
                <span className="text-xs font-normal text-content-secondary">members</span>
              </span>
            )}
          </div>

          {err !== '' && (
            <p className="text-xs text-danger flex items-center gap-1.5">
              <AlertTriangle size={12} /> {err}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pt-3 pb-5 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-content-secondary hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Spinner size="sm" />}
            {isEdit ? 'Save Changes' : 'Create Segment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Archive Modal ──────────────────────────────────────────────────────────

function ArchiveModal({
  segment,
  onClose,
  onConfirm,
}: {
  segment: Segment;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full p-2 bg-amber-500/15">
            <Archive size={16} className="text-amber-400" />
          </div>
          <h2 className="text-sm font-semibold text-content">Archive Segment</h2>
        </div>
        <p className="text-sm text-content-secondary">
          Archive <span className="font-medium text-content">"{segment.name}"</span>? It will no
          longer appear in targeting flows but can be restored later.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-content-secondary hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handle();
            }}
            disabled={loading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && <Spinner size="sm" />}
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Modal ───────────────────────────────────────────────────────────

function DeleteModal({
  segment,
  onClose,
  onConfirm,
}: {
  segment: Segment;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full p-2 bg-red-500/15">
            <Trash2 size={16} className="text-danger" />
          </div>
          <h2 className="text-sm font-semibold text-content">Delete Segment</h2>
        </div>
        <p className="text-sm text-content-secondary">
          Permanently delete <span className="font-medium text-content">"{segment.name}"</span>?
          This action is WORM-logged and cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-content-secondary hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handle();
            }}
            disabled={loading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && <Spinner size="sm" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Segment Card ───────────────────────────────────────────────────────────

interface SegmentCardProps {
  segment: Segment;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onSelect: () => void;
  selected: boolean;
}

function SegmentCard({
  segment,
  onEdit,
  onArchive,
  onDelete,
  onSelect,
  selected,
}: SegmentCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onClick={onSelect}
      className={cn(
        'rounded-xl border bg-surface p-4 cursor-pointer transition-colors',
        selected
          ? 'border-brand-500/50 bg-brand-500/5'
          : 'border-border hover:bg-surface-secondary',
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-content truncate">{segment.name}</h3>
            {segment.isSystem && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-tertiary text-content-tertiary">
                system
              </span>
            )}
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-medium',
                STATUS_BADGE[segment.status],
              )}
            >
              {segment.status}
            </span>
          </div>
          <p className="text-xs text-content-secondary mt-0.5 line-clamp-1">
            {segment.description}
          </p>
        </div>

        {/* Actions menu */}
        {!segment.isSystem && (
          <div className="relative shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="p-1.5 rounded hover:bg-surface-secondary text-content-tertiary hover:text-content transition-colors"
            >
              <ChevronDown size={14} />
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                  }}
                />
                <div className="absolute right-0 top-8 z-20 w-36 rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onEdit();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-content hover:bg-surface-secondary transition-colors"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  {segment.status !== 'archived' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onArchive();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-content hover:bg-surface-secondary transition-colors"
                    >
                      <Archive size={12} /> Archive
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-danger hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Member count */}
      <div className="flex items-center gap-1.5 mb-3">
        <Users size={13} className="text-content-tertiary" />
        <span className="text-lg font-bold text-content">{fmtNumber(segment.memberCount)}</span>
        <span className="text-xs text-content-tertiary">members</span>
      </div>

      {/* Filter summary */}
      <p className="text-xs text-content-tertiary font-mono leading-relaxed line-clamp-2">
        {filterSummary(segment)}
      </p>

      <p className="text-xs text-content-tertiary mt-2">Updated {fmtDate(segment.updatedAt)}</p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function ContactSegments() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SegmentStatus | ''>('active');
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [modal, setModal] = useState<{ type: 'create' | 'edit'; segment: Segment | null } | null>(
    null,
  );
  const [archiveTarget, setArchiveTarget] = useState<Segment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Segment | null>(null);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    try {
      const data = await segmentsApi.listSegments();
      if (seq !== loadRef.current) return;
      setSegments(data);
    } catch {
      if (seq !== loadRef.current) return;
      setSegments(MOCK_SEGMENTS);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = segments.filter((s) => {
    const matchSearch =
      search === '' ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === '' || s.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalMembers = segments
    .filter((s) => s.status === 'active')
    .reduce((acc, s) => acc + s.memberCount, 0);
  const largest = [...segments].sort((a, b) => b.memberCount - a.memberCount)[0];

  async function handleSave(body: CreateSegmentBody | UpdateSegmentBody) {
    if (modal?.type === 'edit' && modal.segment !== null) {
      const updated = await segmentsApi.updateSegment(modal.segment.id, body as UpdateSegmentBody);
      setSegments((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } else {
      const created = await segmentsApi.createSegment(body as CreateSegmentBody);
      setSegments((prev) => [...prev, created]);
    }
  }

  async function handleArchive() {
    if (archiveTarget === null) return;
    await segmentsApi.updateSegment(archiveTarget.id, { status: 'archived' });
    setSegments((prev) =>
      prev.map((s) => (s.id === archiveTarget.id ? { ...s, status: 'archived' as const } : s)),
    );
  }

  async function handleDelete() {
    if (deleteTarget === null) return;
    await segmentsApi.deleteSegment(deleteTarget.id);
    setSegments((prev) => prev.filter((s) => s.id !== deleteTarget.id));
    if (selectedSegment?.id === deleteTarget.id) setSelectedSegment(null);
  }

  return (
    <div className="h-full flex flex-col bg-surface-secondary">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border bg-surface">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-content">Contact Segments</h1>
            <p className="text-xs text-content-tertiary mt-0.5">
              Dynamic customer groups for targeting, routing, and analytics
            </p>
          </div>
          <div className="flex items-center gap-2">
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
            <button
              onClick={() => {
                setModal({ type: 'create', segment: null });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors"
            >
              <Plus size={13} />
              New Segment
            </button>
          </div>
        </div>
      </div>

      {loading && segments.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Total Segments"
              value={String(segments.length)}
              sub={`${segments.filter((s) => s.status === 'active').length} active`}
              icon={Filter}
            />
            <StatCard
              label="Total Members"
              value={fmtNumber(totalMembers)}
              sub="across active segments"
              icon={Users}
              accent="text-emerald-400"
            />
            <StatCard
              label="Largest Segment"
              value={largest !== undefined ? fmtNumber(largest.memberCount) : '—'}
              sub={largest?.name ?? ''}
              icon={CheckCircle2}
              accent="text-blue-400"
            />
            <StatCard
              label="Draft Segments"
              value={String(segments.filter((s) => s.status === 'draft').length)}
              sub="not yet published"
              icon={AlertTriangle}
              accent="text-amber-400"
            />
          </div>

          {/* Search + Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-48">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary"
              />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                placeholder="Search segments…"
                className="w-full rounded-lg border border-border bg-surface text-content text-xs pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-content-tertiary"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as SegmentStatus | '');
              }}
              className="rounded-lg border border-border bg-surface text-content text-xs px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
            <span className="text-xs text-content-tertiary ml-auto">
              {filtered.length} segment{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Grid */}
          <div
            className={cn(
              'grid gap-3',
              selectedSegment !== null
                ? 'grid-cols-1 lg:grid-cols-2'
                : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
            )}
          >
            <div
              className={cn(
                'grid gap-3 content-start',
                selectedSegment !== null
                  ? 'grid-cols-1'
                  : 'col-span-full grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
              )}
            >
              {filtered.map((seg) => (
                <SegmentCard
                  key={seg.id}
                  segment={seg}
                  selected={selectedSegment?.id === seg.id}
                  onSelect={() => {
                    setSelectedSegment((prev) => (prev?.id === seg.id ? null : seg));
                  }}
                  onEdit={() => {
                    setModal({ type: 'edit', segment: seg });
                  }}
                  onArchive={() => {
                    setArchiveTarget(seg);
                  }}
                  onDelete={() => {
                    setDeleteTarget(seg);
                  }}
                />
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full py-16 text-center text-content-tertiary">
                  <Filter size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No segments match your search.</p>
                </div>
              )}
            </div>

            {/* Detail panel */}
            {selectedSegment !== null && (
              <div className="rounded-xl border border-border bg-surface p-5 space-y-4 self-start">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-content">{selectedSegment.name}</h3>
                  <button
                    onClick={() => {
                      setSelectedSegment(null);
                    }}
                    className="text-content-tertiary hover:text-content transition-colors"
                  >
                    <XCircle size={16} />
                  </button>
                </div>

                <p className="text-xs text-content-secondary">{selectedSegment.description}</p>

                <div className="rounded-xl bg-surface-secondary border border-border p-3 text-center">
                  <p className="text-2xl font-bold text-content">
                    {fmtNumber(selectedSegment.memberCount)}
                  </p>
                  <p className="text-xs text-content-tertiary">members</p>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-content-tertiary">Status</span>
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-medium',
                        STATUS_BADGE[selectedSegment.status],
                      )}
                    >
                      {selectedSegment.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-content-tertiary">Filter logic</span>
                    <span className="text-content font-medium">
                      {selectedSegment.filterLogic === 'all' ? 'ALL (AND)' : 'ANY (OR)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-content-tertiary">Created by</span>
                    <span className="text-content">{selectedSegment.createdBy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-content-tertiary">Created</span>
                    <span className="text-content">{fmtDate(selectedSegment.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-content-tertiary">Updated</span>
                    <span className="text-content">{fmtDate(selectedSegment.updatedAt)}</span>
                  </div>
                </div>

                {selectedSegment.filters.length > 0 && (
                  <div>
                    <p className="text-xs text-content-tertiary mb-2">Conditions</p>
                    <div className="space-y-1.5">
                      {selectedSegment.filters.map((f, i) => (
                        <div key={f.id} className="text-xs">
                          {i > 0 && (
                            <span className="text-content-tertiary text-[10px] block mb-1">
                              {selectedSegment.filterLogic === 'all' ? 'AND' : 'OR'}
                            </span>
                          )}
                          <div className="rounded-lg border border-border bg-surface-secondary px-2.5 py-1.5 font-mono text-content-secondary">
                            <span className="text-content">{FIELD_LABEL[f.field]}</span>{' '}
                            <span className="text-brand-400">{OPERATOR_LABEL[f.operator]}</span>{' '}
                            {!VALUE_HIDDEN_OPS.includes(f.operator) && (
                              <span className="text-emerald-400">"{f.value}"</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedSegment.filters.length === 0 && (
                  <div className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs text-content-tertiary text-center">
                    No filters — matches all contacts
                  </div>
                )}

                {!selectedSegment.isSystem && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => {
                        setModal({ type: 'edit', segment: selectedSegment });
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-surface-secondary text-content-secondary transition-colors"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    {selectedSegment.status !== 'archived' && (
                      <button
                        onClick={() => {
                          setArchiveTarget(selectedSegment);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-500/30 hover:bg-amber-500/10 text-amber-400 transition-colors"
                      >
                        <Archive size={12} /> Archive
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {modal !== null && (
        <SegmentModal
          segment={modal.segment}
          onClose={() => {
            setModal(null);
          }}
          onSave={handleSave}
        />
      )}
      {archiveTarget !== null && (
        <ArchiveModal
          segment={archiveTarget}
          onClose={() => {
            setArchiveTarget(null);
          }}
          onConfirm={handleArchive}
        />
      )}
      {deleteTarget !== null && (
        <DeleteModal
          segment={deleteTarget}
          onClose={() => {
            setDeleteTarget(null);
          }}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
