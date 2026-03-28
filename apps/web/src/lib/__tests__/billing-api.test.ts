/**
 * billing-api tests
 *
 * Verifies typed wrappers call the correct endpoints with correct params.
 * Mocks apiClient to avoid real HTTP requests.
 *
 * PCI CC6.1 — No payment method IDs or Stripe secrets in test assertions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { billingApi } from '../billing-api';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

const MOCK_PLAN = {
  id: 'starter',
  tier: 'starter' as const,
  name: 'Starter',
  description: 'For small teams',
  price_cents_monthly: 4900,
  price_cents_yearly: 49000,
  limits: {
    max_agents: 3,
    max_contacts: 1000,
    max_messages_month: 5000,
    max_api_calls_month: 10000,
    features: ['email', 'sms'],
  },
  is_custom: false,
};

const MOCK_SUBSCRIPTION = {
  id: 'sub-1',
  tenant_id: 'tenant-1',
  stripe_subscription_id: 'sub_stripe_1',
  plan_tier: 'starter' as const,
  status: 'active' as const,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('billingApi.listPlans', () => {
  it('GETs /v1/billing/plans and extracts data', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_PLAN] });

    const result = await billingApi.listPlans();

    expect(mockGet).toHaveBeenCalledWith('/v1/billing/plans');
    expect(result).toEqual([MOCK_PLAN]);
  });
});

describe('billingApi.getSubscription', () => {
  it('GETs /v1/billing and extracts data', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_SUBSCRIPTION });

    const result = await billingApi.getSubscription();

    expect(mockGet).toHaveBeenCalledWith('/v1/billing');
    expect(result.plan_tier).toBe('starter');
    expect(result.status).toBe('active');
  });
});

describe('billingApi.createSubscription', () => {
  it('POSTs to /v1/billing with planTier', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_SUBSCRIPTION });

    const result = await billingApi.createSubscription('starter', null);

    expect(mockPost).toHaveBeenCalledWith('/v1/billing', {
      planTier: 'starter',
      paymentMethodId: null,
    });
    expect(result.plan_tier).toBe('starter');
  });

  it('defaults paymentMethodId to null when omitted', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_SUBSCRIPTION });

    await billingApi.createSubscription('free');

    const body = mockPost.mock.calls[0]?.[1] as { paymentMethodId: unknown };
    expect(body.paymentMethodId).toBeNull();
  });
});

describe('billingApi.upgradeSubscription', () => {
  it('PATCHes /v1/billing/upgrade with planTier', async () => {
    const upgraded = { ...MOCK_SUBSCRIPTION, plan_tier: 'professional' as const };
    mockPatch.mockResolvedValue({ success: true, data: upgraded });

    const result = await billingApi.upgradeSubscription('professional');

    expect(mockPatch).toHaveBeenCalledWith('/v1/billing/upgrade', { planTier: 'professional' });
    expect(result.plan_tier).toBe('professional');
  });
});

describe('billingApi.downgradeSubscription', () => {
  it('PATCHes /v1/billing/downgrade with planTier', async () => {
    const downgraded = { ...MOCK_SUBSCRIPTION, plan_tier: 'free' as const };
    mockPatch.mockResolvedValue({ success: true, data: downgraded });

    const result = await billingApi.downgradeSubscription('free');

    expect(mockPatch).toHaveBeenCalledWith('/v1/billing/downgrade', { planTier: 'free' });
    expect(result.plan_tier).toBe('free');
  });
});

describe('billingApi.cancelSubscription', () => {
  it('DELETEs /v1/billing and extracts data', async () => {
    const cancelled = { ...MOCK_SUBSCRIPTION, cancel_at_period_end: true };
    mockDelete.mockResolvedValue({ success: true, data: cancelled });

    const result = await billingApi.cancelSubscription();

    expect(mockDelete).toHaveBeenCalledWith('/v1/billing');
    expect(result.cancel_at_period_end).toBe(true);
  });
});

describe('billingApi.getUsage', () => {
  it('GETs /v1/billing/usage and extracts data', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_USAGE });

    const result = await billingApi.getUsage();

    expect(mockGet).toHaveBeenCalledWith('/v1/billing/usage');
    expect(result.agents).toBe(2);
    expect(result.contacts).toBe(450);
    expect(result.messages).toBe(1200);
    expect(result.api_calls).toBe(3500);
  });
});
