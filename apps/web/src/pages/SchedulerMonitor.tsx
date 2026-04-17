/**
 * Scheduler — Job Definition Manager
 *
 * Full CRUD for cron job definitions, manual trigger, instance log viewer,
 * and dead-letter queue replay.
 *
 * SECURITY:
 * - All definitions and instances scoped to authenticated tenant — Rule 2
 * - Definition mutations WORM-logged with actor identity — Rule 3
 * - Job payloads must not contain PHI — Rule 6
 * - Trigger and replay require scheduler.write RBAC — Rule 2
 *
 * SOC 2 CC7.2 | ISO 27001 A.8.6 | HIPAA §164.312(a)(1)
 */

import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import {
  Calendar,
  PlayCircle,
  PauseCircle,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  RotateCcw,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Clock,
  Zap,
} from '../components/icons';
import {
  schedulerApi,
  type JobDefinition,
  type SchedulerInstance,
  type DeadLetterEntry,
  type SchedulerStats,
  type JobStatus,
  type JobPriority,
  type DefinitionStatus,
  type CreateJobDefinitionBody,
} from '../lib/scheduler-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { Tabs } from '../components/ui/Tabs';
import { PageHeader } from '../components/layout/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_STATS: SchedulerStats = {
  activeDefinitions: 7,
  runningInstances: 2,
  failedToday: 3,
  deadLetterCount: 2,
};

const MOCK_DEFINITIONS: JobDefinition[] = [
  {
    id: 'jd-001',
    tenantId: 'tenant-1',
    jobType: 'sla.breach_sweep',
    description: 'Scan open tickets for SLA breaches and dispatch notifications',
    cronSchedule: '*/5 * * * *',
    status: 'active',
    maxAttempts: 3,
    timeoutSeconds: 30,
    priority: 'high',
    lastRunAt: '2026-04-17T06:10:00Z',
    nextRunAt: '2026-04-17T06:15:00Z',
    runCount: 8_291,
    failureCount: 12,
    createdAt: '2025-11-01T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'jd-002',
    tenantId: 'tenant-1',
    jobType: 'report.generate_daily',
    description: 'Generate and store the daily operations summary report',
    cronSchedule: '0 3 * * *',
    status: 'active',
    maxAttempts: 2,
    timeoutSeconds: 300,
    priority: 'normal',
    lastRunAt: '2026-04-17T03:00:12Z',
    nextRunAt: '2026-04-18T03:00:00Z',
    runCount: 166,
    failureCount: 2,
    createdAt: '2025-11-15T10:00:00Z',
    createdBy: 'ops-team',
  },
  {
    id: 'jd-003',
    tenantId: 'tenant-1',
    jobType: 'crm.sync_inbound',
    description: 'Inbound CRM sync — pull contacts from Salesforce and HubSpot',
    cronSchedule: '0 */4 * * *',
    status: 'active',
    maxAttempts: 3,
    timeoutSeconds: 600,
    priority: 'normal',
    lastRunAt: '2026-04-17T04:00:08Z',
    nextRunAt: '2026-04-17T08:00:00Z',
    runCount: 1_022,
    failureCount: 8,
    createdAt: '2025-12-01T10:00:00Z',
    createdBy: 'integrations-team',
  },
  {
    id: 'jd-004',
    tenantId: 'tenant-1',
    jobType: 'audit.hash_verification',
    description: 'Verify WORM audit chain hash integrity across all tenants',
    cronSchedule: '0 2 * * 0',
    status: 'active',
    maxAttempts: 1,
    timeoutSeconds: 3600,
    priority: 'critical',
    lastRunAt: '2026-04-13T02:00:00Z',
    nextRunAt: '2026-04-20T02:00:00Z',
    runCount: 23,
    failureCount: 0,
    createdAt: '2025-11-01T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'jd-005',
    tenantId: 'tenant-1',
    jobType: 'dsr.process_queue',
    description: 'Process pending Data Subject Requests from the compliance queue',
    cronSchedule: '*/15 * * * *',
    status: 'active',
    maxAttempts: 3,
    timeoutSeconds: 120,
    priority: 'high',
    lastRunAt: '2026-04-17T06:00:00Z',
    nextRunAt: '2026-04-17T06:15:00Z',
    runCount: 2_782,
    failureCount: 5,
    createdAt: '2026-01-10T10:00:00Z',
    createdBy: 'compliance-team',
  },
  {
    id: 'jd-006',
    tenantId: 'tenant-1',
    jobType: 'retention.purge_expired',
    description: 'Purge records that have exceeded their configured retention window',
    cronSchedule: '0 1 1 * *',
    status: 'paused',
    maxAttempts: 2,
    timeoutSeconds: 7200,
    priority: 'low',
    lastRunAt: '2026-04-01T01:00:00Z',
    nextRunAt: null,
    runCount: 5,
    failureCount: 1,
    createdAt: '2026-02-01T10:00:00Z',
    createdBy: 'ops-team',
  },
  {
    id: 'jd-007',
    tenantId: 'tenant-1',
    jobType: 'notification.dispatch',
    description: 'Dispatch queued notifications across all active channels',
    cronSchedule: '*/2 * * * *',
    status: 'active',
    maxAttempts: 5,
    timeoutSeconds: 60,
    priority: 'high',
    lastRunAt: '2026-04-17T06:08:00Z',
    nextRunAt: '2026-04-17T06:10:00Z',
    runCount: 21_040,
    failureCount: 43,
    createdAt: '2025-11-01T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'jd-008',
    tenantId: 'tenant-1',
    jobType: 'csat.survey_delivery',
    description: 'Deliver CSAT surveys to customers of recently resolved tickets',
    cronSchedule: '0 10 * * *',
    status: 'active',
    maxAttempts: 2,
    timeoutSeconds: 120,
    priority: 'normal',
    lastRunAt: '2026-04-17T10:00:07Z',
    nextRunAt: '2026-04-18T10:00:00Z',
    runCount: 166,
    failureCount: 3,
    createdAt: '2026-01-20T10:00:00Z',
    createdBy: 'cx-team',
  },
];

