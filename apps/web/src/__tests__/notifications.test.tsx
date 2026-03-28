/**
 * Notifications Page Tests
 *
 * Validates:
 * - Notifications shows loading spinner on mount
 * - Notifications renders page heading
 * - Notifications shows unread count in subtitle
 * - Notifications renders HITL Approvals section
 * - Notifications renders HITL item with Approve and Reject buttons
 * - Notifications renders notification titles
 * - Notifications renders type filter buttons
 * - Notifications shows Read button for unread notifications
 * - Notifications shows Dismiss button for all notifications
 * - Notifications shows empty HITL state when queue is clear
 * - Notifications calls listHitl and listNotifications on mount
 *
 * COMPLIANCE: No PHI in any test assertion (Rule 6).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Notifications } from '../pages/Notifications';

// ─── Mock agents-api ─────────────────────────────────────────────

const mockListHitl = vi.fn();
const mockApproveHitl = vi.fn();
const mockRejectHitl = vi.fn();

vi.mock('../lib/agents-api', () => ({
  listHitl: (...args: unknown[]) => mockListHitl(...args) as unknown,
  approveHitl: (...args: unknown[]) => mockApproveHitl(...args) as unknown,
  rejectHitl: (...args: unknown[]) => mockRejectHitl(...args) as unknown,
}));

// ─── Mock notifications-api ───────────────────────────────────────

const mockListNotifications = vi.fn();
const mockMarkNotificationRead = vi.fn();
const mockDismissNotification = vi.fn();

vi.mock('../lib/notifications-api', () => ({
  listNotifications: (...args: unknown[]) => mockListNotifications(...args) as unknown,
  markNotificationRead: (...args: unknown[]) => mockMarkNotificationRead(...args) as unknown,
  dismissNotification: (...args: unknown[]) => mockDismissNotification(...args) as unknown,
  markAllNotificationsRead: vi.fn(),
}));

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_HITL_ITEM = {
  id: 'hitl-test-1',
  sessionId: 'sess-test-1',
  action: 'Send payment notice via email',
  reason: 'Confidence below threshold',
  context: {
    agentRole: 'collection',
    confidence: 0.55,
    customerId: 'Acme Corp',
  },
  createdAt: new Date('2026-03-28T09:00:00Z').toISOString(),
};

const MOCK_UNREAD_NOTIF = {
  id: 'notif-test-1',
  type: 'compliance' as const,
  severity: 'critical' as const,
  title: 'Compliance Alert',
  description: 'Policy violation detected',
  timestamp: new Date('2026-03-28T09:30:00Z').toISOString(),
  read: false,
  dismissed: false,
};

const MOCK_READ_NOTIF = {
  id: 'notif-test-2',
  type: 'system' as const,
  severity: 'low' as const,
  title: 'System Update',
  description: 'Maintenance scheduled',
  timestamp: new Date('2026-03-28T08:00:00Z').toISOString(),
  read: true,
  dismissed: false,
};

const HITL_RESPONSE = { data: [MOCK_HITL_ITEM] };
const NOTIF_RESPONSE = {
  success: true as const,
  data: [MOCK_UNREAD_NOTIF, MOCK_READ_NOTIF],
  meta: { total: 2, unreadCount: 1 },
};

// ─── Helper ──────────────────────────────────────────────────────

function renderNotifications(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Notifications)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockListHitl.mockResolvedValue(HITL_RESPONSE);
  mockListNotifications.mockResolvedValue(NOTIF_RESPONSE);
  mockApproveHitl.mockResolvedValue({ success: true });
  mockRejectHitl.mockResolvedValue({ success: true });
  mockMarkNotificationRead.mockResolvedValue({
    success: true,
    data: { ...MOCK_UNREAD_NOTIF, read: true },
  });
  mockDismissNotification.mockResolvedValue({
    success: true,
    data: { ...MOCK_UNREAD_NOTIF, dismissed: true },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('Notifications page', () => {
  it('shows loading spinner on mount', () => {
    renderNotifications();
    expect(screen.getByText('Loading notifications')).toBeDefined();
  });

  it('renders page heading after load', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText('Notifications')).toBeDefined();
    });
  });

  it('shows unread count in subtitle', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText(/1 unread notification/i)).toBeDefined();
    });
  });

  it('renders HITL Approvals section', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText('HITL Approvals')).toBeDefined();
    });
  });

  it('renders HITL item action text', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText('Send payment notice via email')).toBeDefined();
    });
  });

  it('shows Approve button for HITL item', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeDefined();
    });
  });

  it('shows Reject button for HITL item', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText('Reject')).toBeDefined();
    });
  });

  it('renders notification title', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText('Compliance Alert')).toBeDefined();
    });
    expect(screen.getByText('System Update')).toBeDefined();
  });

  it('renders type filter buttons', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText('All')).toBeDefined();
    });
    // Filter labels appear alongside badge labels — use getAllByText
    expect(screen.getAllByText('Compliance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('System').length).toBeGreaterThan(0);
  });

  it('shows Read button for unread notification', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText('Read')).toBeDefined();
    });
  });

  it('shows Dismiss button for notifications', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(screen.getAllByText('Dismiss').length).toBeGreaterThan(0);
    });
  });

  it('shows empty HITL state when queue is clear', async () => {
    mockListHitl.mockResolvedValue({ data: [] });
    renderNotifications();
    await waitFor(() => {
      expect(screen.getByText('No items pending review.')).toBeDefined();
    });
  });

  it('calls listHitl and listNotifications on mount', async () => {
    renderNotifications();
    await waitFor(() => {
      expect(mockListHitl).toHaveBeenCalledTimes(1);
    });
    expect(mockListNotifications).toHaveBeenCalledTimes(1);
  });

  it('falls back to mock data when APIs fail', async () => {
    mockListHitl.mockRejectedValue(new Error('Network error'));
    mockListNotifications.mockRejectedValue(new Error('Network error'));
    renderNotifications();
    await waitFor(() => {
      // Mock data includes HITL approvals section
      expect(screen.getByText('HITL Approvals')).toBeDefined();
    });
  });
});
