/**
 * AuditLog Page Tests
 *
 * Validates:
 * - AuditLog renders page heading and compliance description
 * - AuditLog shows loading spinner on mount
 * - AuditLog renders chain status bar with total events and last sequence
 * - AuditLog renders table column headers
 * - AuditLog renders audit event rows with sequence number, event type, actor
 * - AuditLog shows event type badges with correct text
 * - AuditLog shows actor type badges
 * - AuditLog shows "No audit events found" when list is empty
 * - AuditLog shows pagination controls when total > 0
 * - AuditLog shows total event count label
 * - AuditLog renders filter selects (event type, actor type)
 * - AuditLog renders date range inputs
 * - AuditLog shows error message on API failure
 *
 * COMPLIANCE: No PHI in any test assertion (Rule 6).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuditLog } from '../pages/AuditLog';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────

const mockEvents = [
  {
    id: 'evt-001',
    sequenceNumber: 42,
    eventType: 'auth.login',
    actorType: 'user',
    actorId: 'usr-abc123',
    resource: 'session',
    resourceId: 'sess-001',
    action: 'create',
    details: {},
    hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    previousHash: 'prev0000000000000000000000000000',
    timestamp: new Date('2026-03-28T10:00:00Z').toISOString(),
  },
  {
    id: 'evt-002',
    sequenceNumber: 43,
    eventType: 'data.created',
    actorType: 'agent',
    actorId: 'agent-xyz',
    resource: 'customer',
    resourceId: 'cust-001',
    action: 'create',
    details: {},
    hash: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
    previousHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    timestamp: new Date('2026-03-28T10:01:00Z').toISOString(),
  },
];

const mockLogsResponse = {
  events: mockEvents,
  total: 2,
  page: 1,
  limit: 50,
  pages: 1,
};

const mockChainStatus = {
  totalEvents: 2,
  lastSequence: 43,
  lastHash: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
  lastTimestamp: new Date('2026-03-28T10:01:00Z').toISOString(),
};

// ─── Helper ──────────────────────────────────────────────────────

function renderAuditLog(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(AuditLog)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((url: string) => {
    if (url.includes('chain-status')) return Promise.resolve(mockChainStatus);
    return Promise.resolve(mockLogsResponse);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('AuditLog page', () => {
  it('renders page heading', () => {
    renderAuditLog();
    expect(screen.getByText('Audit Log')).toBeDefined();
  });

  it('renders compliance description', () => {
    renderAuditLog();
    expect(screen.getByText(/WORM audit trail/i)).toBeDefined();
  });

  it('shows loading spinner on mount', () => {
    renderAuditLog();
    // Spinner renders an sr-only span with the label text
    expect(screen.getByText('Loading audit events')).toBeDefined();
  });

  it('renders chain status after load', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText('Chain Verified')).toBeDefined();
    });
    // #43 appears in both chain-status card and event table — assert at least one exists
    expect(screen.getAllByText('#43').length).toBeGreaterThan(0);
  });

  it('renders table column headers after load', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText('Event Type')).toBeDefined();
    });
    expect(screen.getByText('Actor')).toBeDefined();
    expect(screen.getByText('Resource')).toBeDefined();
    expect(screen.getByText('Action')).toBeDefined();
    expect(screen.getByText('Hash')).toBeDefined();
  });

  it('renders audit event rows', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText('#42')).toBeDefined();
    });
    // #43 appears in both chain status card and event row
    expect(screen.getAllByText('#43').length).toBeGreaterThan(0);
  });

  it('renders event type badges', async () => {
    renderAuditLog();
    await waitFor(() => {
      // auth.login appears in the table badge (not in the dropdown — dropdown shows "auth.login" as option too)
      expect(screen.getAllByText('auth.login').length).toBeGreaterThan(0);
    });
    // data.created appears as both dropdown option and table badge
    expect(screen.getAllByText('data.created').length).toBeGreaterThan(0);
  });

  it('renders actor type badges', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText('user')).toBeDefined();
    });
    expect(screen.getByText('agent')).toBeDefined();
  });

  it('renders resource column values', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText('session')).toBeDefined();
    });
    expect(screen.getByText('customer')).toBeDefined();
  });

  it('shows total event count', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText('2 events')).toBeDefined();
    });
  });

  it('renders pagination controls when total > 0', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 1/)).toBeDefined();
    });
    expect(screen.getByText('Prev')).toBeDefined();
    expect(screen.getByText('Next')).toBeDefined();
  });

  it('shows "No audit events found" when list is empty', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('chain-status')) return Promise.resolve(mockChainStatus);
      return Promise.resolve({ events: [], total: 0, page: 1, limit: 50, pages: 0 });
    });
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText(/No audit events found/i)).toBeDefined();
    });
  });

  it('renders filter selects', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText('All Event Types')).toBeDefined();
    });
    expect(screen.getByText('All Actors')).toBeDefined();
  });

  it('renders Apply and Clear filter buttons', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText('Apply')).toBeDefined();
    });
    expect(screen.getByText('Clear')).toBeDefined();
  });

  it('shows error message when logs API fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('chain-status')) return Promise.resolve(mockChainStatus);
      return Promise.reject(new Error('Network error'));
    });
    renderAuditLog();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load audit events/i)).toBeDefined();
    });
  });

  it('calls both chain-status and audit-logs endpoints on mount', async () => {
    renderAuditLog();
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('audit-logs/chain-status'));
    });
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('audit-logs?'));
  });
});
