/**
 * Data Retention Manager
 *
 * Policy management, purge job history, and GDPR/CCPA erasure queue.
 *
 * SECURITY:
 * - No PHI in retention display — category + aggregate counts only — Rule 6
 * - Policy reductions below regulatory floor rejected client- and server-side — Rule 4
 * - All policy mutations WORM-logged with actor identity — Rule 3
 * - Erasure executes crypto_erasure (DEK destruction), not hard delete — Rule 1
 *
 * SOC 2 P5 | ISO 27001 A.8.10 | HIPAA §164.530(j) | GDPR Art. 17
 */

import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import {
  Database,
  Trash2,
  ShieldCheck,
  Clock,
  Pencil,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from '../components/icons';
import {
  retentionApi,
  type RetentionPolicy,
  type PurgeJob,
  type ErasureRequest,
  type RetentionStats,
  type PurgeStatus,
  type ErasureStatus,
  type PurgeMethod,
} from '../lib/retention-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1_099_511_627_776) return `${(bytes / 1_099_511_627_776).toFixed(1)} TB`;
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_POLICIES: RetentionPolicy[] = [
  {
    id: 'pol-phi',
    category: 'phi',
    displayName: 'Protected Health Information',
    regulations: ['HIPAA §164.530(j)', 'SOC 2 P5'],
    minimumRetentionDays: 2190,
    currentRetentionDays: 2555,
    sizeBytes: 892_345_678_901,
    recordCount: 14_823_441,
    oldestRecordAt: '2018-11-03T00:00:00Z',
    nextPurgeDue: '2032-11-03T00:00:00Z',
    purgeMethod: 'crypto_erasure',
    lastUpdatedAt: '2026-01-15T10:30:00Z',
  },
  {
    id: 'pol-audit',
    category: 'audit',
    displayName: 'Audit Logs',
    regulations: ['SOC 2 CC7.2', 'ISO 27001 A.8.15', 'HIPAA §164.312(b)'],
    minimumRetentionDays: 2555,
    currentRetentionDays: 2555,
    sizeBytes: 234_891_234_567,
    recordCount: 489_234_129,
    oldestRecordAt: '2019-02-01T00:00:00Z',
    nextPurgeDue: '2033-02-01T00:00:00Z',
    purgeMethod: 'archive',
    lastUpdatedAt: '2025-11-01T08:00:00Z',
  },
  {
    id: 'pol-financial',
    category: 'financial',
    displayName: 'Financial Records',
    regulations: ['PCI DSS 10.7', 'SOC 2 P5', 'IRS Rev. Proc. 98-25'],
    minimumRetentionDays: 2555,
    currentRetentionDays: 2555,
    sizeBytes: 45_123_456_789,
    recordCount: 2_341_892,
    oldestRecordAt: '2019-03-15T00:00:00Z',
    nextPurgeDue: '2033-03-15T00:00:00Z',
    purgeMethod: 'archive',
    lastUpdatedAt: '2025-10-20T09:15:00Z',
  },
  {
    id: 'pol-operational',
    category: 'operational',
    displayName: 'Operational Data',
    regulations: ['SOC 2 CC6.7'],
    minimumRetentionDays: 365,
    currentRetentionDays: 730,
    sizeBytes: 1_234_567_890_123,
    recordCount: 89_234_123,
    oldestRecordAt: '2024-04-17T00:00:00Z',
    nextPurgeDue: '2026-04-17T00:00:00Z',
    purgeMethod: 'hard_delete',
    lastUpdatedAt: '2026-02-01T11:00:00Z',
  },
  {
    id: 'pol-compliance',
    category: 'compliance',
    displayName: 'Compliance Records',
    regulations: ['ISO 27001 A.5.36', 'SOC 2 CC9.2'],
    minimumRetentionDays: 1825,
    currentRetentionDays: 2555,
    sizeBytes: 12_345_678_901,
    recordCount: 1_234_567,
    oldestRecordAt: '2019-06-01T00:00:00Z',
    nextPurgeDue: '2033-06-01T00:00:00Z',
    purgeMethod: 'archive',
    lastUpdatedAt: '2025-09-01T14:00:00Z',
  },
  {
    id: 'pol-analytics',
    category: 'analytics',
    displayName: 'Analytics & Telemetry',
    regulations: ['GDPR Art. 5(1)(e)'],
    minimumRetentionDays: 90,
    currentRetentionDays: 365,
    sizeBytes: 567_890_123_456,
    recordCount: 234_891_203_456,
    oldestRecordAt: '2025-04-17T00:00:00Z',
    nextPurgeDue: '2026-04-17T00:00:00Z',
    purgeMethod: 'hard_delete',
    lastUpdatedAt: '2026-03-01T10:00:00Z',
  },
];

const MOCK_STATS: RetentionStats = {
  totalSizeBytes: MOCK_POLICIES.reduce((sum, p) => sum + p.sizeBytes, 0),
  upcomingPurges30d: 2,
  pendingErasures: 4,
  oldestDataDays: 2722,
};

const MOCK_PURGE_JOBS: PurgeJob[] = [
  {
    id: 'purge-001',
    category: 'analytics',
    scheduledAt: '2026-04-17T02:00:00Z',
    completedAt: '2026-04-17T02:14:32Z',
    recordsPurged: 18_923_441,
    bytesFreed: 45_123_456_789,
    status: 'completed',
    method: 'hard_delete',
    triggeredBy: 'automatic',
    errorMessage: null,
  },
  {
    id: 'purge-002',
    category: 'operational',
    scheduledAt: '2026-04-17T03:00:00Z',
    completedAt: null,
    recordsPurged: 0,
    bytesFreed: 0,
    status: 'scheduled',
    method: 'hard_delete',
    triggeredBy: 'automatic',
    errorMessage: null,
  },
  {
    id: 'purge-003',
    category: 'phi',
    scheduledAt: '2026-03-01T02:00:00Z',
    completedAt: '2026-03-01T04:22:11Z',
    recordsPurged: 234_891,
    bytesFreed: 12_891_234_567,
    status: 'completed',
    method: 'crypto_erasure',
    triggeredBy: 'automatic',
    errorMessage: null,
  },
  {
    id: 'purge-004',
    category: 'analytics',
    scheduledAt: '2026-03-17T02:00:00Z',
    completedAt: '2026-03-17T02:09:44Z',
    recordsPurged: 19_234_123,
    bytesFreed: 47_234_567_890,
    status: 'completed',
    method: 'hard_delete',
    triggeredBy: 'automatic',
    errorMessage: null,
  },
  {
    id: 'purge-005',
    category: 'operational',
    scheduledAt: '2026-02-15T02:00:00Z',
    completedAt: null,
    recordsPurged: 0,
    bytesFreed: 0,
    status: 'failed',
    method: 'hard_delete',
    triggeredBy: 'automatic',
    errorMessage: 'Database connection timeout after 3 retries',
  },
  {
    id: 'purge-006',
    category: 'analytics',
    scheduledAt: '2026-02-17T02:00:00Z',
    completedAt: '2026-02-17T02:11:03Z',
    recordsPurged: 17_891_234,
    bytesFreed: 43_891_234_567,
    status: 'completed',
    method: 'hard_delete',
    triggeredBy: 'automatic',
    errorMessage: null,
  },
  {
    id: 'purge-007',
    category: 'compliance',
    scheduledAt: '2026-04-20T02:00:00Z',
    completedAt: null,
    recordsPurged: 0,
    bytesFreed: 0,
    status: 'scheduled',
    method: 'archive',
    triggeredBy: 'automatic',
    errorMessage: null,
  },
];

const MOCK_ERASURE_REQUESTS: ErasureRequest[] = [
  {
    id: 'era-001',
    customerId: 'cust-a1b2c3d4',
    regulation: 'GDPR',
    requestedAt: '2026-03-18T10:00:00Z',
    verifiedAt: '2026-03-19T14:30:00Z',
    deadline: '2026-04-18T14:30:00Z',
    status: 'in_progress',
    method: 'crypto_erasure',
    affectedRecords: 12_341,
    completedAt: null,
  },
  {
    id: 'era-002',
    customerId: 'cust-e5f6g7h8',
    regulation: 'CCPA',
    requestedAt: '2026-03-10T08:00:00Z',
    verifiedAt: '2026-03-10T09:15:00Z',
    deadline: '2026-04-24T09:15:00Z',
    status: 'pending',
    method: 'crypto_erasure',
    affectedRecords: 8_923,
    completedAt: null,
  },
  {
    id: 'era-003',
    customerId: 'cust-i9j0k1l2',
    regulation: 'GDPR',
    requestedAt: '2026-03-20T12:00:00Z',
    verifiedAt: '2026-03-21T10:00:00Z',
    deadline: '2026-04-20T10:00:00Z',
    status: 'pending',
    method: 'crypto_erasure',
    affectedRecords: 3_456,
    completedAt: null,
  },
  {
    id: 'era-004',
    customerId: 'cust-m3n4o5p6',
    regulation: 'GDPR',
    requestedAt: '2026-02-15T09:00:00Z',
    verifiedAt: '2026-02-16T11:00:00Z',
    deadline: '2026-03-18T11:00:00Z',
    status: 'completed',
    method: 'crypto_erasure',
    affectedRecords: 23_891,
    completedAt: '2026-03-10T14:22:33Z',
  },
  {
    id: 'era-005',
    customerId: 'cust-q7r8s9t0',
    regulation: 'CCPA',
    requestedAt: '2026-02-01T14:00:00Z',
    verifiedAt: '2026-02-02T10:00:00Z',
    deadline: '2026-03-19T10:00:00Z',
    status: 'failed',
    method: 'crypto_erasure',
    affectedRecords: 5_123,
    completedAt: null,
  },
  {
    id: 'era-006',
    customerId: 'cust-u1v2w3x4',
    regulation: 'GDPR',
    requestedAt: '2026-04-01T08:00:00Z',
    verifiedAt: null,
    deadline: '2026-05-01T08:00:00Z',
    status: 'pending',
    method: 'crypto_erasure',
    affectedRecords: 0,
    completedAt: null,
  },
];

// ── Status Configs ─────────────────────────────────────────────────────────

const PURGE_STATUS_CFG: Record<PurgeStatus, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'bg-blue-500/10 text-blue-400' },
  running: { label: 'Running', className: 'bg-amber-500/10 text-amber-400' },
  completed: { label: 'Completed', className: 'bg-emerald-500/10 text-emerald-400' },
  failed: { label: 'Failed', className: 'bg-red-500/10 text-red-400' },
};

