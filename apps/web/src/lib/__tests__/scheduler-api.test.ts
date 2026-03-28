/**
 * scheduler-api tests
 *
 * Verifies typed wrappers call the correct endpoints with correct params.
 */

/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { schedulerApi } from '../scheduler-api';
import * as apiModule from '../api';

vi.mock('../api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockClient = vi.mocked(apiModule.apiClient);

const MOCK_INSTANCE = {
  id: 'job-1',
  jobType: 'send-email',
  tenantId: 'tenant-1',
  status: 'completed',
  scheduledAt: new Date().toISOString(),
  attempts: 1,
  maxAttempts: 3,
  payload: {},
  createdAt: new Date().toISOString(),
};

const MOCK_DL = {
  id: 'dl-1',
  originalInstanceId: 'job-1',
  jobType: 'send-email',
  tenantId: 'tenant-1',
  payload: {},
  error: 'max retries exceeded',
  attempts: 3,
  deadLetteredAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('schedulerApi.listInstances', () => {
  it('GETs /v1/scheduler/instances with no query when no filter', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: [MOCK_INSTANCE], total: 1 });

    const result = await schedulerApi.listInstances();

    expect(mockClient.get).toHaveBeenCalledWith('/v1/scheduler/instances');
    expect(result).toEqual([MOCK_INSTANCE]);
  });

  it('appends status and limit to query string', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: [], total: 0 });

    await schedulerApi.listInstances({ status: 'failed', limit: 25 });

    const url = mockClient.get.mock.calls[0]?.[0] as string;
    expect(url).toContain('status=failed');
    expect(url).toContain('limit=25');
  });

  it('appends jobType filter when provided', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: [], total: 0 });

    await schedulerApi.listInstances({ jobType: 'send-email' });

    const url = mockClient.get.mock.calls[0]?.[0] as string;
    expect(url).toContain('jobType=send-email');
  });
});

describe('schedulerApi.getInstance', () => {
  it('GETs /v1/scheduler/instances/:id and extracts data', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: MOCK_INSTANCE });

    const result = await schedulerApi.getInstance('job-1');

    expect(mockClient.get).toHaveBeenCalledWith('/v1/scheduler/instances/job-1');
    expect(result.id).toBe('job-1');
  });
});

describe('schedulerApi.listDeadLetter', () => {
  it('GETs /v1/scheduler/dead-letter and extracts data', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: [MOCK_DL], total: 1 });

    const result = await schedulerApi.listDeadLetter();

    expect(mockClient.get).toHaveBeenCalledWith('/v1/scheduler/dead-letter');
    expect(result).toEqual([MOCK_DL]);
  });

  it('returns empty array when queue is empty', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: [], total: 0 });

    const result = await schedulerApi.listDeadLetter();

    expect(result).toEqual([]);
  });
});
