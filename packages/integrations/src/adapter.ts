/**
 * Abstract CRM Adapter Interface — provider-agnostic integration contract
 *
 * SOC2 CC6.1 — All operations are tenant-scoped and audit-logged.
 * ISO 27001 A.14.1.2 — Secure connections to external services.
 * HIPAA §164.312(e) — Transmission security for PHI.
 *
 * Every adapter implementation MUST:
 * - Use OAuth 2.0 for authentication (no permanent credentials)
 * - Encrypt all stored credentials (AES-256-GCM)
 * - Verify webhook signatures before processing
 * - Respect provider rate limits
 * - Log all operations to the immutable audit trail
 */

import type {
  IntegrationProvider,
  OAuthCredentials,
  IntegrationHealth,
  CrmContact,
  CrmDeal,
  CrmActivity,
  PaginationParams,
  PaginatedResult,
  SyncQuery,
  WebhookPayload,
  RateLimitInfo,
} from './types.js';

// ─── OAuth Config ───────────────────────────────────────────────

export interface OAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

// ─── OAuth Authorization URL Result ─────────────────────────────

export interface OAuthAuthorizationResult {
  readonly authorizationUrl: string;
  readonly state: string;
}

// ─── OAuth Token Exchange Result ────────────────────────────────

export interface OAuthTokenResult {
  readonly credentials: OAuthCredentials;
  readonly instanceUrl?: string | undefined;
}

// ─── Connection Config ──────────────────────────────────────────

export interface ConnectionConfig {
  readonly tenantId: string;
  readonly provider: IntegrationProvider;
  readonly oauthConfig: OAuthConfig;
  readonly credentials?: OAuthCredentials | undefined;
}

// ─── HTTP Client Interface (dependency injection) ───────────────

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface HttpClient {
  get(url: string, headers: Readonly<Record<string, string>>): Promise<HttpResponse>;
  post(url: string, body: unknown, headers: Readonly<Record<string, string>>): Promise<HttpResponse>;
  patch(url: string, body: unknown, headers: Readonly<Record<string, string>>): Promise<HttpResponse>;
  delete(url: string, headers: Readonly<Record<string, string>>): Promise<HttpResponse>;
}

// ─── CRM Adapter Interface ──────────────────────────────────────

export interface CRMAdapter {
  readonly provider: IntegrationProvider;

  /**
   * Generate OAuth authorization URL to initiate connection.
   * The returned state parameter MUST be stored server-side for CSRF verification.
   */
  getAuthorizationUrl(config: OAuthConfig): OAuthAuthorizationResult;

  /**
   * Exchange authorization code for access/refresh tokens.
   * Tokens MUST be encrypted before storage.
   */
  exchangeCode(
    config: OAuthConfig,
    code: string,
    state: string,
  ): Promise<OAuthTokenResult>;

  /**
   * Refresh expired access token using refresh token.
   * Returns new credentials — caller MUST encrypt and persist.
   */
  refreshAccessToken(
    config: OAuthConfig,
    refreshToken: string,
  ): Promise<OAuthTokenResult>;

  /**
   * Disconnect integration — revoke OAuth tokens.
   */
  disconnect(credentials: OAuthCredentials): Promise<void>;

  /**
   * Check connection health and rate limit status.
   */
  getHealth(credentials: OAuthCredentials): Promise<IntegrationHealth>;

  /**
   * Fetch contacts from the CRM with optional filtering and pagination.
   */
  fetchContacts(
    credentials: OAuthCredentials,
    query: SyncQuery,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<CrmContact>>;

  /**
   * Push a single contact to the CRM.
   * Returns the external ID of the created/updated record.
   */
  pushContact(
    credentials: OAuthCredentials,
    contact: CrmContact,
    existingExternalId?: string | undefined,
  ): Promise<string>;

  /**
   * Fetch deals/opportunities from the CRM.
   */
  fetchDeals(
    credentials: OAuthCredentials,
    query: SyncQuery,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<CrmDeal>>;

  /**
   * Push a single deal to the CRM.
   * Returns the external ID.
   */
  pushDeal(
    credentials: OAuthCredentials,
    deal: CrmDeal,
    existingExternalId?: string | undefined,
  ): Promise<string>;

  /**
   * Fetch activities/interactions from the CRM.
   */
  fetchActivities(
    credentials: OAuthCredentials,
    query: SyncQuery,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<CrmActivity>>;

  /**
   * Push a single activity to the CRM.
   * Returns the external ID.
   */
  pushActivity(
    credentials: OAuthCredentials,
    activity: CrmActivity,
    existingExternalId?: string | undefined,
  ): Promise<string>;

  /**
   * Process an inbound webhook payload.
   * MUST verify the signature before processing.
   *
   * @throws Error if signature verification fails
   */
  handleWebhook(
    payload: Readonly<Record<string, unknown>>,
    signature: string,
    secret: string,
  ): WebhookPayload;

  /**
   * Fetch current rate limit information for the integration.
   */
  getRateLimitInfo(credentials: OAuthCredentials): Promise<RateLimitInfo>;

  /**
   * Bulk push contacts (for large syncs > 200 records).
   * Returns map of ORDR external ID -> CRM external ID.
   */
  bulkPushContacts?(
    credentials: OAuthCredentials,
    contacts: readonly CrmContact[],
  ): Promise<ReadonlyMap<string, string>>;
}
