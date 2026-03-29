/**
 * CobrowseButton — Admin-side component to initiate a remote assistance session
 *
 * Renders a button that opens a confirmation dialog before sending a session
 * invitation to the target user. The user must explicitly accept before any
 * screen sharing begins (explicit consent, HIPAA §164.312(a)(1)).
 *
 * SECURITY:
 * - Only rendered for admin/support roles (caller must gate this)
 * - sessionId is UUIDv4 from the server — never client-generated
 * - Recording consent is surfaced to the admin UI
 * - Session expires after 2 hours maximum
 *
 * SOC2 CC6.2 — Logical access controls: admin-initiated sessions require auth.
 * HIPAA §164.310(c) — Workstation security: controlled remote access.
 */

import { type ReactNode, useState, useCallback } from 'react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Monitor, Eye, MousePointerClick, AlertTriangle, X, Clock, Shield } from '../icons';

// ─── Types ────────────────────────────────────────────────────────────────────

type CobrowseMode = 'view' | 'assist';

export interface CobrowseButtonProps {
  /** UUID of the user to invite */
  targetUserId: string;
  /** Display name shown in the invitation dialog */
  targetUserName: string;
  /** Called with the session ID after the server creates it */
  onSessionCreated?: (sessionId: string) => void;
  /** Called when the user rejects the invitation */
  onSessionRejected?: () => void;
  /** Optional extra classes */
  className?: string;
  /** Compact variant for table/list rows */
  compact?: boolean;
}

