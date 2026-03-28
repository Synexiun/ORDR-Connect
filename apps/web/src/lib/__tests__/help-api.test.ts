/**
 * Help Center API Tests
 *
 * Validates:
 * - fetchCategories → GET /v1/help/categories (success + fallback to mockCategories)
 * - fetchArticles → GET /v1/help/categories/:id/articles (success + filtered fallback)
 * - fetchArticle → GET /v1/help/articles/:slug (success + fallback by slug, null if not found)
 * - searchHelp → GET /v1/help/search?q=:query (success + local search fallback)
 * - submitFeedback → POST /v1/help/feedback (success + no-op void fallback)
 *
 * COMPLIANCE: No PHI in help content. SOC2 CC6.1.
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
  fetchCategories,
  fetchArticles,
  fetchArticle,
  searchHelp,
  submitFeedback,
  mockCategories,
  mockArticles,
} from '../help-api';

// ─── Fixtures ────────────────────────────────────────────────────

const API_CATEGORY = {
  id: 'cat-api-1',
  name: 'Test Category',
  icon: 'BookOpen',
  articleCount: 1,
  description: 'Test category description',
};

const API_ARTICLE = {
  id: 'art-api-1',
  slug: 'test-article',
  title: 'Test Article',
  category: 'cat-api-1',
  content: 'Test content',
  lastUpdated: new Date('2026-03-28T00:00:00Z').toISOString(),
  helpfulYes: 10,
  helpfulNo: 1,
  relatedArticles: [],
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue([API_CATEGORY]);
  mockPost.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('fetchCategories', () => {
  it('calls GET /v1/help/categories', async () => {
    await fetchCategories();
    expect(mockGet).toHaveBeenCalledWith('/v1/help/categories');
  });

  it('returns API categories on success', async () => {
    const result = await fetchCategories();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cat-api-1');
  });

  it('falls back to mockCategories on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchCategories();
    expect(result).toEqual(mockCategories);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('fetchArticles', () => {
  it('calls GET /v1/help/categories/:id/articles', async () => {
    mockGet.mockResolvedValue([API_ARTICLE]);
    await fetchArticles('cat-getting-started');
    expect(mockGet).toHaveBeenCalledWith('/v1/help/categories/cat-getting-started/articles');
  });

  it('returns articles on success', async () => {
    mockGet.mockResolvedValue([API_ARTICLE]);
    const result = await fetchArticles('cat-api-1');
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('test-article');
  });

  it('falls back to filtered mock articles for the category on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchArticles('cat-getting-started');
    result.forEach((a) => {
      expect(a.category).toBe('cat-getting-started');
    });
  });

  it('returns empty array when no mock articles match category on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchArticles('cat-nonexistent');
    expect(result).toHaveLength(0);
  });
});

describe('fetchArticle', () => {
  it('calls GET /v1/help/articles/:slug', async () => {
    mockGet.mockResolvedValue(API_ARTICLE);
    await fetchArticle('test-article');
    expect(mockGet).toHaveBeenCalledWith('/v1/help/articles/test-article');
  });

  it('returns article on success', async () => {
    mockGet.mockResolvedValue(API_ARTICLE);
    const result = await fetchArticle('test-article');
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Test Article');
  });

  it('falls back to mock article by slug on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    // Use a slug that exists in mockArticles
    const firstSlug = mockArticles[0].slug;
    const result = await fetchArticle(firstSlug);
    expect(result).not.toBeNull();
    expect(result?.slug).toBe(firstSlug);
  });

  it('returns null when slug not found in mock on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchArticle('slug-does-not-exist');
    expect(result).toBeNull();
  });
});

describe('searchHelp', () => {
  it('calls GET /v1/help/search?q=:query with encoded query', async () => {
    const SEARCH_RESULT = { articles: [API_ARTICLE], total: 1 };
    mockGet.mockResolvedValue(SEARCH_RESULT);
    await searchHelp('getting started');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('/v1/help/search');
    expect(url).toContain('q=');
  });

  it('returns search results on success', async () => {
    mockGet.mockResolvedValue({ articles: [API_ARTICLE], total: 1 });
    const result = await searchHelp('test');
    expect(result.articles).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('falls back to local mock search on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    // Search for text present in mockArticles titles
    const result = await searchHelp('compliance');
    expect(result.articles.length).toBeGreaterThan(0);
    expect(result.total).toBe(result.articles.length);
  });

  it('returns empty result when no mock articles match on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await searchHelp('xyzzy-nonexistent-query-42');
    expect(result.articles).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe('submitFeedback', () => {
  it('calls POST /v1/help/feedback with articleId and helpful flag', async () => {
    await submitFeedback('art-api-1', true);
    expect(mockPost).toHaveBeenCalledWith('/v1/help/feedback', {
      articleId: 'art-api-1',
      helpful: true,
    });
  });

  it('returns void on success', async () => {
    await expect(submitFeedback('art-1', true)).resolves.toBeUndefined();
  });

  it('resolves without throwing on failure (graceful degradation)', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    await expect(submitFeedback('art-1', false)).resolves.toBeUndefined();
  });
});
