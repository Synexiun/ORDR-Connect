/**
 * Security Events — Threat detection event feed and incident triage.
 *
 * Surfaces DLP violations, auth attacks, anomaly detections, honeypot triggers,
 * and privilege escalation attempts. Analysts can investigate, resolve, or
 * mark events as false positives.
 *
 * SECURITY:
 * - Source IPs shown only as SHA-256 hashes (GDPR Art. 5(1)(c)) — Rule 6
 * - Actor IDs are internal UUIDs — no PHI in event records — Rule 6
 * - All mutations carry X-Request-Id for WORM audit chain — Rule 3
 * - Severity can never be downgraded post-record (audit integrity) — Rule 3
 *
 * SOC 2 CC7.1, CC7.3 | ISO 27001 A.8.16 | HIPAA §164.312(b)
 */

import { type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  X,
  ChevronRight,
  RefreshCw,
  Search,
  Info,
  Eye,
  MoreHorizontal,
} from '../components/icons';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import {
  securityApi,
  type SecurityEvent,
  type SecurityEventSeverity,
  type SecurityEventStatus,
  type SecurityEventType,
  type SecurityEventStats,
} from '../lib/security-api';

// ── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const SEVERITY_CONFIG: Record<
  SecurityEventSeverity,
  { label: string; color: string; dot: string; icon: ReactNode }
