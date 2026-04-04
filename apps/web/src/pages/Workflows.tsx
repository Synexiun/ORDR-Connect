/**
 * Workflows — Workflow instance manager.
 *
 * Shows active workflow instances, allows starting new ones from
 * built-in templates, and supports pause / resume / cancel actions.
 *
 * SOC2 CC6.1 — All mutations require auth; tenant-scoped.
 * HIPAA §164.312 — No PHI in workflow payloads; IDs and metadata only.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import {
  Plus,
  AlertCircle,
  CheckCircle2,
  Clock,
  Activity,
  GitBranch,
  Loader2,
  X,
} from '../components/icons';
import {
  workflowApi,
  type WorkflowInstance,
  type WorkflowDefinition,
  type WorkflowStatus,
} from '../lib/workflow-api';
import { useToast } from '../hooks/useToast';

// ── Status badge ──────────────────────────────────────────────────

type BadgeVariant = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

const statusBadge: Record<WorkflowStatus, BadgeVariant> = {
  pending: 'neutral',
  running: 'info',
  paused: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

function StatusBadge({ status }: { status: WorkflowStatus }): ReactNode {
  const icons: Partial<Record<WorkflowStatus, ReactNode>> = {
    running: <Loader2 className="h-3 w-3 animate-spin" />,
    completed: <CheckCircle2 className="h-3 w-3" />,
    failed: <AlertCircle className="h-3 w-3" />,
    paused: <Clock className="h-3 w-3" />,
  };
  return (
    <Badge variant={statusBadge[status]} size="sm">
      <span className="flex items-center gap-1">
        {icons[status]}
        {status}
      </span>
    </Badge>
  );
}

// ── Relative time ─────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Constants ─────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// ── Start Modal ───────────────────────────────────────────────────

interface StartModalProps {
  definitions: WorkflowDefinition[];
  open: boolean;
  onClose: () => void;
  onStarted: (instance: WorkflowInstance) => void;
}

function StartWorkflowModal({ definitions, open, onClose, onStarted }: StartModalProps): ReactNode {
  const { toast } = useToast();
  const [selectedDef, setSelectedDef] = useState(definitions[0]?.id ?? '');
  const [entityType, setEntityType] = useState('contact');
  const [entityId, setEntityId] = useState('');
  const [correlationId, setCorrelationId] = useState(crypto.randomUUID());
  const [saving, setSaving] = useState(false);

  const handleStart = useCallback(async () => {
    if (entityId.trim() === '') return;
    setSaving(true);
    try {
      const instance = await workflowApi.startInstance({
        definitionId: selectedDef,
        context: {
          entityType,
          entityId: entityId.trim(),
          tenantId: '',
          correlationId,
          initiatedBy: 'user',
        },
      });
      onStarted(instance);
      toast('Workflow started', 'success');
    } catch {
      toast('Failed to start workflow', 'error');
    } finally {
      setSaving(false);
    }
  }, [selectedDef, entityType, entityId, correlationId, onStarted, toast]);

  return (
    <Modal open={open} title="Start Workflow" onClose={onClose}>
      <div className="space-y-4">
        <Select
          label="Template"
          value={selectedDef}
          onChange={(v) => {
            setSelectedDef(v);
          }}
          options={definitions.map((d) => ({ value: d.id, label: d.name }))}
        />
        <Select
          label="Entity Type"
          value={entityType}
          onChange={(v) => {
            setEntityType(v);
          }}
          options={[
            { value: 'contact', label: 'Contact' },
            { value: 'deal', label: 'Deal' },
            { value: 'ticket', label: 'Ticket' },
          ]}
        />
        <div>
          <label className="block text-sm font-medium text-content mb-1">Entity ID</label>
          <input
            className="input w-full"
            value={entityId}
            onChange={(e) => {
              setEntityId(e.target.value);
            }}
            placeholder="e.g. contact-abc123"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-content mb-1">Correlation ID</label>
          <div className="flex gap-2">
            <input
              className="input w-full font-mono text-xs"
              value={correlationId}
              onChange={(e) => {
                setCorrelationId(e.target.value as ReturnType<typeof crypto.randomUUID>);
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setCorrelationId(crypto.randomUUID());
              }}
            >
              New
            </Button>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void handleStart();
            }}
            disabled={saving || entityId.trim() === ''}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export function Workflows(): ReactNode {
  const { toast } = useToast();
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [defs, insts] = await Promise.all([
        workflowApi.listDefinitions(),
        workflowApi.listInstances(
          statusFilter !== 'all'
            ? { status: statusFilter as WorkflowStatus, limit: 100 }
            : { limit: 100 },
        ),
      ]);
      setDefinitions(defs);
      setInstances(insts);
    } catch {
      setError('Failed to load workflow data');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAction = useCallback(
    async (instanceId: string, action: 'pause' | 'resume' | 'cancel') => {
      setActionPending(instanceId);
      try {
        let updated: WorkflowInstance;
        if (action === 'pause') {
          updated = await workflowApi.pauseInstance(instanceId);
        } else if (action === 'resume') {
          updated = await workflowApi.resumeInstance(instanceId);
        } else {
          updated = await workflowApi.cancelInstance(instanceId, 'User requested cancellation');
        }
        setInstances((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        toast(`Workflow ${action}d`, 'success');
      } catch {
        toast(`Failed to ${action} workflow`, 'error');
      } finally {
        setActionPending(null);
      }
    },
    [toast],
  );

  const kpis = {
    running: instances.filter((i) => i.status === 'running').length,
    paused: instances.filter((i) => i.status === 'paused').length,
    completed: instances.filter((i) => i.status === 'completed').length,
    failed: instances.filter((i) => i.status === 'failed').length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        subtitle="Manage automated workflow instances across your tenant"
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setShowStartModal(true);
            }}
            disabled={definitions.length === 0}
          >
            <Plus className="h-4 w-4" />
            Start Workflow
          </Button>
        }
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Running', value: kpis.running, variant: 'info' as BadgeVariant },
          { label: 'Paused', value: kpis.paused, variant: 'warning' as BadgeVariant },
          { label: 'Completed', value: kpis.completed, variant: 'success' as BadgeVariant },
          { label: 'Failed', value: kpis.failed, variant: 'danger' as BadgeVariant },
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

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
          }}
          options={STATUS_FILTERS}
          className="w-44"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void load();
          }}
        >
          <Activity className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Instance List */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Loading instances" />
          </div>
        ) : error !== null ? (
          <div className="flex items-center gap-2 p-4 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : instances.length === 0 ? (
          <EmptyState
            icon={<GitBranch className="h-8 w-8" />}
            title="No workflow instances"
            description="Start a workflow to automate customer operations."
            action={
              definitions.length > 0
                ? {
                    label: 'Start Workflow',
                    onClick: () => {
                      setShowStartModal(true);
                    },
                  }
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 px-4 text-left font-medium text-content-secondary">ID</th>
                  <th className="py-3 px-4 text-left font-medium text-content-secondary">
                    Definition
                  </th>
                  <th className="py-3 px-4 text-left font-medium text-content-secondary">Status</th>
                  <th className="py-3 px-4 text-left font-medium text-content-secondary">
                    Started
                  </th>
                  <th className="py-3 px-4 text-left font-medium text-content-secondary">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {instances.map((inst) => (
                  <tr key={inst.id} className="hover:bg-surface-secondary transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-content-tertiary">
                      {inst.id.slice(0, 8)}…
                    </td>
                    <td className="py-3 px-4 text-content">{inst.definitionId}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={inst.status} />
                    </td>
                    <td className="py-3 px-4 text-content-secondary">
                      {relativeTime(inst.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        {inst.status === 'running' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              void handleAction(inst.id, 'pause');
                            }}
                            disabled={actionPending === inst.id}
                          >
                            {actionPending === inst.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              'Pause'
                            )}
                          </Button>
                        )}
                        {inst.status === 'paused' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              void handleAction(inst.id, 'resume');
                            }}
                            disabled={actionPending === inst.id}
                          >
                            {actionPending === inst.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              'Resume'
                            )}
                          </Button>
                        )}
                        {(inst.status === 'running' || inst.status === 'paused') && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              void handleAction(inst.id, 'cancel');
                            }}
                            disabled={actionPending === inst.id}
                            aria-label="Cancel workflow"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <StartWorkflowModal
        definitions={definitions}
        open={showStartModal}
        onClose={() => {
          setShowStartModal(false);
        }}
        onStarted={(instance) => {
          setInstances((prev) => [instance, ...prev]);
          setShowStartModal(false);
        }}
      />
    </div>
  );
}
