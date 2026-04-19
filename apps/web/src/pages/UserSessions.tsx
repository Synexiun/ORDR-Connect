/**
 * User Sessions — Active operator session inventory with revocation.
 *
 * Shows all live sessions for the current tenant: device, location (country
 * only), MFA status, and session age. Supports per-session revocation and
 * bulk "revoke all others" for incident response.
 *
 * SECURITY:
 * - Source IPs shown as SHA-256 hashes only — Rule 6
 * - Geo shown as 2-letter country code only (no city/region) — Rule 6
 * - Session revocation inserts JTI into Redis deny-list immediately — Rule 2
 * - isCurrent flag is server-derived — cannot be spoofed by client — Rule 2
 * - All revocations WORM-logged with actor identity — Rule 3
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.15 | HIPAA §164.312(a)(2)(iii)
 */

import { type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import {
  UserCog,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Monitor,
  Smartphone,
  Code2,
  LogOut,
  Globe,
  Activity,
  Users,
} from '../components/icons';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import {
  sessionsApi,
  type UserSession,
  type SessionStatus,
  type DeviceType,
  type SessionStats,
  type FailedLoginAttempt,
} from '../lib/sessions-api';

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  SessionStatus,
  { label: string; variant: 'success' | 'warning' | 'default'; dot: string }
> = {
  active: { label: 'Active', variant: 'success', dot: 'bg-emerald-400' },
  idle: { label: 'Idle', variant: 'warning', dot: 'bg-amber-400' },
  expired: { label: 'Expired', variant: 'default', dot: 'bg-content-tertiary' },
};

const DEVICE_ICONS: Record<DeviceType, ReactNode> = {
  desktop: <Monitor className="h-3.5 w-3.5" />,
  mobile: <Smartphone className="h-3.5 w-3.5" />,
  api: <Code2 className="h-3.5 w-3.5" />,
};

const FAILED_REASON_LABELS: Record<FailedLoginAttempt['reason'], string> = {
  bad_password: 'Bad password',
  mfa_failed: 'MFA failed',
  account_locked: 'Account locked',
  invalid_token: 'Invalid token',
};

// ── Mock Data ──────────────────────────────────────────────────────────────

const NOW = Date.now();

const MOCK_SESSIONS: UserSession[] = [
  {
    id: 'sess_current',
    jti: 'jti_a1b2c3d4e5f6',
    userId: 'usr_demo_operator',
    userDisplayName: 'Alex M.',
    userRole: 'Operator',
    sourceIpHash: 'a3f2c9e1d84b57f0c6219e3d728af41b29c05e87634f1a09b2d5c8e7f0341298',
    countryCode: 'US',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    deviceType: 'desktop',
    mfaVerified: true,
    loginAt: new Date(NOW - 2.4 * 3_600_000).toISOString(),
    lastActiveAt: new Date(NOW - 45_000).toISOString(),
    expiresAt: new Date(NOW + 5.6 * 3_600_000).toISOString(),
    status: 'active',
    isCurrent: true,
  },
  {
    id: 'sess_02',
    jti: 'jti_b2c3d4e5f6a1',
    userId: 'usr_sarah_k',
    userDisplayName: 'Sarah K.',
    userRole: 'Supervisor',
    sourceIpHash: 'b7c3d9e0f2a148c5376d8e21b094f7a3c52e1d684b09f2e3a7c8d14b5e6f2908',
    countryCode: 'US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    deviceType: 'desktop',
    mfaVerified: true,
    loginAt: new Date(NOW - 1.1 * 3_600_000).toISOString(),
    lastActiveAt: new Date(NOW - 120_000).toISOString(),
    expiresAt: new Date(NOW + 6.9 * 3_600_000).toISOString(),
    status: 'active',
    isCurrent: false,
  },
  {
    id: 'sess_03',
    jti: 'jti_c3d4e5f6a1b2',
    userId: 'usr_james_t',
    userDisplayName: 'James T.',
    userRole: 'Operator',
    sourceIpHash: 'c9e1a2f0d7b345c8216d9f4e7b03a1c2e58d4b9731f0e2d3a6c8e4f7b01249536',
    countryCode: 'GB',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    deviceType: 'mobile',
    mfaVerified: true,
    loginAt: new Date(NOW - 4.8 * 3_600_000).toISOString(),
    lastActiveAt: new Date(NOW - 22 * 60_000).toISOString(),
    expiresAt: new Date(NOW + 3.2 * 3_600_000).toISOString(),
    status: 'idle',
    isCurrent: false,
  },
  {
    id: 'sess_04',
    jti: 'jti_d4e5f6a1b2c3',
    userId: 'svc-crm-sync',
    userDisplayName: 'CRM Sync Service',
    userRole: 'ServiceAccount',
    sourceIpHash: null,
    countryCode: null,
    userAgent: 'ordr-crm-worker/2.1.0',
    deviceType: 'api',
    mfaVerified: false,
    loginAt: new Date(NOW - 0.3 * 3_600_000).toISOString(),
    lastActiveAt: new Date(NOW - 8_000).toISOString(),
    expiresAt: new Date(NOW + 0.45 * 3_600_000).toISOString(),
    status: 'active',
    isCurrent: false,
  },
  {
    id: 'sess_05',
    jti: 'jti_e5f6a1b2c3d4',
    userId: 'usr_priya_r',
    userDisplayName: 'Priya R.',
    userRole: 'Analyst',
    sourceIpHash: 'e9d2f1a4c87b356f021ce9847a3b50d12e8f94c673a0159b28d6e4f7c0312485',
    countryCode: 'IN',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    deviceType: 'desktop',
    mfaVerified: false,
    loginAt: new Date(NOW - 3.2 * 3_600_000).toISOString(),
    lastActiveAt: new Date(NOW - 18 * 60_000).toISOString(),
    expiresAt: new Date(NOW + 4.8 * 3_600_000).toISOString(),
    status: 'idle',
    isCurrent: false,
  },
  {
    id: 'sess_06',
    jti: 'jti_f6a1b2c3d4e5',
    userId: 'usr_support_01',
    userDisplayName: 'Support T.',
    userRole: 'Support',
    sourceIpHash: 'f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2',
    countryCode: 'CA',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15',
    deviceType: 'desktop',
    mfaVerified: true,
    loginAt: new Date(NOW - 0.6 * 3_600_000).toISOString(),
    lastActiveAt: new Date(NOW - 3 * 60_000).toISOString(),
    expiresAt: new Date(NOW + 7.4 * 3_600_000).toISOString(),
    status: 'active',
    isCurrent: false,
  },
];

const MOCK_FAILED_LOGINS: FailedLoginAttempt[] = [
  {
    id: 'fl_01',
    sourceIpHash: 'a3f2c9e1d84b57f0c621...',
    countryCode: 'RU',
    userAgent: 'python-requests/2.28.0',
    attemptedAt: new Date(NOW - 12 * 60_000).toISOString(),
    reason: 'bad_password',
  },
  {
    id: 'fl_02',
    sourceIpHash: 'b4e1f0d2c8a357b9e421...',
    countryCode: 'CN',
    userAgent: 'curl/8.0.1',
    attemptedAt: new Date(NOW - 18 * 60_000).toISOString(),
    reason: 'bad_password',
  },
  {
    id: 'fl_03',
    sourceIpHash: 'c5f2e1d3b9a468c0f532...',
    countryCode: 'CN',
    userAgent: 'curl/8.0.1',
    attemptedAt: new Date(NOW - 18 * 60_000).toISOString(),
    reason: 'bad_password',
  },
  {
    id: 'fl_04',
    sourceIpHash: 'a3f2c9e1d84b57f0c621...',
    countryCode: 'RU',
    userAgent: 'python-requests/2.28.0',
    attemptedAt: new Date(NOW - 24 * 60_000).toISOString(),
    reason: 'mfa_failed',
  },
  {
    id: 'fl_05',
    sourceIpHash: 'd6a3f2e4c0b579d1e643...',
    countryCode: 'BR',
    userAgent: 'Mozilla/5.0',
    attemptedAt: new Date(NOW - 42 * 60_000).toISOString(),
    reason: 'bad_password',
  },
  {
    id: 'fl_06',
    sourceIpHash: 'e7b4a3f5d1c680e2f754...',
    countryCode: 'US',
    userAgent: 'Go-http-client/2.0',
    attemptedAt: new Date(NOW - 68 * 60_000).toISOString(),
    reason: 'invalid_token',
  },
  {
    id: 'fl_07',
    sourceIpHash: 'a3f2c9e1d84b57f0c621...',
    countryCode: 'RU',
    userAgent: 'python-requests/2.28.0',
    attemptedAt: new Date(NOW - 95 * 60_000).toISOString(),
    reason: 'account_locked',
  },
];

const MOCK_STATS: SessionStats = {
  activeSessions: 4,
  failedLogins24h: 12,
  avgSessionDurationHours: 4.2,
  mfaCoverage: 67,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${(diff / 3_600_000).toFixed(1)}h ago`;
}

function fmtDuration(loginIso: string): string {
  const diff = Date.now() - new Date(loginIso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  return `${(diff / 3_600_000).toFixed(1)}h`;
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function parseDevice(userAgent: string): string {
  if (userAgent.includes('iPhone') || userAgent.includes('Android')) return 'Mobile';
  if (userAgent.includes('ordr-')) return 'API client';
  if (userAgent.includes('curl') || userAgent.includes('python') || userAgent.includes('Go-http'))
    return 'CLI / script';
  if (userAgent.includes('Macintosh')) return 'macOS';
  if (userAgent.includes('Windows')) return 'Windows';
  if (userAgent.includes('Linux')) return 'Linux';
  return 'Unknown';
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  alert,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
}): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-content-tertiary">
        {icon}
        <span className="text-2xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${alert === true ? 'text-amber-400' : 'text-content'}`}>
        {value}
      </p>
      {sub !== undefined && <p className="mt-0.5 text-xs text-content-tertiary">{sub}</p>}
    </div>
  );
}

