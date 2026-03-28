/**
 * Agent Activity Page Tests
 *
 * Validates:
 * - AgentActivity shows loading spinner on mount
 * - AgentActivity renders page heading after load
 * - AgentActivity renders sessions list
 * - AgentActivity renders HITL queue
 * - AgentActivity shows Approve/Reject buttons for HITL items
 * - AgentActivity shows Orchestrator Status section
 * - AgentActivity renders KPI metric labels
 * - AgentActivity shows Kill button for running sessions
 * - AgentActivity shows empty HITL state when queue is clear
 * - AgentActivity calls listSessions and listHitl on mount
 * - AgentActivity falls back to mock data when APIs fail
 *
 * COMPLIANCE: No PHI in any test assertion (Rule 6).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AgentActivity } from '../pages/AgentActivity';

// ─── Mock chart components (canvas not available in jsdom) ───────

vi.mock('../components/charts/SparkLine', () => ({ SparkLine: () => null }));
vi.mock('../components/charts/GaugeChart', () => ({ GaugeChart: () => null }));
vi.mock('../components/charts/BarChart', () => ({ BarChart: () => null }));
vi.mock('../components/agent-graph/AgentFlowGraph', () => ({
  AgentFlowGraph: () => null,
}));

// ─── Mock Modal (avoid HTMLDialogElement polyfill in jsdom) ──────

vi.mock('../components/ui/Modal', () => ({
  Modal: ({ open, children, title }: { open: boolean; children: unknown; title?: string }) => {
    if (!open) return null;
    return createElement(
      'div',
      { role: 'dialog', 'aria-label': title },
      children as React.ReactNode,
    );
  },
}));

// ─── Mock useRealtimeEvents ───────────────────────────────────────

vi.mock('../hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: () => undefined,
}));

// ─── Mock agents-api ─────────────────────────────────────────────

const mockListSessions = vi.fn();
const mockListHitl = vi.fn();
const mockKillSession = vi.fn();
const mockApproveHitl = vi.fn();
const mockRejectHitl = vi.fn();

vi.mock('../lib/agents-api', () => ({
  listSessions: (...args: unknown[]) => mockListSessions(...args) as unknown,
  listHitl: (...args: unknown[]) => mockListHitl(...args) as unknown,
  killSession: (...args: unknown[]) => mockKillSession(...args) as unknown,
  approveHitl: (...args: unknown[]) => mockApproveHitl(...args) as unknown,
  rejectHitl: (...args: unknown[]) => mockRejectHitl(...args) as unknown,
}));

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_SESSION = {
  id: 'sess-test-1',
  tenantId: 'tenant-1',
  agentRole: 'collection',
  status: 'active',
  customerId: 'cust-0001',
  steps: [{ toolUsed: 'send_sms', approved: true }],
  confidenceScore: 0.92,
  costCents: 12,
  startedAt: new Date('2026-03-28T09:00:00Z').toISOString(),
  completedAt: null,
  metadata: {},
};

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
  createdAt: new Date('2026-03-28T09:30:00Z').toISOString(),
};

const SESSIONS_RESPONSE = {
  data: [MOCK_SESSION],
  total: 1,
};

const HITL_RESPONSE = {
  data: [MOCK_HITL_ITEM],
  total: 1,
};

// ─── Helper ──────────────────────────────────────────────────────

function renderAgentActivity(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(AgentActivity)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockListSessions.mockResolvedValue(SESSIONS_RESPONSE);
  mockListHitl.mockResolvedValue(HITL_RESPONSE);
  mockKillSession.mockResolvedValue({ success: true });
  mockApproveHitl.mockResolvedValue({ success: true });
  mockRejectHitl.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('AgentActivity page', () => {
  it('shows loading spinner on mount', () => {
    renderAgentActivity();
    expect(screen.getByText('Loading agent activity')).toBeDefined();
  });

  it('renders page heading after load', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByText('Agent Activity')).toBeDefined();
    });
  });

  it('renders sessions section heading', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByText('Active Sessions')).toBeDefined();
    });
  });

  it('renders HITL Queue section heading', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByText('HITL Queue')).toBeDefined();
    });
  });

  it('renders HITL item action text', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByText('Send payment notice via email')).toBeDefined();
    });
  });

  it('shows Approve button for HITL item', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined();
    });
  });

  it('shows Reject button for HITL item', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reject' })).toBeDefined();
    });
  });

  it('renders KPI metric labels', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByText('Sessions Today')).toBeDefined();
    });
    expect(screen.getByText('Active Now')).toBeDefined();
    expect(screen.getByText('HITL Pending')).toBeDefined();
  });

  it('renders Orchestrator Status section', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByText('Orchestrator Status')).toBeDefined();
    });
  });

  it('shows Kill button for running sessions', async () => {
    renderAgentActivity();
    // Mock session is 'active' → adapts to 'running', should show Kill
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /kill session sess-test-1/i })).toBeDefined();
    });
  });

  it('shows empty HITL state when queue is clear', async () => {
    mockListHitl.mockResolvedValue({ data: [], total: 0 });
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByText('No items pending review.')).toBeDefined();
    });
  });

  it('calls listSessions on mount', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(mockListSessions).toHaveBeenCalledTimes(1);
    });
  });

  it('calls listHitl on mount', async () => {
    renderAgentActivity();
    await waitFor(() => {
      expect(mockListHitl).toHaveBeenCalledTimes(1);
    });
  });

  it('falls back to mock data when APIs fail', async () => {
    mockListSessions.mockRejectedValue(new Error('Network error'));
    mockListHitl.mockRejectedValue(new Error('Network error'));
    renderAgentActivity();
    await waitFor(() => {
      // Mock sessions include 'Acme Corp'
      expect(screen.getByText('Acme Corp')).toBeDefined();
    });
  });

  it('shows session empty state when no sessions', async () => {
    mockListSessions.mockResolvedValue({ data: [], total: 0 });
    mockListHitl.mockResolvedValue({ data: [], total: 0 });
    renderAgentActivity();
    await waitFor(() => {
      expect(screen.getByText('No active agent sessions.')).toBeDefined();
    });
  });
});
