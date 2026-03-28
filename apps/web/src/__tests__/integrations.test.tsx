/**
 * Integrations Page Tests
 *
 * Validates:
 * - Integrations renders page heading and subtitle
 * - Integrations shows loading spinner while fetching providers
 * - Integrations renders provider cards for each provider
 * - Integrations shows "Not connected" badge for unconnected providers
 * - Integrations shows HealthBadge for connected providers
 * - Integrations Connect button visible for unconnected provider
 * - Integrations Browse button visible for connected provider
 * - Integrations shows empty state when no providers
 * - Integrations shows data browser when connected provider selected
 * - Integrations shows contacts tab in data browser
 * - Integrations shows deals tab in data browser
 * - Integrations shows error toast when provider fetch fails
 *
 * COMPLIANCE: No PHI in any test assertion (Rule 6).
 * SECURITY: OAuth tokens never appear in assertions (CC6.1).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Integrations } from '../pages/Integrations';

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

const MOCK_HEALTH_HEALTHY = {
  status: 'healthy',
  provider: 'salesforce',
  latencyMs: 42,
  lastCheckedAt: new Date('2026-03-28T10:00:00Z').toISOString(),
};

const MOCK_CONTACTS_RESPONSE = {
  success: true,
  data: [
    { id: 'sf-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
    { id: 'sf-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' },
  ],
  total: 2,
  limit: 50,
  offset: 0,
};

const MOCK_DEALS_RESPONSE = {
  success: true,
  data: [{ id: 'deal-1', name: 'Enterprise Agreement', amount: 50000, stage: 'Negotiation' }],
  total: 1,
  limit: 50,
  offset: 0,
};

// ─── Helper ──────────────────────────────────────────────────────

function renderIntegrations(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Integrations)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: salesforce connected (healthy), hubspot not connected
  mockGet.mockImplementation((url: string) => {
    if (url === '/v1/integrations/providers')
      return Promise.resolve({ success: true, data: ['salesforce', 'hubspot'] });
    if (url === '/v1/integrations/salesforce')
      return Promise.resolve({ success: true, data: MOCK_HEALTH_HEALTHY });
    if (url === '/v1/integrations/hubspot') return Promise.reject(new Error('Not connected'));
    if (url.includes('/salesforce/contacts')) return Promise.resolve(MOCK_CONTACTS_RESPONSE);
    if (url.includes('/salesforce/deals')) return Promise.resolve(MOCK_DEALS_RESPONSE);
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
  mockPost.mockResolvedValue({
    success: true,
    data: { authorizationUrl: 'https://sf.com/oauth?client_id=x', state: 'abc' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('Integrations page', () => {
  it('renders page heading after load', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('Integrations')).toBeDefined();
    });
  });

  it('renders subtitle after load', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText(/Connect your CRM providers/i)).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    renderIntegrations();
    expect(screen.getByText('Loading integrations')).toBeDefined();
  });

  it('renders provider cards after load', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('Salesforce')).toBeDefined();
    });
    expect(screen.getByText('Hubspot')).toBeDefined();
  });

  it('shows "Not connected" badge for unconnected provider', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('Not connected')).toBeDefined();
    });
  });

  it('shows Connect button for unconnected provider', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('Connect')).toBeDefined();
    });
  });

  it('shows healthy badge for connected provider', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('healthy')).toBeDefined();
    });
  });

  it('shows Browse button for connected provider', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('Browse')).toBeDefined();
    });
  });

  it('shows empty state when no providers', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/integrations/providers') return Promise.resolve({ success: true, data: [] });
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('No providers available')).toBeDefined();
    });
  });

  it('shows data browser on provider selection', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('Browse')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Browse'));
    await waitFor(() => {
      expect(screen.getByText(/Data Browser/i)).toBeDefined();
    });
    expect(screen.getByText('Contacts')).toBeDefined();
    expect(screen.getByText('Deals')).toBeDefined();
  });

  it('contacts tab shows contact rows', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('Browse')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Browse'));
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeDefined();
    });
    expect(screen.getByText('Bob Jones')).toBeDefined();
    expect(screen.getByText('alice@example.com')).toBeDefined();
  });

  it('deals tab shows deal rows', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(screen.getByText('Browse')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Browse'));
    await waitFor(() => {
      expect(screen.getByText('Contacts')).toBeDefined();
    });
    // Switch to Deals tab
    fireEvent.click(screen.getByText('Deals'));
    await waitFor(() => {
      expect(screen.getByText('Enterprise Agreement')).toBeDefined();
    });
    expect(screen.getByText('Negotiation')).toBeDefined();
  });

  it('shows error toast when providers API fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/integrations/providers') return Promise.reject(new Error('Network error'));
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });
    renderIntegrations();
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('Failed to load'), 'error');
    });
  });

  it('calls providers endpoint on mount', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/v1/integrations/providers');
    });
  });

  it('calls health endpoint for each provider', async () => {
    renderIntegrations();
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/v1/integrations/salesforce');
    });
    expect(mockGet).toHaveBeenCalledWith('/v1/integrations/hubspot');
  });
});