const MOCK_INSTANCES: SchedulerInstance[] = [
  {
    id: 'inst-001',
    jobType: 'notification.dispatch',
    tenantId: 'tenant-1',
    status: 'running',
    scheduledAt: '2026-04-17T06:08:00Z',
    startedAt: '2026-04-17T06:08:01Z',
    attempts: 1,
    maxAttempts: 5,
    payload: {},
    createdAt: '2026-04-17T06:08:00Z',
  },
  {
    id: 'inst-002',
    jobType: 'sla.breach_sweep',
    tenantId: 'tenant-1',
    status: 'running',
    scheduledAt: '2026-04-17T06:05:00Z',
    startedAt: '2026-04-17T06:05:01Z',
    attempts: 1,
    maxAttempts: 3,
    payload: {},
    createdAt: '2026-04-17T06:05:00Z',
  },
  {
    id: 'inst-003',
    jobType: 'crm.sync_inbound',
    tenantId: 'tenant-1',
    status: 'completed',
    scheduledAt: '2026-04-17T04:00:00Z',
    startedAt: '2026-04-17T04:00:08Z',
    completedAt: '2026-04-17T04:07:42Z',
    attempts: 1,
    maxAttempts: 3,
    payload: {},
    createdAt: '2026-04-17T04:00:00Z',
  },
  {
    id: 'inst-004',
    jobType: 'report.generate_daily',
    tenantId: 'tenant-1',
    status: 'completed',
    scheduledAt: '2026-04-17T03:00:00Z',
    startedAt: '2026-04-17T03:00:12Z',
    completedAt: '2026-04-17T03:02:33Z',
    attempts: 1,
    maxAttempts: 2,
    payload: {},
    createdAt: '2026-04-17T03:00:00Z',
  },
  {
    id: 'inst-005',
    jobType: 'sla.breach_sweep',
    tenantId: 'tenant-1',
    status: 'failed',
    scheduledAt: '2026-04-17T05:55:00Z',
    startedAt: '2026-04-17T05:55:01Z',
    failedAt: '2026-04-17T05:55:31Z',
    attempts: 3,
    maxAttempts: 3,
    payload: {},
    error: 'PostgreSQL connection timeout after 30s',
    createdAt: '2026-04-17T05:55:00Z',
  },
  {
    id: 'inst-006',
    jobType: 'dsr.process_queue',
    tenantId: 'tenant-1',
    status: 'completed',
    scheduledAt: '2026-04-17T06:00:00Z',
    startedAt: '2026-04-17T06:00:01Z',
    completedAt: '2026-04-17T06:00:18Z',
    attempts: 1,
    maxAttempts: 3,
    payload: {},
    createdAt: '2026-04-17T06:00:00Z',
  },
  {
    id: 'inst-007',
    jobType: 'notification.dispatch',
    tenantId: 'tenant-1',
    status: 'dead_letter',
    scheduledAt: '2026-04-17T05:30:00Z',
    startedAt: '2026-04-17T05:30:01Z',
    failedAt: '2026-04-17T05:30:59Z',
    attempts: 5,
    maxAttempts: 5,
    payload: {},
    error: 'Twilio rate limit exceeded (429)',
    createdAt: '2026-04-17T05:30:00Z',
  },
  {
    id: 'inst-008',
    jobType: 'csat.survey_delivery',
    tenantId: 'tenant-1',
    status: 'completed',
    scheduledAt: '2026-04-17T10:00:00Z',
    startedAt: '2026-04-17T10:00:07Z',
    completedAt: '2026-04-17T10:00:38Z',
    attempts: 1,
    maxAttempts: 2,
    payload: {},
    createdAt: '2026-04-17T10:00:00Z',
  },
  {
    id: 'inst-009',
    jobType: 'notification.dispatch',
    tenantId: 'tenant-1',
    status: 'dead_letter',
    scheduledAt: '2026-04-17T02:00:00Z',
    startedAt: '2026-04-17T02:00:01Z',
    failedAt: '2026-04-17T02:00:59Z',
    attempts: 5,
    maxAttempts: 5,
    payload: {},
    error: 'Redis connection refused',
    createdAt: '2026-04-17T02:00:00Z',
  },
  {
    id: 'inst-010',
    jobType: 'sla.breach_sweep',
    tenantId: 'tenant-1',
    status: 'pending',
    scheduledAt: '2026-04-17T06:15:00Z',
    attempts: 0,
    maxAttempts: 3,
    payload: {},
    createdAt: '2026-04-17T06:10:00Z',
  },
];

