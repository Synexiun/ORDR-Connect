/**
 * realtime-api tests
 *
 * Verifies typed wrappers call the correct endpoints with correct params.
 * Mocks apiClient to avoid real HTTP requests.
 *
 * SOC2 CC7.2 — Admin-only; tenant-scoped.
 * HIPAA §164.312 — No PHI in event payloads; IDs and metadata only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { realtimeApi } from '../realtime-api';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const MOCK_STATS = {
  totalChannels: 4,
  activeConnections: 12,
  tenants: {
    'tenant-1': { connections: 8, channels: 2 },
    'tenant-2': { connections: 4, channels: 2 },
  },
};

const MOCK_PUBLISH_RESULT = {
  delivered: 8,
  category: 'workflow' as const,
  type: 'instance.completed',
  tenantId: 'tenant-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('realtimeApi.getStats', () => {
  it('GETs /v1/realtime/stats and extracts data', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_STATS });

    const result = await realtimeApi.getStats();

    expect(mockGet).toHaveBeenCalledWith('/v1/realtime/stats');
    expect(result.totalChannels).toBe(4);
    expect(result.activeConnections).toBe(12);
  });

  it('exposes tenant connection map', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_STATS });

    const result = await realtimeApi.getStats();

    expect(result.tenants['tenant-1']?.connections).toBe(8);
  });
});

describe('realtimeApi.publish', () => {
  it('POSTs to /v1/realtime/publish with event params', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_PUBLISH_RESULT });

    const result = await realtimeApi.publish({
      category: 'workflow',
      type: 'instance.completed',
      data: { instanceId: 'inst-1' },
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/v1/realtime/publish',
      expect.objectContaining({ category: 'workflow', type: 'instance.completed' }),
    );
    expect(result.delivered).toBe(8);
  });

  it('includes userIds for targeted publish', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_PUBLISH_RESULT });

    await realtimeApi.publish({
      category: 'billing',
      type: 'subscription.upgraded',
      data: {},
      userIds: ['user-1', 'user-2'],
    });

    const body = mockPost.mock.calls[0]?.[1] as { userIds?: string[] };
    expect(body.userIds).toEqual(['user-1', 'user-2']);
  });

  it('omits userIds for broadcast publish', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_PUBLISH_RESULT });

    await realtimeApi.publish({
      category: 'system',
      type: 'maintenance.scheduled',
      data: {},
    });

    const body = mockPost.mock.calls[0]?.[1] as { userIds?: string[] };
    expect(body.userIds).toBeUndefined();
  });
});
