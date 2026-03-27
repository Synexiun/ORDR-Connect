/**
 * Help Center, HelpArticle, HelpCategoryPage Component Tests
 *
 * Validates:
 * - HelpCenter renders page heading and subtitle
 * - HelpCenter shows search input with aria-label
 * - HelpCenter shows loading spinner initially
 * - HelpCenter renders category grid from mock data
 * - HelpCenter renders popular articles section
 * - HelpCenter shows "Need More Help?" section
 * - HelpCenter shows contact support info
 * - HelpArticle renders article title and content
 * - HelpArticle renders breadcrumb navigation
 * - HelpArticle shows feedback section
 * - HelpArticle shows "Article not found" for invalid slug
 * - HelpArticle shows related articles sidebar
 * - HelpArticle shows loading spinner initially
 * - HelpCategoryPage renders category name as heading
 * - HelpCategoryPage shows articles for that category
 * - HelpCategoryPage shows loading spinner initially
 * - HelpCategoryPage shows breadcrumb navigation
 * - HelpCategoryPage shows "Back to Help Center" button
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelpCenter } from '../pages/HelpCenter';
import { HelpArticlePage } from '../pages/HelpArticle';
import { HelpCategoryPage } from '../pages/HelpCategoryPage';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
  },
}));

// ─── Helpers ────────────────────────────────────────────────────

function renderHelpCenter(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(HelpCenter)));
}

function renderHelpArticle(slug: string): ReturnType<typeof render> {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [`/help/article/${slug}`] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/help/article/:slug',
          element: createElement(HelpArticlePage),
        }),
      ),
    ),
  );
}

function renderHelpCategory(categoryId: string): ReturnType<typeof render> {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [`/help/category/${categoryId}`] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/help/category/:categoryId',
          element: createElement(HelpCategoryPage),
        }),
      ),
    ),
  );
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── HelpCenter Tests ───────────────────────────────────────────

describe('HelpCenter', () => {
  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText('Help Center')).toBeDefined();
    });
  });

  it('renders subtitle text', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(
        screen.getByText('Find answers, guides, and documentation for ORDR-Connect'),
      ).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderHelpCenter();

    expect(screen.getByText('Loading help center')).toBeDefined();
  });

  it('shows search input with aria-label', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      const input = screen.getByLabelText('Search help articles');
      expect(input).toBeDefined();
    });
  });

  it('renders category grid from mock data', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText('Getting Started')).toBeDefined();
      expect(screen.getByText('Dashboard & Analytics')).toBeDefined();
      expect(screen.getByText('Agent Management')).toBeDefined();
      expect(screen.getByText('Compliance')).toBeDefined();
      expect(screen.getByText('API & Integrations')).toBeDefined();
      expect(screen.getByText('FAQ')).toBeDefined();
    });
  });

  it('shows Browse by Category heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText('Browse by Category')).toBeDefined();
    });
  });

  it('renders category article counts', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText('3 articles')).toBeDefined();
      expect(screen.getAllByText('2 articles').length).toBeGreaterThan(0);
      expect(screen.getByText('1 article')).toBeDefined();
    });
  });

  it('renders popular articles section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText('Popular Articles')).toBeDefined();
    });
  });

  it('shows popular article titles sorted by helpfulness', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      // Top articles by helpfulYes: FAQ (85), REST API (71), Compliance Overview (62), Understanding Roles (58), Deploying AI Agents (53)
      expect(screen.getByText('Frequently Asked Questions')).toBeDefined();
      expect(screen.getByText('REST API Quickstart')).toBeDefined();
      expect(screen.getByText('Compliance Overview')).toBeDefined();
    });
  });

  it('shows "Need More Help?" section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText('Need More Help?')).toBeDefined();
    });
  });

  it('shows Submit a Ticket card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText('Submit a Ticket')).toBeDefined();
      expect(screen.getByText('Go to Tickets')).toBeDefined();
    });
  });

  it('shows Contact Support card with email', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText('Contact Support')).toBeDefined();
      expect(screen.getByText('support@ordr-connect.com')).toBeDefined();
    });
  });

  it('shows category descriptions', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText(/Set up your account, configure your workspace/)).toBeDefined();
      expect(screen.getByText(/Understand your KPIs, customize dashboards/)).toBeDefined();
    });
  });

  it('shows helpful count for popular articles', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCenter();

    await waitFor(() => {
      expect(screen.getByText('85 people found this helpful')).toBeDefined();
      expect(screen.getByText('71 people found this helpful')).toBeDefined();
    });
  });
});

// ─── HelpArticlePage Tests ──────────────────────────────────────

describe('HelpArticlePage', () => {
  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderHelpArticle('creating-your-account');

    expect(screen.getByText('Loading article')).toBeDefined();
  });

  it('renders article title', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('creating-your-account');

    await waitFor(() => {
      // Title appears in both breadcrumb and h1
      expect(screen.getAllByText('Creating Your Account').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders breadcrumb navigation', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('creating-your-account');

    await waitFor(() => {
      expect(screen.getByLabelText('Breadcrumb')).toBeDefined();
      expect(screen.getByText('Help Center')).toBeDefined();
      expect(screen.getByText('Getting Started')).toBeDefined();
    });
  });

  it('renders article content paragraphs', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('creating-your-account');

    await waitFor(() => {
      expect(screen.getByText(/multi-factor authentication/)).toBeDefined();
    });
  });

  it('shows feedback section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('creating-your-account');

    await waitFor(() => {
      expect(screen.getByText('Was this article helpful?')).toBeDefined();
    });
  });

  it('shows Yes/No feedback buttons with counts', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('creating-your-account');

    await waitFor(() => {
      expect(screen.getByText('Yes (47)')).toBeDefined();
      expect(screen.getByText('No (3)')).toBeDefined();
    });
  });

  it('shows related articles sidebar', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('creating-your-account');

    await waitFor(() => {
      expect(screen.getByText('Related Articles')).toBeDefined();
      expect(screen.getByText('Configuring Your Workspace')).toBeDefined();
      expect(screen.getByText('Understanding Roles & Permissions')).toBeDefined();
    });
  });

  it('shows Back to Help Center button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('creating-your-account');

    await waitFor(() => {
      expect(screen.getByText('Back to Help Center')).toBeDefined();
    });
  });

  it('shows "Article not found" for invalid slug', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('nonexistent-article-slug');

    await waitFor(() => {
      expect(screen.getByText('Article not found.')).toBeDefined();
    });
  });

  it('shows Last updated date', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('compliance-overview');

    await waitFor(() => {
      expect(screen.getByText(/Last updated/)).toBeDefined();
    });
  });

  it('renders a different article by slug', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpArticle('rest-api-quickstart');

    await waitFor(() => {
      // Title appears in both breadcrumb and h1
      expect(screen.getAllByText('REST API Quickstart').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Bearer token/)).toBeDefined();
    });
  });
});

// ─── HelpCategoryPage Tests ────────────────────────────────────

describe('HelpCategoryPage', () => {
  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderHelpCategory('cat-getting-started');

    expect(screen.getByText('Loading articles')).toBeDefined();
  });

  it('renders category name as heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCategory('cat-getting-started');

    await waitFor(() => {
      // "Getting Started" appears in both breadcrumb and h1
      expect(screen.getAllByText('Getting Started').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders category description', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCategory('cat-getting-started');

    await waitFor(() => {
      expect(screen.getByText(/Set up your account, configure your workspace/)).toBeDefined();
    });
  });

  it('renders breadcrumb navigation', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCategory('cat-getting-started');

    await waitFor(() => {
      expect(screen.getByLabelText('Breadcrumb')).toBeDefined();
      expect(screen.getByText('Help Center')).toBeDefined();
    });
  });

  it('shows articles for the category', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCategory('cat-getting-started');

    await waitFor(() => {
      expect(screen.getByText('Creating Your Account')).toBeDefined();
      expect(screen.getByText('Configuring Your Workspace')).toBeDefined();
      expect(screen.getByText('Understanding Roles & Permissions')).toBeDefined();
    });
  });

  it('shows helpful counts for articles', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCategory('cat-getting-started');

    await waitFor(() => {
      expect(screen.getByText('47 found helpful')).toBeDefined();
      expect(screen.getByText('32 found helpful')).toBeDefined();
      expect(screen.getByText('58 found helpful')).toBeDefined();
    });
  });

  it('shows Back to Help Center button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCategory('cat-getting-started');

    await waitFor(() => {
      expect(screen.getByText('Back to Help Center')).toBeDefined();
    });
  });

  it('shows articles for a different category', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCategory('cat-compliance');

    await waitFor(() => {
      // "Compliance" appears in both breadcrumb and h1
      expect(screen.getAllByText('Compliance').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Compliance Overview')).toBeDefined();
      expect(screen.getByText('Using the Audit Log')).toBeDefined();
    });
  });

  it('shows empty state for unknown category', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCategory('cat-nonexistent');

    await waitFor(() => {
      expect(screen.getByText('No articles in this category yet.')).toBeDefined();
    });
  });

  it('shows article content previews', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderHelpCategory('cat-agents');

    await waitFor(() => {
      expect(screen.getByText('Deploying AI Agents')).toBeDefined();
      expect(screen.getByText('Monitoring Agent Performance')).toBeDefined();
    });
  });
});
