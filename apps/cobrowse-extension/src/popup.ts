import type { StoredAuth, SessionDetails, ActiveSessionRef, ExtMessage } from './types.js';

// ── DOM refs ───────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Element #${id} not found`);
  return node as T;
}

const screens = {
  setup: el('screen-setup'),
  join: el('screen-join'),
  consent: el('screen-consent'),
  active: el('screen-active'),
};

function showScreen(name: keyof typeof screens): void {
  for (const s of Object.values(screens)) s.classList.remove('visible');
  screens[name].classList.add('visible');
}

function setError(id: string, msg: string): void {
  const node = document.getElementById(id);
  if (node !== null) node.textContent = msg;
}

// ── Auth storage ───────────────────────────────────────────────────

function loadAuth(): Promise<StoredAuth | null> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiBaseUrl', 'token', 'userId'], (items) => {
      const { apiBaseUrl, token, userId } = items as Partial<StoredAuth>;
      if (
        typeof apiBaseUrl === 'string' &&
        apiBaseUrl.length > 0 &&
        typeof token === 'string' &&
        token.length > 0 &&
        typeof userId === 'string' &&
        userId.length > 0
      ) {
        resolve({ apiBaseUrl, token, userId });
      } else {
        resolve(null);
      }
    });
  });
}

function saveAuth(auth: StoredAuth): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(auth, resolve);
  });
}

function clearAuth(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.remove(['apiBaseUrl', 'token', 'userId'], resolve);
  });
}

// ── Session fetch ──────────────────────────────────────────────────

async function fetchPendingSession(auth: StoredAuth): Promise<SessionDetails | null> {
  const resp = await fetch(`${auth.apiBaseUrl}/v1/cobrowse/sessions`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (!resp.ok) return null;
  const body = (await resp.json()) as { data?: SessionDetails[] };
  const sessions = body.data ?? [];
  return sessions.find((s) => s.status === 'pending') ?? null;
}

async function postReject(auth: StoredAuth, sessionId: string): Promise<void> {
  await fetch(`${auth.apiBaseUrl}/v1/cobrowse/sessions/${sessionId}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

// ── Consent screen rendering (DOM-only, Rule 4 XSS compliance) ────

function renderConsentDetails(details: SessionDetails): void {
  const container = el('consent-details');
  container.textContent = '';

  const card = document.createElement('div');
  card.className = 'card';

  const modeRow = document.createElement('div');
  modeRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';

  const modeBadge = document.createElement('span');
  modeBadge.className = 'badge badge-info';
  modeBadge.textContent = details.mode === 'assist' ? 'Assist mode' : 'View mode';

  const modeDesc = document.createElement('span');
  modeDesc.style.cssText = 'font-size:11px;color:#94a3b8;';
  modeDesc.textContent =
    details.mode === 'assist' ? 'Agent may annotate your screen.' : 'Agent will view your screen.';

  modeRow.appendChild(modeBadge);
  modeRow.appendChild(modeDesc);
  card.appendChild(modeRow);

  if (details.recordingEnabled) {
    const recRow = document.createElement('div');
    recRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    const recBadge = document.createElement('span');
    recBadge.className = 'badge badge-warn';
    recBadge.textContent = 'Session recorded';
    recRow.appendChild(recBadge);
    card.appendChild(recRow);
  }

  const notice = document.createElement('p');
  notice.style.cssText = 'font-size:11px;color:#64748b;margin:0;';
  notice.textContent =
    'You control exactly which window or tab to share. You can stop sharing at any time.';
  card.appendChild(notice);

  container.appendChild(card);
}

// ── Active-session helpers ─────────────────────────────────────────

async function getActiveSession(): Promise<ActiveSessionRef | null> {
  return new Promise((resolve) => {
    const msg: ExtMessage = { type: 'GET_ACTIVE' };
    chrome.runtime.sendMessage(msg, (resp: unknown) => {
      resolve((resp as ActiveSessionRef | null | undefined) ?? null);
    });
  });
}

// ── Init ───────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const active = await getActiveSession();
  if (active !== null) {
    el<HTMLParagraphElement>('active-session-id').textContent = `Session: ${active.sessionId}`;
    showScreen('active');
    wireActive(active);
    return;
  }

  const auth = await loadAuth();
  if (auth === null) {
    showScreen('setup');
    wireSetup();
    return;
  }

  showScreen('join');
  wireJoin(auth);
}

// ── Setup screen ───────────────────────────────────────────────────

function wireSetup(): void {
  el('btn-save-auth').addEventListener('click', () => {
    void (async () => {
      const apiBaseUrl = el<HTMLInputElement>('input-api-url').value.trim();
      const token = el<HTMLInputElement>('input-token').value.trim();
      const userId = el<HTMLInputElement>('input-user-id').value.trim();
      if (apiBaseUrl.length === 0 || token.length === 0 || userId.length === 0) {
        setError('error-msg', 'All fields are required.');
        return;
      }
      await saveAuth({ apiBaseUrl, token, userId });
      showScreen('join');
      wireJoin({ apiBaseUrl, token, userId });
    })();
  });
}

// ── Join screen ────────────────────────────────────────────────────

function wireJoin(auth: StoredAuth): void {
  el('btn-check-session').addEventListener('click', () => {
    void (async () => {
      const session = await fetchPendingSession(auth);
      if (session === null) {
        setError('error-msg', 'No pending invite found.');
        return;
      }
      renderConsentDetails(session);
      showScreen('consent');
      wireConsent(auth, session);
    })();
  });

  el('btn-reset-auth').addEventListener('click', () => {
    void (async () => {
      await clearAuth();
      showScreen('setup');
      wireSetup();
    })();
  });
}

// ── Consent screen ─────────────────────────────────────────────────

function wireConsent(auth: StoredAuth, session: SessionDetails): void {
  el('btn-accept').addEventListener('click', () => {
    void (async () => {
      const url = chrome.runtime.getURL('session.html');
      const tab = await chrome.tabs.create({ url });
      if (tab.id === undefined) return;
      const ref: ActiveSessionRef = {
        sessionId: session.id,
        apiBaseUrl: auth.apiBaseUrl,
        token: auth.token,
        tabId: tab.id,
      };
      await chrome.storage.session.set({ activeSession: ref });
      window.close();
    })();
  });

  el('btn-reject').addEventListener('click', () => {
    void (async () => {
      await postReject(auth, session.id);
      showScreen('join');
      wireJoin(auth);
    })();
  });
}

// ── Active screen ──────────────────────────────────────────────────

function wireActive(ref: ActiveSessionRef): void {
  el('btn-end-active').addEventListener('click', () => {
    void chrome.tabs.update(ref.tabId, { active: true });
    window.close();
  });
}

void init();
