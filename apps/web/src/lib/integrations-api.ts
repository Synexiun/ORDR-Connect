/**
 * Integrations API Service
 *
 * Typed wrappers over /api/v1/integrations endpoints.
 *
 * SOC2 CC6.1 — OAuth tokens stored server-side, never returned to client.
 * ISO 27001 A.12.4.1 — OAuth flows logged in audit chain.
 * HIPAA §164.312 — No PHI in integration payloads; use pseudonymized IDs only.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type IntegrationProvider = string;

export interface ProviderInfo {
  readonly name: string;
  readonly authType: 'oauth2' | 'api_key';
}

export interface IntegrationHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly provider: string;
  readonly latencyMs: number;
  readonly lastCheckedAt: string;
  readonly error?: string;
}

export interface OAuthState {
  readonly authorizationUrl: string;
  readonly state: string;
}

export interface OAuthCallbackResult {
  readonly connected: boolean;
  readonly provider: string;
  readonly expiresAt?: string;
}

export interface CRMContact {
  readonly id: string;
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly phone?: string;
  readonly company?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface CRMDeal {
  readonly id: string;
  readonly name: string;
  readonly amount?: number;
  readonly stage?: string;
  readonly closeDate?: string;
  readonly ownerId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ListResult<T> {
  readonly items: T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ListContactsParams {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface UpsertContactParams {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  metadata?: Record<string, unknown>;
}

// ── API ────────────────────────────────────────────────────────────

export const integrationsApi = {
  /**
   * List all available integration providers (no auth required).
   */
  listProviders(): Promise<string[]> {
    return apiClient
      .get<{ success: boolean; data: string[] }>('/v1/integrations/providers')
      .then((r) => r.data);
  },

  /**
   * Get integration health status for a specific provider.
   */
  getHealth(provider: IntegrationProvider): Promise<IntegrationHealth> {
    return apiClient
      .get<{
        success: boolean;
        data: IntegrationHealth;
        provider: string;
      }>(`/v1/integrations/${provider}`)
      .then((r) => r.data);
  },

  /**
   * Get OAuth authorization URL for a provider (admin only).
   */
  authorize(
    provider: IntegrationProvider,
    redirectUri: string,
    state?: string,
  ): Promise<OAuthState> {
    return apiClient
      .post<{ success: boolean; data: OAuthState }>(`/v1/integrations/${provider}/authorize`, {
        redirectUri,
        state,
      })
      .then((r) => r.data);
  },

  /**
   * Exchange OAuth authorization code for credentials (admin only).
   * Access token is NEVER returned to the client.
   */
  callback(provider: IntegrationProvider, code: string): Promise<OAuthCallbackResult> {
    return apiClient
      .post<{
        success: boolean;
        data: OAuthCallbackResult;
      }>(`/v1/integrations/${provider}/callback`, { code })
      .then((r) => r.data);
  },

  /**
   * List contacts from a CRM provider.
   */
  listContacts(
    provider: IntegrationProvider,
    params: ListContactsParams = {},
  ): Promise<ListResult<CRMContact>> {
    const query = new URLSearchParams();
    if (params.q !== undefined) query.set('q', params.q);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const qs = query.toString();
    return apiClient
      .get<{
        success: boolean;
        data: CRMContact[];
        total: number;
        limit: number;
        offset: number;
      }>(`/v1/integrations/${provider}/contacts${qs ? `?${qs}` : ''}`)
      .then((r) => ({ items: r.data, total: r.total, limit: r.limit, offset: r.offset }));
  },

  /**
   * Get a single contact by ID.
   */
  getContact(provider: IntegrationProvider, contactId: string): Promise<CRMContact> {
    return apiClient
      .get<{
        success: boolean;
        data: CRMContact;
      }>(`/v1/integrations/${provider}/contacts/${contactId}`)
      .then((r) => r.data);
  },

  /**
   * Create or update a contact.
   */
  upsertContact(provider: IntegrationProvider, params: UpsertContactParams): Promise<CRMContact> {
    return apiClient
      .post<{ success: boolean; data: CRMContact }>(`/v1/integrations/${provider}/contacts`, params)
      .then((r) => r.data);
  },

  /**
   * Delete a contact (admin only).
   */
  deleteContact(provider: IntegrationProvider, contactId: string): Promise<void> {
    return apiClient.delete(`/v1/integrations/${provider}/contacts/${contactId}`);
  },

  /**
   * List deals from a CRM provider.
   */
  listDeals(
    provider: IntegrationProvider,
    params: ListContactsParams = {},
  ): Promise<ListResult<CRMDeal>> {
    const query = new URLSearchParams();
    if (params.q !== undefined) query.set('q', params.q);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const qs = query.toString();
    return apiClient
      .get<{
        success: boolean;
        data: CRMDeal[];
        total: number;
        limit: number;
        offset: number;
      }>(`/v1/integrations/${provider}/deals${qs ? `?${qs}` : ''}`)
      .then((r) => ({ items: r.data, total: r.total, limit: r.limit, offset: r.offset }));
  },
};
