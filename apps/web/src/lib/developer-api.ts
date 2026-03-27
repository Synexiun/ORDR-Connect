/**
 * Developer API Service
 *
 * Typed wrappers over /api/v1/developers endpoints.
 * Covers: registration, login, API keys, sandboxes.
 *
 * SECURITY: Raw API key is only returned once at creation (Rule 2).
 * All subsequent reads return only the prefix.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type DeveloperTier = 'free' | 'pro' | 'enterprise';
export type SandboxStatus = 'active' | 'expired' | 'destroyed';

export interface Developer {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly organization: string | null;
  readonly tier: DeveloperTier;
  readonly createdAt: string;
}

export interface ApiKey {
  readonly id: string;
  readonly developerId: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly isActive: boolean;
}

export interface ApiKeyCreated extends ApiKey {
  /** Raw key — shown ONCE, never stored or returned again. */
  readonly rawKey: string;
}

export interface SandboxTenant {
  readonly id: string;
  readonly developerId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly seedDataProfile: string;
  readonly status: SandboxStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
}

// ── API Functions ──────────────────────────────────────────────────

export function getDeveloperProfile(): Promise<{
  readonly success: true;
  readonly data: Developer;
}> {
  return apiClient.get<{ readonly success: true; readonly data: Developer }>('/v1/developers/me');
}

export function createApiKey(body: {
  readonly name: string;
  readonly expiresInDays?: number;
}): Promise<{ readonly success: true; readonly data: ApiKeyCreated }> {
  return apiClient.post<{ readonly success: true; readonly data: ApiKeyCreated }>(
    '/v1/developers/keys',
    body,
  );
}

export function listApiKeys(): Promise<{ readonly success: true; readonly data: ApiKey[] }> {
  return apiClient.get<{ readonly success: true; readonly data: ApiKey[] }>('/v1/developers/keys');
}

export async function revokeApiKey(keyId: string): Promise<void> {
  await apiClient.delete(`/v1/developers/keys/${keyId}`);
}

export function createSandbox(body: {
  readonly name: string;
  readonly seedProfile?: string;
}): Promise<{ readonly success: true; readonly data: SandboxTenant }> {
  return apiClient.post<{ readonly success: true; readonly data: SandboxTenant }>(
    '/v1/developers/sandbox',
    body,
  );
}

export function listSandboxes(): Promise<{
  readonly success: true;
  readonly data: SandboxTenant[];
}> {
  return apiClient.get<{ readonly success: true; readonly data: SandboxTenant[] }>(
    '/v1/developers/sandbox',
  );
}

export async function destroySandbox(sandboxId: string): Promise<void> {
  await apiClient.delete(`/v1/developers/sandbox/${sandboxId}`);
}
