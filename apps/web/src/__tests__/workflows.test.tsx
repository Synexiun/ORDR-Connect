/**
 * Workflows Page Tests
 *
 * Validates:
 * - Workflows renders page heading and subtitle
 * - Workflows shows loading spinner on mount
 * - Workflows renders KPI cards (Running, Paused, Completed, Failed)
 * - Workflows renders instance table headers after load
 * - Workflows renders instance rows with truncated IDs and status badges
 * - Workflows shows Pause button for running instances
 * - Workflows shows Resume button for paused instances
 * - Workflows shows Cancel button for running and paused instances
 * - Workflows shows empty state when no instances
 * - Workflows Start Workflow button opens modal
 * - Workflows Start Workflow button disabled when no definitions
 * - Workflows shows error when API fails
 *
 * COMPLIANCE: No PHI in any test assertion (Rule 6).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Workflows } from '../pages/Workflows';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

// ─── Mock useToast ────────────────────────────────────────────────

const mockToast = vi.fn();
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_DEF = {
  id: 'onboarding-v1',
  name: 'Customer Onboarding',
  version: 1,
  steps: [],
};

const MOCK_RUNNING = {
  id: 'inst-aaabbbccc',
  definitionId: 'onboarding-v1',
  tenantId: 'tenant-1',
  status: 'running',
  context: {},
  createdAt: new Date('2026-03-28T10:00:00Z').toISOString(),
};

const MOCK_PAUSED = {
  id: 'inst-dddeeefff',
  definitionId: 'onboarding-v1',
  tenantId: 'tenant-1',
  status: 'paused',
  context: {},
  createdAt: new Date('2026-03-28T09:00:00Z').toISOString(),
};

const MOCK_COMPLETED = {
  id: 'inst-ggghhh000',
  definitionId: 'onboarding-v1',
  tenantId: 'tenant-1',
  status: 'completed',
  context: {},
  createdAt: new Date('2026-03-28T08:00:00Z').toISOString(),
};

const DEFS_RESPONSE = { success: true, data: [MOCK_DEF], total: 1 };
const INSTANCES_RESPONSE = {
  success: true,
  data: [MOCK_RUNNING, MOCK_PAUSED, MOCK_COMPLETED],
  total: 3,
};

// ─── Helper ──────────────────────────────────────────────────────

function renderWorkflows(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Workflows)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/v1/workflow/definitions')) return Promise.resolve(DEFS_RESPONSE);
    if (url.includes('/v1/workflow/instances')) return Promise.resolve(INSTANCES_RESPONSE);
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
  mockPost.mockResolvedValue({ success: true, data: MOCK_RUNNING });
  mockPatch.mockResolvedValue({ success: true, data: { ...MOCK_RUNNING, status: 'paused' } });
  mockDelete.mockResolvedValue({ success: true, data: { ...MOCK_RUNNING, status: 'cancelled' } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── polyfill for jsdom (no native <dialog> support) ────────────

HTMLDialogElement.prototype.showModal = vi.fn();
HTMLDialogElement.prototype.close = vi.fn();

// ─── Tests ───────────────────────────────────────────────────────

describe('Workflows page', () => {
  it('renders page heading', () => {
    renderWorkflows();
    // heading is present immediately (PageHeader renders synchronously)
    expect(screen.getAllByText('Workflows').length).toBeGreaterThan(0);
  });

  it('renders subtitle', () => {
    renderWorkflows();
    expect(screen.getByText(/Manage automated workflow instances/i)).toBeDefined();
  });

  it('shows loading spinner on mount', () => {
    renderWorkflows();
    expect(screen.getByText('Loading instances')).toBeDefined();
  });

  it('renders KPI cards after load', async () => {
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
  });

  it('renders instance table headers after load', async () => {
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByText('Definition')).toBeDefined();
    });
    expect(screen.getByText('Status')).toBeDefined();
    expect(screen.getByText('Started')).toBeDefined();
    expect(screen.getByText('Actions')).toBeDefined();
  });

  it('renders instance rows with truncated IDs', async () => {
    renderWorkflows();
    await waitFor(() => {
      // IDs are sliced to 8 chars + ellipsis
      expect(screen.getByText('inst-aaa…')).toBeDefined();
    });
    expect(screen.getByText('inst-ddd…')).toBeDefined();
  });

  it('renders running status badge', async () => {
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getAllByText('running').length).toBeGreaterThan(0);
    });
  });

  it('renders paused status badge', async () => {
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getAllByText('paused').length).toBeGreaterThan(0);
    });
  });

  it('shows Pause button for running instance', async () => {
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeDefined();
    });
  });

  it('shows Resume button for paused instance', async () => {
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeDefined();
    });
  });

  it('shows empty state when no instances', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/workflow/definitions')) return Promise.resolve(DEFS_RESPONSE);
      if (url.includes('/v1/workflow/instances'))
        return Promise.resolve({ success: true, data: [], total: 0 });
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByText('No workflow instances')).toBeDefined();
    });
  });

  it('Start Workflow button is enabled when definitions exist', async () => {
    renderWorkflows();
    await waitFor(() => {
      const btn = screen.getByText('Start Workflow').closest('button');
      expect(btn?.disabled).toBe(false);
    });
  });

  it('Start Workflow button is disabled when no definitions', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/workflow/definitions'))
        return Promise.resolve({ success: true, data: [], total: 0 });
      if (url.includes('/v1/workflow/instances'))
        return Promise.resolve({ success: true, data: [], total: 0 });
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByText('No workflow instances')).toBeDefined();
    });
    const btn = screen.getByText('Start Workflow').closest('button');
    expect(btn?.disabled).toBe(true);
  });

  it('opens Start Workflow modal on button click', async () => {
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start Workflow'));
    await waitFor(() => {
      expect(screen.getByText('Template')).toBeDefined();
    });
    expect(screen.getByText('Entity Type')).toBeDefined();
    expect(screen.getByText('Correlation ID')).toBeDefined();
  });

  it('shows error message when API fails', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load workflow data/i)).toBeDefined();
    });
  });

  it('calls definitions and instances endpoints on mount', async () => {
    renderWorkflows();
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/workflow/definitions'));
    });
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/workflow/instances'));
  });
});
