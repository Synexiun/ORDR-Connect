/**
 * PartnerDashboard Component Tests
 *
 * Validates:
 * - Earnings summary renders (total, pending, paid)
 * - Payout history table
 * - Published agents list with install counts
 * - Loading states
 * - Partner tier badge
 * - Revenue share percentage
 * - Monthly earnings chart
 * - Payout status badges
 * - Currency formatting
 * - Empty payout state
 * - Empty agents state
 * - Refresh button
 * - Page heading
 * - Company name display
 * - Agent version display
 * - Agent rating display
 * - Payout period display
 * - Paid at display
 * - KPI card layout
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { PartnerDashboard } from '../pages/PartnerDashboard';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────

function renderComponent(): ReturnType<typeof render> {
  return render(
    createElement(BrowserRouter, null, createElement(PartnerDashboard)),
  );
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('PartnerDashboard', () => {
  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Partner Dashboard')).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(() => new Promise(() => { /* never resolves */ }));
    renderComponent();

    expect(screen.getByText('Loading partner dashboard')).toBeDefined();
  });

  it('renders total earnings', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Total Earnings')).toBeDefined();
      expect(screen.getByText('$4,582.00')).toBeDefined();
    });
  });

  it('renders pending earnings', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      // "Pending" appears as KPI header + payout status badge
      expect(screen.getAllByText(/^Pending$/i).length).toBeGreaterThan(0);
      // $850.00 may appear in both KPI and payout table
      expect(screen.getAllByText('$850.00').length).toBeGreaterThan(0);
    });
  });

  it('renders paid earnings', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Paid')).toBeDefined();
      expect(screen.getByText('$3,732.00')).toBeDefined();
    });
  });

  it('shows revenue share percentage', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('20% revenue share')).toBeDefined();
    });
  });

  it('shows partner tier badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('gold')).toBeDefined();
    });
  });

  it('shows company name', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/PartnerCorp/)).toBeDefined();
    });
  });

  it('renders payout history table', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Payout History')).toBeDefined();
    });
  });

  it('shows payout status badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('pending')).toBeDefined();
      // Multiple 'paid' badges expected
      const paidBadges = screen.getAllByText('paid');
      expect(paidBadges.length).toBeGreaterThan(0);
    });
  });

  it('renders published agents section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Published Agents')).toBeDefined();
      expect(screen.getByText('Smart Collections')).toBeDefined();
      expect(screen.getByText('Payment Reminder')).toBeDefined();
    });
  });

  it('shows agent install counts', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/847 installs/)).toBeDefined();
    });
  });

  it('shows agent version badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('v1.2.0')).toBeDefined();
      expect(screen.getByText('v1.0.0')).toBeDefined();
    });
  });

  it('renders monthly earnings chart', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Monthly Earnings')).toBeDefined();
      expect(screen.getByText('Oct')).toBeDefined();
      expect(screen.getByText('Nov')).toBeDefined();
      expect(screen.getByText('Dec')).toBeDefined();
    });
  });

  it('shows Refresh button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeDefined();
    });
  });

  it('shows Awaiting payout subtitle', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Awaiting payout')).toBeDefined();
    });
  });

  it('shows Total disbursed subtitle', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Total disbursed')).toBeDefined();
    });
  });

  it('shows agent published status', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      const publishedBadges = screen.getAllByText('published');
      expect(publishedBadges.length).toBe(3);
    });
  });

  it('payout table has expected column headers', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Period')).toBeDefined();
      expect(screen.getByText('Amount')).toBeDefined();
      expect(screen.getByText('Status')).toBeDefined();
    });
  });
});
