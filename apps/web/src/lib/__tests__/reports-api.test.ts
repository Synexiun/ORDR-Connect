/**
 * Reports API Tests
 *
 * Validates:
 * - fetchReportTemplates → GET /v1/reports/templates (success + fallback)
 * - fetchRecentReports → GET /v1/reports/recent (success + fallback)
 * - generateReport → POST /v1/reports/generate (success + fallback)
 * - fetchReport → GET /v1/reports/:id (success + fallback preserves id)
 * - fetchScheduledReports → GET /v1/reports/schedules (success + fallback)
 * - createSchedule → POST /v1/reports/schedules (success + fallback)
 * - deleteSchedule → DELETE /v1/reports/schedules/:id (success + fallback no-op)
 *
 * COMPLIANCE: No PHI in any test assertion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: vi.fn(),
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

import {
  fetchReportTemplates,
  fetchRecentReports,
  generateReport,
  fetchReport,
  fetchScheduledReports,
  createSchedule,
  deleteSchedule,
  mockReportTemplates,
  mockRecentReports,
  mockScheduledReports,
  mockReportData,
} from '../reports-api';

// ─── Fixtures ────────────────────────────────────────────────────

const API_TEMPLATE = {
  type: 'operations' as const,
  name: 'Operations Summary',
  description: 'Operations report',
  icon: 'LayoutDashboard',
  metrics: ['Throughput'],
};

const API_GENERATED_REPORT = {
  id: 'rpt-api-1',
  type: 'operations' as const,
  name: 'Operations Summary — Mar 2026',
  generatedAt: new Date('2026-03-28T10:00:00Z').toISOString(),
  generatedBy: 'admin@ordr.io',
  timeRange: 'Mar 1 — Mar 28, 2026',
  status: 'completed' as const,
  rowCount: 1200,
  size: '2.1 MB',
};

const API_SCHEDULED_REPORT = {
  id: 'sched-api-1',
  name: 'Weekly Ops',
  type: 'operations' as const,
  frequency: 'weekly' as const,
  recipients: ['admin@ordr.io'],
  nextRun: new Date('2026-04-04T09:00:00Z').toISOString(),
  lastRun: new Date('2026-03-28T09:00:00Z').toISOString(),
  status: 'active' as const,
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue([API_TEMPLATE]);
  mockPost.mockResolvedValue(API_GENERATED_REPORT);
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('fetchReportTemplates', () => {
  it('calls GET /v1/reports/templates', async () => {
    await fetchReportTemplates();
    expect(mockGet).toHaveBeenCalledWith('/v1/reports/templates');
  });

  it('returns API templates on success', async () => {
    const result = await fetchReportTemplates();
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('operations');
  });

  it('falls back to mockReportTemplates on API failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchReportTemplates();
    expect(result).toEqual(mockReportTemplates);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('fetchRecentReports', () => {
  it('calls GET /v1/reports/recent', async () => {
    mockGet.mockResolvedValue([API_GENERATED_REPORT]);
    await fetchRecentReports();
    expect(mockGet).toHaveBeenCalledWith('/v1/reports/recent');
  });

  it('falls back to mockRecentReports on API failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchRecentReports();
    expect(result).toEqual(mockRecentReports);
  });
});

describe('generateReport', () => {
  it('calls POST /v1/reports/generate with type and timeRange', async () => {
    const timeRange = { start: '2026-03-01', end: '2026-03-28' };
    await generateReport('operations', timeRange);
    expect(mockPost).toHaveBeenCalledWith('/v1/reports/generate', {
      type: 'operations',
      timeRange,
    });
  });

  it('returns the generated report on success', async () => {
    const result = await generateReport('operations', {
      start: '2026-03-01',
      end: '2026-03-28',
    });
    expect(result.id).toBe('rpt-api-1');
    expect(result.status).toBe('completed');
  });

  it('falls back to local mock report with generating status on failure', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    const result = await generateReport('operations', {
      start: '2026-03-01',
      end: '2026-03-28',
    });
    expect(result.status).toBe('generating');
    expect(result.type).toBe('operations');
  });
});

describe('fetchReport', () => {
  it('calls GET /v1/reports/:id', async () => {
    mockGet.mockResolvedValue(mockReportData);
    await fetchReport('rpt-001');
    expect(mockGet).toHaveBeenCalledWith('/v1/reports/rpt-001');
  });

  it('returns report data on success', async () => {
    mockGet.mockResolvedValue(mockReportData);
    const result = await fetchReport('rpt-001');
    expect(result.id).toBe('rpt-001');
    expect(result.tableHeaders.length).toBeGreaterThan(0);
  });

  it('falls back to mockReportData with requested id on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchReport('rpt-custom');
    expect(result.id).toBe('rpt-custom');
  });
});

describe('fetchScheduledReports', () => {
  it('calls GET /v1/reports/schedules', async () => {
    mockGet.mockResolvedValue([API_SCHEDULED_REPORT]);
    await fetchScheduledReports();
    expect(mockGet).toHaveBeenCalledWith('/v1/reports/schedules');
  });

  it('falls back to mockScheduledReports on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchScheduledReports();
    expect(result).toEqual(mockScheduledReports);
  });
});

describe('createSchedule', () => {
  it('calls POST /v1/reports/schedules with payload', async () => {
    mockPost.mockResolvedValue(API_SCHEDULED_REPORT);
    const payload = {
      name: 'Daily Ops',
      type: 'operations' as const,
      frequency: 'daily' as const,
      recipients: ['admin@ordr.io'],
    };
    await createSchedule(payload);
    expect(mockPost).toHaveBeenCalledWith('/v1/reports/schedules', payload);
  });

  it('falls back to local schedule on failure', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    const result = await createSchedule({
      name: 'Offline Schedule',
      type: 'compliance-audit',
      frequency: 'monthly',
      recipients: ['audit@ordr.io'],
    });
    expect(result.name).toBe('Offline Schedule');
    expect(result.type).toBe('compliance-audit');
    expect(result.status).toBe('active');
  });
});

describe('deleteSchedule', () => {
  it('calls DELETE /v1/reports/schedules/:id', async () => {
    await deleteSchedule('sched-1');
    expect(mockDelete).toHaveBeenCalledWith('/v1/reports/schedules/sched-1');
  });

  it('returns void (resolves without a value) on success', async () => {
    await expect(deleteSchedule('sched-1')).resolves.toBeUndefined();
  });

  it('resolves without throwing on API failure (no-op fallback)', async () => {
    mockDelete.mockRejectedValue(new Error('Network error'));
    await expect(deleteSchedule('sched-1')).resolves.toBeUndefined();
  });
});
