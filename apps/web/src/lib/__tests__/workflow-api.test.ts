/**
 * workflow-api tests
 *
 * Verifies typed wrappers call the correct endpoints with correct params.
 * Mocks apiClient to avoid real HTTP requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workflowApi } from '../workflow-api';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

const MOCK_INSTANCE = {
  id: 'inst-1',
  definitionId: 'onboarding-v1',
  tenantId: 'tenant-1',
  status: 'running',
  context: {},
  createdAt: new Date().toISOString(),
};

const MOCK_DEF = {
  id: 'onboarding-v1',
  name: 'Customer Onboarding',
  version: 1,
  steps: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('workflowApi.listDefinitions', () => {
  it('GETs /v1/workflow/definitions and extracts data', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_DEF], total: 1 });

    const result = await workflowApi.listDefinitions();

    expect(mockGet).toHaveBeenCalledWith('/v1/workflow/definitions');
    expect(result).toEqual([MOCK_DEF]);
  });
});

describe('workflowApi.startInstance', () => {
  it('POSTs to /v1/workflow/instances and extracts data', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_INSTANCE });

    const result = await workflowApi.startInstance({
      definitionId: 'onboarding-v1',
      context: {
        entityType: 'contact',
        entityId: 'c-1',
        tenantId: 'tenant-1',
        correlationId: 'corr-1',
        initiatedBy: 'user-1',
      },
    });

    expect(mockPost).toHaveBeenCalledWith('/v1/workflow/instances', expect.any(Object));
    expect(result.id).toBe('inst-1');
  });
});

describe('workflowApi.listInstances', () => {
  it('GETs /v1/workflow/instances with no query when no filter', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_INSTANCE], total: 1 });

    await workflowApi.listInstances();

    expect(mockGet).toHaveBeenCalledWith('/v1/workflow/instances');
  });

  it('appends status filter to query string', async () => {
    mockGet.mockResolvedValue({ success: true, data: [], total: 0 });

    await workflowApi.listInstances({ status: 'running', limit: 10 });

    const url = mockGet.mock.calls[0]?.[0] as string;
    expect(url).toContain('status=running');
    expect(url).toContain('limit=10');
  });
});

describe('workflowApi.getInstance', () => {
  it('GETs /v1/workflow/instances/:id and extracts data', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_INSTANCE });

    const result = await workflowApi.getInstance('inst-1');

    expect(mockGet).toHaveBeenCalledWith('/v1/workflow/instances/inst-1');
    expect(result.id).toBe('inst-1');
  });
});

describe('workflowApi.pauseInstance', () => {
  it('PATCHes /v1/workflow/instances/:id/pause and extracts data', async () => {
    const paused = { ...MOCK_INSTANCE, status: 'paused' };
    mockPatch.mockResolvedValue({ success: true, data: paused });

    const result = await workflowApi.pauseInstance('inst-1');

    expect(mockPatch).toHaveBeenCalledWith('/v1/workflow/instances/inst-1/pause');
    expect(result.status).toBe('paused');
  });
});

describe('workflowApi.resumeInstance', () => {
  it('PATCHes /v1/workflow/instances/:id/resume and extracts data', async () => {
    mockPatch.mockResolvedValue({ success: true, data: MOCK_INSTANCE });

    const result = await workflowApi.resumeInstance('inst-1');

    expect(mockPatch).toHaveBeenCalledWith('/v1/workflow/instances/inst-1/resume');
    expect(result.status).toBe('running');
  });
});

describe('workflowApi.cancelInstance', () => {
  it('DELETEs /v1/workflow/instances/:id with reason header', async () => {
    const cancelled = { ...MOCK_INSTANCE, status: 'cancelled' };
    mockDelete.mockResolvedValue({ success: true, data: cancelled });

    const result = await workflowApi.cancelInstance('inst-1', 'User requested');

    expect(mockDelete).toHaveBeenCalledWith('/v1/workflow/instances/inst-1', expect.any(Object));
    const opts = mockDelete.mock.calls[0]?.[1] as { headers: Record<string, string> } | undefined;
    expect(opts?.headers['X-Cancel-Reason']).toBe('User requested');
    expect(result.status).toBe('cancelled');
  });
});