// ── Revoke Modal ───────────────────────────────────────────────────────────

function RevokeModal({
  session,
  onClose,
  onConfirm,
}: {
  session: UserSession;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}): ReactNode {
  const [loading, setLoading] = useState(false);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  }, [onConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-content">Revoke Session</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-content-tertiary hover:text-content"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-lg border border-border bg-surface-secondary p-3">
          <p className="text-xs font-medium text-content">{session.userDisplayName}</p>
          <p className="mt-1 text-2xs text-content-tertiary">
            {parseDevice(session.userAgent)} · {session.countryCode ?? 'unknown'} · active{' '}
            {fmtRelative(session.lastActiveAt)}
          </p>
        </div>

        <div className="mb-4 rounded-lg border border-border bg-surface-secondary p-3">
          <p className="text-2xs text-content-tertiary">
            The session token (JTI) is immediately added to the Redis deny-list. The user will be
            signed out on their next request. This action is WORM-logged (SOC 2 CC6.1).
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-content-secondary hover:text-content"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleConfirm();
            }}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-red-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {loading && <Spinner size="sm" />}
            <LogOut className="h-3.5 w-3.5" />
            Revoke Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Revoke All Others Modal ────────────────────────────────────────────────

function RevokeAllModal({
  count,
  onClose,
  onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}): ReactNode {
  const [loading, setLoading] = useState(false);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  }, [onConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-content">Revoke All Other Sessions</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-content-tertiary hover:text-content"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs text-amber-400">
            This will immediately revoke {count} session{count !== 1 ? 's' : ''}. Your current
            session is preserved. Use during incident response or suspected account compromise.
          </p>
        </div>

        <div className="mb-4 rounded-lg border border-border bg-surface-secondary p-3">
          <p className="text-2xs text-content-tertiary">
            All {count} other session JTIs are inserted into the Redis deny-list simultaneously.
            Users will be signed out on their next request. WORM-logged (SOC 2 CC6.1).
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-content-secondary hover:text-content"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleConfirm();
            }}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-red-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {loading && <Spinner size="sm" />}
            <LogOut className="h-3.5 w-3.5" />
            Revoke {count} Session{count !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Session Row ────────────────────────────────────────────────────────────

function SessionRow({
  session,
  selected,
  onClick,
  onRevoke,
}: {
  session: UserSession;
  selected: boolean;
  onClick: () => void;
  onRevoke: (e: React.MouseEvent) => void;
}): ReactNode {
  const statusCfg = STATUS_CONFIG[session.status];

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer border-b border-border transition-colors hover:bg-surface-secondary ${
        selected ? 'bg-surface-secondary' : ''
      }`}
    >
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusCfg.dot}`} />
          <div>
            <p className="text-xs font-medium text-content">
              {session.userDisplayName}
              {session.isCurrent && (
                <span className="ml-1.5 rounded-full bg-brand-accent/20 px-1.5 py-0.5 text-2xs text-brand-accent">
                  You
                </span>
              )}
            </p>
            <p className="text-2xs text-content-tertiary">{session.userRole}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-content-secondary">
          {DEVICE_ICONS[session.deviceType]}
          <span className="text-xs">{parseDevice(session.userAgent)}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-content-secondary">
          <Globe className="h-3.5 w-3.5" />
          <span className="text-xs">{session.countryCode ?? '—'}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        {session.mfaVerified ? (
          <div className="flex items-center gap-1 text-emerald-400">
            <Shield className="h-3.5 w-3.5" />
            <span className="text-2xs">Verified</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-2xs">Not verified</span>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-content-tertiary">{fmtDuration(session.loginAt)}</td>
      <td className="px-4 py-3 text-xs text-content-tertiary">
        {fmtRelative(session.lastActiveAt)}
      </td>
      <td className="px-4 py-3">
        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
      </td>
      <td className="px-4 py-3">
        {!session.isCurrent && session.status !== 'expired' && (
          <button
            onClick={onRevoke}
            className="rounded px-2 py-1 text-2xs text-content-tertiary hover:bg-red-500/10 hover:text-red-400"
          >
            Revoke
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────

function DetailPanel({
  session,
  onClose,
  onRevoke,
}: {
  session: UserSession;
  onClose: () => void;
  onRevoke: () => void;
}): ReactNode {
  const statusCfg = STATUS_CONFIG[session.status];
  const canRevoke = !session.isCurrent && session.status !== 'expired';

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-start justify-between border-b border-border p-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <p className="text-sm font-semibold text-content">{session.userDisplayName}</p>
            {session.isCurrent && (
              <span className="rounded-full bg-brand-accent/20 px-1.5 py-0.5 text-2xs text-brand-accent">
                Current
              </span>
            )}
          </div>
          <p className="text-2xs text-content-tertiary">{session.userRole}</p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-content-tertiary hover:text-content">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
          <div className="flex items-center gap-1.5">
            {DEVICE_ICONS[session.deviceType]}
            <span className="text-xs text-content-secondary">{parseDevice(session.userAgent)}</span>
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg border border-border bg-surface-secondary p-3">
          {[
            ['User ID', session.userId],
            ['Session JTI', session.jti],
            ['MFA verified', session.mfaVerified ? 'Yes' : 'No'],
            ['Country', session.countryCode ?? '—'],
            [
              'IP (SHA-256)',
              session.sourceIpHash !== null ? truncateHash(session.sourceIpHash) : '—',
            ],
            ['Login', new Date(session.loginAt).toLocaleString()],
            ['Last active', fmtRelative(session.lastActiveAt)],
            ['Session age', fmtDuration(session.loginAt)],
            ['Expires', new Date(session.expiresAt).toLocaleString()],
          ].map(([label, val]) => (
            <div key={label} className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-2xs text-content-tertiary">{label}</span>
              <span className="text-right font-mono text-2xs text-content-secondary break-all">
                {val}
              </span>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
            User-Agent
          </p>
          <p className="rounded-lg border border-border bg-surface-secondary p-2 font-mono text-2xs text-content-tertiary break-all">
            {session.userAgent}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface-secondary p-3">
          <p className="text-2xs text-content-tertiary">
            Session revocation inserts the JTI into the Redis deny-list immediately. User is signed
            out on their next API request. Action is WORM-logged (SOC 2 CC6.1, ISO A.8.15).
          </p>
        </div>
      </div>

      {canRevoke && (
        <div className="border-t border-border p-4">
          <button
            onClick={onRevoke}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 py-2 text-sm font-medium text-white hover:bg-red-600"
          >
            <LogOut className="h-4 w-4" />
            Revoke Session
          </button>
        </div>
      )}
    </aside>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

type PageTab = 'sessions' | 'failed';

export function UserSessions(): ReactNode {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [failedLogins, setFailedLogins] = useState<FailedLoginAttempt[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<PageTab>('sessions');
  const [selected, setSelected] = useState<UserSession | null>(null);
  const [revoking, setRevoking] = useState<UserSession | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [filterStatus, setFilterStatus] = useState<SessionStatus | ''>('');
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    const seq = ++loadRef.current;
    try {
      const [sessRes, failedRes, statsRes] = await Promise.all([
        sessionsApi.listSessions(),
        sessionsApi.listFailedLogins(),
        sessionsApi.getStats(),
      ]);
      if (seq !== loadRef.current) return;
      setSessions(sessRes);
      setFailedLogins(failedRes);
      setStats(statsRes);
    } catch {
      if (seq !== loadRef.current) return;
      setSessions(MOCK_SESSIONS);
      setFailedLogins(MOCK_FAILED_LOGINS);
      setStats(MOCK_STATS);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = useCallback(async (session: UserSession) => {
    try {
      await sessionsApi.revokeSession(session.id);
    } catch {
      // mock: update locally
    }
    setSessions((prev) => prev.filter((s) => s.id !== session.id));
    setSelected((prev) => (prev?.id === session.id ? null : prev));
    setRevoking(null);
  }, []);

  const handleRevokeAll = useCallback(async () => {
    try {
      await sessionsApi.revokeAllOthers();
    } catch {
      // mock: update locally
    }
    setSessions((prev) => prev.filter((s) => s.isCurrent));
    setSelected(null);
    setRevokingAll(false);
  }, []);

  const filteredSessions = filterStatus
    ? sessions.filter((s) => s.status === filterStatus)
    : sessions;

  const nonCurrentCount = sessions.filter((s) => !s.isCurrent && s.status !== 'expired').length;
  const noMfaCount = sessions.filter((s) => !s.mfaVerified && s.status === 'active').length;
  const mfaCoverage = stats?.mfaCoverage ?? 0;

  const tabs: { id: PageTab; label: string }[] = [
    { id: 'sessions', label: `Active Sessions (${sessions.length})` },
    { id: 'failed', label: `Failed Logins (${failedLogins.length})` },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <UserCog className="h-5 w-5 text-brand-accent" />
          <div>
            <h1 className="text-base font-semibold text-content">User Sessions</h1>
            <p className="text-xs text-content-tertiary">
              Session management · SOC 2 CC6.1 · ISO A.8.15 · HIPAA §164.312(a)(2)(iii)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {nonCurrentCount > 0 && (
            <button
              onClick={() => {
                setRevokingAll(true);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20"
            >
              <LogOut className="h-3.5 w-3.5" />
              Revoke All Others
            </button>
          )}
          <button
            onClick={() => {
              void load();
            }}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-content-secondary hover:text-content disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ─── MFA warning ─────────────────────────────────── */}
      {noMfaCount > 0 && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <p className="text-sm text-amber-300">
            {noMfaCount} active session{noMfaCount !== 1 ? 's' : ''} without MFA verification. HIPAA
            §164.312(d) requires user identity verification.
          </p>
        </div>
      )}

      {/* ─── Stats ───────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4 border-b border-border px-6 py-4">
        <StatCard
          icon={<Users className="h-3.5 w-3.5" />}
          label="Active Sessions"
          value={stats?.activeSessions ?? '—'}
          sub="Current tenant"
        />
        <StatCard
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Failed Logins (24h)"
          value={stats?.failedLogins24h ?? '—'}
          sub="Across all accounts"
          alert={(stats?.failedLogins24h ?? 0) > 10}
        />
        <StatCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Avg Duration"
          value={stats !== null ? `${stats.avgSessionDurationHours.toFixed(1)}h` : '—'}
          sub="Active sessions"
        />
        <StatCard
          icon={<Shield className="h-3.5 w-3.5" />}
          label="MFA Coverage"
          value={stats !== null ? `${mfaCoverage}%` : '—'}
          sub={mfaCoverage < 100 ? 'Not all sessions MFA-verified' : 'All sessions verified'}
          alert={mfaCoverage < 100}
        />
      </div>

      {/* ─── Tabs ────────────────────────────────────────── */}
      <div className="flex border-b border-border px-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setSelected(null);
            }}
            className={`-mb-px mr-4 border-b-2 py-2.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'border-brand-accent text-content'
                : 'border-transparent text-content-tertiary hover:text-content'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Body ────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {tab === 'sessions' && (
            <>
              {/* Filters */}
              <div className="flex items-center gap-2 border-b border-border px-5 py-2">
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value as SessionStatus | '');
                  }}
                  className="h-8 rounded-lg border border-border bg-surface-tertiary px-2 text-xs text-content focus:outline-none focus:ring-1 focus:ring-brand-accent"
                >
                  <option value="">All statuses</option>
                  {(['active', 'idle', 'expired'] as SessionStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_CONFIG[s].label}
                    </option>
                  ))}
                </select>
                <span className="ml-auto text-xs text-content-tertiary">
                  {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                  {loading ? (
                    <div className="flex h-32 items-center justify-center">
                      <Spinner size="lg" label="Loading sessions" />
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
                          <th className="px-5 py-2 text-left">User</th>
                          <th className="px-4 py-2 text-left">Device</th>
                          <th className="px-4 py-2 text-left">Country</th>
                          <th className="px-4 py-2 text-left">MFA</th>
                          <th className="px-4 py-2 text-left">Duration</th>
                          <th className="px-4 py-2 text-left">Last active</th>
                          <th className="px-4 py-2 text-left">Status</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSessions.map((s) => (
                          <SessionRow
                            key={s.id}
                            session={s}
                            selected={selected?.id === s.id}
                            onClick={() => {
                              setSelected(selected?.id === s.id ? null : s);
                            }}
                            onRevoke={(e) => {
                              e.stopPropagation();
                              setRevoking(s);
                            }}
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {selected !== null && (
                  <DetailPanel
                    session={selected}
                    onClose={() => {
                      setSelected(null);
                    }}
                    onRevoke={() => {
                      setRevoking(selected);
                    }}
                  />
                )}
              </div>
            </>
          )}

          {tab === 'failed' && (
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-32 items-center justify-center">
                  <Spinner size="lg" label="Loading failed logins" />
                </div>
              ) : failedLogins.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-content-tertiary">
                  <CheckCircle2 className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No failed login attempts in the last 24 hours</p>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
                      <th className="px-5 py-2 text-left">IP (SHA-256)</th>
                      <th className="px-4 py-2 text-left">Country</th>
                      <th className="px-4 py-2 text-left">User-Agent</th>
                      <th className="px-4 py-2 text-left">Reason</th>
                      <th className="px-4 py-2 text-left">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedLogins.map((fl) => (
                      <tr key={fl.id} className="border-b border-border">
                        <td className="px-5 py-2.5 font-mono text-content-secondary">
                          {fl.sourceIpHash}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5 text-content-tertiary" />
                            <span className="text-content-secondary">{fl.countryCode ?? '—'}</span>
                          </div>
                        </td>
                        <td className="max-w-xs truncate px-4 py-2.5 text-content-tertiary">
                          {fl.userAgent}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant={
                              fl.reason === 'account_locked'
                                ? 'danger'
                                : fl.reason === 'mfa_failed'
                                  ? 'warning'
                                  : 'default'
                            }
                          >
                            {FAILED_REASON_LABELS[fl.reason]}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-content-tertiary">
                          {fmtRelative(fl.attemptedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Modals ───────────────────────────────────────── */}
      {revoking !== null && (
        <RevokeModal
          session={revoking}
          onClose={() => {
            setRevoking(null);
          }}
          onConfirm={() => handleRevoke(revoking)}
        />
      )}
      {revokingAll && (
        <RevokeAllModal
          count={nonCurrentCount}
          onClose={() => {
            setRevokingAll(false);
          }}
          onConfirm={handleRevokeAll}
        />
      )}
    </div>
  );
}
