/**
 * Feature Flags API Helpers — per-tenant runtime feature gating
 *
 * All calls go to /v1/feature-flags.
 *
 * COMPLIANCE: No PHI in flag data. Admin-only writes are audit-logged
 * server-side. Tenant isolation enforced by JWT.
 */

import { apiClient } from './api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeatureFlag {
  readonly id: string;
  readonly tenantId: string;
  readonly flagName: string;
  readonly enabled: boolean;
  readonly rolloutPct: number;
  readonly description: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateFlagPayload {
  flagName: string;
  enabled?: boolean;
  rolloutPct?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateFlagPayload {
  enabled?: boolean;
  rolloutPct?: number;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

// ── API Functions ─────────────────────────────────────────────────────────────

export async function fetchFeatureFlags(): Promise<FeatureFlag[]> {
  try {
    const res = await apiClient.get<{ data: FeatureFlag[] }>('/v1/feature-flags');
    return res.data;
  } catch {
    return [];
  }
}

export async function createFeatureFlag(payload: CreateFlagPayload): Promise<FeatureFlag> {
  const res = await apiClient.post<{ data: FeatureFlag }>('/v1/feature-flags', payload);
  return res.data;
}

export async function updateFeatureFlag(
  flagName: string,
  payload: UpdateFlagPayload,
): Promise<FeatureFlag> {
  const res = await apiClient.put<{ data: FeatureFlag }>(
    `/v1/feature-flags/${encodeURIComponent(flagName)}`,
    payload,
  );
  return res.data;
}

export async function deleteFeatureFlag(flagName: string): Promise<void> {
  await apiClient.delete(`/v1/feature-flags/${encodeURIComponent(flagName)}`);
}
