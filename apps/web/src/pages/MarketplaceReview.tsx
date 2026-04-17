/**
 * Marketplace Review Queue — admin pipeline for agent security review.
 *
 * Agents submitted to the marketplace enter a 'review' status. Admins
 * must inspect the manifest, run security checks, and approve or reject
 * before the agent goes live. Approved agents are automatically validated
 * by the backend (license, budget limits, confidence threshold, etc.).
 *
 * SOC2 CC8.1 — Change management: agents reviewed before publishing.
 * ISO 27001 A.14.2.1 — Secure development: manifest validation.
 * HIPAA §164.312(a)(1) — Access control: admin-only review pipeline.
 * SECURITY: Admin-only (Rule 2). All decisions WORM-audited (Rule 3).
 */

import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Textarea } from '../components/ui/Textarea';
import { Spinner } from '../components/ui/Spinner';
import type { BadgeVariant } from '../components/ui/Badge';
import {
  Store,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  PauseCircle,
  ShieldCheck,
  RefreshCw,
} from '../components/icons';
import {
  listReviewQueue,
  approveAgent,
  rejectAgent,
  suspendAgent,
  type ReviewQueueAgent,
  type ReviewAgentStatus,
} from '../lib/marketplace-api';

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_QUEUE: ReviewQueueAgent[] = [
  {
    id: 'a1',
    name: 'Smart Ticket Router',
    version: '1.2.0',
    description:
      'Uses NLP to automatically classify and route incoming support tickets to the correct team based on content analysis.',
    author: 'Acme AI Labs',
    license: 'MIT',
    status: 'review',
    publisherId: 'pub-001',
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'a2',
    name: 'HIPAA Compliance Auditor',
    version: '0.9.1',
    description:
      'Scans conversation logs for PHI exposure patterns and generates compliance reports.',
    author: 'HealthTech Solutions',
    license: 'Apache-2.0',
    status: 'review',
    publisherId: 'pub-002',
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 'a3',
    name: 'Customer Sentiment Analyzer',
    version: '2.1.0',
    description: 'Real-time sentiment analysis on customer interactions with escalation triggers.',
    author: 'SentiCore',
    license: 'GPL-3.0',
    status: 'review',
    publisherId: 'pub-003',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'a4',
    name: 'Bulk Email Blaster',
    version: '1.0.0',
    description: 'Mass email sender with minimal rate limiting controls.',
    author: 'SpamCo',
    license: 'GPL-2.0',
    status: 'review',
    publisherId: 'pub-004',
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'a5',
    name: 'CRM Sync Agent',
    version: '3.0.2',
    description: 'Bidirectional sync between ORDR-Connect and Salesforce/HubSpot.',
    author: 'IntegrateHub',
    license: 'MIT',
    status: 'published',
    publisherId: 'pub-005',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
  {
    id: 'a6',
    name: 'Unsafe Data Extractor',
    version: '1.0.0',
    description: 'Extracts raw customer data including PHI for export.',
    author: 'DataMiner',
    license: 'MIT',
    status: 'rejected',
    publisherId: 'pub-006',
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
];

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<ReviewAgentStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  review: { label: 'Pending Review', variant: 'warning' },
  published: { label: 'Published', variant: 'success' },
  suspended: { label: 'Suspended', variant: 'danger' },
  rejected: { label: 'Rejected', variant: 'danger' },
};

const OSI_KNOWN = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'Unlicense',
  'CC0-1.0',
]);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── ReasonModal ────────────────────────────────────────────────────────────────

