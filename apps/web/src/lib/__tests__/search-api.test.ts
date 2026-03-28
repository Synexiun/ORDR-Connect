/**
 * search-api tests
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchApi } from '../search-api';

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

const SEARCH_RESULTS = {
  results: [
    { id: 'c-1', entityType: 'contact', entityId: 'c-1', score: 0.9, displayTitle: 'John' },
  ],
  total: 1,
  facets: [],
  took: 5,
};

const SUGGESTIONS = [{ id: 'c-1', label: 'John Doe', entityType: 'contact' }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('searchApi.search', () => {
  it('POSTs to /v1/search with query and options', async () => {
    mockPost.mockResolvedValue(SEARCH_RESULTS);

    const result = await searchApi.search('john', { limit: 10 });

    expect(mockPost).toHaveBeenCalledWith('/v1/search', { query: 'john', limit: 10 });
    expect(result.total).toBe(1);
  });

  it('uses empty options by default', async () => {
    mockPost.mockResolvedValue(SEARCH_RESULTS);

    await searchApi.search('test');

    expect(mockPost).toHaveBeenCalledWith('/v1/search', { query: 'test' });
  });
});

describe('searchApi.suggest', () => {
  it('GETs /v1/search/suggest and extracts data', async () => {
    mockGet.mockResolvedValue({ success: true, data: SUGGESTIONS });

    const result = await searchApi.suggest('jo');

    const calledUrl = mockGet.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/search/suggest');
    expect(calledUrl).toContain('q=jo');
    expect(result).toEqual(SUGGESTIONS);
  });

  it('appends entityType when provided', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });

    await searchApi.suggest('jo', 'contact');

    const calledUrl = mockGet.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('entityType=contact');
  });

  it('omits entityType when not provided', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });

    await searchApi.suggest('jo');

    const calledUrl = mockGet.mock.calls[0]?.[0] as string;
    expect(calledUrl).not.toContain('entityType');
  });
});

describe('searchApi.faceted', () => {
  it('POSTs to /v1/search/faceted', async () => {
    mockPost.mockResolvedValue(SEARCH_RESULTS);

    await searchApi.faceted({
      facets: [{ type: 'entity_type', field: 'status' }],
      query: 'active',
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/v1/search/faceted',
      expect.objectContaining({ facets: expect.any(Array) }),
    );
  });
});

describe('searchApi.indexEntity', () => {
  it('POSTs to /v1/search/index and extracts data', async () => {
    const payload = { id: 'idx-1', indexedAt: '2026-01-01T00:00:00Z' };
    mockPost.mockResolvedValue({ success: true, data: payload });

    const result = await searchApi.indexEntity({
      entityType: 'contact',
      entityId: 'c-1',
      fields: { email: { value: 'john@example.com', weight: 'A', isPhi: false } },
    });

    expect(mockPost).toHaveBeenCalledWith('/v1/search/index', expect.any(Object));
    expect(result).toEqual(payload);
  });
});

describe('searchApi.removeEntity', () => {
  it('DELETEs /v1/search/index/:entityType/:entityId', async () => {
    mockDelete.mockResolvedValue(undefined);

    await searchApi.removeEntity('contact', 'c-1');

    expect(mockDelete).toHaveBeenCalledWith('/v1/search/index/contact/c-1');
  });
});

describe('searchApi.reindex', () => {
  it('POSTs to /v1/search/reindex/:entityType and returns count', async () => {
    mockPost.mockResolvedValue({ success: true, data: { reindexed: 42 } });

    const result = await searchApi.reindex('contact');

    expect(mockPost).toHaveBeenCalledWith('/v1/search/reindex/contact');
    expect(result.reindexed).toBe(42);
  });
});
