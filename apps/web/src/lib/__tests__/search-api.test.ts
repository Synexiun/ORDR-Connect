/**
 * search-api tests
 *
 * Verifies typed wrappers call the correct endpoints with correct params.
 * Mocks apiClient to avoid real HTTP requests.
 *
 * HIPAA §164.312 — No PHI used in test fixtures.
 */

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

const MOCK_RESULT = {
  id: 'res-1',
  entityType: 'contact' as const,
  entityId: 'c-1',
  score: 0.95,
  displayTitle: 'Alice Smith',
  displaySubtitle: 'alice@example.com',
  metadata: {},
};

const MOCK_SEARCH_RESULTS = {
  results: [MOCK_RESULT],
  total: 1,
  facets: [],
  took: 12,
};

const MOCK_SUGGESTION = {
  id: 'sug-1',
  label: 'Alice Smith',
  entityType: 'contact' as const,
  entityId: 'c-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('searchApi.search', () => {
  it('POSTs to /v1/search with query', async () => {
    mockPost.mockResolvedValue(MOCK_SEARCH_RESULTS);

    const result = await searchApi.search('alice');

    expect(mockPost).toHaveBeenCalledWith(
      '/v1/search',
      expect.objectContaining({ query: 'alice' }),
    );
    expect(result.total).toBe(1);
    expect(result.results[0]?.displayTitle).toBe('Alice Smith');
  });

  it('includes entityTypes filter when provided', async () => {
    mockPost.mockResolvedValue({ results: [], total: 0, facets: [], took: 5 });

    await searchApi.search('test', { entityTypes: ['contact', 'deal'] });

    const body = mockPost.mock.calls[0]?.[1] as { entityTypes: string[] };
    expect(body.entityTypes).toEqual(['contact', 'deal']);
  });

  it('includes limit and offset when provided', async () => {
    mockPost.mockResolvedValue({ results: [], total: 0, facets: [], took: 5 });

    await searchApi.search('test', { limit: 10, offset: 20 });

    const body = mockPost.mock.calls[0]?.[1] as { limit: number; offset: number };
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(20);
  });
});

describe('searchApi.suggest', () => {
  it('GETs /v1/search/suggest with q param', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_SUGGESTION] });

    const result = await searchApi.suggest('ali');

    const url = mockGet.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/search/suggest');
    expect(url).toContain('q=ali');
    expect(result[0]?.label).toBe('Alice Smith');
  });

  it('includes entityType in query when provided', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });

    await searchApi.suggest('ali', 'contact');

    const url = mockGet.mock.calls[0]?.[0] as string;
    expect(url).toContain('entityType=contact');
  });
});

describe('searchApi.faceted', () => {
  it('POSTs to /v1/search/faceted with facets', async () => {
    mockPost.mockResolvedValue(MOCK_SEARCH_RESULTS);

    const result = await searchApi.faceted({
      facets: [{ type: 'entity_type', field: 'entityType', values: ['contact'] }],
      query: 'alice',
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/v1/search/faceted',
      expect.objectContaining({ query: 'alice' }),
    );
    expect(result.total).toBe(1);
  });
});

describe('searchApi.removeEntity', () => {
  it('DELETEs /v1/search/index/:entityType/:entityId', async () => {
    mockDelete.mockResolvedValue(undefined);

    await searchApi.removeEntity('contact', 'c-1');

    expect(mockDelete).toHaveBeenCalledWith('/v1/search/index/contact/c-1');
  });
});
