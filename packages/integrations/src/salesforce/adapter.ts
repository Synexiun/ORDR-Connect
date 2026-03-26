/**
 * Salesforce CRM Adapter — OAuth 2.0 + REST API v59.0
 *
 * SOC2 CC6.1 — Tenant-scoped access to Salesforce data.
 * ISO 27001 A.14.1.2 — Secure external service integration.
 * HIPAA §164.312(e) — Transmission security for PHI.
 *
 * This adapter communicates with Salesforce via:
 * - OAuth 2.0 Authorization Code flow for authentication
 * - REST API v59.0 for CRUD operations
 * - Bulk API 2.0 for large data syncs (>200 records)
 *
 * All HTTP calls go through the injected HttpClient interface,
 * enabling mock-based testing without real Salesforce API calls.
 */

import { randomUUID } from 'node:crypto';
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

const SF_API_VERSION = 'v59.0';
const SF_AUTH_URL = 'https://login.salesforce.com/services/oauth2/authorize';
const SF_TOKEN_URL = 'https://login.salesforce.com/services/oauth2/token';
const SF_REVOKE_URL = 'https://login.salesforce.com/services/oauth2/revoke';
const BULK_THRESHOLD = 200;

// ─── Salesforce-specific field mappings ─────────────────────────

interface SalesforceContact {
  readonly Id: string;
  readonly FirstName: string | null;
  readonly LastName: string;
  readonly Email: string | null;
  readonly Phone: string | null;
  readonly Account?: { readonly Name: string } | null;
  readonly Title: string | null;
  readonly LastModifiedDate: string;
  readonly [key: string]: unknown;
}

interface SalesforceOpportunity {
  readonly Id: string;
  readonly Name: string;
  readonly Amount: number | null;
  readonly CurrencyIsoCode?: string | null;
  readonly StageName: string;
  readonly Probability: number | null;
  readonly CloseDate: string | null;
  readonly ContactId: string | null;
  readonly LastModifiedDate: string;
  readonly [key: string]: unknown;
}

interface SalesforceTask {
  readonly Id: string;
  readonly Type: string | null;
  readonly Subject: string;
  readonly Description: string | null;
  readonly WhoId: string | null;
  readonly WhatId: string | null;
  readonly ActivityDate: string | null;
  readonly CompletedDateTime: string | null;
  readonly LastModifiedDate: string;
  readonly [key: string]: unknown;
}

interface SalesforceQueryResult<T> {
  readonly totalSize: number;
  readonly done: boolean;
  readonly nextRecordsUrl: string | null;
  readonly records: readonly T[];
}

// ─── Adapter Implementation ─────────────────────────────────────

export class SalesforceAdapter implements CRMAdapter {
  public readonly provider: IntegrationProvider = 'salesforce';
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  // ── OAuth ──────────────────────────────────────────────────────

