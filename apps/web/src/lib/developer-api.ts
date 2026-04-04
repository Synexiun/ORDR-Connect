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

// ── Usage Stats ─────────────────────────────────────────────────────

export interface DeveloperUsageStats {
  readonly totalCalls: number;
  readonly totalErrors: number;
  readonly callsToday: number;
  readonly errorsToday: number;
}

export interface DeveloperUsageDaily {
  readonly label: string;
  readonly calls: number;
  readonly errors: number;
}

export interface DeveloperUsageEndpoint {
  readonly endpoint: string;
  readonly calls: number;
}

export interface DeveloperUsageData {
  readonly stats: DeveloperUsageStats;
  readonly daily: DeveloperUsageDaily[];
  readonly endpoints: DeveloperUsageEndpoint[];
}

export function getDeveloperUsage(days = 7): Promise<{
  readonly success: true;
  readonly data: DeveloperUsageData;
}> {
  return apiClient.get<{ readonly success: true; readonly data: DeveloperUsageData }>(
    `/v1/developers/usage?days=${String(days)}`,
  );
}

// ── Developer Webhooks ─────────────────────────────────────────────────────

export interface WebhookItem {
  readonly id: string;
  readonly url: string;
  readonly events: string[];
  readonly active: boolean;
  readonly lastTriggeredAt: string | null;
  readonly createdAt: string;
}

/** Only returned at creation — hmacSecret is shown once and never again. */
export interface WebhookCreated extends WebhookItem {
  readonly hmacSecret: string;
}

export function listWebhooks(): Promise<{ readonly success: true; readonly data: WebhookItem[] }> {
  return apiClient.get<{ readonly success: true; readonly data: WebhookItem[] }>(
    '/v1/developers/webhooks',
  );
}

export function createWebhook(body: {
  readonly url: string;
  readonly events: string[];
}): Promise<{ readonly success: true; readonly data: WebhookCreated }> {
  return apiClient.post<{ readonly success: true; readonly data: WebhookCreated }>(
    '/v1/developers/webhooks',
    body,
  );
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  await apiClient.delete(`/v1/developers/webhooks/${webhookId}`);
}

export function toggleWebhook(
  webhookId: string,
  active: boolean,
): Promise<{ readonly success: true; readonly data: WebhookItem }> {
  return apiClient.patch<{ readonly success: true; readonly data: WebhookItem }>(
    `/v1/developers/webhooks/${webhookId}/toggle`,
    { active },
  );
}

// ── My Agents ──────────────────────────────────────────────────────────────

export interface MyAgent {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  readonly installCount: number;
  readonly createdAt: string;
}

export function listMyAgents(): Promise<{ readonly success: true; readonly data: MyAgent[] }> {
  return apiClient.get<{ readonly success: true; readonly data: MyAgent[] }>(
    '/v1/developers/agents',
  );
}

export function submitAgent(body: {
  readonly manifest: Record<string, unknown>;
  readonly packageHash: string;
  readonly description: string;
}): Promise<{ readonly success: true; readonly data: MyAgent }> {
  return apiClient.post<{ readonly success: true; readonly data: MyAgent }>(
    '/v1/developers/agents/submit',
    body,
  );
}
