/**
 * SchedulerMonitor Page Tests
 *
 * Validates:
 * - SchedulerMonitor renders page heading and subtitle
 * - SchedulerMonitor shows loading spinner on mount
 * - SchedulerMonitor renders KPI cards (Running, Pending, Failed, Dead Letter)
 * - SchedulerMonitor renders instances tab by default
 * - SchedulerMonitor renders job instance table headers
 * - SchedulerMonitor renders job rows with attempts/status
 * - SchedulerMonitor shows empty state when no instances
 * - SchedulerMonitor Dead Letter tab shows dead letter table headers
 * - SchedulerMonitor Dead Letter tab shows dead letter rows
 * - SchedulerMonitor Dead Letter tab shows empty state when queue is empty
 * - SchedulerMonitor shows error when instances API fails
 *
 * COMPLIANCE: No PHI in any test assertion (Rule 6).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { SchedulerMonitor } from '../pages/SchedulerMonitor';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_JOB = {
  id: 'job-aaabbbccc',
  jobType: 'send-email',
  tenantId: 'tenant-1',
  status: 'completed',
  scheduledAt: new Date('2026-03-28T10:00:00Z').toISOString(),
  attempts: 1,
  maxAttempts: 3,
  payload: {},
  createdAt: new Date('2026-03-28T10:00:00Z').toISOString(),
  completedAt: new Date('2026-03-28T10:00:05Z').toISOString(),
};

const MOCK_RUNNING_JOB = {
  id: 'job-dddeeefff',
  jobType: 'sync-contacts',
  tenantId: 'tenant-1',
  status: 'running',
  scheduledAt: new Date('2026-03-28T10:01:00Z').toISOString(),
  attempts: 1,
  maxAttempts: 3,
  payload: {},
  createdAt: new Date('2026-03-28T10:01:00Z').toISOString(),
};

const MOCK_DL = {
  id: 'dl-ggghhh000',
  originalInstanceId: 'job-failed',
  jobType: 'webhook-delivery',
  tenantId: 'tenant-1',
  payload: {},
  error: 'Connection refused after 3 attempts',
  attempts: 3,
  deadLetteredAt: new Date('2026-03-28T09:00:00Z').toISOString(),
};

const INSTANCES_RESPONSE = {
  success: true,
  data: [MOCK_JOB, MOCK_RUNNING_JOB],
  total: 2,
};

const DL_RESPONSE = {
  success: true,
  data: [MOCK_DL],
  total: 1,
};

// ─── Helper ──────────────────────────────────────────────────────

function renderSchedulerMonitor(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(SchedulerMonitor)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/v1/scheduler/dead-letter')) return Promise.resolve(DL_RESPONSE);
    if (url.includes('/v1/scheduler/instances')) return Promise.resolve(INSTANCES_RESPONSE);
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('SchedulerMonitor page', () => {
  it('renders page heading', () => {
    renderSchedulerMonitor();
    expect(screen.getByText('Scheduler Monitor')).toBeDefined();
  });

  it('renders subtitle', () => {
    renderSchedulerMonitor();
    expect(screen.getByText(/Inspect scheduled job instances/i)).toBeDefined();
  });

  it('shows loading spinner on mount', () => {
    renderSchedulerMonitor();
    expect(screen.getByText('Loading jobs')).toBeDefined();
  });

  it('renders KPI cards after load', async () => {
    renderSchedulerMonitor();
    await waitFor(() => {
      expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dead Letter').length).toBeGreaterThan(0);
  });

  it('renders Job Instances tab by default', async () => {
    renderSchedulerMonitor();
    await waitFor(() => {
      // Tab label includes count, e.g. "Job Instances (2)"
      expect(screen.getAllByText(/Job Instances/i).length).toBeGreaterThan(0);
    });
  });

  it('renders instance table headers', async () => {
    renderSchedulerMonitor();
    await waitFor(() => {
      expect(screen.getByText('Job Type')).toBeDefined();
    });
    expect(screen.getByText('Attempts')).toBeDefined();
    expect(screen.getByText('Scheduled')).toBeDefined();
    // "Completed" appears in both KPI card and table header — use getAllByText
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
  });

  it('renders job rows with truncated IDs', async () => {
    // slice(0, 8) of 'job-aaabbbccc' = 'job-aaab'
    renderSchedulerMonitor();
    await waitFor(() => {
      expect(screen.getByText('job-aaab…')).toBeDefined();
    });
    expect(screen.getByText('job-ddde…')).toBeDefined();
  });

  it('renders job type values', async () => {
    renderSchedulerMonitor();
    await waitFor(() => {
      expect(screen.getByText('send-email')).toBeDefined();
    });
    expect(screen.getByText('sync-contacts')).toBeDefined();
  });

  it('shows empty state when no instances', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/scheduler/dead-letter')) return Promise.resolve(DL_RESPONSE);
      if (url.includes('/v1/scheduler/instances'))
        return Promise.resolve({ success: true, data: [], total: 0 });
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });
    renderSchedulerMonitor();
    await waitFor(() => {
      expect(screen.getByText('No jobs found')).toBeDefined();
    });
  });

  it('Dead Letter tab renders dead letter table headers', async () => {
    renderSchedulerMonitor();
    await waitFor(() => {
      // Tab label includes count "Dead Letter (1)"
      expect(screen.getAllByText(/Dead Letter \(/i).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText(/Dead Letter \(/i)[0]);
    await waitFor(() => {
      expect(screen.getByText('Dead-lettered')).toBeDefined();
    });
    expect(screen.getByText('Error')).toBeDefined();
  });

  it('Dead Letter tab renders error messages', async () => {
    renderSchedulerMonitor();
    await waitFor(() => {
      expect(screen.getAllByText(/Dead Letter \(/i).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText(/Dead Letter \(/i)[0]);
    await waitFor(() => {
      expect(screen.getByText('webhook-delivery')).toBeDefined();
    });
    expect(screen.getByText('Connection refused after 3 attempts')).toBeDefined();
  });

  it('Dead Letter tab shows empty state when queue is empty', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/scheduler/dead-letter'))
        return Promise.resolve({ success: true, data: [], total: 0 });
      if (url.includes('/v1/scheduler/instances')) return Promise.resolve(INSTANCES_RESPONSE);
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });
    renderSchedulerMonitor();
    await waitFor(() => {
      expect(screen.getAllByText(/Dead Letter \(/i).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText(/Dead Letter \(/i)[0]);
    await waitFor(() => {
      expect(screen.getByText('Dead-letter queue empty')).toBeDefined();
    });
  });

  it('shows error when instances API fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/v1/scheduler/dead-letter')) return Promise.resolve(DL_RESPONSE);
      return Promise.reject(new Error('Network error'));
    });
    renderSchedulerMonitor();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load scheduler instances/i)).toBeDefined();
    });
  });

  it('calls both instances and dead-letter endpoints on mount', async () => {
    renderSchedulerMonitor();
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/scheduler/instances'));
    });
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/v1/scheduler/dead-letter'));
  });
});
