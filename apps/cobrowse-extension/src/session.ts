import type { ActiveSessionRef, CobrowseSignal, ExtMessage } from './types.js';

// ── DOM ────────────────────────────────────────────────────────────

const statusBadge = document.getElementById('status-badge') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const btnEnd = document.getElementById('btn-end') as HTMLButtonElement;

type StatusKind = 'connecting' | 'live' | 'ended' | 'error';

function setStatus(kind: StatusKind, msg: string): void {
  statusBadge.className = `status status-${kind}`;
  statusText.textContent = msg;
}

// ── Signaling helpers ──────────────────────────────────────────────

async function sendSignal(
  ref: ActiveSessionRef,
  type: CobrowseSignal['type'],
  payload: unknown,
): Promise<void> {
  await fetch(`${ref.apiBaseUrl}/v1/cobrowse/sessions/${ref.sessionId}/signal`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ref.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type, payload }),
  });
}

// ── SSE subscription ───────────────────────────────────────────────

function subscribeSse(ref: ActiveSessionRef, onSignal: (s: CobrowseSignal) => void): () => void {
  const controller = new AbortController();

  void (async () => {
    try {
      const resp = await fetch(`${ref.apiBaseUrl}/v1/cobrowse/sessions/${ref.sessionId}/events`, {
        headers: {
          Authorization: `Bearer ${ref.token}`,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });
      if (!resp.ok || resp.body === null) return;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6)) as CobrowseSignal;
              onSignal(parsed);
            } catch {
              /* malformed SSE line */
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  })();

  return () => {
    controller.abort();
  };
}

// ── Teardown ───────────────────────────────────────────────────────

let abortSse: (() => void) | null = null;
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;

async function teardown(reason: string): Promise<void> {
  setStatus('ended', reason);
  btnEnd.disabled = true;
  abortSse?.();
  pc?.close();
  localStream?.getTracks().forEach((t) => {
    t.stop();
  });
  await chrome.storage.session.remove('activeSession');
  const msg: ExtMessage = { type: 'SESSION_ENDED', sessionId: '' };
  chrome.runtime.sendMessage(msg, () => undefined);
}

// ── WebRTC callee ──────────────────────────────────────────────────

const STUN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function startWebRTC(ref: ActiveSessionRef, offer: RTCSessionDescriptionInit): Promise<void> {
  localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  localStream.getTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      void teardown('Screen sharing stopped by user.');
    });
  });

  const conn = new RTCPeerConnection({ iceServers: STUN });
  pc = conn;

  localStream.getTracks().forEach((track) => {
    if (localStream !== null) conn.addTrack(track, localStream);
  });

  conn.addEventListener('icecandidate', (ev) => {
    if (ev.candidate !== null) {
      void sendSignal(ref, 'ice-candidate', ev.candidate.toJSON()).catch(() => undefined);
    }
  });

  conn.addEventListener('connectionstatechange', () => {
    switch (conn.connectionState) {
      case 'connected':
        setStatus('live', 'Live — sharing your screen');
        break;
      case 'failed':
        void teardown('Connection failed.');
        break;
    }
  });

  await conn.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await conn.createAnswer();
  await conn.setLocalDescription(answer);
  await sendSignal(ref, 'answer', { sdp: answer });
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const items = (await chrome.storage.session.get('activeSession')) as {
    activeSession?: ActiveSessionRef;
  };
  const ref = items.activeSession;
  if (ref === undefined) {
    setStatus('error', 'No active session found.');
    return;
  }

  btnEnd.addEventListener('click', () => {
    void teardown('You ended the session.');
  });

  setStatus('connecting', 'Waiting for admin to connect…');

  abortSse = subscribeSse(ref, (signal) => {
    if (signal.from !== 'admin') return;

    if (signal.type === 'offer') {
      const { sdp } = signal.payload as { sdp: RTCSessionDescriptionInit };
      void startWebRTC(ref, sdp).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        void teardown(`Setup failed: ${msg}`);
      });
    } else if (signal.type === 'ice-candidate' && pc !== null) {
      const candidate = signal.payload as RTCIceCandidateInit;
      void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
    } else if (signal.type === 'end') {
      void teardown('Admin ended the session.');
    }
  });
}

void main();
