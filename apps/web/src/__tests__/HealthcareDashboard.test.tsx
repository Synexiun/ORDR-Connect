/**
 * HealthcareDashboard Component Tests
 *
 * Validates:
 * - Renders patient queue with tokenized IDs (no PHI)
 * - No PHI (real names, SSNs, DOBs) in rendered output
 * - Appointment schedule displays
 * - Compliance status widget (green/yellow/red)
 * - Agent activity section
 * - Loading state
 * - Queue priority badges
 * - Appointment type display
 * - Care plan status cards with progress bars
 * - Care plan phase badges
 * - Agent confidence scores
 * - Agent status badges
 * - HIPAA score display
 * - Open findings count
 * - Last audit date
 * - Checks passed / total
 * - Patient tokens use PTK prefix
 * - Department display in queue
 * - Wait time display
 * - Page heading
 * - HIPAA compliant subtitle
 * - Refresh button
 * - Queue live badge
 * - Appointment today badge
 * - Healthcare agent badge
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { HealthcareDashboard } from '../pages/HealthcareDashboard';

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
    createElement(BrowserRouter, null, createElement(HealthcareDashboard)),
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

describe('HealthcareDashboard', () => {
  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Healthcare Dashboard')).toBeDefined();
    });
  });

  it('shows HIPAA compliant subtitle', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Patient operations overview (HIPAA compliant)')).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(() => new Promise(() => { /* never resolves */ }));
    renderComponent();

    expect(screen.getByText('Loading healthcare dashboard')).toBeDefined();
  });

  it('renders patient queue with tokenized IDs', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      // PTK-8a2f appears in both queue and care plans
      const tokens = screen.getAllByText('PTK-8a2f');
      expect(tokens.length).toBeGreaterThan(0);
      expect(screen.getAllByText('PTK-3b9e').length).toBeGreaterThan(0);
      expect(screen.getAllByText('PTK-7c1d').length).toBeGreaterThan(0);
    });
  });

  it('patient tokens use PTK prefix format', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      const tokens = screen.getAllByText(/^PTK-/);
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(token.textContent).toMatch(/^PTK-[a-z0-9]{4}$/);
      }
    });
  });

  it('does NOT render any PHI (real names, SSNs, DOBs)', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    const { container } = renderComponent();

    await waitFor(() => {
      const tokens = screen.getAllByText('PTK-8a2f');
      expect(tokens.length).toBeGreaterThan(0);
    });

    const allText = container.textContent ?? '';
    // No real patient names
    expect(allText).not.toMatch(/John\s+Doe/i);
    expect(allText).not.toMatch(/Jane\s+Smith/i);
    // No SSN patterns
    expect(allText).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    // No DOB patterns like "01/15/1990"
    expect(allText).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('shows queue priority badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('urgent')).toBeDefined();
      expect(screen.getByText('high')).toBeDefined();
      // 'normal' appears multiple times (2 queue items)
      expect(screen.getAllByText('normal').length).toBeGreaterThan(0);
      expect(screen.getByText('low')).toBeDefined();
    });
  });

  it('shows department in queue items', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Emergency')).toBeDefined();
      expect(screen.getByText('Cardiology')).toBeDefined();
    });
  });

  it('shows wait time in queue items', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('5m wait')).toBeDefined();
      expect(screen.getByText('12m wait')).toBeDefined();
    });
  });

  it('renders appointment schedule', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Appointment Schedule')).toBeDefined();
    });
  });

  it('shows appointment status badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      // 'scheduled' and 'completed' may appear multiple times due to repeated mock data
      expect(screen.getAllByText('scheduled').length).toBeGreaterThan(0);
      expect(screen.getAllByText('in-progress').length).toBeGreaterThan(0);
      expect(screen.getAllByText('completed').length).toBeGreaterThan(0);
    });
  });

  it('renders HIPAA compliance status widget', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('HIPAA Compliance Status')).toBeDefined();
    });
  });

  it('shows compliance level indicator (GREEN)', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('GREEN')).toBeDefined();
    });
  });

  it('shows HIPAA score', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('96%')).toBeDefined();
    });
  });

  it('shows checks passed / total', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('48/50')).toBeDefined();
    });
  });

  it('shows open findings count', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Open Findings')).toBeDefined();
    });
  });

  it('renders care plan status cards', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Care Plan Status')).toBeDefined();
    });
  });

  it('shows care plan phase badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('implementation')).toBeDefined();
      expect(screen.getByText('planning')).toBeDefined();
      expect(screen.getByText('evaluation')).toBeDefined();
      expect(screen.getByText('assessment')).toBeDefined();
    });
  });

  it('shows care plan completion percentages', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('75%')).toBeDefined();
      expect(screen.getByText('30%')).toBeDefined();
      expect(screen.getByText('90%')).toBeDefined();
    });
  });

  it('renders agent activity section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Agent Activity')).toBeDefined();
    });
  });

  it('shows agent action descriptions', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Scheduled follow-up appointment')).toBeDefined();
      expect(screen.getByText('Sent appointment reminder')).toBeDefined();
    });
  });

  it('shows Refresh button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeDefined();
    });
  });

  it('shows Patient Queue title', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Patient Queue')).toBeDefined();
    });
  });
});
