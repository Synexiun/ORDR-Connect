/**
 * workflow-api tests
 *
 * Verifies typed wrappers call the correct endpoints with correct params.
 */

/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workflowApi } from '../workflow-api';
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
    mockClient.get.mockResolvedValue({ success: true, data: [MOCK_DEF], total: 1 });

    const result = await workflowApi.listDefinitions();

    expect(mockClient.get).toHaveBeenCalledWith('/v1/workflow/definitions');
    expect(result).toEqual([MOCK_DEF]);
  });
});

describe('workflowApi.startInstance', () => {
  it('POSTs to /v1/workflow/instances and extracts data', async () => {
    mockClient.post.mockResolvedValue({ success: true, data: MOCK_INSTANCE });

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

    expect(mockClient.post).toHaveBeenCalledWith('/v1/workflow/instances', expect.any(Object));
    expect(result.id).toBe('inst-1');
  });
});

describe('workflowApi.listInstances', () => {
  it('GETs /v1/workflow/instances with no query when no filter', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: [MOCK_INSTANCE], total: 1 });

    await workflowApi.listInstances();

    expect(mockClient.get).toHaveBeenCalledWith('/v1/workflow/instances');
  });

  it('appends status filter to query string', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: [], total: 0 });

    await workflowApi.listInstances({ status: 'running', limit: 10 });

    const url = mockClient.get.mock.calls[0]?.[0] as string;
    expect(url).toContain('status=running');
    expect(url).toContain('limit=10');
  });
});

describe('workflowApi.getInstance', () => {
  it('GETs /v1/workflow/instances/:id and extracts data', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: MOCK_INSTANCE });

    const result = await workflowApi.getInstance('inst-1');

    expect(mockClient.get).toHaveBeenCalledWith('/v1/workflow/instances/inst-1');
    expect(result.id).toBe('inst-1');
  });
});

describe('workflowApi.pauseInstance', () => {
  it('PATCHes /v1/workflow/instances/:id/pause and extracts data', async () => {
    const paused = { ...MOCK_INSTANCE, status: 'paused' };
    mockClient.patch.mockResolvedValue({ success: true, data: paused });

    const result = await workflowApi.pauseInstance('inst-1');

    expect(mockClient.patch).toHaveBeenCalledWith('/v1/workflow/instances/inst-1/pause');
    expect(result.status).toBe('paused');
  });
});

describe('workflowApi.resumeInstance', () => {
  it('PATCHes /v1/workflow/instances/:id/resume and extracts data', async () => {
    mockClient.patch.mockResolvedValue({ success: true, data: MOCK_INSTANCE });

    const result = await workflowApi.resumeInstance('inst-1');

    expect(mockClient.patch).toHaveBeenCalledWith('/v1/workflow/instances/inst-1/resume');
    expect(result.status).toBe('running');
  });
});

describe('workflowApi.cancelInstance', () => {
  it('DELETEs /v1/workflow/instances/:id with reason header', async () => {
    const cancelled = { ...MOCK_INSTANCE, status: 'cancelled' };
    mockClient.delete.mockResolvedValue({ success: true, data: cancelled });

    const result = await workflowApi.cancelInstance('inst-1', 'User requested');

    expect(mockClient.delete).toHaveBeenCalledWith(
      '/v1/workflow/instances/inst-1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Cancel-Reason': 'User requested' }),
      }),
    );
    expect(result.status).toBe('cancelled');
  });
});