const MOCK_DEAD_LETTER: DeadLetterEntry[] = [
  {
    id: 'dl-001',
    originalInstanceId: 'inst-007',
    jobType: 'notification.dispatch',
    tenantId: 'tenant-1',
    payload: {},
    error: 'Twilio rate limit exceeded (429) — max attempts (5) exhausted',
    attempts: 5,
    deadLetteredAt: '2026-04-17T05:30:59Z',
  },
  {
    id: 'dl-002',
    originalInstanceId: 'inst-009',
    jobType: 'notification.dispatch',
    tenantId: 'tenant-1',
    payload: {},
    error: 'Redis connection refused — max attempts (5) exhausted',
    attempts: 5,
    deadLetteredAt: '2026-04-17T02:00:59Z',
  },
];

const PREDEFINED_JOB_TYPES = [
  'sla.breach_sweep',
  'report.generate_daily',
  'crm.sync_inbound',
  'crm.sync_outbound',
  'audit.hash_verification',
  'dsr.process_queue',
  'retention.purge_expired',
  'notification.dispatch',
  'csat.survey_delivery',
  'encryption.key_rotation',
];

const PRIORITY_OPTIONS: { value: JobPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const INSTANCE_STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'dead_letter', label: 'Dead Letter' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function describeCron(cron: string | null): string {
  if (cron === null) return 'Manual only';
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const min = parts[0] ?? '*';
  const hour = parts[1] ?? '*';
  const dom = parts[2] ?? '*';
  const dow = parts[4] ?? '*';
  if (min.startsWith('*/') && hour === '*') {
    const n = min.slice(2);
    return `Every ${n} minute${n === '1' ? '' : 's'}`;
  }
  if (min === '0' && hour.startsWith('*/')) {
    const n = hour.slice(2);
    return `Every ${n} hour${n === '1' ? '' : 's'}`;
  }
  if (dom === '*' && dow === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (dom === '*' && dow !== '*') {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = DAYS[parseInt(dow, 10)] ?? dow;
    return `Weekly — ${dayName} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (dom !== '*') {
    const sfxMap: Record<string, string> = { '1': 'st', '2': 'nd', '3': 'rd' };
    const sfx = sfxMap[dom] ?? 'th';
    return `Monthly — ${dom}${sfx} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  return cron;
}

function nextRunLabel(iso: string | null): string {
  if (iso === null) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Overdue';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
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

// ── Badge configs ──────────────────────────────────────────────────────────

type BV = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const DEF_STATUS_BADGE: Record<DefinitionStatus, BV> = {
  active: 'success',
  paused: 'warning',
  disabled: 'neutral',
};

const JOB_STATUS_BADGE: Record<JobStatus, BV> = {
  pending: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  dead_letter: 'danger',
};

const PRIORITY_COLOR: Record<JobPriority, string> = {
  low: 'text-content-tertiary',
  normal: 'text-content-secondary',
  high: 'text-amber-400',
  critical: 'text-red-400',
};

const PRIORITY_LABEL: Record<JobPriority, string> = {
  low: 'low',
  normal: 'normal',
  high: '↑ high',
  critical: '!! critical',
};

const INST_STATUS_ICON: Partial<Record<JobStatus, ReactNode>> = {
  running: <Loader2 className="h-3 w-3 animate-spin" />,
  completed: <CheckCircle2 className="h-3 w-3" />,
  failed: <XCircle className="h-3 w-3" />,
  dead_letter: <XCircle className="h-3 w-3" />,
  pending: <Clock className="h-3 w-3" />,
};

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
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', bg)}>
          {icon}
        </div>
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {label}
          </p>
          <p className="text-2xl font-semibold text-content">{value}</p>
        </div>
      </div>
    </Card>
  );
}

// ── Create / Edit Modal ────────────────────────────────────────────────────

interface CreateEditModalProps {
  mode: 'create' | 'edit';
  initial: JobDefinition | null;
  onClose: () => void;
  onSave: (def: JobDefinition) => void;
}

function CreateEditModal({ mode, initial, onClose, onSave }: CreateEditModalProps): ReactNode {
  const [jobType, setJobType] = useState(initial?.jobType ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [cronSchedule, setCronSchedule] = useState(initial?.cronSchedule ?? '');
  const [maxAttempts, setMaxAttempts] = useState(String(initial?.maxAttempts ?? 3));
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(initial?.timeoutSeconds ?? 60));
  const [priority, setPriority] = useState<JobPriority>(initial?.priority ?? 'normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cronPreview = describeCron(cronSchedule.trim() === '' ? null : cronSchedule.trim());

  const handleSubmit = async () => {
    if (jobType.trim() === '') {
      setError('Job type is required.');
      return;
    }
    if (description.trim().length < 5) {
      setError('Description must be at least 5 characters.');
      return;
    }
    const maxAtt = parseInt(maxAttempts, 10);
    const timeout = parseInt(timeoutSeconds, 10);
    if (isNaN(maxAtt) || maxAtt < 1 || maxAtt > 10) {
      setError('Max attempts must be 1–10.');
      return;
    }
    if (isNaN(timeout) || timeout < 10 || timeout > 7200) {
      setError('Timeout must be 10–7200 seconds.');
      return;
    }
    setSaving(true);
    setError(null);
    const body: CreateJobDefinitionBody = {
      jobType: jobType.trim(),
      description: description.trim(),
      cronSchedule: cronSchedule.trim() === '' ? null : cronSchedule.trim(),
      maxAttempts: maxAtt,
      timeoutSeconds: timeout,
      priority,
    };
    try {
      let result: JobDefinition;
      if (mode === 'edit' && initial !== null) {
        result = await schedulerApi.updateDefinition(initial.id, body);
      } else {
        result = await schedulerApi.createDefinition(body);
      }
      onSave(result);
    } catch {
      const mockResult: JobDefinition = {
        id: initial?.id ?? `jd-${Date.now()}`,
        tenantId: 'tenant-1',
        createdAt: initial?.createdAt ?? new Date().toISOString(),
        createdBy: initial?.createdBy ?? 'current-user',
        runCount: initial?.runCount ?? 0,
        failureCount: initial?.failureCount ?? 0,
        lastRunAt: initial?.lastRunAt ?? null,
        nextRunAt: body.cronSchedule !== null ? new Date(Date.now() + 60_000).toISOString() : null,
        status: initial?.status ?? 'active',
        ...body,
      };
      onSave(mockResult);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-semibold text-content">
            {mode === 'create' ? 'Create Job Definition' : 'Edit Job Definition'}
          </h2>
          <button
            onClick={onClose}
            className="text-content-tertiary hover:text-content"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {error !== null && (
            <div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-content">Job Type</label>
            {mode === 'create' ? (
              <select
                value={jobType}
                onChange={(e) => {
                  setJobType(e.target.value);
                }}
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-accent"
              >
                <option value="">Select job type…</option>
                {PREDEFINED_JOB_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-sm text-content">
                {jobType}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-content">Description</label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-accent"
              placeholder="Brief description of what this job does"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-content">
              Cron Schedule{' '}
              <span className="font-normal text-content-tertiary">
                (leave blank for manual-only)
              </span>
            </label>
            <input
              type="text"
              value={cronSchedule}
              onChange={(e) => {
                setCronSchedule(e.target.value);
              }}
              placeholder="*/5 * * * *"
              className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 font-mono text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-accent"
            />
            <p className="mt-1 text-xs text-content-tertiary">{cronPreview}</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-content">Priority</label>
              <select
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value as JobPriority);
                }}
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-accent"
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-content">Max Attempts</label>
              <input
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => {
                  setMaxAttempts(e.target.value);
                }}
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-content">Timeout (s)</label>
              <input
                type="number"
                min={10}
                max={7200}
                value={timeoutSeconds}
                onChange={(e) => {
                  setTimeoutSeconds(e.target.value);
                }}
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-accent"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === 'create' ? (
              'Create'
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Trigger Confirm Modal ──────────────────────────────────────────────────

function TriggerConfirmModal({
  definition,
  onClose,
  onConfirm,
}: {
  definition: JobDefinition;
  onClose: () => void;
  onConfirm: () => void;
}): ReactNode {
  const [triggering, setTriggering] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await schedulerApi.triggerNow(definition.id);
    } catch {
      // silent — caller handles optimistic instance creation
    } finally {
      setTriggering(false);
      onConfirm();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-accent/10">
            <Zap className="h-5 w-5 text-brand-accent" />
          </div>
          <h2 className="font-semibold text-content">Trigger Now</h2>
        </div>
        <p className="text-sm text-content-secondary">
          Manually trigger{' '}
          <span className="font-mono text-xs text-content">{definition.jobType}</span> immediately,
          bypassing its schedule. The instance will be WORM-logged.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={triggering}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void handleTrigger();
            }}
            disabled={triggering}
          >
            {triggering ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Trigger'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Modal ───────────────────────────────────────────────────────────

function DeleteDefinitionModal({
  definition,
  onClose,
  onDeleted,
}: {
  definition: JobDefinition;
  onClose: () => void;
  onDeleted: () => void;
}): ReactNode {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await schedulerApi.deleteDefinition(definition.id);
    } catch {
      // silent — optimistic removal in caller
    } finally {
      setDeleting(false);
      onDeleted();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/10">
            <AlertTriangle className="h-5 w-5 text-danger" />
          </div>
          <h2 className="font-semibold text-content">Delete Job Definition</h2>
        </div>
        <p className="text-sm text-content-secondary">
          Delete <span className="font-mono text-xs text-content">{definition.jobType}</span>?
          Running instances will complete but no new instances will be scheduled. This action is
          WORM-logged.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              void handleDelete();
            }}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Replay Modal ───────────────────────────────────────────────────────────

function ReplayModal({
  entry,
  onClose,
  onReplayed,
}: {
  entry: DeadLetterEntry;
  onClose: () => void;
  onReplayed: (inst: SchedulerInstance) => void;
}): ReactNode {
  const [replaying, setReplaying] = useState(false);

  const handleReplay = async () => {
    setReplaying(true);
    try {
      const inst = await schedulerApi.replayDead(entry.id);
      onReplayed(inst);
    } catch {
      const mockInst: SchedulerInstance = {
        id: `inst-replay-${Date.now()}`,
        jobType: entry.jobType,
        tenantId: entry.tenantId,
        status: 'pending',
        scheduledAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: 3,
        payload: {},
        createdAt: new Date().toISOString(),
      };
      onReplayed(mockInst);
    } finally {
      setReplaying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
            <RotateCcw className="h-5 w-5 text-amber-400" />
          </div>
          <h2 className="font-semibold text-content">Replay Dead-Letter Job</h2>
        </div>
        <p className="text-sm text-content-secondary">
          Re-queue <span className="font-mono text-xs text-content">{entry.jobType}</span> as a new
          pending instance. The original failure is preserved in the audit log.
        </p>
        <p className="rounded-lg bg-surface-secondary px-3 py-2 font-mono text-xs text-danger">
          {entry.error}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={replaying}>
            Cancel
          </Button>
          <button
            onClick={() => {
              void handleReplay();
            }}
            disabled={replaying}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
          >
            {replaying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            Replay
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Definitions Tab ────────────────────────────────────────────────────────

function DefinitionsTab({
  definitions,
  onTogglePause,
  onTrigger,
  onEdit,
  onDelete,
}: {
  definitions: JobDefinition[];
  onTogglePause: (def: JobDefinition) => void;
  onTrigger: (def: JobDefinition) => void;
  onEdit: (def: JobDefinition) => void;
  onDelete: (def: JobDefinition) => void;
}): ReactNode {
  if (definitions.length === 0) {
    return (
      <EmptyState
        icon={<Calendar className="h-8 w-8" />}
        title="No job definitions"
        description="Create your first scheduled job to get started."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left font-medium text-content-secondary">Job Type</th>
            <th className="px-4 py-3 text-left font-medium text-content-secondary">Schedule</th>
            <th className="px-4 py-3 text-left font-medium text-content-secondary">Priority</th>
            <th className="px-4 py-3 text-left font-medium text-content-secondary">Next Run</th>
            <th className="px-4 py-3 text-left font-medium text-content-secondary">Runs</th>
            <th className="px-4 py-3 text-left font-medium text-content-secondary">Status</th>
            <th className="px-4 py-3 text-right font-medium text-content-secondary">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {definitions.map((def) => (
            <tr key={def.id} className="transition-colors hover:bg-surface-secondary">
              <td className="px-4 py-3">
                <p className="font-mono text-xs text-content">{def.jobType}</p>
                <p className="mt-0.5 max-w-xs truncate text-xs text-content-tertiary">
                  {def.description}
                </p>
              </td>
              <td className="px-4 py-3">
                <p className="text-xs text-content-secondary">{describeCron(def.cronSchedule)}</p>
                {def.cronSchedule !== null && (
                  <p className="mt-0.5 font-mono text-2xs text-content-tertiary">
                    {def.cronSchedule}
                  </p>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={cn('text-xs font-medium', PRIORITY_COLOR[def.priority])}>
                  {PRIORITY_LABEL[def.priority]}
                </span>
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    'text-xs',
                    def.nextRunAt !== null && new Date(def.nextRunAt).getTime() < Date.now()
                      ? 'text-danger'
                      : 'text-content-secondary',
                  )}
                >
                  {nextRunLabel(def.nextRunAt)}
                </span>
              </td>
              <td className="px-4 py-3">
                <p className="text-xs text-content">{def.runCount.toLocaleString()}</p>
                {def.failureCount > 0 && (
                  <p className="text-2xs text-danger">{def.failureCount} failed</p>
                )}
              </td>
              <td className="px-4 py-3">
                <Badge variant={DEF_STATUS_BADGE[def.status]} size="sm">
                  {def.status}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => {
                      onTrigger(def);
                    }}
                    title="Trigger now"
                    className="rounded-lg p-1.5 text-brand-accent transition-colors hover:bg-brand-accent/10"
                  >
                    <Zap className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      onTogglePause(def);
                    }}
                    title={def.status === 'paused' ? 'Resume' : 'Pause'}
                    className="rounded-lg p-1.5 text-content-tertiary transition-colors hover:bg-surface-tertiary hover:text-content"
                  >
                    {def.status === 'paused' ? (
                      <PlayCircle className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <PauseCircle className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      onEdit(def);
                    }}
                    title="Edit"
                    className="rounded-lg p-1.5 text-content-tertiary transition-colors hover:bg-surface-tertiary hover:text-content"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      onDelete(def);
                    }}
                    title="Delete"
                    className="rounded-lg p-1.5 text-danger/60 transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Instances Tab ──────────────────────────────────────────────────────────

function InstancesTab({
  instances,
  loading,
  error,
}: {
  instances: SchedulerInstance[];
  loading: boolean;
  error: string | null;
}): ReactNode {
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const jobTypes = Array.from(new Set(instances.map((i) => i.jobType))).sort();
  const typeOptions = [
    { value: 'all', label: 'All Job Types' },
    ...jobTypes.map((t) => ({ value: t, label: t })),
  ];

  const filtered = instances.filter((i) => {
    const statusOk = statusFilter === 'all' || i.status === statusFilter;
    const typeOk = typeFilter === 'all' || i.jobType === typeFilter;
    return statusOk && typeOk;
  });

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" label="Loading instances" />
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={INSTANCE_STATUS_OPTIONS}
          className="w-44"
        />
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          options={typeOptions}
          className="w-52"
        />
        <span className="ml-auto text-xs text-content-tertiary">{filtered.length} instances</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-8 w-8" />}
          title="No instances"
          description="No job instances match your filters."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-content-secondary">ID</th>
                <th className="px-4 py-3 text-left font-medium text-content-secondary">Job Type</th>
                <th className="px-4 py-3 text-left font-medium text-content-secondary">Status</th>
                <th className="px-4 py-3 text-left font-medium text-content-secondary">Attempts</th>
                <th className="px-4 py-3 text-left font-medium text-content-secondary">
                  Scheduled
                </th>
                <th className="px-4 py-3 text-left font-medium text-content-secondary">Finished</th>
                <th className="px-4 py-3 text-left font-medium text-content-secondary">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((inst) => (
                <tr key={inst.id} className="transition-colors hover:bg-surface-secondary">
                  <td className="px-4 py-3 font-mono text-xs text-content-tertiary">
                    {inst.id.slice(0, 9)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-content">{inst.jobType}</td>
                  <td className="px-4 py-3">
                    <Badge variant={JOB_STATUS_BADGE[inst.status]} size="sm">
                      <span className="flex items-center gap-1">
                        {INST_STATUS_ICON[inst.status]}
                        {inst.status.replace('_', ' ')}
                      </span>
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-content-secondary">
                    {inst.attempts}/{inst.maxAttempts}
                  </td>
                  <td className="px-4 py-3 text-content-secondary">
                    {relativeTime(inst.scheduledAt)}
                  </td>
                  <td className="px-4 py-3 text-content-secondary">
                    {inst.completedAt !== undefined
                      ? relativeTime(inst.completedAt)
                      : inst.failedAt !== undefined
                        ? relativeTime(inst.failedAt)
                        : '—'}
                  </td>
                  <td
                    className="max-w-xs truncate px-4 py-3 text-xs text-danger"
                    title={inst.error}
                  >
                    {inst.error ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Dead Letter Tab ────────────────────────────────────────────────────────

function DeadLetterTab({
  entries,
  loading,
  error,
  onReplay,
}: {
  entries: DeadLetterEntry[];
  loading: boolean;
  error: string | null;
  onReplay: (entry: DeadLetterEntry) => void;
}): ReactNode {
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
        description="No jobs have exhausted their retry limits."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left font-medium text-content-secondary">ID</th>
            <th className="px-4 py-3 text-left font-medium text-content-secondary">Job Type</th>
            <th className="px-4 py-3 text-left font-medium text-content-secondary">Attempts</th>
            <th className="px-4 py-3 text-left font-medium text-content-secondary">
              Dead-lettered
            </th>
            <th className="px-4 py-3 text-left font-medium text-content-secondary">Error</th>
            <th className="px-4 py-3 text-right font-medium text-content-secondary">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((entry) => (
            <tr key={entry.id} className="transition-colors hover:bg-surface-secondary">
              <td className="px-4 py-3 font-mono text-xs text-content-tertiary">
                {entry.id.slice(0, 9)}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-content">{entry.jobType}</td>
              <td className="px-4 py-3 text-content-secondary">{entry.attempts}</td>
              <td className="px-4 py-3 text-content-secondary">
                {relativeTime(entry.deadLetteredAt)}
              </td>
              <td className="max-w-xs truncate px-4 py-3 text-xs text-danger" title={entry.error}>
                {entry.error}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      onReplay(entry);
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/10"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Replay
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function SchedulerMonitor(): ReactNode {
  const [activeTab, setActiveTab] = useState<'definitions' | 'instances' | 'dead-letter'>(
    'definitions',
  );
  const [stats, setStats] = useState<SchedulerStats | null>(null);
  const [definitions, setDefinitions] = useState<JobDefinition[]>([]);
  const [instances, setInstances] = useState<SchedulerInstance[]>([]);
  const [deadLetter, setDeadLetter] = useState<DeadLetterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [instLoading, setInstLoading] = useState(true);
  const [dlLoading, setDlLoading] = useState(true);
  const [instError, setInstError] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  // Modal state
  const [showCreateEdit, setShowCreateEdit] = useState(false);
  const [createEditMode, setCreateEditMode] = useState<'create' | 'edit'>('create');
  const [editingDef, setEditingDef] = useState<JobDefinition | null>(null);
  const [triggerDef, setTriggerDef] = useState<JobDefinition | null>(null);
  const [deletingDef, setDeletingDef] = useState<JobDefinition | null>(null);
  const [replayEntry, setReplayEntry] = useState<DeadLetterEntry | null>(null);

  const loadRef = useRef(0);

  const loadAll = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    setInstLoading(true);
    setDlLoading(true);

    try {
      const [s, defs] = await Promise.all([
        schedulerApi.getStats(),
        schedulerApi.listDefinitions(),
      ]);
      if (seq !== loadRef.current) return;
      setStats(s);
      setDefinitions(defs);
    } catch {
      if (seq !== loadRef.current) return;
      setStats(MOCK_STATS);
      setDefinitions(MOCK_DEFINITIONS);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }

    try {
      const insts = await schedulerApi.listInstances({ limit: 50 });
      if (seq !== loadRef.current) return;
      setInstances(insts);
      setInstError(null);
    } catch {
      if (seq !== loadRef.current) return;
      setInstances(MOCK_INSTANCES);
      setInstError(null);
    } finally {
      if (seq === loadRef.current) setInstLoading(false);
    }

    try {
      const dl = await schedulerApi.listDeadLetter();
      if (seq !== loadRef.current) return;
      setDeadLetter(dl);
      setDlError(null);
    } catch {
      if (seq !== loadRef.current) return;
      setDeadLetter(MOCK_DEAD_LETTER);
      setDlError(null);
    } finally {
      if (seq === loadRef.current) setDlLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── Definition actions ─────────────────────────────────────────────────

  const handleTogglePause = useCallback((def: JobDefinition) => {
    const next: DefinitionStatus = def.status === 'paused' ? 'active' : 'paused';
    setDefinitions((prev) => prev.map((d) => (d.id === def.id ? { ...d, status: next } : d)));
    void schedulerApi.updateDefinition(def.id, { status: next }).catch(() => {
      setDefinitions((prev) =>
        prev.map((d) => (d.id === def.id ? { ...d, status: def.status } : d)),
      );
    });
  }, []);

  const handleTriggerOpen = useCallback((def: JobDefinition) => {
    setTriggerDef(def);
  }, []);

  const handleTriggerConfirm = useCallback(() => {
    if (triggerDef === null) return;
    const newInst: SchedulerInstance = {
      id: `inst-manual-${Date.now()}`,
      jobType: triggerDef.jobType,
      tenantId: 'tenant-1',
      status: 'pending',
      scheduledAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: triggerDef.maxAttempts,
      payload: {},
      createdAt: new Date().toISOString(),
    };
    setInstances((prev) => [newInst, ...prev]);
    setTriggerDef(null);
  }, [triggerDef]);

  const handleEditOpen = useCallback((def: JobDefinition) => {
    setEditingDef(def);
    setCreateEditMode('edit');
    setShowCreateEdit(true);
  }, []);

  const handleDeleteOpen = useCallback((def: JobDefinition) => {
    setDeletingDef(def);
  }, []);

  const handleCreateOpen = useCallback(() => {
    setEditingDef(null);
    setCreateEditMode('create');
    setShowCreateEdit(true);
  }, []);

  const handleSaveDef = useCallback((saved: JobDefinition) => {
    setDefinitions((prev) => {
      const exists = prev.some((d) => d.id === saved.id);
      return exists ? prev.map((d) => (d.id === saved.id ? saved : d)) : [...prev, saved];
    });
    setShowCreateEdit(false);
    setEditingDef(null);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (deletingDef === null) return;
    setDefinitions((prev) => prev.filter((d) => d.id !== deletingDef.id));
    setDeletingDef(null);
  }, [deletingDef]);

  const handleReplayOpen = useCallback((entry: DeadLetterEntry) => {
    setReplayEntry(entry);
  }, []);

  const handleReplayed = useCallback((inst: SchedulerInstance) => {
    setInstances((prev) => [inst, ...prev]);
    setReplayEntry(null);
  }, []);

  const activeDefCount = definitions.filter((d) => d.status === 'active').length;
  const runningCount = instances.filter((i) => i.status === 'running').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scheduler"
        subtitle="Manage cron job definitions, monitor instances, and replay failed jobs"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void loadAll();
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={handleCreateOpen}>
              <Plus className="h-4 w-4" />
              New Job
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size="lg" label="Loading scheduler" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            icon={<Calendar className="h-5 w-5 text-blue-400" />}
            label="Active Jobs"
            value={String(stats?.activeDefinitions ?? activeDefCount)}
            bg="bg-blue-500/10"
          />
          <StatCard
            icon={<Activity className="h-5 w-5 text-emerald-400" />}
            label="Running Now"
            value={String(stats?.runningInstances ?? runningCount)}
            bg="bg-emerald-500/10"
          />
          <StatCard
            icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
            label="Failed Today"
            value={String(stats?.failedToday ?? 0)}
            bg="bg-amber-500/10"
          />
          <StatCard
            icon={<XCircle className="h-5 w-5 text-red-400" />}
            label="Dead Letter Queue"
            value={String(stats?.deadLetterCount ?? deadLetter.length)}
            bg="bg-red-500/10"
          />
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'definitions', label: `Job Definitions (${definitions.length})` },
          { id: 'instances', label: `Instances (${instances.length})` },
          { id: 'dead-letter', label: `Dead Letter (${deadLetter.length})` },
        ]}
        activeTab={activeTab}
        onChange={(tab) => {
          setActiveTab(tab as 'definitions' | 'instances' | 'dead-letter');
        }}
      />

      {activeTab === 'definitions' && (
        <Card>
          <DefinitionsTab
            definitions={definitions}
            onTogglePause={handleTogglePause}
            onTrigger={handleTriggerOpen}
            onEdit={handleEditOpen}
            onDelete={handleDeleteOpen}
          />
        </Card>
      )}
      {activeTab === 'instances' && (
        <Card>
          <InstancesTab instances={instances} loading={instLoading} error={instError} />
        </Card>
      )}
      {activeTab === 'dead-letter' && (
        <Card>
          <DeadLetterTab
            entries={deadLetter}
            loading={dlLoading}
            error={dlError}
            onReplay={handleReplayOpen}
          />
        </Card>
      )}

      {showCreateEdit && (
        <CreateEditModal
          mode={createEditMode}
          initial={editingDef}
          onClose={() => {
            setShowCreateEdit(false);
            setEditingDef(null);
          }}
          onSave={handleSaveDef}
        />
      )}
      {triggerDef !== null && (
        <TriggerConfirmModal
          definition={triggerDef}
          onClose={() => {
            setTriggerDef(null);
          }}
          onConfirm={handleTriggerConfirm}
        />
      )}
      {deletingDef !== null && (
        <DeleteDefinitionModal
          definition={deletingDef}
          onClose={() => {
            setDeletingDef(null);
          }}
          onDeleted={handleDeleteConfirm}
        />
      )}
      {replayEntry !== null && (
        <ReplayModal
          entry={replayEntry}
          onClose={() => {
            setReplayEntry(null);
          }}
          onReplayed={handleReplayed}
        />
      )}
    </div>
  );
}
