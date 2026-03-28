/**
 * SchedulerMonitor — Scheduled job instance viewer and dead-letter queue.
 *
 * Shows active/historical job instances and the dead-letter queue for
 * failed jobs that exceeded retry limits.
 *
 * SOC2 CC7.2 — Operational visibility into job pipeline.
 * ISO 27001 A.12.4.1 — Job state transitions logged in audit chain.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { Tabs } from '../components/ui/Tabs';
import { PageHeader } from '../components/layout/PageHeader';
import { AlertCircle, Activity, Clock, CheckCircle2, XCircle, Loader2 } from '../components/icons';
import {
  schedulerApi,
  type SchedulerInstance,
  type DeadLetterEntry,
  type JobStatus,
} from '../lib/scheduler-api';

// ── Types ─────────────────────────────────────────────────────────

type BadgeVariant = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

const statusBadge: Record<JobStatus, BadgeVariant> = {
  pending: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  dead_letter: 'danger',
};

const statusIcon: Partial<Record<JobStatus, ReactNode>> = {
  running: <Loader2 className="h-3 w-3 animate-spin" />,
  completed: <CheckCircle2 className="h-3 w-3" />,
  failed: <XCircle className="h-3 w-3" />,
  pending: <Clock className="h-3 w-3" />,
};

function JobStatusBadge({ status }: { status: JobStatus }): ReactNode {
  return (
    <Badge variant={statusBadge[status]} size="sm">
      <span className="flex items-center gap-1">
        {statusIcon[status]}
        {status.replace('_', ' ')}
      </span>
    </Badge>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// ── Instance Table ────────────────────────────────────────────────

interface InstanceTableProps {
  instances: SchedulerInstance[];
  loading: boolean;
  error: string | null;
}

function InstanceTable({ instances, loading, error }: InstanceTableProps): ReactNode {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" label="Loading jobs" />
      </div>
    );
  }
  if (error !== null) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-danger">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    );
  }
  if (instances.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="h-8 w-8" />}
        title="No jobs found"
        description="No scheduled job instances match your filter."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-3 px-4 text-left font-medium text-content-secondary">ID</th>
            <th className="py-3 px-4 text-left font-medium text-content-secondary">Job Type</th>
            <th className="py-3 px-4 text-left font-medium text-content-secondary">Status</th>
            <th className="py-3 px-4 text-left font-medium text-content-secondary">Attempts</th>
            <th className="py-3 px-4 text-left font-medium text-content-secondary">Scheduled</th>
            <th className="py-3 px-4 text-left font-medium text-content-secondary">Completed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {instances.map((job) => (
            <tr key={job.id} className="hover:bg-surface-secondary transition-colors">
              <td className="py-3 px-4 font-mono text-xs text-content-tertiary">
                {job.id.slice(0, 8)}…
              </td>
              <td className="py-3 px-4 text-content">{job.jobType}</td>
              <td className="py-3 px-4">
                <JobStatusBadge status={job.status} />
              </td>
              <td className="py-3 px-4 text-content-secondary">
                {job.attempts} / {job.maxAttempts}
              </td>
              <td className="py-3 px-4 text-content-secondary">{relativeTime(job.scheduledAt)}</td>
              <td className="py-3 px-4 text-content-secondary">
                {job.completedAt !== undefined ? relativeTime(job.completedAt) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Dead-Letter Table ─────────────────────────────────────────────

interface DeadLetterTableProps {
  entries: DeadLetterEntry[];
  loading: boolean;
  error: string | null;
}

function DeadLetterTable({ entries, loading, error }: DeadLetterTableProps): ReactNode {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" label="Loading dead-letter queue" />
      </div>
    );
  }
  if (error !== null) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-danger">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-8 w-8" />}
        title="Dead-letter queue empty"
        description="No jobs have exceeded their retry limits."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-3 px-4 text-left font-medium text-content-secondary">ID</th>
            <th className="py-3 px-4 text-left font-medium text-content-secondary">Job Type</th>
            <th className="py-3 px-4 text-left font-medium text-content-secondary">Attempts</th>
            <th className="py-3 px-4 text-left font-medium text-content-secondary">
              Dead-lettered
            </th>
            <th className="py-3 px-4 text-left font-medium text-content-secondary">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((entry) => (
            <tr key={entry.id} className="hover:bg-surface-secondary transition-colors">
              <td className="py-3 px-4 font-mono text-xs text-content-tertiary">
                {entry.id.slice(0, 8)}…
              </td>
              <td className="py-3 px-4 text-content">{entry.jobType}</td>
              <td className="py-3 px-4 text-content-secondary">{entry.attempts}</td>
              <td className="py-3 px-4 text-content-secondary">
                {relativeTime(entry.deadLetteredAt)}
              </td>
              <td className="py-3 px-4 text-sm text-danger max-w-xs truncate" title={entry.error}>
                {entry.error}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export function SchedulerMonitor(): ReactNode {
  const [activeTab, setActiveTab] = useState('instances');
  const [instances, setInstances] = useState<SchedulerInstance[]>([]);
  const [deadLetter, setDeadLetter] = useState<DeadLetterEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [dlLoading, setDlLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  const loadInstances = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await schedulerApi.listInstances(
        statusFilter !== 'all' ? { status: statusFilter as JobStatus, limit: 100 } : { limit: 100 },
      );
      setInstances(data);
    } catch {
      setError('Failed to load scheduler instances');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const loadDeadLetter = useCallback(async () => {
    setDlLoading(true);
    setDlError(null);
    try {
      const data = await schedulerApi.listDeadLetter();
      setDeadLetter(data);
    } catch {
      setDlError('Failed to load dead-letter queue');
    } finally {
      setDlLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInstances();
  }, [loadInstances]);

  useEffect(() => {
    void loadDeadLetter();
  }, [loadDeadLetter]);

  const kpis = {
    running: instances.filter((i) => i.status === 'running').length,
    pending: instances.filter((i) => i.status === 'pending').length,
    failed: instances.filter((i) => i.status === 'failed').length,
    deadLetter: deadLetter.length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scheduler Monitor"
        subtitle="Inspect scheduled job instances and the dead-letter queue"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadInstances();
              void loadDeadLetter();
            }}
          >
            <Activity className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Running', value: kpis.running, variant: 'info' as BadgeVariant },
          { label: 'Pending', value: kpis.pending, variant: 'neutral' as BadgeVariant },
          { label: 'Failed', value: kpis.failed, variant: 'danger' as BadgeVariant },
          { label: 'Dead Letter', value: kpis.deadLetter, variant: 'danger' as BadgeVariant },
        ].map(({ label, value, variant }) => (
          <Card key={label} className="p-4">
            <p className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {label}
            </p>
            <p className="mt-1 text-2xl font-semibold text-content">{value}</p>
            <Badge variant={variant} size="sm" className="mt-2">
              {label}
            </Badge>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'instances', label: `Job Instances (${instances.length})` },
          { id: 'dead-letter', label: `Dead Letter (${deadLetter.length})` },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'instances' && (
        <Card>
          <div className="p-4 border-b border-border">
            <Select
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
              }}
              options={STATUS_FILTERS}
              className="w-44"
            />
          </div>
          <InstanceTable instances={instances} loading={loading} error={error} />
        </Card>
      )}

      {activeTab === 'dead-letter' && (
        <Card>
          <DeadLetterTable entries={deadLetter} loading={dlLoading} error={dlError} />
        </Card>
      )}
    </div>
  );
}
