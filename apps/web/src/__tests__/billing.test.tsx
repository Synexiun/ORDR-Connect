/**
 * Billing Page Tests
 *
 * Validates:
 * - Billing renders page heading and subtitle
 * - Billing shows loading spinner on mount
 * - Billing renders subscription details after load
 * - Billing renders usage KPI cards after load
 * - Billing renders plan cards after load
 * - Billing shows current plan badge
 * - Billing shows Upgrade button for higher plans
 * - Billing shows Downgrade button for lower plans
 * - Billing shows Cancel subscription button for active subscription
 * - Billing hides Cancel button when subscription is cancelled
 * - Billing shows error when API fails
 * - Billing calls plans, subscription, and usage endpoints on mount
 *
 * COMPLIANCE: No PHI in any test assertion (Rule 6).
 * PCI CC6.1: No payment method IDs or Stripe data in assertions.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Billing } from '../pages/Billing';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

// ─── Mock useToast ────────────────────────────────────────────────

const mockToast = vi.fn();
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_FREE_PLAN = {
  id: 'free',
  tier: 'free',
  name: 'Free',
  description: 'Get started',
  price_cents_monthly: 0,
  price_cents_yearly: 0,
  limits: {
    max_agents: 1,
    max_contacts: 100,
    max_messages_month: 500,
    max_api_calls_month: 1000,
    features: [],
  },
  is_custom: false,
};

const MOCK_STARTER_PLAN = {
  id: 'starter',
  tier: 'starter',
  name: 'Starter',
  description: 'For small teams',
  price_cents_monthly: 4900,
  price_cents_yearly: 49000,
  limits: {
    max_agents: 3,
    max_contacts: 1000,
    max_messages_month: 5000,
    max_api_calls_month: 10000,
    features: [],
  },
  is_custom: false,
};

const MOCK_PRO_PLAN = {
  id: 'professional',
  tier: 'professional',
  name: 'Professional',
  description: 'For growing teams',
  price_cents_monthly: 14900,
  price_cents_yearly: 149000,
  limits: {
    max_agents: 10,
    max_contacts: 10000,
    max_messages_month: 50000,
    max_api_calls_month: 100000,
    features: [],
  },
  is_custom: false,
};

const MOCK_ENTERPRISE_PLAN = {
  id: 'enterprise',
  tier: 'enterprise',
  name: 'Enterprise',
  description: 'For large organizations',
  price_cents_monthly: 0,
  price_cents_yearly: 0,
  limits: {
    max_agents: -1,
    max_contacts: -1,
    max_messages_month: -1,
    max_api_calls_month: -1,
    features: [],
  },
  is_custom: true,
};

const MOCK_SUBSCRIPTION = {
  id: 'sub-1',
  tenant_id: 'tenant-1',
  stripe_subscription_id: 'sub_stripe_1',
  plan_tier: 'starter',
  status: 'active',
  current_period_start: new Date('2026-03-01T00:00:00Z').toISOString(),
  current_period_end: new Date('2026-04-01T00:00:00Z').toISOString(),
  cancel_at_period_end: false,
  created_at: new Date('2026-03-01T00:00:00Z').toISOString(),
  updated_at: new Date('2026-03-01T00:00:00Z').toISOString(),
};

const MOCK_USAGE = {
  tenant_id: 'tenant-1',
  period_start: new Date('2026-03-01T00:00:00Z').toISOString(),
  period_end: new Date('2026-04-01T00:00:00Z').toISOString(),
  agents: 2,
  contacts: 450,
  messages: 1200,
  api_calls: 3500,
};

const PLANS_RESPONSE = {
  success: true,
  data: [MOCK_FREE_PLAN, MOCK_STARTER_PLAN, MOCK_PRO_PLAN, MOCK_ENTERPRISE_PLAN],
};
const SUB_RESPONSE = { success: true, data: MOCK_SUBSCRIPTION };
const USAGE_RESPONSE = { success: true, data: MOCK_USAGE };

// ─── Helper ──────────────────────────────────────────────────────

function renderBilling(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Billing)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockImplementation((url: string) => {
    if (url === '/v1/billing/plans') return Promise.resolve(PLANS_RESPONSE);
    if (url === '/v1/billing') return Promise.resolve(SUB_RESPONSE);
    if (url === '/v1/billing/usage') return Promise.resolve(USAGE_RESPONSE);
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
  mockPatch.mockResolvedValue({ success: true, data: MOCK_SUBSCRIPTION });
  mockDelete.mockResolvedValue({
    success: true,
    data: { ...MOCK_SUBSCRIPTION, cancel_at_period_end: true },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('Billing page', () => {
  it('renders page heading', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getAllByText('Billing').length).toBeGreaterThan(0);
    });
  });

  it('renders subtitle', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getByText(/Manage your subscription and usage/i)).toBeDefined();
    });
  });

  it('shows loading spinner on mount', () => {
    renderBilling();
    expect(screen.getByText('Loading billing data')).toBeDefined();
  });

  it('renders subscription plan after load', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getAllByText(/starter/i).length).toBeGreaterThan(0);
    });
  });

  it('renders subscription status badge after load', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getAllByText('active').length).toBeGreaterThan(0);
    });
  });

  it('renders next renewal label after load', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getByText('Next renewal')).toBeDefined();
    });
  });

  it('renders usage KPI cards after load', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getByText('Agents')).toBeDefined();
    });
    expect(screen.getByText('Contacts')).toBeDefined();
    expect(screen.getByText('Messages')).toBeDefined();
    expect(screen.getByText('API Calls')).toBeDefined();
  });

  it('renders usage values after load', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getByText('2')).toBeDefined(); // agents
    });
    expect(screen.getByText('1,200')).toBeDefined(); // messages
  });

  it('renders plan cards after load', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Starter').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Professional').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enterprise').length).toBeGreaterThan(0);
  });

  it('shows current plan badge on active plan', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getAllByText('Current plan').length).toBeGreaterThan(0);
    });
  });

  it('shows Upgrade button for higher plans', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getAllByText('Upgrade').length).toBeGreaterThan(0);
    });
  });

  it('shows Downgrade button for lower plans', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getByText('Downgrade')).toBeDefined();
    });
  });

  it('shows Cancel subscription button for active subscription', async () => {
    renderBilling();
    await waitFor(() => {
      expect(screen.getByText('Cancel subscription')).toBeDefined();
    });
  });

  it('hides Cancel button when subscription is cancelled', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/v1/billing/plans') return Promise.resolve(PLANS_RESPONSE);
      if (url === '/v1/billing')
        return Promise.resolve({
          success: true,
          data: { ...MOCK_SUBSCRIPTION, status: 'cancelled', cancel_at_period_end: true },
        });
      if (url === '/v1/billing/usage') return Promise.resolve(USAGE_RESPONSE);
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });
    renderBilling();
    await waitFor(() => {
      expect(screen.getByText('cancelling')).toBeDefined();
    });
    expect(screen.queryByText('Cancel subscription')).toBeNull();
  });

  it('shows error when API fails', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    renderBilling();
    await waitFor(() => {
      expect(screen.getByText('Failed to load billing data')).toBeDefined();
    });
  });

  it('calls plans, subscription, and usage endpoints on mount', async () => {
    renderBilling();
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/v1/billing/plans');
    });
    expect(mockGet).toHaveBeenCalledWith('/v1/billing');
    expect(mockGet).toHaveBeenCalledWith('/v1/billing/usage');
  });
});
