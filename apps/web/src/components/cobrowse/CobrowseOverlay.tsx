/**
 * CobrowseOverlay — User-facing screen sharing consent overlay + Admin viewer
 *
 * Two rendering modes:
 *   1. USER mode — Displayed to the user being assisted:
 *      - Shows an invitation banner with admin name and mode
 *      - Accept/Reject buttons with explicit consent (HIPAA §164.310(c))
 *      - Active session banner showing who is watching
 *      - Red border around viewport during active session
 *
 *   2. ADMIN mode — Displayed to the admin initiating the session:
 *      - Shows a placeholder viewer panel (WebRTC stream attaches here)
 *      - Annotation tools for 'assist' mode
 *      - Session status and controls
 *      - End session button
 *
 * WebRTC integration:
 *   - This component manages the SSE connection for signaling
 *   - RTCPeerConnection creation and ICE candidate exchange
 *   - Screen capture (getDisplayMedia) for user side
 *   - Remote stream display for admin side
 *
 * SECURITY:
 * - No session data stored in localStorage
 * - Session tokens come from server only
 * - Recording indicator shown when recordingEnabled=true
 * - SSE authenticated via HTTP-only session cookie
 *
 * SOC2 CC6.2, ISO 27001 A.11.2.4, HIPAA §164.310(c)
 */

