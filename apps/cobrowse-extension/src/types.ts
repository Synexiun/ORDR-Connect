// Stored in chrome.storage.sync by the user after pasting their API base URL and token.
export interface StoredAuth {
  apiBaseUrl: string;
  token: string;
  userId: string;
}

export interface SessionDetails {
  id: string;
  status: 'pending' | 'active' | 'ended' | 'rejected' | 'expired';
  mode: 'view' | 'assist';
  recordingEnabled: boolean;
  initiatedAt: string;
}

// Stored in chrome.storage.session (ephemeral) while a session tab is open.
export interface ActiveSessionRef {
  sessionId: string;
  apiBaseUrl: string;
  token: string;
  tabId: number;
}

export interface CobrowseSignal {
  type: 'offer' | 'answer' | 'ice-candidate' | 'annotation' | 'pointer' | 'end';
  from: 'admin' | 'user';
  payload: unknown;
  timestamp: string;
}

export type ExtMessage =
  | { type: 'SESSION_ENDED'; sessionId: string }
  | { type: 'GET_ACTIVE'; response?: ActiveSessionRef | null };
