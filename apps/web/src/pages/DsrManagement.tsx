/**
 * DSR Management — GDPR Data Subject Request lifecycle dashboard
 *
 * Allows compliance teams to create, review, approve, reject, and cancel
 * data subject requests (access, erasure, portability).
 *
 * GDPR Art. 12 — 30-day deadline tracking and overdue alerting.
 * GDPR Art. 15/17/20 — access / erasure / portability.
 * SOC2 CC6.1 — Tenant-scoped; all actions produce WORM audit events.
 *
 * SECURITY:
 * - No PHI rendered — customer IDs only; all data is metadata (Rule 6).
 * - Approve / reject / cancel are write operations with WORM audit trail (Rule 3).
 * - Download URLs are pre-signed S3 URLs — never store them client-side.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
  Plus,
  Download,
  User,
  Trash2,
  Eye,
  RefreshCw,
} from '../components/icons';
import {
  dsrApi,
  type DsrRecord,
  type DsrDetail,
  type DsrType,
  type DsrStatus,
} from '../lib/dsr-api';

// ── Constants ──────────────────────────────────────────────────────

const STATUS_BADGE: Record<
  DsrStatus,
  { variant: 'success' | 'warning' | 'danger' | 'neutral' | 'info'; label: string }
> = {
  pending: { variant: 'warning', label: 'Pending' },
  approved: { variant: 'info', label: 'Approved' },
  processing: { variant: 'info', label: 'Processing' },
  completed: { variant: 'success', label: 'Completed' },
  rejected: { variant: 'neutral', label: 'Rejected' },
  cancelled: { variant: 'neutral', label: 'Cancelled' },
  failed: { variant: 'danger', label: 'Failed' },
};

const TYPE_BADGE: Record<DsrType, { label: string; variant: 'info' | 'danger' | 'neutral' }> = {
  access: { label: 'Access', variant: 'info' },
  erasure: { label: 'Erasure', variant: 'danger' },
  portability: { label: 'Portability', variant: 'neutral' },
};

const TYPE_ICONS: Record<DsrType, ReactNode> = {
  access: <Eye className="h-3.5 w-3.5" />,
  erasure: <Trash2 className="h-3.5 w-3.5" />,
  portability: <Download className="h-3.5 w-3.5" />,
};

// ── Mock data ─────────────────────────────────────────────────────

const MOCK_RECORDS: DsrRecord[] = [
  {
    id: 'dsr-001',
    customerId: 'cust-1001',
    type: 'erasure',
    status: 'pending',
    requestedBy: 'user-admin',
    reason: 'Customer requested account deletion per GDPR Art. 17',
    deadlineAt: new Date(Date.now() + 5 * 86400000).toISOString(),
    completedAt: null,
    rejectionReason: null,
    createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 25 * 86400000).toISOString(),
  },
  {
    id: 'dsr-002',
    customerId: 'cust-1042',
    type: 'access',
    status: 'pending',
    requestedBy: 'user-admin',
    reason: null,
    deadlineAt: new Date(Date.now() - 2 * 86400000).toISOString(), // overdue
    completedAt: null,
    rejectionReason: null,
    createdAt: new Date(Date.now() - 32 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 32 * 86400000).toISOString(),
  },
  {
    id: 'dsr-003',
    customerId: 'cust-0873',
    type: 'portability',
    status: 'completed',
    requestedBy: 'user-ops',
    reason: null,
    deadlineAt: new Date(Date.now() + 10 * 86400000).toISOString(),
    completedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    rejectionReason: null,
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'dsr-004',
    customerId: 'cust-0291',
    type: 'access',
    status: 'rejected',
    requestedBy: 'user-admin',
    reason: null,
    deadlineAt: new Date(Date.now() + 20 * 86400000).toISOString(),
    completedAt: null,
    rejectionReason: 'Insufficient identity verification provided',
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
  },
  {
    id: 'dsr-005',
    customerId: 'cust-0512',
    type: 'erasure',
    status: 'processing',
    requestedBy: 'user-ops',
    reason: 'Withdrawal of consent',
    deadlineAt: new Date(Date.now() + 15 * 86400000).toISOString(),
    completedAt: null,
    rejectionReason: null,
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
];

// ── Helpers ───────────────────────────────────────────────────────

function isOverdue(deadlineAt: string, status: DsrStatus): boolean {
  if (status === 'completed' || status === 'rejected' || status === 'cancelled') return false;
  return new Date(deadlineAt) < new Date();
}

function daysUntilDeadline(deadlineAt: string): number {
  return Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 86400000);
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unknown size';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}

// ── Reject modal ──────────────────────────────────────────────────

interface RejectModalProps {
  dsrId: string;
  onClose: () => void;
  onReject: (reason: string) => Promise<void>;
}

function RejectModal({ dsrId: _dsrId, onClose, onReject }: RejectModalProps): ReactNode {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (reason.trim().length === 0) return;
      setSubmitting(true);
      try {
        await onReject(reason.trim());
      } finally {
        setSubmitting(false);
      }
    },
    [reason, onReject],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-surface-3 bg-surface-1 shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-3 px-6 py-4">
          <h2 className="text-base font-semibold text-content-primary">Reject DSR</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-content-tertiary hover:bg-surface-3"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 px-6 py-5"
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-content-secondary">
              Rejection Reason <span className="text-red-400">*</span>
            </label>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
              placeholder="Explain why this request cannot be fulfilled…"
              className="w-full resize-none rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-content-primary placeholder-content-tertiary focus:border-brand-accent focus:outline-none"
              required
            />
            <p className="mt-1 text-xs text-content-tertiary">
              This reason will be included in the WORM audit trail (GDPR Art. 12).
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || reason.trim().length === 0}
              className="bg-red-500/20 text-red-300 hover:bg-red-500/30"
            >
              {submitting ? <Spinner size="sm" /> : 'Reject Request'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Create DSR modal ──────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreate: (customerId: string, type: DsrType, reason: string) => Promise<void>;
}

function CreateModal({ onClose, onCreate }: CreateModalProps): ReactNode {
  const [customerId, setCustomerId] = useState('');
  const [type, setType] = useState<DsrType>('access');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (customerId.trim().length === 0) return;
      setSubmitting(true);
      try {
        await onCreate(customerId.trim(), type, reason.trim());
      } finally {
        setSubmitting(false);
      }
    },
    [customerId, type, reason, onCreate],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-surface-3 bg-surface-1 shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-3 px-6 py-4">
          <h2 className="text-base font-semibold text-content-primary">New Data Subject Request</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-content-tertiary hover:bg-surface-3"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 px-6 py-5"
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-content-secondary">
              Customer ID <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
              }}
              placeholder="cust-uuid"
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-content-primary placeholder-content-tertiary focus:border-brand-accent focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-content-secondary">
              Request Type <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['access', 'erasure', 'portability'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setType(t);
                  }}
                  className={[
                    'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    type === t
                      ? 'border-brand-accent bg-brand-accent/10 text-brand-accent'
                      : 'border-surface-3 bg-surface-2 text-content-tertiary hover:border-surface-4 hover:text-content-secondary',
                  ].join(' ')}
                >
                  {TYPE_ICONS[t]}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {(type === 'erasure' || type === 'portability') && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">
                Reason {type === 'erasure' && <span className="text-red-400">*</span>}
              </label>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
                placeholder={
                  type === 'erasure'
                    ? 'Specify the legal basis for erasure…'
                    : 'Optional context for the portability request…'
                }
                required={type === 'erasure'}
                className="w-full resize-none rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-content-primary placeholder-content-tertiary focus:border-brand-accent focus:outline-none"
              />
            </div>
          )}
          <p className="text-xs text-content-tertiary">
            A 30-day response deadline (GDPR Art. 12) is automatically applied.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting || customerId.trim().length === 0}>
              {submitting ? <Spinner size="sm" /> : 'Create Request'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────

interface DetailPanelProps {
  dsr: DsrRecord;
  detail: DsrDetail | null;
  detailLoading: boolean;
  onClose: () => void;
  onApprove: (id: string) => Promise<void>;
  onRejectClick: (id: string) => void;
  onCancel: (id: string) => Promise<void>;
}

function DetailPanel({
  dsr,
  detail,
  detailLoading,
  onClose,
  onApprove,
  onRejectClick,
  onCancel,
}: DetailPanelProps): ReactNode {
  const [acting, setActing] = useState<'approve' | 'cancel' | null>(null);
  const overdue = isOverdue(dsr.deadlineAt, dsr.status);
  const daysLeft = daysUntilDeadline(dsr.deadlineAt);
  const { label: typeLabel, variant: typeVariant } = TYPE_BADGE[dsr.type];
  const { label: statusLabel, variant: statusVariant } = STATUS_BADGE[dsr.status];

  const handleApprove = async () => {
    setActing('approve');
    try {
      await onApprove(dsr.id);
    } finally {
      setActing(null);
    }
  };

  const handleCancel = async () => {
    setActing('cancel');
    try {
      await onCancel(dsr.id);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="flex w-96 flex-shrink-0 flex-col border-l border-surface-3 bg-surface-1">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-3 px-5 py-4">
        <h3 className="text-sm font-semibold text-content-primary">DSR Detail</h3>
        <button onClick={onClose} className="rounded p-1 text-content-tertiary hover:bg-surface-3">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Status + type */}
        <div className="flex flex-wrap gap-2">
          <Badge variant={statusVariant} size="sm">
            {statusLabel}
          </Badge>
          <Badge variant={typeVariant} size="sm" className="flex items-center gap-1">
            {TYPE_ICONS[dsr.type]}
            {typeLabel}
          </Badge>
          {overdue && (
            <Badge variant="danger" size="sm">
              OVERDUE
            </Badge>
          )}
        </div>

        {/* Metadata */}
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-content-tertiary">Request ID</dt>
            <dd className="font-mono text-xs text-content-secondary">{dsr.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-content-tertiary">Customer ID</dt>
            <dd className="font-mono text-xs text-content-secondary">{dsr.customerId}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-content-tertiary">Requested By</dt>
            <dd className="font-mono text-xs text-content-secondary">{dsr.requestedBy}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-content-tertiary">Created</dt>
            <dd className="text-content-secondary">{new Date(dsr.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-content-tertiary">GDPR Deadline</dt>
            <dd className={overdue ? 'text-red-400 font-medium' : 'text-content-secondary'}>
              {new Date(dsr.deadlineAt).toLocaleDateString()}{' '}
              {!overdue && daysLeft >= 0 && (
                <span className={daysLeft <= 3 ? 'text-amber-400' : 'text-content-tertiary'}>
                  ({daysLeft} day{daysLeft !== 1 ? 's' : ''} left)
                </span>
              )}
              {overdue && (
                <span>
                  {' '}
                  (overdue by {String(Math.abs(daysLeft))} day{Math.abs(daysLeft) !== 1 ? 's' : ''})
                </span>
              )}
            </dd>
          </div>
          {dsr.reason !== null && (
            <div>
              <dt className="text-xs font-medium text-content-tertiary">Reason</dt>
              <dd className="text-content-secondary">{dsr.reason}</dd>
            </div>
          )}
          {dsr.rejectionReason !== null && (
            <div>
              <dt className="text-xs font-medium text-content-tertiary">Rejection Reason</dt>
              <dd className="text-amber-400">{dsr.rejectionReason}</dd>
            </div>
          )}
          {dsr.completedAt !== null && (
            <div>
              <dt className="text-xs font-medium text-content-tertiary">Completed</dt>
              <dd className="text-emerald-400">{new Date(dsr.completedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>

        {/* Export download (access/portability completed) */}
        {detailLoading && (
          <div className="flex items-center gap-2 text-xs text-content-tertiary">
            <Spinner size="sm" /> Loading export info…
          </div>
        )}
        {!detailLoading && detail?.export !== undefined && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-medium text-content-primary">Data Export Ready</span>
            </div>
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-content-tertiary">File Size</dt>
                <dd className="text-content-secondary">
                  {formatBytes(detail.export.file_size_bytes)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-content-tertiary">Expires</dt>
                <dd className="text-content-secondary">
                  {new Date(detail.export.expires_at).toLocaleDateString()}
                </dd>
              </div>
              <div>
                <dt className="text-content-tertiary mb-0.5">SHA-256</dt>
                <dd className="break-all font-mono text-[10px] text-content-tertiary">
                  {detail.export.checksum_sha256}
                </dd>
              </div>
            </dl>
            <a
              href={detail.export.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download Export
            </a>
          </Card>
        )}
      </div>

      {/* Actions */}
      {dsr.status === 'pending' && (
        <div className="border-t border-surface-3 px-5 py-4 space-y-2">
          <Button
            className="w-full"
            size="sm"
            onClick={() => {
              void handleApprove();
            }}
            disabled={acting !== null}
          >
            {acting === 'approve' ? (
              <Spinner size="sm" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">Approve Request</span>
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-red-500/30 text-red-400 hover:border-red-500/50"
              onClick={() => {
                onRejectClick(dsr.id);
              }}
              disabled={acting !== null}
            >
              Reject
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-content-tertiary"
              onClick={() => {
                void handleCancel();
              }}
              disabled={acting !== null}
            >
              {acting === 'cancel' ? <Spinner size="sm" /> : 'Cancel'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export function DsrManagement(): ReactNode {
  const [records, setRecords] = useState<DsrRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<DsrStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<DsrType | 'all'>('all');
  const [page, setPage] = useState(1);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DsrDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const PAGE_SIZE = 20;

  const load = useCallback(() => {
    setLoading(true);
    void dsrApi
      .list({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        type: typeFilter !== 'all' ? typeFilter : undefined,
        page,
        limit: PAGE_SIZE,
      })
      .then((r) => {
        setRecords(r.items);
        setTotal(r.total);
        setOverdueCount(r.overdue_count);
      })
      .catch(() => {
        // Mock fallback
        setRecords(MOCK_RECORDS);
        setTotal(MOCK_RECORDS.length);
        setOverdueCount(MOCK_RECORDS.filter((r) => isOverdue(r.deadlineAt, r.status)).length);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [statusFilter, typeFilter, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Load detail when selected
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    void dsrApi
      .get(selectedId)
      .then(setDetail)
      .catch(() => {
        const mock = MOCK_RECORDS.find((r) => r.id === selectedId) ?? null;
        setDetail(mock);
      })
      .finally(() => {
        setDetailLoading(false);
      });
  }, [selectedId]);

  const selectedRecord = records.find((r) => r.id === selectedId) ?? null;

  // Actions
  const handleApprove = useCallback(async (id: string) => {
    const updated = await dsrApi.approve(id).catch(() => null);
    if (updated) {
      setRecords((rs) => rs.map((r) => (r.id === id ? updated : r)));
      setDetail(updated);
    }
  }, []);

  const handleReject = useCallback(
    async (reason: string) => {
      if (rejectingId === null) return;
      const updated = await dsrApi.reject(rejectingId, reason).catch(() => null);
      if (updated) {
        setRecords((rs) => rs.map((r) => (r.id === rejectingId ? updated : r)));
        setDetail(updated);
      }
      setRejectingId(null);
    },
    [rejectingId],
  );

  const handleCancel = useCallback(async (id: string) => {
    const updated = await dsrApi.cancel(id).catch(() => null);
    if (updated) {
      setRecords((rs) => rs.map((r) => (r.id === id ? updated : r)));
      setDetail(updated);
    }
  }, []);

  const handleCreate = useCallback(
    async (customerId: string, type: DsrType, reason: string) => {
      const created = await dsrApi
        .create({ customerId, type, reason: reason || undefined })
        .catch(() => null);
      if (created) {
        setShowCreate(false);
        load();
      }
    },
    [load],
  );

  // Derived stats
  const pendingCount = records.filter((r) => r.status === 'pending').length;
  const completedCount = records.filter((r) => r.status === 'completed').length;

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div
        className={[
          'flex flex-col flex-1 space-y-6 min-w-0',
          selectedRecord !== null ? 'pr-0' : '',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-content-primary">Data Subject Requests</h1>
            <p className="mt-0.5 text-sm text-content-tertiary">
              GDPR Art. 12–20 — access, erasure, and portability requests.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setShowCreate(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="ml-1.5">New Request</span>
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15">
                <Clock className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Pending</p>
                <p className="text-xl font-bold text-content-primary">{pendingCount}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-lg',
                  overdueCount > 0 ? 'bg-red-500/15' : 'bg-surface-3',
                ].join(' ')}
              >
                <AlertTriangle
                  className={[
                    'h-4 w-4',
                    overdueCount > 0 ? 'text-red-400' : 'text-content-tertiary',
                  ].join(' ')}
                />
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Overdue</p>
                <p
                  className={[
                    'text-xl font-bold',
                    overdueCount > 0 ? 'text-red-400' : 'text-content-primary',
                  ].join(' ')}
                >
                  {overdueCount}
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
                <p className="text-xs text-content-tertiary">Completed</p>
                <p className="text-xl font-bold text-content-primary">{completedCount}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15">
                <ShieldCheck className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Total</p>
                <p className="text-xl font-bold text-content-primary">{total}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* GDPR deadline alert */}
        {overdueCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-400" />
            <p className="text-sm text-red-300">
              <span className="font-semibold">
                {overdueCount} request{overdueCount !== 1 ? 's are' : ' is'} overdue.
              </span>{' '}
              GDPR Art. 12 requires a response within 30 days. Take action immediately.
            </p>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Status filter */}
          <div className="flex items-center gap-1">
            {(
              [
                'all',
                'pending',
                'approved',
                'processing',
                'completed',
                'rejected',
                'cancelled',
              ] as const
            ).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                className={[
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  statusFilter === s
                    ? 'bg-brand-accent/15 text-brand-accent'
                    : 'bg-surface-2 text-content-tertiary hover:text-content-secondary',
                ].join(' ')}
              >
                {s === 'all' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-surface-3" />

          {/* Type filter */}
          <div className="flex items-center gap-1">
            {(['all', 'access', 'erasure', 'portability'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTypeFilter(t);
                  setPage(1);
                }}
                className={[
                  'flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  typeFilter === t
                    ? 'bg-brand-accent/15 text-brand-accent'
                    : 'bg-surface-2 text-content-tertiary hover:text-content-secondary',
                ].join(' ')}
              >
                {t !== 'all' && <span>{TYPE_ICONS[t]}</span>}
                {t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" label="Loading requests…" />
          </div>
        ) : (
          <Card>
            <Table
              columns={[
                {
                  key: 'type',
                  header: 'Type',
                  render: (row: DsrRecord) => (
                    <div className="flex items-center gap-1.5">
                      <span className="text-content-tertiary">{TYPE_ICONS[row.type]}</span>
                      <Badge variant={TYPE_BADGE[row.type].variant} size="sm">
                        {TYPE_BADGE[row.type].label}
                      </Badge>
                    </div>
                  ),
                },
                {
                  key: 'customer',
                  header: 'Customer ID',
                  render: (row: DsrRecord) => (
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-content-tertiary" />
                      <span className="font-mono text-xs text-content-secondary">
                        {row.customerId}
                      </span>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row: DsrRecord) => (
                    <Badge variant={STATUS_BADGE[row.status].variant} size="sm">
                      {STATUS_BADGE[row.status].label}
                    </Badge>
                  ),
                },
                {
                  key: 'deadline',
                  header: 'GDPR Deadline',
                  render: (row: DsrRecord) => {
                    const overdue = isOverdue(row.deadlineAt, row.status);
                    const days = daysUntilDeadline(row.deadlineAt);
                    return (
                      <div>
                        <p
                          className={
                            overdue
                              ? 'text-sm font-medium text-red-400'
                              : 'text-sm text-content-secondary'
                          }
                        >
                          {new Date(row.deadlineAt).toLocaleDateString()}
                        </p>
                        {overdue ? (
                          <p className="text-xs text-red-400">{String(Math.abs(days))}d overdue</p>
                        ) : (
                          <p
                            className={[
                              'text-xs',
                              days <= 3 ? 'text-amber-400' : 'text-content-tertiary',
                            ].join(' ')}
                          >
                            {days}d remaining
                          </p>
                        )}
                      </div>
                    );
                  },
                },
                {
                  key: 'created',
                  header: 'Created',
                  render: (row: DsrRecord) => (
                    <span className="text-sm text-content-tertiary">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  render: (row: DsrRecord) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(row.id);
                      }}
                      className={selectedId === row.id ? 'text-brand-accent' : ''}
                    >
                      View
                    </Button>
                  ),
                },
              ]}
              data={records}
              keyExtractor={(row) => row.id}
              onRowClick={(row) => {
                setSelectedId(row.id);
              }}
              emptyMessage="No data subject requests found."
            />
          </Card>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-content-tertiary">
              Showing {String((page - 1) * PAGE_SIZE + 1)}–
              {String(Math.min(page * PAGE_SIZE, total))} of {String(total)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => {
                  setPage((p) => p - 1);
                }}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * PAGE_SIZE >= total}
                onClick={() => {
                  setPage((p) => p + 1);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedRecord !== null && (
        <DetailPanel
          dsr={selectedRecord}
          detail={detail}
          detailLoading={detailLoading}
          onClose={() => {
            setSelectedId(null);
          }}
          onApprove={handleApprove}
          onRejectClick={(id) => {
            setRejectingId(id);
          }}
          onCancel={handleCancel}
        />
      )}

      {/* Modals */}
      {showCreate && (
        <CreateModal
          onClose={() => {
            setShowCreate(false);
          }}
          onCreate={handleCreate}
        />
      )}

      {rejectingId !== null && (
        <RejectModal
          dsrId={rejectingId}
          onClose={() => {
            setRejectingId(null);
          }}
          onReject={handleReject}
        />
      )}
    </div>
  );
}
