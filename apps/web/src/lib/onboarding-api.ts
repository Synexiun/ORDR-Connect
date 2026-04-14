/**
 * Onboarding API Helpers — first-run wizard state
 *
 * All calls go to /v1/onboarding.
 *
 * COMPLIANCE: No PHI. State is admin-only, tenant-scoped.
 * Completion is audit-logged server-side.
 */

import { apiClient } from './api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OnboardingState {
  readonly tenantId: string;
  readonly complete: boolean;
  readonly step: number;
  readonly completedAt: string | null;
}

// ── API Functions ─────────────────────────────────────────────────────────────

export async function fetchOnboardingState(): Promise<OnboardingState> {
  const res = await apiClient.get<{ data: OnboardingState }>('/v1/onboarding');
  return res.data;
}

export async function advanceOnboardingStep(step: number): Promise<OnboardingState> {
  const res = await apiClient.put<{ data: OnboardingState }>('/v1/onboarding/step', { step });
  return res.data;
}

export async function completeOnboarding(): Promise<OnboardingState> {
  const res = await apiClient.post<{ data: OnboardingState }>('/v1/onboarding/complete');
  return res.data;
}