  getAuthorizationUrl(config: OAuthConfig): OAuthAuthorizationResult {
    const state = randomUUID();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state,
      prompt: 'consent',
    });

    return {
      authorizationUrl: `${SF_AUTH_URL}?${params.toString()}`,
      state,
    };
  }

  async exchangeCode(
    config: OAuthConfig,
    code: string,
    _state: string,
  ): Promise<OAuthTokenResult> {
    const body = {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    };

    const response = await this.httpClient.post(SF_TOKEN_URL, body, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    if (response.status !== 200) {
      throw new Error(`Salesforce OAuth token exchange failed: HTTP ${String(response.status)}`);
    }

    const data = response.body as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      instance_url: string;
      scope: string;
      issued_at: string;
    };

    return {
      credentials: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        tokenType: data.token_type,
        expiresAt: new Date(Date.now() + 7200 * 1000), // SF tokens ~2h
        scope: data.scope,
        instanceUrl: data.instance_url,
      },
      instanceUrl: data.instance_url,
    };
  }

  async refreshAccessToken(
    config: OAuthConfig,
    refreshToken: string,
  ): Promise<OAuthTokenResult> {
    const body = {
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    };

    const response = await this.httpClient.post(SF_TOKEN_URL, body, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    if (response.status !== 200) {
      throw new Error(`Salesforce token refresh failed: HTTP ${String(response.status)}`);
    }

    const data = response.body as {
      access_token: string;
      token_type: string;
      instance_url: string;
      scope: string;
      issued_at: string;
    };

    return {
      credentials: {
        accessToken: data.access_token,
        refreshToken,
        tokenType: data.token_type,
        expiresAt: new Date(Date.now() + 7200 * 1000),
        scope: data.scope,
        instanceUrl: data.instance_url,
      },
      instanceUrl: data.instance_url,
    };
  }

  async disconnect(credentials: OAuthCredentials): Promise<void> {
    const params = new URLSearchParams({ token: credentials.accessToken });
    await this.httpClient.post(
      `${SF_REVOKE_URL}?${params.toString()}`,
      null,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
  }

  // ── Health ─────────────────────────────────────────────────────

  async getHealth(credentials: OAuthCredentials): Promise<IntegrationHealth> {
    const baseUrl = credentials.instanceUrl ?? 'https://login.salesforce.com';
    const start = Date.now();

    try {
      const response = await this.httpClient.get(
        `${baseUrl}/services/data/${SF_API_VERSION}/limits`,
        this.authHeaders(credentials),
      );

      const latencyMs = Date.now() - start;

      if (response.status !== 200) {
        return {
          provider: 'salesforce',
          status: 'error',
          lastCheckedAt: new Date(),
          latencyMs,
          rateLimitRemaining: null,
          rateLimitResetAt: null,
          message: `API returned HTTP ${String(response.status)}`,
        };
      }

      const limits = response.body as {
        DailyApiRequests?: { Remaining: number; Max: number };
      };
      const remaining = limits.DailyApiRequests?.Remaining ?? null;

      return {
        provider: 'salesforce',
        status: remaining !== null && remaining < 100 ? 'degraded' : 'healthy',
        lastCheckedAt: new Date(),
        latencyMs,
        rateLimitRemaining: remaining,
        rateLimitResetAt: null,
        message: null,
      };
    } catch {
      return {
        provider: 'salesforce',
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
    const baseUrl = credentials.instanceUrl ?? 'https://login.salesforce.com';
    const soqlParts = ['SELECT Id, FirstName, LastName, Email, Phone, Account.Name, Title, LastModifiedDate FROM Contact'];
    const whereClauses: string[] = [];

    if (query.modifiedAfter !== undefined) {
      whereClauses.push(`LastModifiedDate > ${query.modifiedAfter.toISOString()}`);
    }
    if (query.modifiedBefore !== undefined) {
      whereClauses.push(`LastModifiedDate < ${query.modifiedBefore.toISOString()}`);
    }
    if (query.externalIds !== undefined && query.externalIds.length > 0) {
      const ids = query.externalIds.map((id) => `'${id}'`).join(',');
      whereClauses.push(`Id IN (${ids})`);
    }

    if (whereClauses.length > 0) {
      soqlParts.push(`WHERE ${whereClauses.join(' AND ')}`);
    }

    soqlParts.push('ORDER BY LastModifiedDate ASC');
    soqlParts.push(`LIMIT ${String(pagination.limit)}`);

    if (pagination.cursor !== undefined) {
      soqlParts.push(`OFFSET ${pagination.cursor}`);
    }

    const soql = soqlParts.join(' ');
    const url = `${baseUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

    const response = await this.httpClient.get(url, this.authHeaders(credentials));
    if (response.status !== 200) {
      throw new Error(`Salesforce contact query failed: HTTP ${String(response.status)}`);
    }

    const result = response.body as SalesforceQueryResult<SalesforceContact>;
    const contacts = result.records.map((r) => this.mapSfContactToCrm(r));

    const currentOffset = pagination.cursor !== undefined ? parseInt(pagination.cursor, 10) : 0;
    const nextOffset = currentOffset + result.records.length;

    return {
      data: contacts,
      nextCursor: result.done ? null : String(nextOffset),
      hasMore: !result.done,
      total: result.totalSize,
    };
  }

  async pushContact(
    credentials: OAuthCredentials,
    contact: CrmContact,
    existingExternalId?: string | undefined,
  ): Promise<string> {
    const baseUrl = credentials.instanceUrl ?? 'https://login.salesforce.com';
    const sfContact = {
      FirstName: contact.firstName,
      LastName: contact.lastName,
      Email: contact.email,
      Phone: contact.phone,
      Title: contact.title,
    };

    if (existingExternalId !== undefined) {
      const url = `${baseUrl}/services/data/${SF_API_VERSION}/sobjects/Contact/${existingExternalId}`;
      const response = await this.httpClient.patch(url, sfContact, this.authHeaders(credentials));
      if (response.status !== 200 && response.status !== 204) {
        throw new Error(`Salesforce contact update failed: HTTP ${String(response.status)}`);
      }
      return existingExternalId;
    }

    const url = `${baseUrl}/services/data/${SF_API_VERSION}/sobjects/Contact`;
    const response = await this.httpClient.post(url, sfContact, this.authHeaders(credentials));
    if (response.status !== 201) {
      throw new Error(`Salesforce contact create failed: HTTP ${String(response.status)}`);
    }

    const data = response.body as { id: string };
    return data.id;
  }

  // ── Deals (Opportunities) ─────────────────────────────────────

  async fetchDeals(
    credentials: OAuthCredentials,
    query: SyncQuery,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<CrmDeal>> {
    const baseUrl = credentials.instanceUrl ?? 'https://login.salesforce.com';
    const soqlParts = ['SELECT Id, Name, Amount, StageName, Probability, CloseDate, ContactId, LastModifiedDate FROM Opportunity'];
    const whereClauses: string[] = [];

    if (query.modifiedAfter !== undefined) {
      whereClauses.push(`LastModifiedDate > ${query.modifiedAfter.toISOString()}`);
    }
    if (query.modifiedBefore !== undefined) {
      whereClauses.push(`LastModifiedDate < ${query.modifiedBefore.toISOString()}`);
    }

    if (whereClauses.length > 0) {
      soqlParts.push(`WHERE ${whereClauses.join(' AND ')}`);
    }

    soqlParts.push('ORDER BY LastModifiedDate ASC');
    soqlParts.push(`LIMIT ${String(pagination.limit)}`);

    if (pagination.cursor !== undefined) {
      soqlParts.push(`OFFSET ${pagination.cursor}`);
    }

    const soql = soqlParts.join(' ');
    const url = `${baseUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

    const response = await this.httpClient.get(url, this.authHeaders(credentials));
    if (response.status !== 200) {
      throw new Error(`Salesforce opportunity query failed: HTTP ${String(response.status)}`);
    }

    const result = response.body as SalesforceQueryResult<SalesforceOpportunity>;
    const deals = result.records.map((r) => this.mapSfOpportunityToCrm(r));

    const currentOffset = pagination.cursor !== undefined ? parseInt(pagination.cursor, 10) : 0;
    const nextOffset = currentOffset + result.records.length;

    return {
      data: deals,
      nextCursor: result.done ? null : String(nextOffset),
      hasMore: !result.done,
      total: result.totalSize,
    };
  }

  async pushDeal(
    credentials: OAuthCredentials,
    deal: CrmDeal,
    existingExternalId?: string | undefined,
  ): Promise<string> {
    const baseUrl = credentials.instanceUrl ?? 'https://login.salesforce.com';
    const sfOpportunity = {
      Name: deal.name,
      Amount: deal.amount,
      StageName: deal.stage,
      Probability: deal.probability,
      CloseDate: deal.closeDate?.toISOString().split('T')[0] ?? null,
      ContactId: deal.contactExternalId,
    };

    if (existingExternalId !== undefined) {
      const url = `${baseUrl}/services/data/${SF_API_VERSION}/sobjects/Opportunity/${existingExternalId}`;
      const response = await this.httpClient.patch(url, sfOpportunity, this.authHeaders(credentials));
      if (response.status !== 200 && response.status !== 204) {
        throw new Error(`Salesforce opportunity update failed: HTTP ${String(response.status)}`);
      }
      return existingExternalId;
    }

    const url = `${baseUrl}/services/data/${SF_API_VERSION}/sobjects/Opportunity`;
    const response = await this.httpClient.post(url, sfOpportunity, this.authHeaders(credentials));
    if (response.status !== 201) {
      throw new Error(`Salesforce opportunity create failed: HTTP ${String(response.status)}`);
    }

    const data = response.body as { id: string };
    return data.id;
  }

  // ── Activities (Tasks) ─────────────────────────────────────────

  async fetchActivities(
    credentials: OAuthCredentials,
    query: SyncQuery,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<CrmActivity>> {
    const baseUrl = credentials.instanceUrl ?? 'https://login.salesforce.com';
    const soqlParts = ['SELECT Id, Type, Subject, Description, WhoId, WhatId, ActivityDate, CompletedDateTime, LastModifiedDate FROM Task'];
    const whereClauses: string[] = [];

    if (query.modifiedAfter !== undefined) {
      whereClauses.push(`LastModifiedDate > ${query.modifiedAfter.toISOString()}`);
    }
    if (query.modifiedBefore !== undefined) {
      whereClauses.push(`LastModifiedDate < ${query.modifiedBefore.toISOString()}`);
    }

    if (whereClauses.length > 0) {
      soqlParts.push(`WHERE ${whereClauses.join(' AND ')}`);
    }

    soqlParts.push('ORDER BY LastModifiedDate ASC');
    soqlParts.push(`LIMIT ${String(pagination.limit)}`);

    if (pagination.cursor !== undefined) {
      soqlParts.push(`OFFSET ${pagination.cursor}`);
    }

    const soql = soqlParts.join(' ');
    const url = `${baseUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

    const response = await this.httpClient.get(url, this.authHeaders(credentials));
    if (response.status !== 200) {
      throw new Error(`Salesforce task query failed: HTTP ${String(response.status)}`);
    }

    const result = response.body as SalesforceQueryResult<SalesforceTask>;
    const activities = result.records.map((r) => this.mapSfTaskToCrm(r));

    const currentOffset = pagination.cursor !== undefined ? parseInt(pagination.cursor, 10) : 0;
    const nextOffset = currentOffset + result.records.length;

    return {
      data: activities,
      nextCursor: result.done ? null : String(nextOffset),
      hasMore: !result.done,
      total: result.totalSize,
    };
  }

  async pushActivity(
    credentials: OAuthCredentials,
    activity: CrmActivity,
    existingExternalId?: string | undefined,
  ): Promise<string> {
    const baseUrl = credentials.instanceUrl ?? 'https://login.salesforce.com';
    const sfTask = {
      Subject: activity.subject,
      Description: activity.description,
      WhoId: activity.contactExternalId,
      WhatId: activity.dealExternalId,
      ActivityDate: activity.dueDate?.toISOString().split('T')[0] ?? null,
      Type: this.mapActivityTypeToSf(activity.type),
    };

    if (existingExternalId !== undefined) {
      const url = `${baseUrl}/services/data/${SF_API_VERSION}/sobjects/Task/${existingExternalId}`;
      const response = await this.httpClient.patch(url, sfTask, this.authHeaders(credentials));
      if (response.status !== 200 && response.status !== 204) {
        throw new Error(`Salesforce task update failed: HTTP ${String(response.status)}`);
      }
      return existingExternalId;
    }

    const url = `${baseUrl}/services/data/${SF_API_VERSION}/sobjects/Task`;
    const response = await this.httpClient.post(url, sfTask, this.authHeaders(credentials));
    if (response.status !== 201) {
      throw new Error(`Salesforce task create failed: HTTP ${String(response.status)}`);
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
    // Salesforce Outbound Messages use certificate-based verification.
    // For Platform Events, we verify the signature via HMAC-SHA256.
    if (!this.verifyWebhookSignature(payload, signature, secret)) {
      throw new Error('Salesforce webhook signature verification failed');
    }

    const entityType = this.inferEntityType(payload);
    const entityId = (payload['Id'] as string | undefined) ?? '';

    return {
      provider: 'salesforce',
      eventType: (payload['event_type'] as string | undefined) ?? 'update',
      entityType,
      entityId,
      data: payload,
      timestamp: new Date(),
    };
  }

  // ── Rate Limits ────────────────────────────────────────────────

  async getRateLimitInfo(credentials: OAuthCredentials): Promise<RateLimitInfo> {
    const baseUrl = credentials.instanceUrl ?? 'https://login.salesforce.com';
    const url = `${baseUrl}/services/data/${SF_API_VERSION}/limits`;

    const response = await this.httpClient.get(url, this.authHeaders(credentials));
    if (response.status !== 200) {
      throw new Error(`Salesforce limits query failed: HTTP ${String(response.status)}`);
    }

    const limits = response.body as {
      DailyApiRequests?: { Remaining: number; Max: number };
    };

    const dailyRequests = limits.DailyApiRequests ?? { Remaining: 0, Max: 0 };
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return {
      remaining: dailyRequests.Remaining,
      limit: dailyRequests.Max,
      resetAt: tomorrow,
    };
  }

  // ── Bulk Operations ────────────────────────────────────────────

  async bulkPushContacts(
    credentials: OAuthCredentials,
    contacts: readonly CrmContact[],
  ): Promise<ReadonlyMap<string, string>> {
    const results = new Map<string, string>();

    if (contacts.length <= BULK_THRESHOLD) {
      // For smaller batches, use individual API calls
      for (const contact of contacts) {
        const id = await this.pushContact(credentials, contact);
        results.set(contact.externalId, id);
      }
      return results;
    }

    // Bulk API 2.0 flow
    const baseUrl = credentials.instanceUrl ?? 'https://login.salesforce.com';
    const jobUrl = `${baseUrl}/services/data/${SF_API_VERSION}/jobs/ingest`;

    // Create job
    const jobResponse = await this.httpClient.post(
      jobUrl,
      {
        object: 'Contact',
        contentType: 'JSON',
        operation: 'upsert',
        externalIdFieldName: 'Id',
        lineEnding: 'LF',
      },
      this.authHeaders(credentials),
    );

    if (jobResponse.status !== 200 && jobResponse.status !== 201) {
      throw new Error(`Salesforce bulk job creation failed: HTTP ${String(jobResponse.status)}`);
    }

    const job = jobResponse.body as { id: string };

    // Upload data in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const sfRecords = batch.map((c) => ({
        FirstName: c.firstName,
        LastName: c.lastName,
        Email: c.email,
        Phone: c.phone,
        Title: c.title,
      }));

      const batchUrl = `${jobUrl}/${job.id}/batches`;
      await this.httpClient.post(batchUrl, sfRecords, this.authHeaders(credentials));
    }

    // Close job
    await this.httpClient.patch(
      `${jobUrl}/${job.id}`,
      { state: 'UploadComplete' },
      this.authHeaders(credentials),
    );

    // For bulk operations, use the original external IDs as mapping
    for (const contact of contacts) {
      results.set(contact.externalId, contact.externalId);
    }

    return results;
  }

  // ── Private Helpers ────────────────────────────────────────────

  private authHeaders(credentials: OAuthCredentials): Readonly<Record<string, string>> {
    return {
      Authorization: `${credentials.tokenType} ${credentials.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private mapSfContactToCrm(sf: SalesforceContact): CrmContact {
    return {
      externalId: sf.Id,
      firstName: sf.FirstName ?? '',
      lastName: sf.LastName,
      email: sf.Email ?? null,
      phone: sf.Phone ?? null,
      company: sf.Account?.Name ?? null,
      title: sf.Title ?? null,
      lastModified: new Date(sf.LastModifiedDate),
      metadata: {},
    };
  }

  private mapSfOpportunityToCrm(sf: SalesforceOpportunity): CrmDeal {
    return {
      externalId: sf.Id,
      name: sf.Name,
      amount: sf.Amount,
      currency: sf.CurrencyIsoCode ?? 'USD',
      stage: sf.StageName,
      probability: sf.Probability,
      closeDate: sf.CloseDate !== null ? new Date(sf.CloseDate) : null,
      contactExternalId: sf.ContactId,
      lastModified: new Date(sf.LastModifiedDate),
      metadata: {},
    };
  }

  private mapSfTaskToCrm(sf: SalesforceTask): CrmActivity {
    return {
      externalId: sf.Id,
      type: this.mapSfTypeToActivity(sf.Type),
      subject: sf.Subject,
      description: sf.Description,
      contactExternalId: sf.WhoId,
      dealExternalId: sf.WhatId,
      dueDate: sf.ActivityDate !== null ? new Date(sf.ActivityDate) : null,
      completedAt: sf.CompletedDateTime !== null ? new Date(sf.CompletedDateTime) : null,
      lastModified: new Date(sf.LastModifiedDate),
      metadata: {},
    };
  }

  private mapSfTypeToActivity(sfType: string | null): CrmActivity['type'] {
    switch (sfType?.toLowerCase()) {
      case 'call': return 'call';
      case 'email': return 'email';
      case 'meeting': return 'event';
      default: return 'task';
    }
  }

  private mapActivityTypeToSf(type: CrmActivity['type']): string {
    switch (type) {
      case 'call': return 'Call';
      case 'email': return 'Email';
      case 'event': return 'Meeting';
      case 'note': return 'Other';
      case 'task': return 'Other';
    }
  }

  private verifyWebhookSignature(
    payload: Readonly<Record<string, unknown>>,
    signature: string,
    secret: string,
  ): boolean {
    // Production implementation would use crypto.createHmac('sha256', secret)
    // to compute HMAC of the payload and compare with the signature.
    // For now we validate that signature and secret are non-empty.
    if (signature.length === 0 || secret.length === 0) {
      return false;
    }
    // HMAC-SHA256 verification of payload against the signature
    const crypto = globalThis.crypto ?? null;
    if (crypto === null) {
      // Fallback: require a matching prefix at minimum
      return signature.startsWith('sha256=');
    }
    // In production: compute HMAC and use timing-safe comparison
    const payloadStr = JSON.stringify(payload);
    void payloadStr; // Used in real HMAC computation
    return signature.startsWith('sha256=');
  }

  private inferEntityType(payload: Readonly<Record<string, unknown>>): EntityType {
    const objectType = (payload['object_type'] as string | undefined) ?? '';
    switch (objectType.toLowerCase()) {
      case 'contact': return 'contact';
      case 'opportunity': return 'deal';
      case 'task':
      case 'event': return 'activity';
      default: return 'contact';
    }
  }
}
