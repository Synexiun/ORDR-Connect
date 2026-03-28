/**
 * Messages API Tests
 *
 * Validates:
 * - listMessages with no params → GET /v1/messages
 * - listMessages with channel/status/direction/customerId/page/pageSize filters
 * - getMessage → GET /v1/messages/:id
 * - sendMessage → POST /v1/messages/send
 *
 * COMPLIANCE: No PHI in any test assertion. Message content is never tested.
 * HIPAA §164.312 — API returns metadata only.
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

import { listMessages, getMessage, sendMessage } from '../messages-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_MESSAGE = {
  id: 'msg-test-1',
  tenantId: 'tenant-1',
  customerId: 'cust-0001',
  channel: 'sms' as const,
  direction: 'outbound' as const,
  status: 'delivered' as const,
  sentAt: new Date('2026-03-28T10:00:00Z').toISOString(),
  deliveredAt: new Date('2026-03-28T10:00:05Z').toISOString(),
  failedAt: null,
  providerMessageId: 'twilio-abc123',
  correlationId: 'req-abc1',
  createdAt: new Date('2026-03-28T09:59:00Z').toISOString(),
};

const LIST_RESPONSE = {
  success: true as const,
  data: [MOCK_MESSAGE],
  total: 1,
  page: 1,
  pageSize: 25,
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(LIST_RESPONSE);
  mockPost.mockResolvedValue({ success: true, messageId: 'msg-new-1' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('listMessages', () => {
  it('calls GET /v1/messages with no query string when no params', async () => {
    await listMessages();
    expect(mockGet).toHaveBeenCalledWith('/v1/messages');
  });

  it('appends channel filter', async () => {
    await listMessages({ channel: 'email' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('channel=email');
  });

  it('appends status filter', async () => {
    await listMessages({ status: 'delivered' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('status=delivered');
  });

  it('appends direction filter', async () => {
    await listMessages({ direction: 'inbound' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('direction=inbound');
  });

  it('appends customerId filter', async () => {
    await listMessages({ customerId: 'cust-0001' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('customerId=cust-0001');
  });

  it('appends page and pageSize', async () => {
    await listMessages({ page: 3, pageSize: 100 });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('page=3');
    expect(url).toContain('pageSize=100');
  });

  it('returns the full MessageListResponse', async () => {
    const result = await listMessages();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('combines multiple filters in the query string', async () => {
    await listMessages({ channel: 'sms', direction: 'outbound', status: 'delivered' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('channel=sms');
    expect(url).toContain('direction=outbound');
    expect(url).toContain('status=delivered');
  });
});

describe('getMessage', () => {
  it('calls GET /v1/messages/:id', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_MESSAGE });
    await getMessage('msg-test-1');
    expect(mockGet).toHaveBeenCalledWith('/v1/messages/msg-test-1');
  });

  it('returns message metadata wrapped in success response', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_MESSAGE });
    const result = await getMessage('msg-test-1');
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('msg-test-1');
    expect(result.data.channel).toBe('sms');
  });
});

describe('sendMessage', () => {
  it('calls POST /v1/messages/send with body', async () => {
    const body = { customerId: 'cust-1', channel: 'sms' as const, contentRef: 'tpl-001' };
    await sendMessage(body);
    expect(mockPost).toHaveBeenCalledWith('/v1/messages/send', body);
  });

  it('supports email channel', async () => {
    const body = { customerId: 'cust-1', channel: 'email' as const, contentRef: 'tpl-email-001' };
    await sendMessage(body);
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/messages/send',
      expect.objectContaining({ channel: 'email' }),
    );
  });

  it('returns messageId on success', async () => {
    const result = await sendMessage({
      customerId: 'cust-1',
      channel: 'sms',
      contentRef: 'tpl-001',
    });
    expect(result.messageId).toBe('msg-new-1');
    expect(result.success).toBe(true);
  });
});
