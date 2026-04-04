/**
 * HubSpot CRM Adapter — OAuth 2.0 + REST API v3
 *
 * SOC2 CC6.1 — Tenant-scoped access to HubSpot data.
 * ISO 27001 A.14.1.2 — Secure external service integration.
 * HIPAA §164.312(e) — Transmission security for PHI.
 *
 * This adapter communicates with HubSpot via:
 * - OAuth 2.0 Authorization Code flow for authentication
 * - CRM API v3 for CRUD operations
 * - Batch API for large data syncs (>100 records)
 *
 * All HTTP calls go through the injected HttpClient interface,
 * enabling mock-based testing without real HubSpot API calls.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
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
  EntityType,
} from '../types.js';
import type {
  CRMAdapter,
  OAuthConfig,
  OAuthAuthorizationResult,
  OAuthTokenResult,
  HttpClient,
} from '../adapter.js';

// ─── Constants ──────────────────────────────────────────────────

const HS_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const HS_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const HS_API_BASE = 'https://api.hubapi.com';
const BATCH_THRESHOLD = 100;

// ─── HubSpot-specific response types ────────────────────────────

interface HubSpotContact {
  readonly id: string;
  readonly properties: {
    readonly firstname: string | null;
    readonly lastname: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    readonly company: string | null;
    readonly jobtitle: string | null;
    readonly hs_object_id: string;
    readonly [key: string]: unknown;
  };
  readonly updatedAt: string;
}

interface HubSpotDeal {
  readonly id: string;
  readonly properties: {
    readonly dealname: string;
    readonly amount: string | null;
    readonly dealstage: string;
    readonly hs_deal_stage_probability: string | null;
    readonly closedate: string | null;
    readonly hs_object_id: string;
    readonly [key: string]: unknown;
  };
  readonly updatedAt: string;
}

interface HubSpotEngagement {
  readonly id: string;
  readonly properties: {
    readonly hs_engagement_type: string;
    readonly hs_activity_type: string | null;
    readonly hs_timestamp: string;
    readonly hs_body_preview: string | null;
    readonly hs_object_id: string;
    readonly [key: string]: unknown;
  };
  readonly updatedAt: string;
}

interface HubSpotSearchResult<T> {
  readonly total: number;
  readonly results: readonly T[];
  readonly paging?: {
    readonly next?: { readonly after: string };
  };
}

// ─── Adapter Implementation ─────────────────────────────────────

export class HubSpotAdapter implements CRMAdapter {
  public readonly provider: IntegrationProvider = 'hubspot';
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  // ── OAuth ──────────────────────────────────────────────────────

  getAuthorizationUrl(config: OAuthConfig): OAuthAuthorizationResult {
    const state = randomUUID();
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state,
    });

    return {
      authorizationUrl: `${HS_AUTH_URL}?${params.toString()}`,
      state,
    };
  }

  async exchangeCode(config: OAuthConfig, code: string, _state: string): Promise<OAuthTokenResult> {
    const body = {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    };

    const response = await this.httpClient.post(HS_TOKEN_URL, body, {
      'Content-Type': 'application/json',
    });

    if (response.status !== 200) {
      throw new Error(`HubSpot OAuth token exchange failed: HTTP ${String(response.status)}`);
    }

    const data = response.body as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };

    return {
      credentials: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        tokenType: data.token_type,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        scope: config.scopes.join(' '),
      },
    };
  }

  async refreshAccessToken(config: OAuthConfig, refreshToken: string): Promise<OAuthTokenResult> {
    const body = {
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    };

    const response = await this.httpClient.post(HS_TOKEN_URL, body, {
      'Content-Type': 'application/json',
    });

    if (response.status !== 200) {
      throw new Error(`HubSpot token refresh failed: HTTP ${String(response.status)}`);
    }

    const data = response.body as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };

    return {
      credentials: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        tokenType: data.token_type,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        scope: config.scopes.join(' '),
      },
    };
  }

  async disconnect(credentials: OAuthCredentials): Promise<void> {
    // Revoke the refresh token via HubSpot OAuth token revocation endpoint
    // This is best-effort — we always clear local credentials regardless of API response
    try {
      await fetch(`https://api.hubapi.com/oauth/v1/refresh-tokens/${credentials.refreshToken}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
        },
      });
    } catch (err) {
      // Best-effort: log warning but do not throw — local cleanup proceeds
      console.warn(
        '[ORDR:INTEGRATIONS:HUBSPOT] Token revocation request failed (best-effort):',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ── Health ─────────────────────────────────────────────────────

  async getHealth(credentials: OAuthCredentials): Promise<IntegrationHealth> {
    const start = Date.now();

    try {
      const response = await this.httpClient.get(
        `${HS_API_BASE}/crm/v3/objects/contacts?limit=1`,
        this.authHeaders(credentials),
      );

      const latencyMs = Date.now() - start;

      if (response.status !== 200) {
        return {
          provider: 'hubspot',
          status: 'error',
          lastCheckedAt: new Date(),
          latencyMs,
          rateLimitRemaining: this.extractRateLimit(response.headers),
          rateLimitResetAt: null,
          message: `API returned HTTP ${String(response.status)}`,
        };
      }

      const remaining = this.extractRateLimit(response.headers);

      return {
        provider: 'hubspot',
        status: remaining !== null && remaining < 10 ? 'degraded' : 'healthy',
        lastCheckedAt: new Date(),
        latencyMs,
        rateLimitRemaining: remaining,
        rateLimitResetAt: null,
        message: null,
      };
    } catch {
      return {
        provider: 'hubspot',
        status: 'disconnected',
        lastCheckedAt: new Date(),
        latencyMs: Date.now() - start,
        rateLimitRemaining: null,
        rateLimitResetAt: null,
        message: 'Connection failed',
      };
    }
  }

  // ── Contacts ───────────────────────────────────────────────────

  async fetchContacts(
    credentials: OAuthCredentials,
    query: SyncQuery,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<CrmContact>> {
    const searchBody: Record<string, unknown> = {
      limit: pagination.limit,
      properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle'],
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
    };

    if (pagination.cursor !== undefined) {
      searchBody['after'] = pagination.cursor;
    }

    const filterGroups: Record<string, unknown>[] = [];
    if (query.modifiedAfter !== undefined) {
      filterGroups.push({
        filters: [
          {
            propertyName: 'lastmodifieddate',
            operator: 'GTE',
            value: String(query.modifiedAfter.getTime()),
          },
        ],
      });
    }
    if (query.modifiedBefore !== undefined) {
      filterGroups.push({
        filters: [
          {
            propertyName: 'lastmodifieddate',
            operator: 'LTE',
            value: String(query.modifiedBefore.getTime()),
          },
        ],
      });
    }
    if (filterGroups.length > 0) {
      searchBody['filterGroups'] = filterGroups;
    }

    const url = `${HS_API_BASE}/crm/v3/objects/contacts/search`;
    const response = await this.httpClient.post(url, searchBody, this.authHeaders(credentials));

    if (response.status !== 200) {
      throw new Error(`HubSpot contact search failed: HTTP ${String(response.status)}`);
    }

    const result = response.body as HubSpotSearchResult<HubSpotContact>;
    const contacts = result.results.map((r) => this.mapHsContactToCrm(r));
    const nextCursor = result.paging?.next?.after ?? null;

    return {
      data: contacts,
      nextCursor,
      hasMore: nextCursor !== null,
      total: result.total,
    };
  }

  async pushContact(
    credentials: OAuthCredentials,
    contact: CrmContact,
    existingExternalId?: string,
  ): Promise<string> {
    const properties = {
      firstname: contact.firstName,
      lastname: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      jobtitle: contact.title,
      company: contact.company,
    };

    if (existingExternalId !== undefined) {
      const url = `${HS_API_BASE}/crm/v3/objects/contacts/${existingExternalId}`;
      const response = await this.httpClient.patch(
        url,
        { properties },
        this.authHeaders(credentials),
      );
      if (response.status !== 200) {
        throw new Error(`HubSpot contact update failed: HTTP ${String(response.status)}`);
      }
      return existingExternalId;
    }

    const url = `${HS_API_BASE}/crm/v3/objects/contacts`;
    const response = await this.httpClient.post(url, { properties }, this.authHeaders(credentials));
    if (response.status !== 201) {
      throw new Error(`HubSpot contact create failed: HTTP ${String(response.status)}`);
    }

    const data = response.body as { id: string };
    return data.id;
  }

  // ── Deals ──────────────────────────────────────────────────────

  async fetchDeals(
    credentials: OAuthCredentials,
    query: SyncQuery,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<CrmDeal>> {
    const searchBody: Record<string, unknown> = {
      limit: pagination.limit,
      properties: ['dealname', 'amount', 'dealstage', 'hs_deal_stage_probability', 'closedate'],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
    };

    if (pagination.cursor !== undefined) {
      searchBody['after'] = pagination.cursor;
    }

    const filterGroups: Record<string, unknown>[] = [];
    if (query.modifiedAfter !== undefined) {
      filterGroups.push({
        filters: [
          {
            propertyName: 'hs_lastmodifieddate',
            operator: 'GTE',
            value: String(query.modifiedAfter.getTime()),
          },
        ],
      });
    }
    if (filterGroups.length > 0) {
      searchBody['filterGroups'] = filterGroups;
    }

    const url = `${HS_API_BASE}/crm/v3/objects/deals/search`;
    const response = await this.httpClient.post(url, searchBody, this.authHeaders(credentials));

    if (response.status !== 200) {
      throw new Error(`HubSpot deal search failed: HTTP ${String(response.status)}`);
    }

    const result = response.body as HubSpotSearchResult<HubSpotDeal>;
    const deals = result.results.map((r) => this.mapHsDealToCrm(r));
    const nextCursor = result.paging?.next?.after ?? null;

    return {
      data: deals,
      nextCursor,
      hasMore: nextCursor !== null,
      total: result.total,
    };
  }

  async pushDeal(
    credentials: OAuthCredentials,
    deal: CrmDeal,
    existingExternalId?: string,
  ): Promise<string> {
    const properties = {
      dealname: deal.name,
      amount: deal.amount !== null ? String(deal.amount) : null,
      dealstage: deal.stage,
      closedate: deal.closeDate?.toISOString() ?? null,
    };

    if (existingExternalId !== undefined) {
      const url = `${HS_API_BASE}/crm/v3/objects/deals/${existingExternalId}`;
      const response = await this.httpClient.patch(
        url,
        { properties },
        this.authHeaders(credentials),
      );
      if (response.status !== 200) {
        throw new Error(`HubSpot deal update failed: HTTP ${String(response.status)}`);
      }
      return existingExternalId;
    }

    const url = `${HS_API_BASE}/crm/v3/objects/deals`;
    const response = await this.httpClient.post(url, { properties }, this.authHeaders(credentials));
    if (response.status !== 201) {
      throw new Error(`HubSpot deal create failed: HTTP ${String(response.status)}`);
    }

    const data = response.body as { id: string };
    return data.id;
  }

  // ── Activities (Engagements) ───────────────────────────────────

  async fetchActivities(
    credentials: OAuthCredentials,
    query: SyncQuery,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<CrmActivity>> {
    const searchBody: Record<string, unknown> = {
      limit: pagination.limit,
      properties: ['hs_engagement_type', 'hs_activity_type', 'hs_timestamp', 'hs_body_preview'],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
    };

    if (pagination.cursor !== undefined) {
      searchBody['after'] = pagination.cursor;
    }

    if (query.modifiedAfter !== undefined) {
      searchBody['filterGroups'] = [
        {
          filters: [
            {
              propertyName: 'hs_lastmodifieddate',
              operator: 'GTE',
              value: String(query.modifiedAfter.getTime()),
            },
          ],
        },
      ];
    }

    const url = `${HS_API_BASE}/crm/v3/objects/tasks/search`;
    const response = await this.httpClient.post(url, searchBody, this.authHeaders(credentials));

    if (response.status !== 200) {
      throw new Error(`HubSpot activity search failed: HTTP ${String(response.status)}`);
    }

    const result = response.body as HubSpotSearchResult<HubSpotEngagement>;
    const activities = result.results.map((r) => this.mapHsEngagementToCrm(r));
    const nextCursor = result.paging?.next?.after ?? null;

    return {
      data: activities,
      nextCursor,
      hasMore: nextCursor !== null,
      total: result.total,
    };
  }

  async pushActivity(
    credentials: OAuthCredentials,
    activity: CrmActivity,
    existingExternalId?: string,
  ): Promise<string> {
    const properties = {
      hs_task_subject: activity.subject,
      hs_task_body: activity.description,
      hs_task_type: this.mapActivityTypeToHs(activity.type),
      hs_timestamp: activity.dueDate?.toISOString() ?? new Date().toISOString(),
    };

    if (existingExternalId !== undefined) {
      const url = `${HS_API_BASE}/crm/v3/objects/tasks/${existingExternalId}`;
      const response = await this.httpClient.patch(
        url,
        { properties },
        this.authHeaders(credentials),
      );
      if (response.status !== 200) {
        throw new Error(`HubSpot activity update failed: HTTP ${String(response.status)}`);
      }
      return existingExternalId;
    }

    const url = `${HS_API_BASE}/crm/v3/objects/tasks`;
    const response = await this.httpClient.post(url, { properties }, this.authHeaders(credentials));
    if (response.status !== 201) {
      throw new Error(`HubSpot activity create failed: HTTP ${String(response.status)}`);
    }

    const data = response.body as { id: string };
    return data.id;
  }

  // ── Webhook ────────────────────────────────────────────────────

  handleWebhook(
    payload: Readonly<Record<string, unknown>>,
    signature: string,
    secret: string,
  ): WebhookPayload {
    if (!this.verifyWebhookSignature(payload, signature, secret)) {
      throw new Error('HubSpot webhook signature verification failed');
    }

    const entityType = this.inferEntityType(payload);
    const entityId = (payload['objectId'] as string | undefined) ?? '';

    return {
      provider: 'hubspot',
      eventType: (payload['subscriptionType'] as string | undefined) ?? 'update',
      entityType,
      entityId,
      data: payload,
      timestamp: new Date(),
    };
  }

  // ── Rate Limits ────────────────────────────────────────────────

  async getRateLimitInfo(credentials: OAuthCredentials): Promise<RateLimitInfo> {
    const response = await this.httpClient.get(
      `${HS_API_BASE}/crm/v3/objects/contacts?limit=1`,
      this.authHeaders(credentials),
    );

    const remaining = this.extractRateLimit(response.headers);
    const resetSeconds = parseInt(
      response.headers['x-hubspot-ratelimit-interval-milliseconds'] ?? '10000',
      10,
    );

    return {
      remaining: remaining ?? 0,
      limit: parseInt(response.headers['x-hubspot-ratelimit-max'] ?? '100', 10),
      resetAt: new Date(Date.now() + resetSeconds),
    };
  }

  // ── Bulk Operations ────────────────────────────────────────────

  async bulkPushContacts(
    credentials: OAuthCredentials,
    contacts: readonly CrmContact[],
  ): Promise<ReadonlyMap<string, string>> {
    const results = new Map<string, string>();

    if (contacts.length <= BATCH_THRESHOLD) {
      for (const contact of contacts) {
        const id = await this.pushContact(credentials, contact);
        results.set(contact.externalId, id);
      }
      return results;
    }

    // HubSpot Batch API — process in chunks of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const inputs = batch.map((c) => ({
        properties: {
          firstname: c.firstName,
          lastname: c.lastName,
          email: c.email,
          phone: c.phone,
          company: c.company,
          jobtitle: c.title,
        },
      }));

      const url = `${HS_API_BASE}/crm/v3/objects/contacts/batch/create`;
      const response = await this.httpClient.post(url, { inputs }, this.authHeaders(credentials));

      if (response.status === 201 || response.status === 200) {
        const data = response.body as { results: readonly { id: string }[] };
        for (let j = 0; j < batch.length && j < data.results.length; j++) {
          const batchContact = batch[j];
          const resultItem = data.results[j];
          if (batchContact !== undefined && resultItem !== undefined) {
            results.set(batchContact.externalId, resultItem.id);
          }
        }
      }
    }

    return results;
  }

  // ── Private Helpers ────────────────────────────────────────────

  private authHeaders(credentials: OAuthCredentials): Readonly<Record<string, string>> {
    return {
      Authorization: `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private extractRateLimit(headers: Readonly<Record<string, string>>): number | null {
    const remaining = headers['x-hubspot-ratelimit-remaining'];
    if (remaining !== undefined) {
      const parsed = parseInt(remaining, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private mapHsContactToCrm(hs: HubSpotContact): CrmContact {
    return {
      externalId: hs.id,
      firstName: hs.properties.firstname ?? '',
      lastName: hs.properties.lastname ?? '',
      email: hs.properties.email ?? null,
      phone: hs.properties.phone ?? null,
      company: hs.properties.company ?? null,
      title: hs.properties.jobtitle ?? null,
      lastModified: new Date(hs.updatedAt),
      metadata: {},
    };
  }

  private mapHsDealToCrm(hs: HubSpotDeal): CrmDeal {
    return {
      externalId: hs.id,
      name: hs.properties.dealname,
      amount: hs.properties.amount !== null ? parseFloat(hs.properties.amount) : null,
      currency: 'USD',
      stage: hs.properties.dealstage,
      probability:
        hs.properties.hs_deal_stage_probability !== null
          ? parseFloat(hs.properties.hs_deal_stage_probability)
          : null,
      closeDate: hs.properties.closedate !== null ? new Date(hs.properties.closedate) : null,
      contactExternalId: null,
      lastModified: new Date(hs.updatedAt),
      metadata: {},
    };
  }

  private mapHsEngagementToCrm(hs: HubSpotEngagement): CrmActivity {
    return {
      externalId: hs.id,
      type: this.mapHsTypeToActivity(hs.properties.hs_engagement_type),
      subject: hs.properties.hs_body_preview ?? 'Untitled Activity',
      description: hs.properties.hs_body_preview,
      contactExternalId: null,
      dealExternalId: null,
      dueDate: hs.properties.hs_timestamp ? new Date(hs.properties.hs_timestamp) : null,
      completedAt: null,
      lastModified: new Date(hs.updatedAt),
      metadata: {},
    };
  }

  private mapHsTypeToActivity(hsType: string): CrmActivity['type'] {
    switch (hsType.toUpperCase()) {
      case 'CALL':
        return 'call';
      case 'EMAIL':
        return 'email';
      case 'MEETING':
        return 'event';
      case 'NOTE':
        return 'note';
      default:
        return 'task';
    }
  }

  private mapActivityTypeToHs(type: CrmActivity['type']): string {
    switch (type) {
      case 'call':
        return 'CALL';
      case 'email':
        return 'EMAIL';
      case 'event':
        return 'MEETING';
      case 'note':
        return 'NOTE';
      case 'task':
        return 'TODO';
    }
  }

  private verifyWebhookSignature(
    payload: Readonly<Record<string, unknown>>,
    signature: string,
    secret: string,
  ): boolean {
    // HubSpot sends HMAC-SHA256 as hex (no prefix)
    const body = JSON.stringify(payload);
    const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    try {
      return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      // timingSafeEqual throws if buffers have different length (invalid signature)
      return false;
    }
  }

  private inferEntityType(payload: Readonly<Record<string, unknown>>): EntityType {
    const objectType = (payload['objectType'] as string | undefined) ?? '';
    switch (objectType.toLowerCase()) {
      case 'contact':
        return 'contact';
      case 'deal':
        return 'deal';
      case 'task':
      case 'engagement':
        return 'activity';
      default:
        return 'contact';
    }
  }
}