interface ReasonModalProps {
  open: boolean;
  action: 'reject' | 'suspend';
  agentName: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

function ReasonModal({ open, action, agentName, onClose, onConfirm }: ReasonModalProps): ReactNode {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (reason.trim() === '') return;
      setSaving(true);
      try {
        await onConfirm(reason.trim());
        onClose();
      } finally {
        setSaving(false);
      }
    },
    [reason, onConfirm, onClose],
  );

  const isReject = action === 'reject';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isReject ? `Reject "${agentName}"` : `Suspend "${agentName}"`}
      size="md"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            type="submit"
            form="reason-form"
            disabled={saving || reason.trim() === ''}
          >
            {saving ? <Spinner size="sm" /> : isReject ? 'Reject Agent' : 'Suspend Agent'}
          </Button>
        </>
      }
    >
      <form
        id="reason-form"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-3"
      >
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-content-secondary">
            {isReject
              ? 'The agent author will be notified. The reason will appear on their dashboard.'
              : 'The agent will be immediately unavailable to all tenants. Provide a clear reason for the suspension.'}
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">
            {isReject ? 'Rejection Reason' : 'Suspension Reason'}{' '}
            <span className="text-red-500">*</span>
          </label>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            placeholder={
              isReject
                ? 'Describe the specific security or compliance issues found...'
                : 'Describe why this agent is being suspended...'
            }
            rows={4}
            maxLength={2000}
            required
          />
          <p className="mt-1 text-right text-xs text-content-tertiary">
            {String(reason.length)}/2000
          </p>
        </div>
        <p className="text-xs text-content-tertiary">
          This action is permanent and WORM-audited under SOC2 CC8.1.
        </p>
      </form>
    </Modal>
  );
}

// ── AgentCard ──────────────────────────────────────────────────────────────────

interface AgentCardProps {
  agent: ReviewQueueAgent;
  onApprove: (agent: ReviewQueueAgent) => void;
  onReject: (agent: ReviewQueueAgent) => void;
  onSuspend: (agent: ReviewQueueAgent) => void;
  approving: boolean;
}

