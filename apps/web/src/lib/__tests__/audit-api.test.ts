/**
 * Audit Log API Tests
 *
 * Validates:
 * - fetchAuditLogs with no params → GET /v1/audit-logs
 * - fetchAuditLogs with all filter params
 * - fetchAuditChainStatus → GET /v1/audit-logs/chain-status
 *
 * COMPLIANCE: SOC2 CC7.2 / HIPAA §164.312(b) — no PHI in test data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { fetchAuditLogs, fetchAuditChainStatus } from '../audit-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_LOG_EVENT = {
  id: 'evt-test-1',
  sequenceNumber: 42,
  eventType: 'agent.session_started',
  actorType: 'agent' as const,
  actorId: 'agent-1',
  resource: 'session',
  resourceId: 'sess-1',
  action: 'started',
  details: {},
  hash: 'abc123',
  previousHash: 'def456',
  timestamp: new Date('2026-03-28T09:00:00Z').toISOString(),
};

const LOGS_RESPONSE = {
  events: [MOCK_LOG_EVENT],
  total: 1,
  page: 1,
  limit: 25,
  pages: 1,
};

const CHAIN_STATUS = {
  totalEvents: 5280,
  lastSequence: 5280,
  lastHash: 'sha256:abc123def456',
  lastTimestamp: new Date('2026-03-28T10:00:00Z').toISOString(),
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(LOGS_RESPONSE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('fetchAuditLogs', () => {
  it('calls GET /v1/audit-logs with no query string when no params', async () => {
    await fetchAuditLogs();
    expect(mockGet).toHaveBeenCalledWith('/v1/audit-logs');
  });

  it('appends page and limit filters', async () => {
    await fetchAuditLogs({ page: 2, limit: 50 });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('page=2');
    expect(url).toContain('limit=50');
  });

  it('appends eventType filter', async () => {
    await fetchAuditLogs({ eventType: 'agent.session_started' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('eventType=agent.session_started');
  });

  it('appends actorType filter', async () => {
    await fetchAuditLogs({ actorType: 'system' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('actorType=system');
  });

  it('appends resource filter', async () => {
    await fetchAuditLogs({ resource: 'session' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('resource=session');
  });

  it('appends from/to date range filters', async () => {
    const from = '2026-03-01T00:00:00Z';
    const to = '2026-03-28T23:59:59Z';
    await fetchAuditLogs({ from, to });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('from=');
    expect(url).toContain('to=');
  });

  it('returns AuditLogsResponse with events array', async () => {
    const result = await fetchAuditLogs();
    expect(result.events).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.events[0].id).toBe('evt-test-1');
  });
});

describe('fetchAuditChainStatus', () => {
  it('calls GET /v1/audit-logs/chain-status', async () => {
    mockGet.mockResolvedValue(CHAIN_STATUS);
    await fetchAuditChainStatus();
    expect(mockGet).toHaveBeenCalledWith('/v1/audit-logs/chain-status');
  });

  it('returns chain status with totalEvents and lastHash', async () => {
    mockGet.mockResolvedValue(CHAIN_STATUS);
    const result = await fetchAuditChainStatus();
    expect(result.totalEvents).toBe(5280);
    expect(result.lastSequence).toBe(5280);
    expect(result.lastHash).toBe('sha256:abc123def456');
  });
});
