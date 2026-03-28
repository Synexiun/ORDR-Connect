/**
 * Marketplace API Tests
 *
 * Validates:
 * - listMarketplaceAgents with no params → GET /v1/marketplace
 * - listMarketplaceAgents with page/pageSize/category/status/search/installed filters
 * - getMarketplaceAgent → GET /v1/marketplace/:agentId
 * - installAgent → POST /v1/marketplace/:agentId/install
 * - uninstallAgent → DELETE /v1/marketplace/:agentId/install (void)
 * - listReviews → GET /v1/marketplace/:agentId/reviews
 * - submitReview → POST /v1/marketplace/:agentId/review (with/without comment)
 *
 * COMPLIANCE: No PHI. SOC2 CC6.1.
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
  listMarketplaceAgents,
  getMarketplaceAgent,
  installAgent,
  uninstallAgent,
  listReviews,
  submitReview,
} from '../marketplace-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_AGENT = {
  id: 'agent-mkt-1',
  name: 'Collections Pro',
  version: '2.1.0',
  description: 'AI-powered collections agent',
  author: 'ORDR',
  category: 'collections' as const,
  status: 'published' as const,
  installStatus: 'not_installed' as const,
  rating: 4.5,
  reviewCount: 42,
  installCount: 1200,
  priceMonthly: 99,
  license: 'Commercial',
  publishedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  updatedAt: new Date('2026-03-01T00:00:00Z').toISOString(),
};

const MOCK_LIST_RESPONSE = {
  success: true as const,
  data: [MOCK_AGENT],
  total: 1,
  page: 1,
  pageSize: 25,
};

const MOCK_REVIEW = {
  id: 'rev-test-1',
  agentId: 'agent-mkt-1',
  userId: 'usr-1',
  rating: 5,
  comment: 'Excellent agent',
  createdAt: new Date('2026-03-28T10:00:00Z').toISOString(),
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(MOCK_LIST_RESPONSE);
  mockPost.mockResolvedValue({ success: true });
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('listMarketplaceAgents', () => {
  it('calls GET /v1/marketplace with no query string when no params', async () => {
    await listMarketplaceAgents();
    expect(mockGet).toHaveBeenCalledWith('/v1/marketplace');
  });

  it('appends page and pageSize', async () => {
    await listMarketplaceAgents({ page: 2, pageSize: 10 });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=10');
  });

  it('appends category filter', async () => {
    await listMarketplaceAgents({ category: 'collections' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('category=collections');
  });

  it('appends status filter', async () => {
    await listMarketplaceAgents({ status: 'published' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('status=published');
  });

  it('appends search filter when non-empty', async () => {
    await listMarketplaceAgents({ search: 'collections' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('search=collections');
  });

  it('omits search param when empty string', async () => {
    await listMarketplaceAgents({ search: '' });
    expect(mockGet).toHaveBeenCalledWith('/v1/marketplace');
  });

  it('appends installed filter', async () => {
    await listMarketplaceAgents({ installed: true });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('installed=true');
  });

  it('returns MarketplaceListResponse with data array', async () => {
    const result = await listMarketplaceAgents();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('agent-mkt-1');
  });
});

describe('getMarketplaceAgent', () => {
  it('calls GET /v1/marketplace/:agentId', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_AGENT });
    await getMarketplaceAgent('agent-mkt-1');
    expect(mockGet).toHaveBeenCalledWith('/v1/marketplace/agent-mkt-1');
  });

  it('returns wrapped agent on success', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_AGENT });
    const result = await getMarketplaceAgent('agent-mkt-1');
    expect(result.data.name).toBe('Collections Pro');
    expect(result.data.category).toBe('collections');
  });
});

describe('installAgent', () => {
  it('calls POST /v1/marketplace/:agentId/install', async () => {
    await installAgent('agent-mkt-1');
    expect(mockPost).toHaveBeenCalledWith('/v1/marketplace/agent-mkt-1/install', {});
  });

  it('returns success:true on installation', async () => {
    const result = await installAgent('agent-mkt-1');
    expect(result.success).toBe(true);
  });
});

describe('uninstallAgent', () => {
  it('calls DELETE /v1/marketplace/:agentId/install', async () => {
    await uninstallAgent('agent-mkt-1');
    expect(mockDelete).toHaveBeenCalledWith('/v1/marketplace/agent-mkt-1/install');
  });

  it('returns void on success', async () => {
    await expect(uninstallAgent('agent-mkt-1')).resolves.toBeUndefined();
  });
});

describe('listReviews', () => {
  it('calls GET /v1/marketplace/:agentId/reviews', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_REVIEW], total: 1 });
    await listReviews('agent-mkt-1');
    expect(mockGet).toHaveBeenCalledWith('/v1/marketplace/agent-mkt-1/reviews');
  });

  it('returns ReviewListResponse with data array', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_REVIEW], total: 1 });
    const result = await listReviews('agent-mkt-1');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].rating).toBe(5);
    expect(result.total).toBe(1);
  });
});

describe('submitReview', () => {
  it('calls POST /v1/marketplace/:agentId/review with rating', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_REVIEW });
    await submitReview('agent-mkt-1', { rating: 5 });
    expect(mockPost).toHaveBeenCalledWith('/v1/marketplace/agent-mkt-1/review', { rating: 5 });
  });

  it('includes comment when provided', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_REVIEW });
    await submitReview('agent-mkt-1', { rating: 4, comment: 'Great agent' });
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/marketplace/agent-mkt-1/review',
      expect.objectContaining({ comment: 'Great agent' }),
    );
  });

  it('returns created review on success', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_REVIEW });
    const result = await submitReview('agent-mkt-1', { rating: 5 });
    expect(result.data.id).toBe('rev-test-1');
    expect(result.data.rating).toBe(5);
  });
});
