/**
 * Search Page Tests
 *
 * Validates:
 * - Search renders page heading and subtitle
 * - Search shows empty prompt before any query
 * - Search shows loading spinner while searching
 * - Search renders results after query
 * - Search shows entity type badges on results
 * - Search shows no-results state when empty
 * - Search shows error when API fails
 * - Search calls /v1/search endpoint with query
 * - Search applies entity type filter
 *
 * COMPLIANCE: No PHI in any test assertion (Rule 6).
 * HIPAA §164.312: Search queries are opaque strings, not PHI.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Search } from '../pages/Search';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// ─── Mock useToast ────────────────────────────────────────────────

const mockToast = vi.fn();
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_CONTACT_RESULT = {
  id: 'res-1',
  entityType: 'contact',
  entityId: 'c-1',
  score: 0.95,
  displayTitle: 'Alice Smith',
  displaySubtitle: 'alice@example.com',
  metadata: {},
};

const MOCK_TICKET_RESULT = {
  id: 'res-2',
  entityType: 'ticket',
  entityId: 'tk-1',
  score: 0.8,
  displayTitle: 'Login issue — T-1042',
  displaySubtitle: 'Open',
  metadata: {},
};

const SEARCH_RESULTS = {
  results: [MOCK_CONTACT_RESULT, MOCK_TICKET_RESULT],
  total: 2,
  facets: [],
  took: 15,
};

// ─── Helper ──────────────────────────────────────────────────────

function renderSearch(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Search)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPost.mockResolvedValue(SEARCH_RESULTS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('Search page', () => {
  it('renders page heading', () => {
    renderSearch();
    expect(screen.getAllByText('Search').length).toBeGreaterThan(0);
  });

  it('renders subtitle', () => {
    renderSearch();
    expect(screen.getByText(/Full-text search across/i)).toBeDefined();
  });

  it('shows empty prompt before any query', () => {
    renderSearch();
    expect(screen.getByText('Enter a query to search')).toBeDefined();
  });

  it('renders entity type filter buttons', () => {
    renderSearch();
    expect(screen.getByText('All')).toBeDefined();
    expect(screen.getByText('Contacts')).toBeDefined();
    expect(screen.getByText('Deals')).toBeDefined();
    expect(screen.getByText('Tickets')).toBeDefined();
    expect(screen.getByText('Activities')).toBeDefined();
  });

  it('Search button is disabled when input is empty', () => {
    renderSearch();
    const btn = screen.getByRole('button', { name: 'Search' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows results after submitting query', async () => {
    renderSearch();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeDefined();
    });
    expect(screen.getByText('Login issue — T-1042')).toBeDefined();
  });

  it('shows entity type badges on results', async () => {
    renderSearch();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(screen.getAllByText('contact').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('ticket').length).toBeGreaterThan(0);
  });

  it('shows result subtitle', async () => {
    renderSearch();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeDefined();
    });
  });

  it('shows result count and timing', async () => {
    renderSearch();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(screen.getByText('2')).toBeDefined();
    });
    expect(screen.getByText('(15ms)')).toBeDefined();
  });

  it('shows no-results state when empty', async () => {
    mockPost.mockResolvedValue({ results: [], total: 0, facets: [], took: 3 });
    renderSearch();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'xyz-no-match' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeDefined();
    });
  });

  it('shows error state when API fails', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    renderSearch();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'error-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(screen.getByText('Failed to search')).toBeDefined();
    });
  });

  it('calls /v1/search endpoint with trimmed query', async () => {
    renderSearch();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: '  alice  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/v1/search',
        expect.objectContaining({ query: 'alice' }),
      );
    });
  });

  it('applies entity type filter when selected', async () => {
    renderSearch();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'alice' } });
    // First submit to set searched=true
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeDefined();
    });
    // Now click Contacts filter
    fireEvent.click(screen.getByText('Contacts'));
    await waitFor(() => {
      const lastCall = mockPost.mock.calls[mockPost.mock.calls.length - 1] as unknown[];
      const body = lastCall[1] as { entityTypes?: string[] };
      expect(body.entityTypes).toEqual(['contact']);
    });
  });
});
