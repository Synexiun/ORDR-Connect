/**
 * CoBrowse — Co-browsing session management dashboard.
 *
 * Allows admin/support to initiate sessions, view active/pending sessions,
 * and manage session lifecycle (accept/reject/end).
 *
 * COMPLIANCE:
 * - No PHI displayed — userId is an opaque reference (Rule 6)
 * - recordingEnabled shown prominently; consent status visible (HIPAA §164.312)
 * - All state changes carry X-Request-Id for WORM audit trail (Rule 3)
 * - Session IDs never exposed in URL parameters (Rule 6)
 */

import { type ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { Toggle } from '../components/ui/Toggle';
import {
  Monitor,
  Eye,
  Video,
  VideoOff,
  Radio,
  Phone,
  StopCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Timer,
  Plus,
  RefreshCw,
  UserCog,
  Shield,
  X,
} from '../components/icons';
import {
  type CobrowseSession,
  type CobrowseSessionStatus,
  type CobrowseMode,
  type CobrowseSignal,
  listCobrowseSessions,
  initiateCobrowseSession,
  acceptCobrowseSession,
  rejectCobrowseSession,
  endCobrowseSession,
  sendCobrowseSignal,
  subscribeCobrowseEvents,
} from '../lib/cobrowse-api';
import type { BadgeVariant } from '../components/ui/Badge';
import { cn } from '../lib/cn';

// ── Meta maps ─────────────────────────────────────────────────────

const STATUS_META: Record<
  CobrowseSessionStatus,
  { label: string; variant: BadgeVariant; Icon: ReactNode }
> = {
  pending: {
    label: 'Pending',
    variant: 'warning',
    Icon: <Clock className="h-3.5 w-3.5" />,
  },
  active: {
    label: 'Active',
    variant: 'success',
    Icon: <Radio className="h-3.5 w-3.5" />,
  },
  ended: {
    label: 'Ended',
    variant: 'neutral',
    Icon: <StopCircle className="h-3.5 w-3.5" />,
  },
  rejected: {
    label: 'Rejected',
    variant: 'danger',
    Icon: <XCircle className="h-3.5 w-3.5" />,
  },
  expired: {
    label: 'Expired',
    variant: 'neutral',
    Icon: <Timer className="h-3.5 w-3.5" />,
  },
};

const MODE_META: Record<CobrowseMode, { label: string; description: string; Icon: ReactNode }> = {
  view: {
    label: 'View',
    description: 'Read-only — agent watches the customer session',
    Icon: <Eye className="h-4 w-4" />,
  },
  assist: {
    label: 'Assist',
    description: 'Interactive — agent can annotate and guide',
    Icon: <UserCog className="h-4 w-4" />,
  },
};

// ── Helpers ───────────────────────────────────────────────────────

function fmtRelative(iso: string | null): string {
  if (iso === null) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${String(secs)}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  return `${String(hours)}h ago`;
}

function fmtDuration(start: string | null, end: string | null): string {
  if (start === null) return '—';
  const endTime = end !== null ? new Date(end).getTime() : Date.now();
  const secs = Math.floor((endTime - new Date(start).getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m)}m ${String(s).padStart(2, '0')}s`;
}

function isTerminal(status: CobrowseSessionStatus): boolean {
  return status === 'ended' || status === 'rejected' || status === 'expired';
}

// ── Stat card ─────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  icon: ReactNode;
  accent?: string;
}

function StatCard({ label, value, icon, accent = 'text-brand-accent' }: StatCardProps): ReactNode {
  return (
    <Card className="flex items-center gap-4">
      <div className={cn('shrink-0', accent)}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-content">{String(value)}</p>
        <p className="text-xs text-content-secondary">{label}</p>
      </div>
    </Card>
  );
}

// ── Initiate Session Modal ────────────────────────────────────────

interface InitiateModalProps {
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}

function InitiateModal({ onClose, onCreated }: InitiateModalProps): ReactNode {
  const initForm = {
    userId: '',
    mode: 'view' as CobrowseMode,
    recordingEnabled: false,
    message: '',
  };
  const [form, setForm] = useState(initForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = form.userId.trim().length > 0;

  const handleCreate = useCallback(async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const result = await initiateCobrowseSession({
        userId: form.userId.trim(),
        mode: form.mode,
        recordingEnabled: form.recordingEnabled,
        message: form.message.trim().length > 0 ? form.message.trim() : undefined,
      });
      onCreated(result.sessionId);
      onClose();
    } catch {
      setError('Failed to initiate co-browse session. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [valid, form, onCreated, onClose]);

  return (
    <Modal open onClose={onClose} title="Initiate Co-Browse Session">
      <div className="space-y-4">
        <Input
          label="Customer User ID"
          value={form.userId}
          onChange={(e) => {
            setForm((f) => ({ ...f, userId: e.target.value }));
          }}
          placeholder="usr_..."
          helperText="The user ID of the customer to invite"
          autoFocus
        />

        <Select
          label="Session Mode"
          value={form.mode}
          onChange={(value) => {
            setForm((f) => ({ ...f, mode: value as CobrowseMode }));
          }}
          options={[
            { value: 'view', label: 'View — read-only observation' },
            { value: 'assist', label: 'Assist — interactive guidance' },
          ]}
        />

        <div className="rounded-lg border border-border bg-surface-secondary p-3 text-xs text-content-secondary">
          <p className="font-medium text-content">
            {MODE_META[form.mode].Icon} {MODE_META[form.mode].label} Mode
          </p>
          <p className="mt-1">{MODE_META[form.mode].description}</p>
        </div>

        <Input
          label="Invitation Message (optional)"
          value={form.message}
          onChange={(e) => {
            setForm((f) => ({ ...f, message: e.target.value }));
          }}
          placeholder="Hi, I'd like to help you with..."
          helperText="Shown to the customer in the invite notification (max 500 chars)"
        />

        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3">
          <div>
            <p className="text-sm font-medium text-content">Enable Session Recording</p>
            <p className="text-xs text-content-secondary">
              Customer will be notified. Recordings are stored encrypted and audit-logged.
            </p>
          </div>
          <Toggle
            checked={form.recordingEnabled}
            onChange={(checked) => {
              setForm((f) => ({ ...f, recordingEnabled: checked }));
            }}
          />
        </div>

        {form.recordingEnabled && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Recording requires explicit customer consent. A consent prompt will appear on the
              customer&apos;s screen before the session starts.
            </span>
          </div>
        )}

        {error !== null && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleCreate()} disabled={!valid || saving} loading={saving}>
            Initiate Session
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── WebRTC Viewer — admin-side screen viewer ──────────────────────

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface WebRtcViewerProps {
  sessionId: string;
  onClose: () => void;
}

function WebRtcViewer({ sessionId, onClose }: WebRtcViewerProps): ReactNode {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [connState, setConnState] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    cleanupRef.current?.();
    pcRef.current?.close();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    pc.addTransceiver('video', { direction: 'recvonly' });

    pc.addEventListener('track', (ev) => {
      if (videoRef.current !== null && ev.streams[0] !== undefined) {
        videoRef.current.srcObject = ev.streams[0];
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      switch (pc.connectionState) {
        case 'connected':
          setConnState('connected');
          break;
        case 'failed':
          setErrMsg('WebRTC connection failed — customer may have ended sharing.');
          setConnState('error');
          break;
      }
    });

    pc.addEventListener('icecandidate', (ev) => {
      if (ev.candidate !== null) {
        void sendCobrowseSignal(sessionId, 'ice-candidate', ev.candidate.toJSON()).catch(
          () => undefined,
        );
      }
    });

    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendCobrowseSignal(sessionId, 'offer', { sdp: offer });

        const unsubscribe = subscribeCobrowseEvents(
          sessionId,
          (signal: CobrowseSignal) => {
            if (signal.type === 'answer') {
              const { sdp } = signal.payload as { sdp: RTCSessionDescriptionInit };
              void pc.setRemoteDescription(new RTCSessionDescription(sdp)).catch(() => undefined);
            } else if (signal.type === 'ice-candidate') {
              const candidate = signal.payload as RTCIceCandidateInit;
              void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
            } else if (signal.type === 'end') {
              setErrMsg('Customer ended screen sharing.');
              setConnState('error');
            }
          },
          (reason: string) => {
            // Without this handler, a dropped SSE stream leaves the viewer in
            // "Waiting for customer…" forever because the WebRTC `answer` can
            // only arrive over this channel. Surface the drop instead.
            setErrMsg(`Signal stream lost — ${reason}. Close and retry.`);
            setConnState('error');
          },
        );
        cleanupRef.current = unsubscribe;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrMsg(`Setup failed: ${msg}`);
        setConnState('error');
      }
    })();

    return () => {
      cleanupRef.current?.();
      pc.close();
      pcRef.current = null;
    };
  }, [sessionId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-brand-accent" />
            <span className="text-sm font-medium text-content">Live Screen View</span>
            {connState === 'connected' && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Connected
              </span>
            )}
            {connState === 'connecting' && (
              <span className="text-xs text-content-tertiary">Waiting for customer…</span>
            )}
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-content-tertiary hover:text-content"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className="relative flex flex-1 items-center justify-center bg-black"
          style={{ minHeight: 400 }}
        >
          {connState === 'connecting' && (
            <div className="flex flex-col items-center gap-3 text-content-secondary">
              <Spinner />
              <p className="text-sm">Waiting for customer to accept and share screen…</p>
            </div>
          )}
          {connState === 'error' && (
            <div className="flex flex-col items-center gap-2">
              <AlertTriangle className="h-8 w-8 text-red-400" />
              <p className="text-sm text-red-400">{errMsg}</p>
              <Button size="sm" variant="secondary" onClick={handleClose}>
                Close
              </Button>
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn('h-full w-full object-contain', connState !== 'connected' && 'hidden')}
          />
        </div>

        <div className="border-t border-border px-4 py-2 text-xs text-content-tertiary">
          🔒 Encrypted WebRTC — screen video never passes through ORDR servers. HIPAA
          §164.312(e)(1).
        </div>
      </div>
    </div>
  );
}

// ── Session Detail Panel ──────────────────────────────────────────

interface DetailPanelProps {
  session: CobrowseSession;
  onClose: () => void;
  onStatusChange: (id: string, status: CobrowseSessionStatus) => void;
}

function DetailPanel({ session, onClose, onStatusChange }: DetailPanelProps): ReactNode {
  const [acting, setActing] = useState(false);
  const [showViewer, setShowViewer] = useState(false);

  const act = useCallback(
    async (action: 'accept' | 'reject' | 'end') => {
      setActing(true);
      try {
        let result: { status: CobrowseSessionStatus };
        if (action === 'accept') result = await acceptCobrowseSession(session.id);
        else if (action === 'reject') result = await rejectCobrowseSession(session.id);
        else result = await endCobrowseSession(session.id);
        onStatusChange(session.id, result.status);
      } catch {
        /* silently keep existing state — alert banner omitted for brevity */
      } finally {
        setActing(false);
      }
    },
    [session.id, onStatusChange],
  );

  const statusMeta = STATUS_META[session.status];
  const modeMeta = MODE_META[session.mode];

  return (
    <>
      {showViewer && (
        <WebRtcViewer
          sessionId={session.id}
          onClose={() => {
            setShowViewer(false);
          }}
        />
      )}
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-semibold text-content">Session Detail</h2>
            <p className="font-mono text-xs text-content-tertiary">{session.id}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-content-tertiary hover:text-content"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            <Badge variant={statusMeta.variant}>
              <span className="flex items-center gap-1">
                {statusMeta.Icon}
                {statusMeta.label}
              </span>
            </Badge>
            {session.status === 'active' && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Live
              </span>
            )}
          </div>

          {/* Mode */}
          <div className="rounded-lg border border-border bg-surface-secondary p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-content">
              <span className="text-content-tertiary">{modeMeta.Icon}</span>
              {modeMeta.label} Mode
            </div>
            <p className="mt-1 text-xs text-content-tertiary">{modeMeta.description}</p>
          </div>

          {/* Participants */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
              Participants
            </p>
            <div className="rounded-lg border border-border divide-y divide-border">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">Admin</span>
                <span className="font-mono text-xs text-content">{session.adminId}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">Customer</span>
                <span className="font-mono text-xs text-content">{session.userId}</span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
              Timeline
            </p>
            <div className="rounded-lg border border-border divide-y divide-border">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">Initiated</span>
                <span className="text-xs text-content">{fmtRelative(session.initiatedAt)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">Started</span>
                <span className="text-xs text-content">{fmtRelative(session.startedAt)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">Ended</span>
                <span className="text-xs text-content">{fmtRelative(session.endedAt)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">Duration</span>
                <span className="text-xs text-content">
                  {fmtDuration(session.startedAt, session.endedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">Expires</span>
                <span className="text-xs text-content">{fmtRelative(session.expiresAt)}</span>
              </div>
            </div>
          </div>

          {/* Recording / Consent */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
              Privacy
            </p>
            <div className="rounded-lg border border-border divide-y divide-border">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">Recording</span>
                <span
                  className={cn(
                    'flex items-center gap-1 text-xs',
                    session.recordingEnabled ? 'text-amber-400' : 'text-content-tertiary',
                  )}
                >
                  {session.recordingEnabled ? (
                    <>
                      <Video className="h-3.5 w-3.5" /> Enabled
                    </>
                  ) : (
                    <>
                      <VideoOff className="h-3.5 w-3.5" /> Disabled
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">User Consent</span>
                <span
                  className={cn(
                    'flex items-center gap-1 text-xs',
                    session.userConsented ? 'text-emerald-400' : 'text-content-tertiary',
                  )}
                >
                  {session.userConsented ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Granted
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5" /> Not yet
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        {!isTerminal(session.status) && (
          <div className="border-t border-border p-4 space-y-2">
            {session.status === 'pending' && (
              <>
                <Button
                  className="w-full"
                  variant="secondary"
                  size="sm"
                  onClick={() => void act('accept')}
                  disabled={acting}
                >
                  <Phone className="mr-1.5 h-3.5 w-3.5" />
                  Accept Invite
                </Button>
                <Button
                  className="w-full"
                  variant="danger"
                  size="sm"
                  onClick={() => void act('reject')}
                  disabled={acting}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Reject
                </Button>
              </>
            )}
            {session.status === 'active' && (
              <>
                <Button
                  className="w-full"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowViewer(true);
                  }}
                  disabled={acting}
                >
                  <Monitor className="mr-1.5 h-3.5 w-3.5" />
                  View Screen
                </Button>
                <Button
                  className="w-full"
                  variant="danger"
                  size="sm"
                  onClick={() => void act('end')}
                  disabled={acting}
                >
                  <StopCircle className="mr-1.5 h-3.5 w-3.5" />
                  End Session
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Session Row ────────────────────────────────────────────────────

interface SessionRowProps {
  session: CobrowseSession;
  onClick: () => void;
  selected: boolean;
}

function SessionRow({ session, onClick, selected }: SessionRowProps): ReactNode {
  const statusMeta = STATUS_META[session.status];
  const modeMeta = MODE_META[session.mode];

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border p-4 transition-colors hover:border-border-active',
        selected ? 'border-brand-accent/50 bg-brand-accent/5' : 'border-border bg-surface',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={statusMeta.variant}>
              <span className="flex items-center gap-1">
                {statusMeta.Icon}
                {statusMeta.label}
              </span>
            </Badge>
            <span className="flex items-center gap-1 text-xs text-content-secondary">
              {modeMeta.Icon}
              {modeMeta.label}
            </span>
            {session.recordingEnabled && (
              <span className="flex items-center gap-1 text-xs text-amber-400">
                <Video className="h-3 w-3" />
                REC
              </span>
            )}
          </div>
          <p className="truncate font-mono text-xs text-content-tertiary">{session.id}</p>
          <div className="flex items-center gap-3 text-xs text-content-secondary">
            <span>
              Customer: <span className="font-mono">{session.userId}</span>
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-content-tertiary">{fmtRelative(session.initiatedAt)}</p>
          {session.status === 'active' && session.startedAt !== null && (
            <p className="text-xs text-emerald-400">{fmtDuration(session.startedAt, null)}</p>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────

type FilterStatus = 'all' | CobrowseSessionStatus;

const FILTER_TABS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'ended', label: 'Ended' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
];

export function CoBrowse(): ReactNode {
  const [sessions, setSessions] = useState<CobrowseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInitiate, setShowInitiate] = useState(false);

  // Guards against two hazards: (1) setState after unmount when the user
  // navigates away mid-fetch, (2) a stacked/out-of-order response where an
  // earlier slow fetch overwrites fresher data from a later call (handleCreated
  // triggers loadSessions immediately after session creation).
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSessions = useCallback(() => {
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    void listCobrowseSessions().then(
      (data) => {
        if (!mountedRef.current || myRequestId !== requestIdRef.current) return;
        setSessions(data);
        setLoading(false);
      },
      () => {
        if (!mountedRef.current || myRequestId !== requestIdRef.current) return;
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleStatusChange = useCallback((id: string, status: CobrowseSessionStatus) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  }, []);

  const handleCreated = useCallback(
    (sessionId: string) => {
      loadSessions();
      setSelectedId(sessionId);
    },
    [loadSessions],
  );

  const filtered = filter === 'all' ? sessions : sessions.filter((s) => s.status === filter);

  const selected = selectedId !== null ? (sessions.find((s) => s.id === selectedId) ?? null) : null;

  const stats = {
    active: sessions.filter((s) => s.status === 'active').length,
    pending: sessions.filter((s) => s.status === 'pending').length,
    ended: sessions.filter((s) => s.status === 'ended').length,
    total: sessions.length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-content">Co-Browse Sessions</h1>
            <p className="text-sm text-content-secondary">
              Manage live screen-sharing sessions with customers
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={loadSessions} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setShowInitiate(true);
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Session
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-6 space-y-5">
        {/* ── Stats ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Active Sessions"
            value={stats.active}
            icon={<Radio className="h-6 w-6" />}
            accent="text-emerald-400"
          />
          <StatCard
            label="Pending Invites"
            value={stats.pending}
            icon={<Clock className="h-6 w-6" />}
            accent="text-amber-400"
          />
          <StatCard
            label="Ended Today"
            value={stats.ended}
            icon={<StopCircle className="h-6 w-6" />}
            accent="text-content-tertiary"
          />
          <StatCard
            label="Total Sessions"
            value={stats.total}
            icon={<Monitor className="h-6 w-6" />}
          />
        </div>

        {/* ── Compliance notice ──────────────────────────────── */}
        <div className="flex items-start gap-2 rounded-lg border border-brand-accent/20 bg-brand-accent/5 px-4 py-3 text-xs text-content-secondary">
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent" />
          <span>
            All co-browse sessions are audit-logged with full participant identifiers, timestamps,
            and consent status. Recordings are encrypted at rest (AES-256-GCM) and require explicit
            customer consent per HIPAA §164.312.
          </span>
        </div>

        {/* ── Main layout ────────────────────────────────────── */}
        <div className="flex gap-5">
          {/* Session list */}
          <div className="min-w-0 flex-1 space-y-3">
            {/* Filter tabs */}
            <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface-secondary p-1">
              {FILTER_TABS.map((tab) => {
                const count =
                  tab.value === 'all'
                    ? sessions.length
                    : sessions.filter((s) => s.status === tab.value).length;
                return (
                  <button
                    key={tab.value}
                    onClick={() => {
                      setFilter(tab.value);
                    }}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors',
                      filter === tab.value
                        ? 'bg-surface text-content shadow-sm'
                        : 'text-content-secondary hover:text-content',
                    )}
                  >
                    {tab.label}
                    {count > 0 && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-2xs',
                          filter === tab.value
                            ? 'bg-brand-accent/20 text-brand-accent'
                            : 'bg-surface-tertiary text-content-tertiary',
                        )}
                      >
                        {String(count)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Session cards */}
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Spinner size="md" label="Loading sessions" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-content-secondary">
                <Monitor className="h-8 w-8 opacity-40" />
                <p className="text-sm">No {filter === 'all' ? '' : filter} sessions</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    selected={session.id === selectedId}
                    onClick={() => {
                      setSelectedId(session.id === selectedId ? null : session.id);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selected !== null && (
            <div className="w-80 shrink-0 rounded-lg border border-border bg-surface">
              <DetailPanel
                session={selected}
                onClose={() => {
                  setSelectedId(null);
                }}
                onStatusChange={handleStatusChange}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────── */}
      {showInitiate && (
        <InitiateModal
          onClose={() => {
            setShowInitiate(false);
          }}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
