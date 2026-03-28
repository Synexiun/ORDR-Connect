/**
 * Interactions Page Tests
 *
 * Validates:
 * - Interactions shows loading spinner on mount
 * - Interactions renders page heading
 * - Interactions shows PHI compliance notice
 * - Interactions renders channel filter buttons
 * - Interactions renders interaction rows after load
 * - Interactions falls back to mock data when API fails
 * - Interactions calls listMessages on mount
 * - Interactions shows empty state when no interactions match
 *
 * COMPLIANCE: No PHI in any test assertion (Rule 6).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Interactions } from '../pages/Interactions';

// ─── Mock SparkLine (canvas not available in jsdom) ──────────────

vi.mock('../components/charts/SparkLine', () => ({
  SparkLine: () => null,
}));

// ─── Mock messages-api ───────────────────────────────────────────

const mockListMessages = vi.fn();

vi.mock('../lib/messages-api', () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args) as unknown,
}));

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_MESSAGE = {
  id: 'msg-test-1',
  tenantId: 'tenant-1',
  customerId: 'cust-0001',
  channel: 'sms' as const,
  direction: 'outbound' as const,
  status: 'delivered' as const,
  correlationId: 'req-abc1',
  sentAt: new Date('2026-03-28T10:00:00Z').toISOString(),
  createdAt: new Date('2026-03-28T09:59:00Z').toISOString(),
  updatedAt: new Date('2026-03-28T10:00:00Z').toISOString(),
  errorCode: null,
  errorMessage: null,
  retryCount: 0,
  metadata: {},
};

const LIST_RESPONSE = {
  success: true as const,
  data: [MOCK_MESSAGE],
  total: 1,
  page: 1,
  pageSize: 100,
};

// ─── Helper ──────────────────────────────────────────────────────

function renderInteractions(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Interactions)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockListMessages.mockResolvedValue(LIST_RESPONSE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('Interactions page', () => {
  it('shows loading spinner on mount', () => {
    renderInteractions();
    expect(screen.getByText('Loading interactions')).toBeDefined();
  });

  it('renders page heading after load', async () => {
    renderInteractions();
    await waitFor(() => {
      expect(screen.getByText('Interactions')).toBeDefined();
    });
  });

  it('shows PHI compliance notice', async () => {
    renderInteractions();
    await waitFor(() => {
      expect(screen.getByText(/Message content is never displayed/i)).toBeDefined();
    });
  });

  it('renders channel filter buttons', async () => {
    renderInteractions();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'All' })).toBeDefined();
    });
    expect(screen.getByRole('button', { name: 'SMS' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Email' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Voice' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Chat' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'IVR' })).toBeDefined();
  });

  it('renders KPI labels after load', async () => {
    renderInteractions();
    await waitFor(() => {
      expect(screen.getByText('Total')).toBeDefined();
    });
    expect(screen.getByText('Delivered')).toBeDefined();
    expect(screen.getByText('Failed')).toBeDefined();
    expect(screen.getByText('Inbound')).toBeDefined();
  });

  it('calls listMessages on mount', async () => {
    renderInteractions();
    await waitFor(() => {
      expect(mockListMessages).toHaveBeenCalledTimes(1);
    });
  });

  it('calls listMessages with pageSize: 100', async () => {
    renderInteractions();
    await waitFor(() => {
      expect(mockListMessages).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }));
    });
  });

  it('falls back to mock data when API fails', async () => {
    mockListMessages.mockRejectedValue(new Error('Network error'));
    renderInteractions();
    // Fallback renders mock interactions — empty-state message must NOT appear
    await waitFor(
      () => {
        // Page heading visible and no empty-state message = fallback data loaded
        expect(screen.getByText('Interactions')).toBeDefined();
        expect(
          screen.queryByText('No interactions found matching the current filters.'),
        ).toBeNull();
      },
      { timeout: 5000 },
    );
  });

  it('shows interaction customer name from API response', async () => {
    renderInteractions();
    // adaptMessage maps customerId → customerName, so cust-0001 appears as text
    await waitFor(() => {
      expect(screen.getByText('cust-0001')).toBeDefined();
    });
  });

  it('shows delivered status badge', async () => {
    renderInteractions();
    await waitFor(() => {
      expect(screen.getByText('delivered')).toBeDefined();
    });
  });

  it('shows empty state when interactions list is empty after load', async () => {
    mockListMessages.mockResolvedValue({
      ...LIST_RESPONSE,
      data: [],
      total: 0,
    });
    renderInteractions();
    await waitFor(() => {
      expect(screen.getByText('No interactions found matching the current filters.')).toBeDefined();
    });
  });
});
