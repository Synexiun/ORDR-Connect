import type { ActiveSessionRef, ExtMessage } from './types.js';

// ── Badge helpers ──────────────────────────────────────────────────

function setBadgePending(): void {
  void chrome.action.setBadgeText({ text: '!' });
  void chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
}

function setBadgeLive(): void {
  void chrome.action.setBadgeText({ text: '●' });
  void chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
}

function clearBadge(): void {
  void chrome.action.setBadgeText({ text: '' });
}

// ── Session tab lifecycle ──────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.get('activeSession', (items) => {
    const ref = items['activeSession'] as ActiveSessionRef | undefined;
    if (ref !== undefined && ref.tabId === tabId) {
      void chrome.storage.session.remove('activeSession');
      clearBadge();
    }
  });
});

// ── Storage observer → badge sync ─────────────────────────────────

chrome.storage.session.onChanged.addListener((changes) => {
  if ('activeSession' in changes) {
    const newVal = changes['activeSession']?.newValue as ActiveSessionRef | undefined;
    if (newVal !== undefined) {
      setBadgeLive();
    } else {
      clearBadge();
    }
  }
  if ('pendingSession' in changes) {
    const newVal = changes['pendingSession']?.newValue;
    if (newVal !== undefined) {
      setBadgePending();
    }
  }
});

// ── Message relay ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (r: unknown) => void) => {
    const msg = message as ExtMessage;
    if (msg.type === 'GET_ACTIVE') {
      chrome.storage.session.get('activeSession', (items) => {
        const ref = items['activeSession'] as ActiveSessionRef | undefined;
        sendResponse(ref ?? null);
      });
      return true; // async response
    }
    if (msg.type === 'SESSION_ENDED') {
      void chrome.storage.session.remove('activeSession');
      void chrome.storage.session.remove('pendingSession');
      clearBadge();
    }
    return false;
  },
);
