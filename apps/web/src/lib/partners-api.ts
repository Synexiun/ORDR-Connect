/**
 * Partners API Service
 *
 * Typed wrappers over /api/v1/partners endpoints.
 * Covers: profile, earnings, payouts.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type PartnerTier = 'referral' | 'reseller' | 'strategic';
export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface Partner {
  readonly id: string;
  readonly userId: string;
  readonly companyName: string;
  readonly contactName: string;
  readonly tier: PartnerTier;
  readonly commissionRate: number;
  readonly status: 'active' | 'inactive' | 'suspended';
  readonly createdAt: string;
}

export interface EarningsSummary {
  readonly totalEarned: number;
  readonly pendingPayout: number;
  readonly paidOut: number;
  readonly currentPeriodEarnings: number;
  readonly referralCount: number;
  readonly activeReferrals: number;
}

export interface Payout {
  readonly id: string;
  readonly partnerId: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: PayoutStatus;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly paidAt: string | null;
  readonly createdAt: string;
}

export interface PayoutListResponse {
  readonly success: true;
  readonly data: Payout[];
  readonly total: number;
}

// ── API Functions ──────────────────────────────────────────────────

export function getPartnerProfile(): Promise<{ readonly success: true; readonly data: Partner }> {
  return apiClient.get<{ readonly success: true; readonly data: Partner }>('/v1/partners/me');
}

export function updatePartnerProfile(body: {
  readonly companyName?: string;
  readonly contactName?: string;
}): Promise<{ readonly success: true; readonly data: Partner }> {
  return apiClient.patch<{ readonly success: true; readonly data: Partner }>(
    '/v1/partners/me',
    body,
  );
}

export function getEarnings(): Promise<{ readonly success: true; readonly data: EarningsSummary }> {
  return apiClient.get<{ readonly success: true; readonly data: EarningsSummary }>(
    '/v1/partners/earnings',
  );
}

export function listPayouts(): Promise<PayoutListResponse> {
  return apiClient.get<PayoutListResponse>('/v1/partners/payouts');
}

export function registerAsPartner(body: {
  readonly companyName: string;
  readonly contactName: string;
  readonly tier?: PartnerTier;
}): Promise<{ readonly success: true; readonly data: Partner }> {
  return apiClient.post<{ readonly success: true; readonly data: Partner }>(
    '/v1/partners/register',
    body,
  );
}