interface SessionState {
  status: 'idle' | 'creating' | 'pending' | 'active' | 'rejected' | 'ended' | 'error';
  sessionId?: string;
  errorMessage?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CobrowseButton({
  targetUserId,
  targetUserName,
  onSessionCreated,
  onSessionRejected: _onSessionRejected,
  className = '',
  compact = false,
}: CobrowseButtonProps): ReactNode {
  const [showDialog, setShowDialog] = useState(false);
  const [mode, setMode] = useState<CobrowseMode>('view');
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [session, setSession] = useState<SessionState>({ status: 'idle' });

  const handleOpen = useCallback(() => {
    setShowDialog(true);
    setSession({ status: 'idle' });
  }, []);

  const handleClose = useCallback(() => {
    setShowDialog(false);
    setMessage('');
    setMode('view');
    setRecordingEnabled(false);
    if (session.status === 'pending' || session.status === 'creating') {
      setSession({ status: 'idle' });
    }
  }, [session.status]);

  const handleInitiate = useCallback(async () => {
    setSession({ status: 'creating' });
    try {
      const res = await fetch('/api/v1/cobrowse/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: targetUserId,
          mode,
          recordingEnabled,
          message: message.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        setSession({
          status: 'error',
          errorMessage: err.error?.message ?? 'Failed to create session',
        });
        return;
      }
      const data = (await res.json()) as { data?: { sessionId?: string } };
      const sessionId = data.data?.sessionId ?? '';
      setSession({ status: 'pending', sessionId });
      onSessionCreated?.(sessionId);
    } catch {
      setSession({ status: 'error', errorMessage: 'Network error — please try again' });
    }
  }, [targetUserId, mode, recordingEnabled, message, onSessionCreated]);

  const handleCancel = useCallback(async () => {
    if (session.sessionId !== undefined) {
      try {
        await fetch(`/api/v1/cobrowse/sessions/${session.sessionId}/end`, {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        // Best effort — session will expire
      }
    }
    setSession({ status: 'idle' });
    setShowDialog(false);
  }, [session.sessionId]);

  const statusBadge = (): ReactNode => {
    switch (session.status) {
      case 'pending':
        return (
          <Badge variant="warning" size="sm" dot>
            Waiting for user
          </Badge>
        );
      case 'active':
        return (
          <Badge variant="success" size="sm" dot>
            Session active
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="danger" size="sm">
            Rejected
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="danger" size="sm">
            Error
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/* Trigger button */}
      {compact ? (
        <button
          className={`flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-content-secondary transition-colors hover:border-brand-accent/40 hover:bg-brand-accent/5 hover:text-content ${className}`}
          onClick={handleOpen}
          title={`Remote assist ${targetUserName}`}
        >
          <Monitor className="h-3 w-3" />
          Assist
        </button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          icon={<Monitor className="h-3.5 w-3.5" />}
          className={className}
          onClick={handleOpen}
        >
          Remote Assist
        </Button>
      )}

      {/* Session initiation dialog */}
      {showDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cobrowse-dialog-title"
        >
          <div className="relative w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-brand-accent" />
                <h2 id="cobrowse-dialog-title" className="text-sm font-semibold text-content">
                  Remote Assistance
                </h2>
                {statusBadge()}
              </div>
              <button
                className="text-content-tertiary hover:text-content"
                onClick={handleClose}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Target user */}
              <div className="flex items-center gap-3 rounded-lg bg-surface-tertiary p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-accent to-purple-500 text-sm font-bold text-white">
                  {targetUserName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-content">{targetUserName}</p>
                  <p className="text-xs text-content-tertiary">
                    Will receive an invitation to share their screen
                  </p>
                </div>
              </div>

              {/* Mode selection */}
              {session.status === 'idle' || session.status === 'error' ? (
                <>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                      Session Mode
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                          mode === 'view'
                            ? 'border-brand-accent/50 bg-brand-accent/10'
                            : 'border-border hover:border-border-light'
                        }`}
                        onClick={() => {
                          setMode('view');
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Eye
                            className={`h-3.5 w-3.5 ${mode === 'view' ? 'text-brand-accent' : 'text-content-tertiary'}`}
                          />
                          <span
                            className={`text-xs font-semibold ${mode === 'view' ? 'text-brand-accent' : 'text-content'}`}
                          >
                            View Only
                          </span>
                        </div>
                        <p className="text-[10px] text-content-tertiary">
                          See the user's screen without interaction
                        </p>
                      </button>
                      <button
                        className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                          mode === 'assist'
                            ? 'border-brand-accent/50 bg-brand-accent/10'
                            : 'border-border hover:border-border-light'
                        }`}
                        onClick={() => {
                          setMode('assist');
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <MousePointerClick
                            className={`h-3.5 w-3.5 ${mode === 'assist' ? 'text-brand-accent' : 'text-content-tertiary'}`}
                          />
                          <span
                            className={`text-xs font-semibold ${mode === 'assist' ? 'text-brand-accent' : 'text-content'}`}
                          >
                            Assist
                          </span>
                        </div>
                        <p className="text-[10px] text-content-tertiary">
                          View + annotate and highlight elements
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Recording option */}
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5 text-content-tertiary" />
                      <div>
                        <p className="text-xs font-medium text-content">Record session</p>
                        <p className="text-[10px] text-content-tertiary">
                          User will be informed of recording
                        </p>
                      </div>
                    </div>
                    <button
                      role="switch"
                      aria-checked={recordingEnabled}
                      className={`relative h-5 w-9 rounded-full transition-colors ${recordingEnabled ? 'bg-brand-accent' : 'bg-surface-tertiary border border-border'}`}
                      onClick={() => {
                        setRecordingEnabled((p) => !p);
                      }}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${recordingEnabled ? 'translate-x-4' : 'translate-x-0.5'}`}
                      />
                    </button>
                  </div>

                  {/* Optional message */}
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-content-secondary"
                      htmlFor="cobrowse-message"
                    >
                      Message to user <span className="text-content-tertiary">(optional)</span>
                    </label>
                    <textarea
                      id="cobrowse-message"
                      rows={2}
                      maxLength={500}
                      placeholder="e.g. Hi, I'd like to help you with the billing question..."
                      className="w-full resize-none rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-content placeholder-content-tertiary focus:border-brand-accent/50 focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value);
                      }}
                    />
                  </div>

                  {/* Consent notice */}
                  <div className="flex gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-400 mt-0.5" />
                    <p className="text-[11px] text-amber-300">
                      The user must explicitly accept this invitation before any screen sharing
                      begins. They can reject or end the session at any time.
                    </p>
                  </div>

                  {session.status === 'error' && session.errorMessage !== undefined && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                      <p className="text-xs text-red-400">{session.errorMessage}</p>
                    </div>
                  )}
                </>
              ) : session.status === 'creating' ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-accent border-t-transparent" />
                  <p className="text-sm text-content-secondary">Creating session...</p>
                </div>
              ) : session.status === 'pending' ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/20">
                    <Clock className="h-6 w-6 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-content">Waiting for {targetUserName}</p>
                    <p className="text-xs text-content-tertiary mt-1">
                      An invitation has been sent. The session will start once they accept.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-md bg-surface-tertiary px-3 py-1.5">
                    <span className="text-xs text-content-tertiary">Session ID:</span>
                    <code className="text-xs font-mono text-content">
                      {session.sessionId?.slice(0, 8)}...
                    </code>
                  </div>
                </div>
              ) : session.status === 'rejected' ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <p className="text-sm font-medium text-content">
                    {targetUserName} declined the session
                  </p>
                  <p className="text-xs text-content-tertiary">
                    You can try sending a new invitation if needed.
                  </p>
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              {session.status === 'pending' ? (
                <>
                  <Button variant="ghost" size="sm" onClick={handleCancel}>
                    Cancel Session
                  </Button>
                </>
              ) : session.status === 'rejected' || session.status === 'ended' ? (
                <>
                  <Button variant="ghost" size="sm" onClick={handleClose}>
                    Close
                  </Button>
                  <Button
                    size="sm"
                    icon={<Monitor className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setSession({ status: 'idle' });
                    }}
                  >
                    Try Again
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={handleClose}>
                    Cancel
                  </Button>
                  {(session.status === 'idle' || session.status === 'error') && (
                    <Button
                      size="sm"
                      icon={<Monitor className="h-3.5 w-3.5" />}
                      loading={session.status === 'creating'}
                      onClick={() => {
                        void handleInitiate();
                      }}
                    >
                      Send Invitation
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
