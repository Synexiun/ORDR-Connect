/**
 * Agents API Tests
 *
 * Validates:
 * - triggerAgent → POST /v1/agents/trigger
 * - listSessions with no params → GET /v1/agents/sessions
 * - listSessions with status/agentRole/page/pageSize filters
 * - getSession → GET /v1/agents/sessions/:id
 * - killSession → POST /v1/agents/sessions/:id/kill
 * - listHitl → GET /v1/agents/hitl
 * - approveHitl → POST /v1/agents/hitl/:id/approve
 * - approveHitl with notes
 * - rejectHitl → POST /v1/agents/hitl/:id/reject
 * - fetchRoutingDecisions → GET with customerId query string
 *
 * COMPLIANCE: No PHI in any test assertion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

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

import {
  triggerAgent,
  listSessions,
  getSession,
  killSession,
  listHitl,
  approveHitl,
  rejectHitl,
  fetchRoutingDecisions,
} from '../agents-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_SESSION = {
  id: 'sess-test-1',
  tenantId: 'tenant-1',
  customerId: 'cust-0001',
  agentRole: 'collections' as const,
  status: 'active' as const,
  autonomyLevel: 'supervised' as const,
  steps: [],
  costCents: 12,
  confidenceScore: 0.91,
  startedAt: new Date('2026-03-28T09:00:00Z').toISOString(),
  completedAt: null,
  killReason: null,
};

const MOCK_HITL_ITEM = {
  id: 'hitl-test-1',
  sessionId: 'sess-test-1',
  tenantId: 'tenant-1',
  action: 'Send payment notice',
  reason: 'Confidence below threshold',
  context: { agentRole: 'collections', confidence: 0.55 },
  createdAt: new Date('2026-03-28T09:30:00Z').toISOString(),
  expiresAt: new Date('2026-03-28T10:30:00Z').toISOString(),
};

const SESSION_LIST_RESPONSE = {
  success: true as const,
  data: [MOCK_SESSION],
  total: 1,
  page: 1,
  pageSize: 25,
};

const HITL_LIST_RESPONSE = {
  success: true as const,
  data: [MOCK_HITL_ITEM],
  total: 1,
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(SESSION_LIST_RESPONSE);
  mockPost.mockResolvedValue({ success: true, sessionId: 'sess-new' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('triggerAgent', () => {
  it('calls POST /v1/agents/trigger with body', async () => {
    await triggerAgent({ customerId: 'cust-1', agentRole: 'collections' });
    expect(mockPost).toHaveBeenCalledWith('/v1/agents/trigger', {
      customerId: 'cust-1',
      agentRole: 'collections',
    });
  });

  it('includes autonomyLevel when provided', async () => {
    await triggerAgent({
      customerId: 'cust-1',
      agentRole: 'support_triage',
      autonomyLevel: 'autonomous',
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/agents/trigger',
      expect.objectContaining({ autonomyLevel: 'autonomous' }),
    );
  });

  it('returns sessionId on success', async () => {
    const result = await triggerAgent({ customerId: 'cust-1', agentRole: 'collections' });
    expect(result.sessionId).toBe('sess-new');
  });
});

describe('listSessions', () => {
  it('calls GET /v1/agents/sessions with no query string when no params', async () => {
    await listSessions();
    expect(mockGet).toHaveBeenCalledWith('/v1/agents/sessions');
  });

  it('appends status filter', async () => {
    await listSessions({ status: 'active' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('status=active');
  });

  it('appends agentRole filter', async () => {
    await listSessions({ agentRole: 'collections' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('agentRole=collections');
  });

  it('appends page and pageSize', async () => {
    await listSessions({ page: 2, pageSize: 50 });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
  });

  it('returns SessionListResponse', async () => {
    const result = await listSessions();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe('getSession', () => {
  it('calls GET /v1/agents/sessions/:id', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_SESSION });
    await getSession('sess-test-1');
    expect(mockGet).toHaveBeenCalledWith('/v1/agents/sessions/sess-test-1');
  });

  it('returns session wrapped in success response', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_SESSION });
    const result = await getSession('sess-test-1');
    expect(result.data.id).toBe('sess-test-1');
  });
});

describe('killSession', () => {
  it('calls POST /v1/agents/sessions/:id/kill with reason', async () => {
    mockPost.mockResolvedValue(undefined);
    await killSession('sess-test-1', 'Operator terminated');
    expect(mockPost).toHaveBeenCalledWith('/v1/agents/sessions/sess-test-1/kill', {
      reason: 'Operator terminated',
    });
  });

  it('returns void (resolves without a value)', async () => {
    mockPost.mockResolvedValue(undefined);
    await expect(killSession('sess-test-1', 'reason')).resolves.toBeUndefined();
  });
});

describe('listHitl', () => {
  it('calls GET /v1/agents/hitl', async () => {
    mockGet.mockResolvedValue(HITL_LIST_RESPONSE);
    await listHitl();
    expect(mockGet).toHaveBeenCalledWith('/v1/agents/hitl');
  });

  it('returns HitlListResponse with items', async () => {
    mockGet.mockResolvedValue(HITL_LIST_RESPONSE);
    const result = await listHitl();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.id).toBe('hitl-test-1');
  });
});

describe('approveHitl', () => {
  it('calls POST /v1/agents/hitl/:id/approve', async () => {
    mockPost.mockResolvedValue(undefined);
    await approveHitl('hitl-test-1');
    expect(mockPost).toHaveBeenCalledWith('/v1/agents/hitl/hitl-test-1/approve', {
      notes: undefined,
    });
  });

  it('includes notes when provided', async () => {
    mockPost.mockResolvedValue(undefined);
    await approveHitl('hitl-test-1', 'Reviewed and approved');
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/agents/hitl/hitl-test-1/approve',
      expect.objectContaining({ notes: 'Reviewed and approved' }),
    );
  });

  it('returns void (resolves without a value)', async () => {
    mockPost.mockResolvedValue(undefined);
    await expect(approveHitl('hitl-test-1')).resolves.toBeUndefined();
  });
});

describe('rejectHitl', () => {
  it('calls POST /v1/agents/hitl/:id/reject with reason', async () => {
    mockPost.mockResolvedValue(undefined);
    await rejectHitl('hitl-test-1', 'Action not appropriate');
    expect(mockPost).toHaveBeenCalledWith('/v1/agents/hitl/hitl-test-1/reject', {
      reason: 'Action not appropriate',
    });
  });

  it('returns void (resolves without a value)', async () => {
    mockPost.mockResolvedValue(undefined);
    await expect(rejectHitl('hitl-test-1', 'reason')).resolves.toBeUndefined();
  });
});

describe('fetchRoutingDecisions', () => {
  it('calls GET with encoded customerId query param', async () => {
    mockGet.mockResolvedValue({ success: true, data: [], total: 0 });
    await fetchRoutingDecisions('cust-0001');
    expect(mockGet).toHaveBeenCalledWith('/v1/agents/routing-decisions?customerId=cust-0001');
  });

  it('encodes special characters in customerId', async () => {
    mockGet.mockResolvedValue({ success: true, data: [], total: 0 });
    await fetchRoutingDecisions('cust 001');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('customerId=cust%20001');
  });

  it('returns RoutingDecisionsResponse', async () => {
    const ROUTING_RESPONSE = { success: true as const, data: [], total: 0 };
    mockGet.mockResolvedValue(ROUTING_RESPONSE);
    const result = await fetchRoutingDecisions('cust-1');
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });
});
