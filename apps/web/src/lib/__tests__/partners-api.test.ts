/**
 * Partners API Tests
 *
 * Validates:
 * - getPartnerProfile → GET /v1/partners/me
 * - updatePartnerProfile → PATCH /v1/partners/me
 * - getEarnings → GET /v1/partners/earnings
 * - listPayouts → GET /v1/partners/payouts
 * - registerAsPartner → POST /v1/partners/register
 * - getPartnerStats → GET /v1/partners/stats?months=:n (default 6)
 *
 * COMPLIANCE: No PHI. SOC2 CC6.1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: vi.fn(),
  },
}));

import {
  getPartnerProfile,
  updatePartnerProfile,
  getEarnings,
  listPayouts,
  registerAsPartner,
  getPartnerStats,
} from '../partners-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_PARTNER = {
  id: 'partner-test-1',
  userId: 'usr-1',
  companyName: 'Test Partner Inc',
  contactName: 'Jane Smith',
  tier: 'reseller' as const,
  commissionRate: 0.15,
  status: 'active' as const,
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
};

const MOCK_EARNINGS = {
  totalEarned: 12500,
  pendingPayout: 1800,
  paidOut: 10700,
  currentPeriodEarnings: 1800,
  referralCount: 42,
  activeReferrals: 15,
};

const MOCK_PAYOUT = {
  id: 'payout-test-1',
  partnerId: 'partner-test-1',
  amount: 1500,
  currency: 'USD',
  status: 'paid' as const,
  periodStart: '2026-02-01T00:00:00Z',
  periodEnd: '2026-02-28T23:59:59Z',
  paidAt: '2026-03-05T00:00:00Z',
  createdAt: '2026-03-01T00:00:00Z',
};

const MOCK_STATS = {
  monthly: [{ month: '2026-03', amountCents: 180000 }],
  funnel: [{ month: '2026-03', clicks: 240, signups: 18, conversions: 3 }],
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ success: true, data: MOCK_PARTNER });
  mockPost.mockResolvedValue({ success: true, data: MOCK_PARTNER });
  mockPatch.mockResolvedValue({ success: true, data: MOCK_PARTNER });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('getPartnerProfile', () => {
  it('calls GET /v1/partners/me', async () => {
    await getPartnerProfile();
    expect(mockGet).toHaveBeenCalledWith('/v1/partners/me');
  });

  it('returns wrapped partner profile on success', async () => {
    const result = await getPartnerProfile();
    expect(result.data.id).toBe('partner-test-1');
    expect(result.data.tier).toBe('reseller');
  });
});

describe('updatePartnerProfile', () => {
  it('calls PATCH /v1/partners/me with partial body', async () => {
    await updatePartnerProfile({ companyName: 'Updated Partner Inc' });
    expect(mockPatch).toHaveBeenCalledWith('/v1/partners/me', {
      companyName: 'Updated Partner Inc',
    });
  });

  it('includes contactName when provided', async () => {
    await updatePartnerProfile({ contactName: 'John Doe' });
    expect(mockPatch).toHaveBeenCalledWith(
      '/v1/partners/me',
      expect.objectContaining({ contactName: 'John Doe' }),
    );
  });

  it('returns updated partner on success', async () => {
    const result = await updatePartnerProfile({ companyName: 'Updated' });
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('partner-test-1');
  });
});

describe('getEarnings', () => {
  it('calls GET /v1/partners/earnings', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_EARNINGS });
    await getEarnings();
    expect(mockGet).toHaveBeenCalledWith('/v1/partners/earnings');
  });

  it('returns earnings summary on success', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_EARNINGS });
    const result = await getEarnings();
    expect(result.data.totalEarned).toBe(12500);
    expect(result.data.activeReferrals).toBe(15);
  });
});

describe('listPayouts', () => {
  it('calls GET /v1/partners/payouts', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_PAYOUT], total: 1 });
    await listPayouts();
    expect(mockGet).toHaveBeenCalledWith('/v1/partners/payouts');
  });

  it('returns PayoutListResponse with data array', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_PAYOUT], total: 1 });
    const result = await listPayouts();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.status).toBe('paid');
    expect(result.data[0]!.amount).toBe(1500);
  });
});

describe('registerAsPartner', () => {
  it('calls POST /v1/partners/register with body', async () => {
    await registerAsPartner({ companyName: 'New Partner', contactName: 'Jane Smith' });
    expect(mockPost).toHaveBeenCalledWith('/v1/partners/register', {
      companyName: 'New Partner',
      contactName: 'Jane Smith',
    });
  });

  it('includes tier when provided', async () => {
    await registerAsPartner({
      companyName: 'New Partner',
      contactName: 'Jane Smith',
      tier: 'strategic',
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/partners/register',
      expect.objectContaining({ tier: 'strategic' }),
    );
  });

  it('returns created partner profile on success', async () => {
    const result = await registerAsPartner({
      companyName: 'New Partner',
      contactName: 'Jane Smith',
    });
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('partner-test-1');
  });
});

describe('getPartnerStats', () => {
  it('calls GET /v1/partners/stats?months=6 by default', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_STATS });
    await getPartnerStats();
    expect(mockGet).toHaveBeenCalledWith('/v1/partners/stats?months=6');
  });

  it('uses custom months parameter when provided', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_STATS });
    await getPartnerStats(12);
    expect(mockGet).toHaveBeenCalledWith('/v1/partners/stats?months=12');
  });

  it('returns stats with monthly and funnel data', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_STATS });
    const result = await getPartnerStats();
    expect(result.data.monthly).toHaveLength(1);
    expect(result.data.funnel).toHaveLength(1);
    expect(result.data.monthly[0]!.amountCents).toBe(180000);
  });
});