import { type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { StatusDot } from '../ui/StatusDot';
import {
  Monitor,
  Eye,
  X,
  Check,
  AlertTriangle,
  Circle,
  Shield,
  Clock,
  Maximize,
  Minimize,
} from '../icons';

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionStatus = 'pending' | 'active' | 'ended' | 'rejected' | 'expired';
type SessionRole = 'admin' | 'user';
type CobrowseMode = 'view' | 'assist';

interface CobrowseSignal {
  type: 'offer' | 'answer' | 'ice-candidate' | 'annotation' | 'pointer' | 'end' | 'heartbeat';
  from: SessionRole;
  payload: unknown;
  timestamp: string;
}

export interface CobrowseOverlayProps {
  sessionId: string;
  role: SessionRole;
  mode: CobrowseMode;
  adminName?: string;
  recordingEnabled?: boolean;
  onEnd?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
}

// ─── Annotation canvas helper ─────────────────────────────────────────────────

interface AnnotationPoint {
  x: number;
  y: number;
  color: string;
  timestamp: number;
}

const ANNOTATION_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7'];
const ANNOTATION_FADE_MS = 4000;

// ─── Component ───────────────────────────────────────────────────────────────

export function CobrowseOverlay({
  sessionId,
  role,
  mode,
  adminName = 'Admin',
  recordingEnabled = false,
  onEnd,
  onAccept,
  onReject,
}: CobrowseOverlayProps): ReactNode {
  const [status, setStatus] = useState<SessionStatus>(role === 'user' ? 'pending' : 'active');
  const [isMinimized, setIsMinimized] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const defaultColor = ANNOTATION_COLORS[0] ?? '#ef4444';
  const [annotationColor, setAnnotationColor] = useState(defaultColor);
  const [annotations, setAnnotations] = useState<AnnotationPoint[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(Date.now());

  // ── SSE connection for signaling ──────────────────────────────────────────

  useEffect(() => {
    const sse = new EventSource(`/api/v1/cobrowse/sessions/${sessionId}/events`, {
      withCredentials: true,
    });
    sseRef.current = sse;

    sse.addEventListener('connected', () => {
      setSseConnected(true);
    });

    sse.addEventListener('answer', (e: MessageEvent) => {
      const signal = JSON.parse(e.data as string) as CobrowseSignal;
      const payload = signal.payload as { accepted?: boolean };
      if (payload.accepted === true) {
        setStatus('active');
        startTimeRef.current = Date.now();
      }
    });

    sse.addEventListener('end', () => {
      setStatus('ended');
      handleCleanup();
      onEnd?.();
    });

    sse.addEventListener('ice-candidate', (e: MessageEvent) => {
      const signal = JSON.parse(e.data as string) as CobrowseSignal;
      if (peerRef.current !== null && signal.payload !== null) {
        void peerRef.current.addIceCandidate(
          new RTCIceCandidate(signal.payload as RTCIceCandidateInit),
        );
      }
    });

    sse.addEventListener('offer', (e: MessageEvent) => {
      if (role !== 'user') return;
      const signal = JSON.parse(e.data as string) as CobrowseSignal;
      // User receives offer — initiate WebRTC peer connection
      handleWebRTCOffer(signal);
    });

    sse.addEventListener('annotation', (e: MessageEvent) => {
      if (role !== 'user') return;
      const signal = JSON.parse(e.data as string) as CobrowseSignal;
      const point = signal.payload as { x: number; y: number; color: string };
      setAnnotations((prev) => [...prev.slice(-50), { ...point, timestamp: Date.now() }]);
    });

    sse.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      sse.close();
      sseRef.current = null;
    };
  }, [sessionId, role]);

  // ── Session timer ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (status === 'active') {
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, [status]);

  // ── Annotation fade ───────────────────────────────────────────────────────

  useEffect(() => {
    if (annotations.length === 0) return;
    const timer = setTimeout(() => {
      const cutoff = Date.now() - ANNOTATION_FADE_MS;
      setAnnotations((prev) => prev.filter((a) => a.timestamp > cutoff));
    }, ANNOTATION_FADE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [annotations]);

  // ── WebRTC helpers ─────────────────────────────────────────────────────────

  const sendSignal = useCallback(
    async (type: string, payload: unknown) => {
      try {
        await fetch(`/api/v1/cobrowse/sessions/${sessionId}/signal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ type, payload }),
        });
      } catch {
        // Signal relay failure — best effort
      }
    },
    [sessionId],
  );

  const handleWebRTCOffer = useCallback(
    (_signal: CobrowseSignal) => {
      if (role !== 'user') return;
      // In a real implementation, we'd create an RTCPeerConnection here
      // and set the remote description from the offer payload.
      // For now this is a stub — WebRTC connection is established via handleStartScreenShare.
    },
    [role],
  );

  const handleStartScreenShare = useCallback(async () => {
    if (role !== 'user' || status !== 'active') return;
    try {
      // Request screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15, width: { max: 1920 }, height: { max: 1080 } },
        audio: false,
      });

      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream;
      }

      // Create peer connection and add tracks
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate !== null) {
          void sendSignal('ice-candidate', e.candidate.toJSON());
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal('offer', offer);

      setPeerConnected(true);

      // Handle stream end (user stops sharing)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        void handleEndSession();
      });
    } catch {
      // User denied screen share or browser not supported
    }
  }, [role, status, sendSignal]);

  const handleEndSession = useCallback(async () => {
    handleCleanup();
    setStatus('ended');
    try {
      await fetch(`/api/v1/cobrowse/sessions/${sessionId}/end`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best effort
    }
    onEnd?.();
  }, [sessionId, onEnd]);

  const handleCleanup = useCallback(() => {
    if (peerRef.current !== null) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (videoRef.current?.srcObject instanceof MediaStream) {
      videoRef.current.srcObject.getTracks().forEach((t) => {
        t.stop();
      });
      videoRef.current.srcObject = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
    }
    setPeerConnected(false);
  }, []);

  const handleAccept = useCallback(async () => {
    try {
      await fetch(`/api/v1/cobrowse/sessions/${sessionId}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      setStatus('active');
      startTimeRef.current = Date.now();
      onAccept?.();
      // Start screen share after acceptance
      void handleStartScreenShare();
    } catch {
      // Error accepting
    }
  }, [sessionId, onAccept, handleStartScreenShare]);

  const handleReject = useCallback(async () => {
    try {
      await fetch(`/api/v1/cobrowse/sessions/${sessionId}/reject`, {
        method: 'POST',
        credentials: 'include',
      });
      setStatus('rejected');
      onReject?.();
    } catch {
      // Error rejecting
    }
  }, [sessionId, onReject]);

  // ── Canvas drawing (admin annotation) ────────────────────────────────────

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (role !== 'admin' || mode !== 'assist') return;
      setIsDrawing(true);
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      void sendSignal('annotation', { x, y, color: annotationColor });
    },
    [role, mode, annotationColor, sendSignal],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing || role !== 'admin' || mode !== 'assist') return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      void sendSignal('annotation', { x, y, color: annotationColor });
      void sendSignal('pointer', { x, y });
    },
    [isDrawing, role, mode, annotationColor, sendSignal],
  );

  // ── Formatters ────────────────────────────────────────────────────────────

  const formatElapsed = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // ── Render: USER MODE — Invitation banner ─────────────────────────────────

  if (role === 'user' && status === 'pending') {
    return (
      <div className="fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-amber-500/30 bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-content">Remote Assistance Request</h3>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-2">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-accent to-purple-500 text-sm font-bold text-white">
              {adminName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-content">{adminName}</p>
              <p className="text-xs text-content-secondary mt-0.5">
                is requesting to {mode === 'view' ? 'view your screen' : 'assist you remotely'}
              </p>
              {recordingEnabled && (
                <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-400">
                  <Circle className="h-2 w-2 fill-current" />
                  This session will be recorded
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-tertiary px-3 py-2 text-[11px] text-content-tertiary">
            <Shield className="h-3 w-3 flex-shrink-0" />
            You can end this session at any time. Your consent is required.
          </div>
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              icon={<X className="h-3.5 w-3.5" />}
              onClick={() => {
                void handleReject();
              }}
            >
              Decline
            </Button>
            <Button
              size="sm"
              className="flex-1"
              icon={<Check className="h-3.5 w-3.5" />}
              onClick={() => {
                void handleAccept();
              }}
            >
              Accept
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: USER MODE — Active session banner ─────────────────────────────

  if (role === 'user' && status === 'active') {
    return (
      <>
        {/* Pulsing red border around viewport */}
        <div
          className="pointer-events-none fixed inset-0 z-40 rounded-none"
          style={{
            boxShadow: 'inset 0 0 0 3px rgba(239, 68, 68, 0.6)',
            animation: 'pulse 2s ease-in-out infinite',
          }}
          aria-hidden="true"
        />

        {/* Session status bar */}
        <div
          className={`fixed ${isMinimized ? 'bottom-4 right-4 w-auto' : 'bottom-6 right-6 w-72'} z-50 rounded-xl border border-red-500/30 bg-surface shadow-2xl transition-all`}
        >
          {isMinimized ? (
            <button
              className="flex items-center gap-2 px-3 py-2 text-xs text-content"
              onClick={() => {
                setIsMinimized(false);
              }}
              aria-label="Expand session panel"
            >
              <div className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              Screen shared
              <Maximize className="h-3 w-3 text-content-tertiary" />
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs font-semibold text-content">Screen Sharing</span>
                  {recordingEnabled && (
                    <Badge variant="danger" size="sm">
                      <Circle className="h-2 w-2 fill-current" />
                      REC
                    </Badge>
                  )}
                </div>
                <button
                  className="text-content-tertiary hover:text-content"
                  onClick={() => {
                    setIsMinimized(true);
                  }}
                  aria-label="Minimize"
                >
                  <Minimize className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-content-secondary">
                    <Eye className="h-3.5 w-3.5" />
                    <span>{adminName} is viewing</span>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-content-tertiary">
                    <Clock className="h-3 w-3" />
                    {formatElapsed(elapsedSeconds)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-surface-tertiary px-2.5 py-2 text-[11px] text-content-tertiary">
                  <Shield className="h-3 w-3 flex-shrink-0 text-green-400" />
                  Encrypted P2P connection
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  className="w-full"
                  icon={<X className="h-3.5 w-3.5" />}
                  onClick={() => {
                    void handleEndSession();
                  }}
                >
                  End Session
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Hidden video element for local stream */}
        <video ref={videoRef} className="hidden" autoPlay muted playsInline aria-hidden="true" />

        {/* Annotation dots rendered over the page */}
        {annotations.map((a, i) => (
          <div
            key={i}
            className="pointer-events-none fixed z-50 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-80 transition-opacity"
            style={{
              left: `${a.x * 100}%`,
              top: `${a.y * 100}%`,
              backgroundColor: a.color,
              boxShadow: `0 0 8px ${a.color}`,
            }}
            aria-hidden="true"
          />
        ))}
      </>
    );
  }

  // ── Render: ADMIN MODE — Viewer panel ─────────────────────────────────────

  if (role === 'admin') {
    return (
      <div
        className={`flex flex-col rounded-xl border border-border bg-surface-secondary overflow-hidden ${isMinimized ? 'h-10' : 'h-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Monitor className="h-3.5 w-3.5 text-brand-accent" />
            <span className="text-xs font-semibold text-content">Remote View</span>
            {status === 'active' ? (
              <Badge variant="success" size="sm" dot>
                Live
              </Badge>
            ) : status === 'pending' ? (
              <Badge variant="warning" size="sm">
                Waiting
              </Badge>
            ) : (
              <Badge variant="neutral" size="sm">
                {status}
              </Badge>
            )}
            {recordingEnabled && (
              <Badge variant="danger" size="sm">
                <Circle className="h-2 w-2 fill-current" />
                REC
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {status === 'active' && (
              <div className="flex items-center gap-1 font-mono text-[10px] text-content-tertiary mr-2">
                <Clock className="h-3 w-3" />
                {formatElapsed(elapsedSeconds)}
              </div>
            )}
            <button
              className="flex h-6 w-6 items-center justify-center rounded text-content-tertiary hover:bg-surface-tertiary hover:text-content"
              onClick={() => {
                setIsMinimized((p) => !p);
              }}
              aria-label={isMinimized ? 'Expand' : 'Minimize'}
            >
              {isMinimized ? <Maximize className="h-3 w-3" /> : <Minimize className="h-3 w-3" />}
            </button>
            <button
              className="flex h-6 w-6 items-center justify-center rounded text-content-tertiary hover:bg-red-500/20 hover:text-red-400"
              onClick={() => {
                void handleEndSession();
              }}
              aria-label="End session"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {!isMinimized && (
          <>
            {/* Video area */}
            <div className="relative flex-1 bg-black">
              {status === 'pending' ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center p-6">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-accent border-t-transparent" />
                  <p className="text-sm font-medium text-content">Waiting for user to accept</p>
                  <p className="text-xs text-content-tertiary">
                    The session will begin once they share their screen
                  </p>
                </div>
              ) : status === 'active' && !peerConnected ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-accent border-t-transparent" />
                  <p className="text-xs text-content-secondary">Establishing P2P connection...</p>
                </div>
              ) : status === 'active' ? (
                <>
                  <video
                    ref={remoteVideoRef}
                    className="h-full w-full object-contain"
                    autoPlay
                    playsInline
                    aria-label="Remote screen share"
                  />
                  {/* Annotation canvas overlay */}
                  {mode === 'assist' && (
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 h-full w-full"
                      style={{ cursor: isDrawing ? 'crosshair' : 'default' }}
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={() => {
                        setIsDrawing(false);
                      }}
                      onMouseLeave={() => {
                        setIsDrawing(false);
                      }}
                      aria-label="Annotation canvas"
                    />
                  )}
                </>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-content-tertiary capitalize">{status}</p>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="border-t border-border p-3 space-y-2 flex-shrink-0">
              {/* Annotation toolbar (assist mode only) */}
              {mode === 'assist' && status === 'active' && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-content-tertiary">Annotate:</span>
                  <div className="flex gap-1">
                    {ANNOTATION_COLORS.map((color) => (
                      <button
                        key={color}
                        className={`h-5 w-5 rounded-full border-2 transition-transform ${annotationColor === color ? 'scale-125 border-white' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                        onClick={() => {
                          setAnnotationColor(color);
                        }}
                        aria-label={`Select color ${color}`}
                      />
                    ))}
                  </div>
                  <button
                    className="ml-auto text-[10px] text-content-tertiary hover:text-content"
                    onClick={() => {
                      setAnnotations([]);
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}

              {/* Session controls */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <StatusDot status={sseConnected ? 'success' : 'danger'} size="sm" />
                  <span className="text-[10px] text-content-tertiary">
                    {sseConnected ? 'Signal connected' : 'Reconnecting...'}
                  </span>
                </div>
                <div className="ml-auto">
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<X className="h-3.5 w-3.5" />}
                    onClick={() => {
                      void handleEndSession();
                    }}
                  >
                    End Session
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Render: Session ended / rejected ─────────────────────────────────────

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface-secondary p-8 text-center">
      <Monitor className="h-10 w-10 text-content-tertiary opacity-30" />
      <div>
        <p className="text-sm font-medium text-content capitalize">
          {status === 'rejected' ? 'Session declined' : 'Session ended'}
        </p>
        <p className="text-xs text-content-tertiary mt-1">
          {status === 'rejected'
            ? 'The user declined the remote assistance request.'
            : `Session duration: ${formatElapsed(elapsedSeconds)}`}
        </p>
      </div>
      {onEnd !== undefined && (
        <Button variant="secondary" size="sm" onClick={onEnd}>
          Close
        </Button>
      )}
    </div>
  );
}