function AgentCard({
  agent,
  onApprove,
  onReject,
  onSuspend,
  approving,
}: AgentCardProps): ReactNode {
  const isOsi = OSI_KNOWN.has(agent.license);
  const isPending = agent.status === 'review';
  const isPublished = agent.status === 'published';
  const meta = STATUS_META[agent.status];

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-content">{agent.name}</span>
            <Badge variant="neutral" size="sm">
              v{agent.version}
            </Badge>
            <Badge variant={meta.variant} size="sm">
              {meta.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-content-secondary">
            by <span className="font-medium text-content">{agent.author}</span>
            {' · '}
            Submitted {formatDate(agent.createdAt)}
          </p>
          <p className="mt-2 text-sm text-content-secondary">{agent.description}</p>

          {/* License check */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-content-tertiary">License:</span>
            <Badge variant={isOsi ? 'success' : 'danger'} size="sm">
              {agent.license}
            </Badge>
            {!isOsi && <span className="text-xs text-red-500">Not OSI-approved</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {isPending && (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onApprove(agent);
                }}
                disabled={approving}
                className="whitespace-nowrap"
              >
                {approving ? (
                  <Spinner size="sm" />
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve
                  </>
                )}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  onReject(agent);
                }}
                disabled={approving}
                className="whitespace-nowrap"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </Button>
            </>
          )}
          {isPublished && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onSuspend(agent);
              }}
              className="whitespace-nowrap text-amber-500 hover:text-amber-600"
            >
              <PauseCircle className="h-3.5 w-3.5" />
              Suspend
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function MarketplaceReview(): ReactNode {
  const [agents, setAgents] = useState<ReviewQueueAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<ReviewQueueAgent | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<ReviewQueueAgent | null>(null);

  const [filterStatus, setFilterStatus] = useState<ReviewAgentStatus | 'all'>('review');

  // ── Load ──

  const load = useCallback(() => {
    setLoading(true);
    void listReviewQueue()
      .then((res) => {
        setAgents(res.data.length > 0 ? res.data : MOCK_QUEUE);
      })
      .catch(() => {
        setAgents(MOCK_QUEUE);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Stats ──

  const stats = useMemo(
    () => ({
      pending: agents.filter((a) => a.status === 'review').length,
      published: agents.filter((a) => a.status === 'published').length,
      rejected: agents.filter((a) => a.status === 'rejected').length,
      suspended: agents.filter((a) => a.status === 'suspended').length,
    }),
    [agents],
  );

  // ── Filtered list ──

  const filtered = useMemo(
    () => (filterStatus === 'all' ? agents : agents.filter((a) => a.status === filterStatus)),
    [agents, filterStatus],
  );

  // ── Approve ──

  const handleApprove = useCallback(async (agent: ReviewQueueAgent) => {
    setApprovingId(agent.id);
    try {
      const res = await approveAgent(agent.id).catch(() => null);
      if (res !== null) {
        setAgents((prev) =>
          prev.map((a) => (a.id === res.data.id ? { ...a, status: res.data.status } : a)),
        );
      }
    } finally {
      setApprovingId(null);
    }
  }, []);

  // ── Reject ──

  const handleReject = useCallback(
    async (reason: string) => {
      if (rejectTarget === null) return;
      const res = await rejectAgent(rejectTarget.id, reason).catch(() => null);
      if (res !== null) {
        setAgents((prev) =>
          prev.map((a) => (a.id === res.data.id ? { ...a, status: res.data.status } : a)),
        );
      }
      setRejectTarget(null);
    },
    [rejectTarget],
  );

  // ── Suspend ──

  const handleSuspend = useCallback(
    async (reason: string) => {
      if (suspendTarget === null) return;
      const res = await suspendAgent(suspendTarget.id, reason).catch(() => null);
      if (res !== null) {
        setAgents((prev) =>
          prev.map((a) => (a.id === res.data.id ? { ...a, status: res.data.status } : a)),
        );
      }
      setSuspendTarget(null);
    },
    [suspendTarget],
  );

  // ── Render ──

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/10">
            <ShieldCheck className="h-5 w-5 text-brand-accent" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-content">Marketplace Review</h1>
            <p className="text-sm text-content-tertiary">
              Agent security review pipeline — SOC2 CC8.1 change management
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-2xl font-bold text-content">{String(stats.pending)}</p>
              <p className="text-xs text-content-tertiary">Pending Review</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <div>
              <p className="text-2xl font-bold text-content">{String(stats.published)}</p>
              <p className="text-xs text-content-tertiary">Published</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-2xl font-bold text-content">{String(stats.rejected)}</p>
              <p className="text-xs text-content-tertiary">Rejected</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <PauseCircle className="h-5 w-5 text-content-tertiary" />
            <div>
              <p className="text-2xl font-bold text-content">{String(stats.suspended)}</p>
              <p className="text-xs text-content-tertiary">Suspended</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        {(['all', 'review', 'published', 'rejected', 'suspended'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setFilterStatus(s);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filterStatus === s
                ? 'bg-brand-accent/10 text-brand-accent'
                : 'text-content-tertiary hover:bg-surface-tertiary/50 hover:text-content'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_META[s].label}
          </button>
        ))}
        <span className="ml-auto text-xs text-content-tertiary">
          {String(filtered.length)} agent{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Agent list */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner size="lg" label="Loading review queue" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <div className="text-center">
            <Store className="mx-auto mb-2 h-8 w-8 text-content-tertiary" />
            <p className="text-sm text-content-tertiary">
              {filterStatus === 'review'
                ? 'No agents pending review.'
                : 'No agents in this status.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onApprove={(a) => {
                void handleApprove(a);
              }}
              onReject={(a) => {
                setRejectTarget(a);
              }}
              onSuspend={(a) => {
                setSuspendTarget(a);
              }}
              approving={approvingId === agent.id}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <ReasonModal
        open={rejectTarget !== null}
        action="reject"
        agentName={rejectTarget?.name ?? ''}
        onClose={() => {
          setRejectTarget(null);
        }}
        onConfirm={handleReject}
      />

      <ReasonModal
        open={suspendTarget !== null}
        action="suspend"
        agentName={suspendTarget?.name ?? ''}
        onClose={() => {
          setSuspendTarget(null);
        }}
        onConfirm={handleSuspend}
      />
    </div>
  );
}
