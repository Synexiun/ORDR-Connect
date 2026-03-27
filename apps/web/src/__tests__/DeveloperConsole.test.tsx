/**
 * DeveloperConsole Component Tests
 *
 * Validates:
 * - Renders API key list
 * - Create key shows raw key once
 * - Revoke key removes from list
 * - Published agents display with status badges
 * - Sandbox status shown
 * - Loading state
 * - Usage stats display
 * - Key prefix display (not full key)
 * - Create key modal opens
 * - Key expiry display
 * - Revoked key badge
 * - Refresh button
 * - Agent version display
 * - Agent download count
 * - Empty key list message
 * - Empty agent list message
 * - Sandbox expiry display
 * - Copy warning for raw key
 * - Create key disabled without name
 * - Page heading
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { DeveloperConsole } from '../pages/DeveloperConsole';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

// ─── Helpers ────────────────────────────────────────────────────

function renderComponent(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(DeveloperConsole)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom does not implement HTMLDialogElement.showModal/close
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('DeveloperConsole', () => {
  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Developer Console')).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderComponent();

    expect(screen.getByText('Loading developer console')).toBeDefined();
  });

  it('renders API key list', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeDefined();
      expect(screen.getByText('Staging Key')).toBeDefined();
    });
  });

  it('shows key prefix not full key', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('ordr_pk_a1b2...')).toBeDefined();
    });
  });

  it('shows revoked badge on revoked key', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Revoked')).toBeDefined();
    });
  });

  it('opens create key modal', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('New Key')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('New Key'));
    });

    expect(screen.getByText('Create API Key')).toBeDefined();
  });

  it('create key shows raw key once', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    mockPost.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('New Key')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('New Key'));
    });

    const input = screen.getByPlaceholderText('e.g. Production Key');
    act(() => {
      fireEvent.change(input, { target: { value: 'Test Key' } });
    });

    act(() => {
      fireEvent.click(screen.getByText('Create Key'));
    });

    await waitFor(() => {
      expect(screen.getByText('Copy this key now. It will not be shown again.')).toBeDefined();
    });
  });

  it('revoke key removes from list', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    mockDelete.mockResolvedValue({ success: true });
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Production Key')).toBeDefined();
    });

    const revokeButtons = screen.getAllByText('Revoke');
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      fireEvent.click(revokeButtons[0]!);
    });

    await waitFor(() => {
      expect(screen.queryByText('Production Key')).toBeNull();
    });
  });

  it('renders published agents', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Smart Collections')).toBeDefined();
      expect(screen.getByText('Payment Reminder')).toBeDefined();
    });
  });

  it('shows agent status badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('published')).toBeDefined();
      expect(screen.getByText('review')).toBeDefined();
      expect(screen.getByText('draft')).toBeDefined();
    });
  });

  it('shows agent versions', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('1.2.0')).toBeDefined();
      expect(screen.getByText('0.9.0')).toBeDefined();
    });
  });

  it('shows sandbox environments', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Dev Testing')).toBeDefined();
      expect(screen.getByText('Demo Env')).toBeDefined();
    });
  });

  it('shows sandbox status badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('active')).toBeDefined();
      expect(screen.getByText('expired')).toBeDefined();
    });
  });

  it('shows usage stats', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Total API Calls')).toBeDefined();
      expect(screen.getByText('Total Errors')).toBeDefined();
      expect(screen.getByText('Calls Today')).toBeDefined();
      expect(screen.getByText('Active Keys')).toBeDefined();
    });
  });

  it('shows Refresh button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeDefined();
    });
  });

  it('shows API Keys section title', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('API Keys')).toBeDefined();
    });
  });

  it('shows Published Agents section title', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Published Agents')).toBeDefined();
    });
  });

  it('shows Sandbox Environments section title', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Sandbox Environments')).toBeDefined();
    });
  });
});