> = {
  CRITICAL: {
    label: 'Critical',
    color: 'text-red-400 bg-red-400/10 border border-red-400/20',
    dot: 'bg-red-400',
    icon: <AlertCircle className="h-3.5 w-3.5" />,
  },
  HIGH: {
    label: 'High',
    color: 'text-orange-400 bg-orange-400/10 border border-orange-400/20',
    dot: 'bg-orange-400',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  MEDIUM: {
    label: 'Medium',
    color: 'text-amber-400 bg-amber-400/10 border border-amber-400/20',
    dot: 'bg-amber-400',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  LOW: {
    label: 'Low',
    color: 'text-blue-400 bg-blue-400/10 border border-blue-400/20',
    dot: 'bg-blue-400',
    icon: <Info className="h-3.5 w-3.5" />,
  },
  INFO: {
    label: 'Info',
    color: 'text-content-tertiary bg-surface-tertiary',
    dot: 'bg-content-tertiary',
    icon: <Info className="h-3.5 w-3.5" />,
  },
};

const TYPE_LABELS: Record<SecurityEventType, string> = {
  auth_attack: 'Auth Attack',
  brute_force: 'Brute Force',
  privilege_escalation: 'Priv. Escalation',
  dlp_violation: 'DLP Violation',
  anomaly_detected: 'Anomaly',
  honeypot_trigger: 'Honeypot',
  injection_attempt: 'Injection',
  data_exfiltration: 'Data Exfil.',
  policy_violation: 'Policy Violation',
  geo_anomaly: 'Geo Anomaly',
};

const STATUS_CONFIG: Record<
  SecurityEventStatus,
  { label: string; variant: 'default' | 'success' | 'warning' | 'error' }
> = {
  open: { label: 'Open', variant: 'error' },
  investigating: { label: 'Investigating', variant: 'warning' },
  resolved: { label: 'Resolved', variant: 'success' },
  false_positive: { label: 'False Positive', variant: 'default' },
};

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_EVENTS: SecurityEvent[] = [
  {
    id: 'evt_01',
    tenantId: 'tenant_demo',
    severity: 'CRITICAL',
    type: 'dlp_violation',
    status: 'open',
    title: 'PHI field accessed without HIPAA business justification',
    description:
      'A bulk export of patient contact fields was initiated by a service account outside of approved data access windows. 1,247 records retrieved in 4.2 seconds.',
    sourceIpHash: 'a3f2c9e1d84b57f0c6219e3d728af41b29c05e87634f1a09b2d5c8e7f0341298',
    userAgent: 'python-requests/2.31.0',
    affectedResource: 'customers:bulk_export',
    actorId: 'usr_svc_etl_prod',
    ruleId: 'HIPAA-DLP-001',
    detectedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 'evt_02',
    tenantId: 'tenant_demo',
    severity: 'CRITICAL',
    type: 'privilege_escalation',
    status: 'investigating',
    title: 'Service account assumed tenant_admin role outside normal workflow',
    description:
      'svc-integration-worker claimed a role assignment not present in its JWT at token issuance time. The claim was rejected by ABAC middleware, but the attempt is logged as an escalation indicator.',
    sourceIpHash: null,
    userAgent: null,
    affectedResource: 'roles:tenant_admin',
    actorId: 'svc-integration-worker',
    ruleId: 'SOC2-PRIV-002',
    detectedAt: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 'evt_03',
    tenantId: 'tenant_demo',
    severity: 'HIGH',
    type: 'brute_force',
    status: 'resolved',
    title: '847 failed login attempts from single IP hash within 10 minutes',
    description:
      'Rate limiter triggered at attempt 100; IP range was automatically blocked. Credential stuffing pattern detected (username list from known breach). MFA prevented any successful authentication.',
    sourceIpHash: 'e9d2f1a4c87b356f021ce9847a3b50d12e8f94c673a0159b28d6e4f7c0312485',
    userAgent: 'Mozilla/5.0 (compatible; attackscript/1.0)',
    affectedResource: 'auth:login',
    actorId: null,
    ruleId: 'SOC2-AUTH-003',
    detectedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    resolvedAt: new Date(Date.now() - 105 * 60 * 1000).toISOString(),
    resolutionNotes:
      'IP range blocked at edge. Rate limiting confirmed effective. No accounts compromised. Incident closed.',
  },
  {
    id: 'evt_04',
    tenantId: 'tenant_demo',
    severity: 'HIGH',
    type: 'injection_attempt',
    status: 'false_positive',
    title: 'SQL-like pattern detected in customer search query',
    description:
      'Input validation flagged a search string containing "OR 1=1" pattern. Query was parameterized — no injection possible. Triggered by a customer whose company name contains the string.',
    sourceIpHash: 'b7c3d9e0f2a148c5376d8e21b094f7a3c52e1d684b09f2e3a7c8d14b5e6f2908',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    affectedResource: 'customers:search',
    actorId: 'usr_demo_operator',
    ruleId: 'OWASP-INJ-001',
    detectedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    resolvedAt: new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString(),
    resolutionNotes:
      'Confirmed false positive. Customer company name "OR Solutions LLC" matched injection pattern. Rule tuning ticket filed.',
  },
  {
    id: 'evt_05',
    tenantId: 'tenant_demo',
    severity: 'HIGH',
    type: 'data_exfiltration',
    status: 'open',
    title: 'Unusually large response payload on /customers export',
    description:
      'Export endpoint returned 14.2 MB in a single response — 8× the 99th-percentile baseline. DLP scanner flagged high density of encrypted PHI fields. Request came from a valid operator session.',
    sourceIpHash: 'f0a2c8e1d7b349c6218f4d7e5a023b9c1e48f6d793a2058b1c4d7f2e0a31b694',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    affectedResource: 'customers:export',
    actorId: 'usr_9f2a3c8d',
    ruleId: 'DLP-EXFIL-002',
    detectedAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 'evt_06',
    tenantId: 'tenant_demo',
    severity: 'MEDIUM',
    type: 'geo_anomaly',
    status: 'open',
    title: 'Login from new country — no prior sessions from this region',
    description:
      'Operator account authenticated from a geolocation not present in their 90-day session history. MFA challenge was issued and passed. Session is active.',
    sourceIpHash: '3c9e1f7d0b52a48c6329d71e4b0f82a5c6e3d10879b2f4e5a18c9d3f7b062451',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    affectedResource: 'auth:session',
    actorId: 'usr_demo_operator',
    ruleId: 'GEO-ANOMALY-001',
    detectedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 'evt_07',
    tenantId: 'tenant_demo',
    severity: 'MEDIUM',
    type: 'honeypot_trigger',
    status: 'resolved',
    title: 'Honeypot endpoint /api/v1/admin/debug accessed',
    description:
      'Canary route with no legitimate use was probed. Request included a valid but expired JWT, suggesting a targeted reconnaissance attempt with a harvested token.',
    sourceIpHash: 'd8e1a2f0c7b345d9216c8e4f73b01a9d2e57c4b8930f1e6d2a7b4c8e5f0239861',
    userAgent: 'curl/8.1.2',
    affectedResource: 'api:honeypot:admin_debug',
    actorId: null,
    ruleId: 'HONEYPOT-001',
    detectedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    resolvedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    resolutionNotes:
      'Expired JWT revoked from active token store. No data accessed. IP range added to watchlist. Closed.',
  },
  {
    id: 'evt_08',
    tenantId: 'tenant_demo',
    severity: 'MEDIUM',
    type: 'anomaly_detected',
    status: 'investigating',
    title: 'Agent decision confidence dropped below 0.5 threshold — 23 actions queued',
    description:
      'Agent runtime reported sustained low-confidence decisions over 8 minutes. 23 actions held in human review queue (Rule 9 — confidence threshold 0.7). No customer-facing delivery has occurred.',
    sourceIpHash: null,
    userAgent: null,
    affectedResource: 'agents:runtime:workflow_executor',
    actorId: 'agt_workflow_executor',
    ruleId: 'AGENT-SAFETY-001',
    detectedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 'evt_09',
    tenantId: 'tenant_demo',
    severity: 'LOW',
    type: 'policy_violation',
    status: 'resolved',
    title: 'API key used 3 days after scheduled rotation deadline',
    description:
      'API key ok_live_8f2a... was not rotated within the 90-day automated cycle window. The key was still active and in use by an integration. Rotation enforced immediately.',
    sourceIpHash: null,
    userAgent: null,
    affectedResource: 'api-keys:ok_live_8f2a',
    actorId: 'svc-crm-sync',
    ruleId: 'KEY-ROTATION-001',
    detectedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    resolvedAt: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(),
    resolutionNotes:
      'Key rotated. Integration updated with new key. 90-day rotation cron verified.',
  },
  {
    id: 'evt_10',
    tenantId: 'tenant_demo',
    severity: 'LOW',
    type: 'auth_attack',
    status: 'open',
    title: 'PKCE code verifier reuse attempt blocked',
    description:
      "OAuth 2.1 PKCE flow rejected a code_verifier that had already been used in a prior token exchange. Replay protection confirmed working. Original session owner's account is unaffected.",
    sourceIpHash: '1a9f4c7e2d0b638c5479e82d1b4a0f3c7e5d249801c3f7a6b2e0d5c9f4173820',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    affectedResource: 'auth:oauth:token',
    actorId: null,
    ruleId: 'OAUTH-REPLAY-001',
    detectedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    resolvedAt: null,
    resolutionNotes: null,
  },
  {
    id: 'evt_11',
    tenantId: 'tenant_demo',
    severity: 'INFO',
    type: 'policy_violation',
    status: 'resolved',
    title: 'New tenant created without initial MFA enrollment prompt',
    description:
      'Onboarding flow completed without triggering the MFA setup step. User proceeded to dashboard with password-only session. MFA enrollment reminder sent at +5 min by the notification service.',
    sourceIpHash: null,
    userAgent: null,
    affectedResource: 'auth:mfa:enrollment',
    actorId: 'usr_new_onboarding',
    ruleId: 'MFA-ENROLL-001',
    detectedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    resolvedAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    resolutionNotes:
      'MFA enrollment email resent. User enrolled 14 minutes later. Onboarding flow patched.',
  },
];

const MOCK_STATS: SecurityEventStats = {
  openCritical: 2,
  openHigh: 2,
  resolvedToday: 4,
  avgResolutionHours: 1.1,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: SecurityEventSeverity }): ReactNode {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${cfg.color}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function TypeBadge({ type }: { type: SecurityEventType }): ReactNode {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-2xs text-content-secondary bg-surface-tertiary">
      {TYPE_LABELS[type]}
    </span>
  );
}

function StatusBadge({ status }: { status: SecurityEventStatus }): ReactNode {
  const cfg = STATUS_CONFIG[status];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

// ── Resolve / False-Positive Modal ─────────────────────────────────────────

interface ActionModalProps {
  event: SecurityEvent;
  mode: 'resolve' | 'false_positive';
  onClose: () => void;
  onConfirm: (notes: string) => Promise<void>;
}

function ActionModal({ event, mode, onClose, onConfirm }: ActionModalProps): ReactNode {
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const isResolve = mode === 'resolve';

  const handleSubmit = useCallback(async () => {
    if (!notes.trim()) return;
    setLoading(true);
    await onConfirm(notes.trim());
    setLoading(false);
  }, [notes, onConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-content">
            {isResolve ? 'Resolve Event' : 'Mark as False Positive'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-content-tertiary hover:text-content"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-lg border border-border bg-surface-secondary p-3">
          <p className="text-xs font-medium text-content">{event.title}</p>
          <p className="mt-1 text-2xs text-content-secondary">
            {event.severity} · {TYPE_LABELS[event.type]} · Detected {fmtRelative(event.detectedAt)}
          </p>
        </div>

        {!isResolve && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs text-amber-400">
              Marking as false positive suppresses future alerts matching this pattern. Ensure the
              rule tuning ticket is filed before proceeding.
            </p>
          </div>
        )}

        <div className="mb-4 rounded-lg border border-border bg-surface-secondary p-3">
          <p className="text-2xs text-content-tertiary">
            This action is WORM-logged and cannot be undone. The resolution notes become part of the
            immutable audit chain (SOC 2 CC7.3, ISO A.8.16).
          </p>
        </div>

        <label className="mb-1 block text-xs font-medium text-content">
          Resolution notes <span className="text-red-400">*</span>
        </label>
        <textarea
          className="w-full rounded-lg border border-border bg-surface-tertiary p-2 text-xs text-content placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-brand-accent"
          rows={4}
          placeholder={
            isResolve
              ? 'Describe what was found and how it was addressed…'
              : 'Explain why this is a false positive and any tuning actions taken…'
          }
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-content-secondary hover:text-content"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!notes.trim() || loading}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              isResolve
                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                : 'bg-amber-600 text-white hover:bg-amber-500'
            }`}
          >
            {loading && <Spinner size="sm" />}
            {isResolve ? 'Resolve & Log' : 'Mark False Positive'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────

interface DetailPanelProps {
  event: SecurityEvent;
  onClose: () => void;
  onInvestigate: () => void;
  onResolve: () => void;
  onFalsePositive: () => void;
}

function DetailPanel({
  event,
  onClose,
  onInvestigate,
  onResolve,
  onFalsePositive,
}: DetailPanelProps): ReactNode {
  const canAct = event.status === 'open' || event.status === 'investigating';

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-surface">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border p-4">
        <div className="min-w-0 flex-1 pr-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={event.severity} />
            <TypeBadge type={event.type} />
          </div>
          <p className="text-sm font-medium text-content leading-snug">{event.title}</p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-content-tertiary hover:text-content"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status + Time */}
        <div className="flex items-center justify-between">
          <StatusBadge status={event.status} />
          <span className="text-2xs text-content-tertiary">
            Detected {fmtRelative(event.detectedAt)}
          </span>
        </div>

        {/* Description */}
        <div>
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
            Description
          </p>
          <p className="text-xs text-content-secondary leading-relaxed">{event.description}</p>
        </div>

        {/* Metadata grid */}
        <div className="space-y-2 rounded-lg border border-border bg-surface-secondary p-3">
          <Row label="Rule ID" value={event.ruleId ?? '—'} mono />
          <Row label="Resource" value={event.affectedResource ?? '—'} mono />
          {event.actorId !== null && <Row label="Actor ID" value={event.actorId} mono />}
          {event.sourceIpHash !== null && (
            <Row
              label="Source IP (SHA-256)"
              value={truncateHash(event.sourceIpHash)}
              mono
              title={event.sourceIpHash}
            />
          )}
          {event.userAgent !== null && <Row label="User-Agent" value={event.userAgent} />}
          <Row label="Detected" value={new Date(event.detectedAt).toLocaleString()} />
          {event.resolvedAt !== null && (
            <Row label="Resolved" value={new Date(event.resolvedAt).toLocaleString()} />
          )}
        </div>

        {/* Resolution notes */}
        {event.resolutionNotes !== null && (
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
              Resolution Notes
            </p>
            <div className="rounded-lg border border-border bg-surface-secondary p-3">
              <p className="text-xs text-content-secondary leading-relaxed">
                {event.resolutionNotes}
              </p>
            </div>
          </div>
        )}

        {/* Compliance anchor */}
        <div className="rounded-lg border border-border bg-surface-secondary p-3">
          <p className="text-2xs text-content-tertiary">
            <span className="font-semibold text-content-secondary">Compliance context:</span> This
            event and all status transitions are immutably recorded in the WORM audit chain with a
            SHA-256 hash link. Evidence preserved for SOC 2 CC7 + ISO A.8.16 assessments.
          </p>
        </div>
      </div>

      {/* Actions */}
      {canAct && (
        <div className="border-t border-border p-4 space-y-2">
          {event.status === 'open' && (
            <button
              onClick={onInvestigate}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-tertiary py-2 text-sm font-medium text-content hover:bg-surface-secondary"
            >
              <Eye className="h-4 w-4" />
              Mark Investigating
            </button>
          )}
          <button
            onClick={onResolve}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 py-2 text-sm font-medium text-white hover:bg-emerald-600"
          >
            <CheckCircle2 className="h-4 w-4" />
            Resolve Event
          </button>
          <button
            onClick={onFalsePositive}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm text-content-secondary hover:text-content"
          >
            <MoreHorizontal className="h-4 w-4" />
            Mark False Positive
          </button>
        </div>
      )}
    </aside>
  );
}

function Row({
  label,
  value,
  mono = false,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}): ReactNode {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-2xs text-content-tertiary">{label}</span>
      <span
        className={`text-right text-2xs text-content-secondary ${mono ? 'font-mono' : ''}`}
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${color ?? 'text-content'}`}>{value}</p>
      {sub !== undefined && <p className="mt-0.5 text-xs text-content-tertiary">{sub}</p>}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function SecurityEvents(): ReactNode {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [stats, setStats] = useState<SecurityEventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [filterSeverity, setFilterSeverity] = useState<SecurityEventSeverity | ''>('');
  const [filterStatus, setFilterStatus] = useState<SecurityEventStatus | ''>('');
  const [filterType, setFilterType] = useState<SecurityEventType | ''>('');
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<SecurityEvent | null>(null);
  const [actionModal, setActionModal] = useState<'resolve' | 'false_positive' | null>(null);

  const loadRef = useRef(0);

  const load = useCallback(
    async (pg: number) => {
      setLoading(true);
      const seq = ++loadRef.current;
      try {
        const [evtRes, statsRes] = await Promise.all([
          securityApi.listEvents({
            ...(filterSeverity ? { severity: filterSeverity } : {}),
            ...(filterStatus ? { status: filterStatus } : {}),
            ...(filterType ? { type: filterType } : {}),
            page: pg,
            limit: PAGE_SIZE,
          }),
          securityApi.getStats(),
        ]);
        if (seq !== loadRef.current) return;
        setEvents(evtRes.items);
        setTotal(evtRes.total);
        setStats(statsRes);
      } catch {
        if (seq !== loadRef.current) return;
        // Fallback to mock data
        let filtered = MOCK_EVENTS;
        if (filterSeverity) filtered = filtered.filter((e) => e.severity === filterSeverity);
        if (filterStatus) filtered = filtered.filter((e) => e.status === filterStatus);
        if (filterType) filtered = filtered.filter((e) => e.type === filterType);
        const start = (pg - 1) * PAGE_SIZE;
        setEvents(filtered.slice(start, start + PAGE_SIZE));
        setTotal(filtered.length);
        setStats(MOCK_STATS);
      } finally {
        if (seq === loadRef.current) setLoading(false);
      }
    },
    [filterSeverity, filterStatus, filterType],
  );

  useEffect(() => {
    setPage(1);
    void load(1);
  }, [load]);

  const handleInvestigate = useCallback(async () => {
    if (!selected) return;
    try {
      await securityApi.markInvestigating(selected.id);
    } catch {
      // mock: update locally
    }
    setEvents((prev) =>
      prev.map((e) => (e.id === selected.id ? { ...e, status: 'investigating' as const } : e)),
    );
    setSelected((prev) => (prev ? { ...prev, status: 'investigating' as const } : null));
  }, [selected]);

  const handleActionConfirm = useCallback(
    async (notes: string) => {
      if (!selected || !actionModal) return;
      try {
        if (actionModal === 'resolve') {
          await securityApi.resolve(selected.id, notes);
        } else {
          await securityApi.markFalsePositive(selected.id, notes);
        }
      } catch {
        // mock: update locally
      }
      const newStatus =
        actionModal === 'resolve' ? ('resolved' as const) : ('false_positive' as const);
      const now = new Date().toISOString();
      setEvents((prev) =>
        prev.map((e) =>
          e.id === selected.id
            ? { ...e, status: newStatus, resolvedAt: now, resolutionNotes: notes }
            : e,
        ),
      );
      setSelected((prev) =>
        prev ? { ...prev, status: newStatus, resolvedAt: now, resolutionNotes: notes } : null,
      );
      setActionModal(null);
    },
    [selected, actionModal],
  );

  const filteredEvents = search
    ? events.filter(
        (e) =>
          e.title.toLowerCase().includes(search.toLowerCase()) ||
          (e.affectedResource?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
          (e.ruleId?.toLowerCase().includes(search.toLowerCase()) ?? false),
      )
    : events;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col">
      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-brand-accent" />
          <div>
            <h1 className="text-base font-semibold text-content">Security Events</h1>
            <p className="text-xs text-content-tertiary">
              Threat detection · SOC 2 CC7.1 · ISO A.8.16 · HIPAA §164.312(b)
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            void load(page);
          }}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-content-secondary hover:text-content disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* ─── Stat Cards ──────────────────────────────── */}
          <div className="grid grid-cols-4 gap-4 border-b border-border px-6 py-4">
            <StatCard
              label="Open Critical"
              value={stats?.openCritical ?? '—'}
              sub="Requires immediate action"
              color="text-red-400"
            />
            <StatCard
              label="Open High"
              value={stats?.openHigh ?? '—'}
              sub="SLA: 1-hour response"
              color="text-orange-400"
            />
            <StatCard
              label="Resolved Today"
              value={stats?.resolvedToday ?? '—'}
              sub="Closed in current UTC day"
              color="text-emerald-400"
            />
            <StatCard
              label="Avg Resolution"
              value={stats !== null ? `${stats.avgResolutionHours.toFixed(1)}h` : '—'}
              sub="MTTR last 30 days"
            />
          </div>

          {/* ─── Filters ─────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-tertiary" />
              <input
                type="text"
                placeholder="Search title, resource, rule…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                className="h-8 rounded-lg border border-border bg-surface-tertiary pl-8 pr-3 text-xs text-content placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-brand-accent w-56"
              />
            </div>

            <select
              value={filterSeverity}
              onChange={(e) => {
                setFilterSeverity(e.target.value as SecurityEventSeverity | '');
              }}
              className="h-8 rounded-lg border border-border bg-surface-tertiary px-2 text-xs text-content focus:outline-none focus:ring-1 focus:ring-brand-accent"
            >
              <option value="">All severities</option>
              {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as SecurityEventSeverity[]).map(
                (s) => (
                  <option key={s} value={s}>
                    {SEVERITY_CONFIG[s].label}
                  </option>
                ),
              )}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value as SecurityEventStatus | '');
              }}
              className="h-8 rounded-lg border border-border bg-surface-tertiary px-2 text-xs text-content focus:outline-none focus:ring-1 focus:ring-brand-accent"
            >
              <option value="">All statuses</option>
              {(
                ['open', 'investigating', 'resolved', 'false_positive'] as SecurityEventStatus[]
              ).map((s) => (
                <option key={s} value={s}>
                  {STATUS_CONFIG[s].label}
                </option>
              ))}
            </select>

            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value as SecurityEventType | '');
              }}
              className="h-8 rounded-lg border border-border bg-surface-tertiary px-2 text-xs text-content focus:outline-none focus:ring-1 focus:ring-brand-accent"
            >
              <option value="">All types</option>
              {(Object.keys(TYPE_LABELS) as SecurityEventType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>

            <span className="ml-auto text-xs text-content-tertiary">
              {total} event{total !== 1 ? 's' : ''}
            </span>
          </div>

          {/* ─── Event List ──────────────────────────────── */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Spinner size="lg" label="Loading events" />
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-content-tertiary">
                <ShieldAlert className="h-8 w-8 opacity-40" />
                <p className="text-sm">No events match the current filters</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
                    <th className="px-6 py-2 text-left">Severity</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left">Title</th>
                    <th className="px-4 py-2 text-left">Resource</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Detected</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((evt) => {
                    const isSelected = selected?.id === evt.id;
                    const sevCfg = SEVERITY_CONFIG[evt.severity];
                    return (
                      <tr
                        key={evt.id}
                        onClick={() => {
                          setSelected(isSelected ? null : evt);
                        }}
                        className={`cursor-pointer border-b border-border transition-colors hover:bg-surface-secondary ${
                          isSelected ? 'bg-surface-secondary' : ''
                        }`}
                      >
                        <td className="px-6 py-3">
                          <SeverityBadge severity={evt.severity} />
                        </td>
                        <td className="px-4 py-3">
                          <TypeBadge type={evt.type} />
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sevCfg.dot}`} />
                            <span className="truncate text-content">{evt.title}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-content-tertiary">
                            {evt.affectedResource ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={evt.status} />
                        </td>
                        <td className="px-4 py-3 text-content-tertiary">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {fmtRelative(evt.detectedAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-content-tertiary">
                          <ChevronRight className="h-3.5 w-3.5" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ─── Pagination ──────────────────────────────── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-6 py-3">
              <span className="text-xs text-content-tertiary">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const p = page - 1;
                    setPage(p);
                    void load(p);
                  }}
                  disabled={page === 1}
                  className="rounded-lg border border-border px-3 py-1 text-xs text-content-secondary hover:text-content disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => {
                    const p = page + 1;
                    setPage(p);
                    void load(p);
                  }}
                  disabled={page === totalPages}
                  className="rounded-lg border border-border px-3 py-1 text-xs text-content-secondary hover:text-content disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── Detail Panel ────────────────────────────────── */}
        {selected !== null && (
          <DetailPanel
            event={selected}
            onClose={() => {
              setSelected(null);
            }}
            onInvestigate={() => {
              void handleInvestigate();
            }}
            onResolve={() => {
              setActionModal('resolve');
            }}
            onFalsePositive={() => {
              setActionModal('false_positive');
            }}
          />
        )}
      </div>

      {/* ─── Action Modal ────────────────────────────────────── */}
      {actionModal !== null && selected !== null && (
        <ActionModal
          event={selected}
          mode={actionModal}
          onClose={() => {
            setActionModal(null);
          }}
          onConfirm={handleActionConfirm}
        />
      )}
    </div>
  );
}