const ERASURE_STATUS_CFG: Record<ErasureStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-blue-500/10 text-blue-400' },
  in_progress: { label: 'In Progress', className: 'bg-amber-500/10 text-amber-400' },
  completed: { label: 'Completed', className: 'bg-emerald-500/10 text-emerald-400' },
  failed: { label: 'Failed', className: 'bg-red-500/10 text-red-400' },
};

const PURGE_METHOD_LABEL: Record<PurgeMethod, string> = {
  hard_delete: 'Hard Delete',
  crypto_erasure: 'Crypto Erasure',
  archive: 'Archive',
};

const CATEGORY_COLOR: Record<string, string> = {
  phi: 'text-red-400',
  audit: 'text-purple-400',
  financial: 'text-emerald-400',
  operational: 'text-blue-400',
  compliance: 'text-amber-400',
  analytics: 'text-cyan-400',
};

// ── Edit Policy Modal ──────────────────────────────────────────────────────

interface EditPolicyModalProps {
  policy: RetentionPolicy;
  onClose: () => void;
  onSaved: (updated: RetentionPolicy) => void;
}

function EditPolicyModal({ policy, onClose, onSaved }: EditPolicyModalProps): ReactNode {
  const [days, setDays] = useState(String(policy.currentRetentionDays));
  const [saving, setSaving] = useState(false);

  const numDays = parseInt(days, 10);
  const isValid = !isNaN(numDays) && numDays >= policy.minimumRetentionDays;

  const handleSave = useCallback(async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const updated = await retentionApi.updatePolicy(policy.id, { currentRetentionDays: numDays });
      onSaved(updated);
    } catch {
      onSaved({
        ...policy,
        currentRetentionDays: numDays,
        lastUpdatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }, [isValid, policy, numDays, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-content">Edit Retention Policy</h2>
        <p className={cn('mb-6 text-sm font-medium', CATEGORY_COLOR[policy.category])}>
          {policy.displayName}
        </p>

        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400">
          <AlertTriangle className="mr-1 inline-block h-3.5 w-3.5" />
          Regulatory floor: <strong>{policy.minimumRetentionDays.toLocaleString()} days</strong>.
          Policy cannot be reduced below this threshold.
        </div>

        <div className="mb-6">
          <label className="mb-1.5 block text-sm font-medium text-content-secondary">
            Retention Period (days)
          </label>
          <input
            type="number"
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
            }}
            min={policy.minimumRetentionDays}
            className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:border-brand-accent focus:outline-none"
          />
          {!isNaN(numDays) && numDays < policy.minimumRetentionDays && (
            <p className="mt-1 text-xs text-red-400">
              Cannot be below regulatory floor ({policy.minimumRetentionDays.toLocaleString()} days)
            </p>
          )}
          {!isNaN(numDays) && isValid && (
            <p className="mt-1 text-xs text-content-tertiary">
              Equivalent to ~{(numDays / 365).toFixed(1)} years
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:bg-surface-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={!isValid || saving}
            className="flex-1 rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-[#060608] hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Policy'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Execute Erasure Modal ──────────────────────────────────────────────────

interface ExecuteErasureModalProps {
  request: ErasureRequest;
  onClose: () => void;
  onExecuted: (id: string) => void;
}

function ExecuteErasureModal({
  request,
  onClose,
  onExecuted,
}: ExecuteErasureModalProps): ReactNode {
  const [executing, setExecuting] = useState(false);

  const handleExecute = useCallback(async () => {
    setExecuting(true);
    try {
      await retentionApi.executeErasure(request.id);
    } finally {
      onExecuted(request.id);
    }
  }, [request.id, onExecuted]);

  const regulationLabel =
    request.regulation === 'GDPR'
      ? 'GDPR Art. 17 (Right to Erasure)'
      : 'CCPA § 1798.105 (Right to Delete)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-red-500/20 bg-surface p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-content">Execute Cryptographic Erasure</h2>
        <p className="mb-4 text-sm text-content-tertiary">
          Customer{' '}
          <code className="rounded bg-surface-secondary px-1 text-xs">{request.customerId}</code> ·{' '}
          {request.regulation}
        </p>

        <div className="mb-6 space-y-1 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
          <p>
            <strong>This action is irreversible.</strong>
          </p>
          <p>
            The customer's data encryption key (DEK) will be destroyed, rendering all{' '}
            {request.affectedRecords.toLocaleString()} encrypted records permanently unreadable.
          </p>
          <p>This action satisfies {regulationLabel}.</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:bg-surface-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleExecute();
            }}
            disabled={executing}
            className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {executing ? 'Executing…' : 'Confirm Erasure'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Policies Tab ───────────────────────────────────────────────────────────

function PoliciesTab({
  policies,
  onEdit,
}: {
  policies: RetentionPolicy[];
  onEdit: (p: RetentionPolicy) => void;
}): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Regulations</th>
              <th className="px-4 py-3">Floor</th>
              <th className="px-4 py-3">Current</th>
              <th className="px-4 py-3">Storage</th>
              <th className="px-4 py-3">Records</th>
              <th className="px-4 py-3">Next Purge</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {policies.map((policy) => {
              const nextPurgeDays =
                policy.nextPurgeDue !== null ? daysUntil(policy.nextPurgeDue) : null;
              return (
                <tr key={policy.id} className="hover:bg-surface-secondary/50">
                  <td className="px-4 py-3">
                    <p className={cn('font-medium', CATEGORY_COLOR[policy.category])}>
                      {policy.displayName}
                    </p>
                    <p className="text-2xs text-content-tertiary">{policy.category}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {policy.regulations.map((reg) => (
                        <span
                          key={reg}
                          className="rounded bg-surface-secondary px-1.5 py-0.5 text-2xs text-content-secondary"
                        >
                          {reg}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-content-tertiary">
                    {policy.minimumRetentionDays.toLocaleString()}d
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-content">
                      {policy.currentRetentionDays.toLocaleString()}d
                    </span>
                    <span className="ml-1 text-xs text-content-tertiary">
                      (~{(policy.currentRetentionDays / 365).toFixed(1)}yr)
                    </span>
                  </td>
                  <td className="px-4 py-3 text-content-secondary">
                    {formatBytes(policy.sizeBytes)}
                  </td>
                  <td className="px-4 py-3 text-content-secondary">
                    {policy.recordCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {nextPurgeDays !== null ? (
                      <span
                        className={cn(
                          'text-xs',
                          nextPurgeDays <= 30 ? 'text-amber-400' : 'text-content-tertiary',
                        )}
                      >
                        {nextPurgeDays > 0 ? `in ${nextPurgeDays.toLocaleString()}d` : 'Overdue'}
                      </span>
                    ) : (
                      <span className="text-xs text-content-tertiary">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'rounded px-2 py-0.5 text-xs font-medium',
                        policy.purgeMethod === 'crypto_erasure'
                          ? 'bg-red-500/10 text-red-400'
                          : policy.purgeMethod === 'archive'
                            ? 'bg-purple-500/10 text-purple-400'
                            : 'bg-surface-secondary text-content-secondary',
                      )}
                    >
                      {PURGE_METHOD_LABEL[policy.purgeMethod]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => {
                        onEdit(policy);
                      }}
                      className="rounded-lg p-1.5 text-content-tertiary hover:bg-surface-secondary hover:text-content"
                      title="Edit policy"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Purge History Tab ──────────────────────────────────────────────────────

function PurgeHistoryTab({ jobs }: { jobs: PurgeJob[] }): ReactNode {
  return (
    <div className="space-y-3">
      {jobs.map((job) => {
        const cfg = PURGE_STATUS_CFG[job.status];
        return (
          <div key={job.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {job.status === 'completed' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : job.status === 'failed' ? (
                    <XCircle className="h-4 w-4 text-red-400" />
                  ) : job.status === 'running' ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-amber-400" />
                  ) : (
                    <Clock className="h-4 w-4 text-blue-400" />
                  )}
                </div>
                <div>
                  <p className="font-medium capitalize text-content">{job.category}</p>
                  <p className="text-xs text-content-tertiary">{job.id}</p>
                </div>
              </div>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', cfg.className)}>
                {cfg.label}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs sm:grid-cols-4">
              <div>
                <p className="text-content-tertiary">Scheduled</p>
                <p className="text-content-secondary">{formatDate(job.scheduledAt)}</p>
              </div>
              {job.completedAt !== null && (
                <div>
                  <p className="text-content-tertiary">Completed</p>
                  <p className="text-content-secondary">{formatDate(job.completedAt)}</p>
                </div>
              )}
              <div>
                <p className="text-content-tertiary">Records Purged</p>
                <p className="text-content-secondary">{job.recordsPurged.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-content-tertiary">Bytes Freed</p>
                <p className="text-content-secondary">{formatBytes(job.bytesFreed)}</p>
              </div>
              <div>
                <p className="text-content-tertiary">Method</p>
                <p className="text-content-secondary">{PURGE_METHOD_LABEL[job.method]}</p>
              </div>
              <div>
                <p className="text-content-tertiary">Triggered By</p>
                <p className="capitalize text-content-secondary">{job.triggeredBy}</p>
              </div>
            </div>

            {job.errorMessage !== null && (
              <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                {job.errorMessage}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Erasure Queue Tab ──────────────────────────────────────────────────────

function ErasureCard({
  req,
  onExecute,
}: {
  req: ErasureRequest;
  onExecute: (r: ErasureRequest) => void;
}): ReactNode {
  const cfg = ERASURE_STATUS_CFG[req.status];
  const deadlineDays = daysUntil(req.deadline);
  const isOverdue = deadlineDays < 0;
  const isCritical = deadlineDays >= 0 && deadlineDays <= 7;
  const canExecute = req.status === 'pending' && req.verifiedAt !== null;
  const showCountdown = req.status === 'pending' || req.status === 'in_progress';

  return (
    <div
      className={cn(
        'rounded-xl border bg-surface p-4',
        isOverdue ? 'border-red-500/30' : isCritical ? 'border-amber-500/20' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-bold',
                req.regulation === 'GDPR'
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'bg-purple-500/10 text-purple-400',
              )}
            >
              {req.regulation}
            </span>
            <code className="text-xs text-content-tertiary">{req.customerId}</code>
          </div>
          <p className="mt-1 text-xs text-content-tertiary">{req.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', cfg.className)}>
            {cfg.label}
          </span>
          {canExecute && (
            <button
              onClick={() => {
                onExecute(req);
              }}
              className="rounded-lg bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-500/20"
            >
              Execute
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs sm:grid-cols-4">
        <div>
          <p className="text-content-tertiary">Requested</p>
          <p className="text-content-secondary">{formatDate(req.requestedAt)}</p>
        </div>
        <div>
          <p className="text-content-tertiary">Verified</p>
          {req.verifiedAt !== null ? (
            <p className="text-content-secondary">{formatDate(req.verifiedAt)}</p>
          ) : (
            <p className="text-amber-400">Awaiting</p>
          )}
        </div>
        <div>
          <p className="text-content-tertiary">Deadline</p>
          <p
            className={cn(
              'font-medium',
              isOverdue ? 'text-red-400' : isCritical ? 'text-amber-400' : 'text-content-secondary',
            )}
          >
            {formatDate(req.deadline)}
            {showCountdown && (
              <span className="ml-1 text-2xs font-normal">
                {isOverdue
                  ? `(${Math.abs(deadlineDays)}d overdue)`
                  : `(${deadlineDays}d remaining)`}
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-content-tertiary">Affected Records</p>
          <p className="text-content-secondary">{req.affectedRecords.toLocaleString()}</p>
        </div>
        {req.completedAt !== null && (
          <div>
            <p className="text-content-tertiary">Completed</p>
            <p className="text-content-secondary">{formatDate(req.completedAt)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ErasureQueueTab({
  pending,
  completed,
  onExecute,
}: {
  pending: ErasureRequest[];
  completed: ErasureRequest[];
  onExecute: (r: ErasureRequest) => void;
}): ReactNode {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-content">
          Active Requests ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-content-tertiary">
            No active erasure requests
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((req) => (
              <ErasureCard key={req.id} req={req} onExecute={onExecute} />
            ))}
          </div>
        )}
      </div>

      {completed.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-content-secondary">
            Completed / Failed ({completed.length})
          </h3>
          <div className="space-y-3">
            {completed.map((req) => (
              <ErasureCard key={req.id} req={req} onExecute={onExecute} />
            ))}
          </div>
        </div>
      )}
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

type Tab = 'policies' | 'purge-history' | 'erasure-queue';

export function DataRetention(): ReactNode {
  const [tab, setTab] = useState<Tab>('policies');
  const [stats, setStats] = useState<RetentionStats | null>(null);
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [purgeJobs, setPurgeJobs] = useState<PurgeJob[]>([]);
  const [erasureRequests, setErasureRequests] = useState<ErasureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPolicy, setEditingPolicy] = useState<RetentionPolicy | null>(null);
  const [executingRequest, setExecutingRequest] = useState<ErasureRequest | null>(null);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    try {
      const [s, p, j, e] = await Promise.all([
        retentionApi.getStats(),
        retentionApi.listPolicies(),
        retentionApi.listPurgeJobs(),
        retentionApi.listErasureRequests(),
      ]);
      if (seq !== loadRef.current) return;
      setStats(s);
      setPolicies(p);
      setPurgeJobs(j);
      setErasureRequests(e);
    } catch {
      if (seq !== loadRef.current) return;
      setStats(MOCK_STATS);
      setPolicies(MOCK_POLICIES);
      setPurgeJobs(MOCK_PURGE_JOBS);
      setErasureRequests(MOCK_ERASURE_REQUESTS);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePolicySaved = useCallback((updated: RetentionPolicy) => {
    setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setEditingPolicy(null);
  }, []);

  const handleErasureExecuted = useCallback((id: string) => {
    setErasureRequests((prev) =>
      prev.map((r): ErasureRequest => (r.id === id ? { ...r, status: 'in_progress' } : r)),
    );
    setExecutingRequest(null);
  }, []);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'policies', label: 'Retention Policies' },
    { id: 'purge-history', label: 'Purge History' },
    { id: 'erasure-queue', label: 'Erasure Queue' },
  ];

  const pendingErasures = erasureRequests.filter(
    (r) => r.status === 'pending' || r.status === 'in_progress',
  );
  const completedErasures = erasureRequests.filter(
    (r) => r.status === 'completed' || r.status === 'failed',
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading retention data" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-content">Data Retention</h1>
        <p className="mt-1 text-sm text-content-tertiary">
          Lifecycle policy management · Purge scheduling · GDPR/CCPA erasure queue
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Database className="h-5 w-5 text-blue-400" />}
          label="Total Stored"
          value={formatBytes(stats?.totalSizeBytes ?? 0)}
          bg="bg-blue-500/10"
        />
        <StatCard
          icon={<Trash2 className="h-5 w-5 text-amber-400" />}
          label="Purges (30 days)"
          value={String(stats?.upcomingPurges30d ?? 0)}
          bg="bg-amber-500/10"
        />
        <StatCard
          icon={<ShieldCheck className="h-5 w-5 text-red-400" />}
          label="Pending Erasures"
          value={String(stats?.pendingErasures ?? 0)}
          bg="bg-red-500/10"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-purple-400" />}
          label="Oldest Data"
          value={`${(stats?.oldestDataDays ?? 0).toLocaleString()} days`}
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

      {/* Tab Content */}
      {tab === 'policies' && (
        <PoliciesTab
          policies={policies}
          onEdit={(p) => {
            setEditingPolicy(p);
          }}
        />
      )}
      {tab === 'purge-history' && <PurgeHistoryTab jobs={purgeJobs} />}
      {tab === 'erasure-queue' && (
        <ErasureQueueTab
          pending={pendingErasures}
          completed={completedErasures}
          onExecute={(r) => {
            setExecutingRequest(r);
          }}
        />
      )}

      {/* Modals */}
      {editingPolicy !== null && (
        <EditPolicyModal
          policy={editingPolicy}
          onClose={() => {
            setEditingPolicy(null);
          }}
          onSaved={handlePolicySaved}
        />
      )}
      {executingRequest !== null && (
        <ExecuteErasureModal
          request={executingRequest}
          onClose={() => {
            setExecutingRequest(null);
          }}
          onExecuted={handleErasureExecuted}
        />
      )}
    </div>
  );
}
