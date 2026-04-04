/**
 * Tickets API Tests
 *
 * Validates:
 * - fetchTickets → GET /v1/tickets, returns res.tickets
 * - fetchTickets fallback to mockTickets on API failure
 * - fetchTicket → GET /v1/tickets/:id
 * - fetchTicket fallback to mock data on failure
 * - fetchTicket returns null when ticket not found in mock
 * - createTicket → POST /v1/tickets
 * - createTicket fallback creates local ticket on failure
 * - addMessage → POST /v1/tickets/:id/messages
 * - assignTicket → PATCH /v1/tickets/:id
 * - updateStatus → PATCH /v1/tickets/:id
 * - fetchStats → GET /v1/tickets/stats
 * - fetchStats fallback to mockStats on failure
 *
 * COMPLIANCE: No PHI in any test assertion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: vi.fn(),
  },
}));

import {
  fetchTickets,
  fetchTicket,
  createTicket,
  addMessage,
  assignTicket,
  updateStatus,
  fetchStats,
  mockStats,
} from '../tickets-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_TICKET = {
  id: 'TKT-test-1',
  title: 'Test ticket',
  status: 'open' as const,
  priority: 'medium' as const,
  category: 'question' as const,
  assignee: null,
  reporter: 'Test User',
  createdAt: new Date('2026-03-28').toISOString(),
  updatedAt: new Date('2026-03-28').toISOString(),
  description: 'Test description',
  messageCount: 1,
};

const MOCK_MESSAGE = {
  id: 'msg-test-1',
  ticketId: 'TKT-test-1',
  author: 'Test User',
  authorRole: 'user' as const,
  content: 'Test message',
  createdAt: new Date('2026-03-28').toISOString(),
  attachments: [],
};

const API_STATS = {
  open: 5,
  inProgress: 3,
  avgResponseTime: '2.1h',
  avgResolutionTime: '20h',
  slaCompliance: 92,
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ tickets: [MOCK_TICKET] });
  mockPost.mockResolvedValue(MOCK_TICKET);
  mockPatch.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('fetchTickets', () => {
  it('calls GET /v1/tickets', async () => {
    await fetchTickets();
    expect(mockGet).toHaveBeenCalledWith('/v1/tickets');
  });

  it('returns res.tickets from successful response', async () => {
    const result = await fetchTickets();
    expect(result).toEqual([MOCK_TICKET]);
  });

  it('falls back to mockTickets when API throws', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchTickets();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // mockTickets has 8 entries
    expect(result[0]!.id).toBe('TKT-001');
  });
});

describe('fetchTicket', () => {
  it('calls GET /v1/tickets/:id', async () => {
    mockGet.mockResolvedValue({ ticket: MOCK_TICKET, messages: [MOCK_MESSAGE] });
    await fetchTicket('TKT-test-1');
    expect(mockGet).toHaveBeenCalledWith('/v1/tickets/TKT-test-1');
  });

  it('returns ticket and messages on success', async () => {
    mockGet.mockResolvedValue({ ticket: MOCK_TICKET, messages: [MOCK_MESSAGE] });
    const result = await fetchTicket('TKT-test-1');
    expect(result).not.toBeNull();
    expect(result?.ticket.id).toBe('TKT-test-1');
    expect(result?.messages).toHaveLength(1);
  });

  it('falls back to mock data on API failure for known ticket id', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchTicket('TKT-001');
    expect(result).not.toBeNull();
    expect(result?.ticket.id).toBe('TKT-001');
  });

  it('returns null on failure when ticket id not in mock data', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchTicket('TKT-UNKNOWN');
    expect(result).toBeNull();
  });
});

describe('createTicket', () => {
  it('calls POST /v1/tickets with payload', async () => {
    const payload = {
      title: 'New bug',
      category: 'bug' as const,
      priority: 'high' as const,
      description: 'Bug description',
    };
    await createTicket(payload);
    expect(mockPost).toHaveBeenCalledWith('/v1/tickets', payload);
  });

  it('returns the created ticket on success', async () => {
    mockPost.mockResolvedValue(MOCK_TICKET);
    const result = await createTicket({
      title: 'Test',
      category: 'question',
      priority: 'low',
      description: 'test',
    });
    expect(result.id).toBe('TKT-test-1');
  });

  it('creates a local fallback ticket when API throws', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    const result = await createTicket({
      title: 'Offline ticket',
      category: 'feature',
      priority: 'medium',
      description: 'Created offline',
    });
    expect(result.title).toBe('Offline ticket');
    expect(result.status).toBe('open');
    expect(result.reporter).toBe('Current User');
  });
});

describe('addMessage', () => {
  it('calls POST /v1/tickets/:id/messages with content', async () => {
    mockPost.mockResolvedValue(MOCK_MESSAGE);
    await addMessage('TKT-001', 'Hello');
    expect(mockPost).toHaveBeenCalledWith('/v1/tickets/TKT-001/messages', { content: 'Hello' });
  });

  it('returns the message on success', async () => {
    mockPost.mockResolvedValue(MOCK_MESSAGE);
    const result = await addMessage('TKT-test-1', 'Test message');
    expect(result.content).toBe('Test message');
  });

  it('creates a local fallback message when API throws', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    const result = await addMessage('TKT-001', 'Offline reply');
    expect(result.content).toBe('Offline reply');
    expect(result.ticketId).toBe('TKT-001');
    expect(result.author).toBe('Current User');
    expect(result.authorRole).toBe('user');
  });
});

describe('assignTicket', () => {
  it('calls PATCH /v1/tickets/:id with assignee', async () => {
    await assignTicket('TKT-001', 'Jane Doe');
    expect(mockPatch).toHaveBeenCalledWith('/v1/tickets/TKT-001', { assignee: 'Jane Doe' });
  });

  it('returns void (resolves without a value)', async () => {
    await expect(assignTicket('TKT-001', 'Jane Doe')).resolves.toBeUndefined();
  });
});

describe('updateStatus', () => {
  it('calls PATCH /v1/tickets/:id with status', async () => {
    await updateStatus('TKT-001', 'resolved');
    expect(mockPatch).toHaveBeenCalledWith('/v1/tickets/TKT-001', { status: 'resolved' });
  });

  it('returns void (resolves without a value)', async () => {
    await expect(updateStatus('TKT-001', 'closed')).resolves.toBeUndefined();
  });
});

describe('fetchStats', () => {
  it('calls GET /v1/tickets/stats', async () => {
    mockGet.mockResolvedValue(API_STATS);
    await fetchStats();
    expect(mockGet).toHaveBeenCalledWith('/v1/tickets/stats');
  });

  it('returns stats from API on success', async () => {
    mockGet.mockResolvedValue(API_STATS);
    const result = await fetchStats();
    expect(result.open).toBe(5);
    expect(result.slaCompliance).toBe(92);
  });

  it('falls back to mockStats when API throws', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchStats();
    expect(result).toEqual(mockStats);
    expect(result.slaCompliance).toBe(94.5);
  });
});
