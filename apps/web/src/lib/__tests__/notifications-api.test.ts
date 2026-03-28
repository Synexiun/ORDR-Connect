/**
 * notifications-api tests
 *
 * Verifies named-export wrappers call the correct endpoints.
 * Mocks apiClient to avoid real HTTP requests.
 *
 * COMPLIANCE: No PHI in test fixtures — metadata only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listNotifications,
  markNotificationRead,
  dismissNotification,
  markAllNotificationsRead,
} from '../notifications-api';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: vi.fn(),
  },
}));

const MOCK_NOTIFICATION = {
  id: 'notif-1',
  type: 'system' as const,
  severity: 'low' as const,
  title: 'Key Rotation Scheduled',
  description: 'Automated key rotation scheduled',
  timestamp: new Date('2026-03-28T10:00:00Z').toISOString(),
  read: false,
  dismissed: false,
};

const LIST_RESPONSE = {
  success: true as const,
  data: [MOCK_NOTIFICATION],
  meta: { total: 1, unreadCount: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listNotifications', () => {
  it('GETs /v1/notifications with no params', async () => {
    mockGet.mockResolvedValue(LIST_RESPONSE);

    const result = await listNotifications();

    expect(mockGet).toHaveBeenCalledWith('/v1/notifications');
    expect(result.data).toHaveLength(1);
    expect(result.meta.unreadCount).toBe(1);
  });

  it('appends type filter to query string', async () => {
    mockGet.mockResolvedValue(LIST_RESPONSE);

    await listNotifications({ type: 'compliance' });

    const url = mockGet.mock.calls[0]?.[0] as string;
    expect(url).toContain('type=compliance');
  });

  it('appends read flag to query string', async () => {
    mockGet.mockResolvedValue(LIST_RESPONSE);

    await listNotifications({ read: false });

    const url = mockGet.mock.calls[0]?.[0] as string;
    expect(url).toContain('read=false');
  });

  it('appends limit to query string', async () => {
    mockGet.mockResolvedValue(LIST_RESPONSE);

    await listNotifications({ limit: 25 });

    const url = mockGet.mock.calls[0]?.[0] as string;
    expect(url).toContain('limit=25');
  });

  it('appends includeDismissed to query string', async () => {
    mockGet.mockResolvedValue(LIST_RESPONSE);

    await listNotifications({ includeDismissed: true });

    const url = mockGet.mock.calls[0]?.[0] as string;
    expect(url).toContain('includeDismissed=true');
  });
});

describe('markNotificationRead', () => {
  it('PATCHes /v1/notifications/:id/read', async () => {
    const updated = { ...MOCK_NOTIFICATION, read: true };
    mockPatch.mockResolvedValue({ success: true, data: updated });

    const result = await markNotificationRead('notif-1');

    expect(mockPatch).toHaveBeenCalledWith('/v1/notifications/notif-1/read', {});
    expect(result.data.read).toBe(true);
  });

  it('URL-encodes notification ID', async () => {
    mockPatch.mockResolvedValue({ success: true, data: MOCK_NOTIFICATION });

    await markNotificationRead('notif/special');

    const url = mockPatch.mock.calls[0]?.[0] as string;
    expect(url).toContain('notif%2Fspecial');
  });
});

describe('dismissNotification', () => {
  it('PATCHes /v1/notifications/:id/dismiss', async () => {
    const dismissed = { ...MOCK_NOTIFICATION, dismissed: true };
    mockPatch.mockResolvedValue({ success: true, data: dismissed });

    const result = await dismissNotification('notif-1');

    expect(mockPatch).toHaveBeenCalledWith('/v1/notifications/notif-1/dismiss', {});
    expect(result.data.dismissed).toBe(true);
  });
});

describe('markAllNotificationsRead', () => {
  it('POSTs to /v1/notifications/mark-read-all', async () => {
    mockPost.mockResolvedValue({ success: true, data: { markedRead: 5 } });

    const result = await markAllNotificationsRead();

    expect(mockPost).toHaveBeenCalledWith('/v1/notifications/mark-read-all', {});
    expect(result.data.markedRead).toBe(5);
  });
});
