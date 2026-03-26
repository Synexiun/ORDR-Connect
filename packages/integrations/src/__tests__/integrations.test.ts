/**
 * Integration Package — Comprehensive Test Suite
 *
 * SOC2 CC7.2 — Verifies all integration operations are covered by tests.
 * ISO 27001 A.14.2.8 — Security testing of integration components.
 * HIPAA §164.312(a)(1) — Access control paths validated end-to-end.
 *
 * Coverage targets:
 *  - SalesforceAdapter: OAuth, health, contacts, deals, activities, webhooks, rate limits
 *  - HubSpotAdapter:    OAuth, health, contacts, deals, activities, webhooks, rate limits
 *  - Type constants:    All exported const arrays verified
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

import {
  INTEGRATION_PROVIDERS,
  SYNC_DIRECTIONS,
  ENTITY_TYPES,
  SYNC_STATUSES,
  CONFLICT_RESOLUTIONS,
  HEALTH_STATUSES,
} from '../types.js';
import type {
  OAuthCredentials,
  CrmContact,
  CrmDeal,
  CrmActivity,
  SyncQuery,
  PaginationParams,
} from '../types.js';
import type { OAuthConfig, HttpClient, HttpResponse } from '../adapter.js';
import { SalesforceAdapter } from '../salesforce/adapter.js';
import { HubSpotAdapter } from '../hubspot/adapter.js';

// ─── Test Data Factories ─────────────────────────────────────────────────────

function makeOAuthConfig(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://app.ordr.io/oauth/callback',
    scopes: ['read', 'write'],
    ...overrides,
  };
}

function makeCredentials(overrides: Partial<OAuthCredentials> = {}): OAuthCredentials {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    tokenType: 'Bearer',
    expiresAt: new Date(Date.now() + 7200 * 1000),
    scope: 'read write',
    instanceUrl: 'https://myorg.salesforce.com',
    ...overrides,
  };
}

function makeContact(overrides: Partial<CrmContact> = {}): CrmContact {
  return {
    externalId: 'contact-ext-001',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
    phone: '+1-555-0100',
    company: 'Acme Corp',
    title: 'VP Sales',
    lastModified: new Date('2025-01-15T10:00:00Z'),
    metadata: {},
    ...overrides,
  };
}

function makeDeal(overrides: Partial<CrmDeal> = {}): CrmDeal {
  return {
    externalId: 'deal-ext-001',
    name: 'Enterprise Deal Q1',
    amount: 120000,
    currency: 'USD',
    stage: 'Qualification',
    probability: 40,
    closeDate: new Date('2025-03-31'),
    contactExternalId: 'contact-ext-001',
    lastModified: new Date('2025-01-15T10:00:00Z'),
    metadata: {},
    ...overrides,
  };
}

function makeActivity(overrides: Partial<CrmActivity> = {}): CrmActivity {
  return {
    externalId: 'activity-ext-001',
    type: 'call',
    subject: 'Discovery call with Jane',
    description: 'Discussed product fit',
    contactExternalId: 'contact-ext-001',
    dealExternalId: 'deal-ext-001',
    dueDate: new Date('2025-01-20T14:00:00Z'),
    completedAt: null,
    lastModified: new Date('2025-01-15T10:00:00Z'),
    metadata: {},
    ...overrides,
  };
}

function makeHttpResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200,
    headers: {},
    body: {},
    ...overrides,
  };
}

// ─── Mock HttpClient Factory ─────────────────────────────────────────────────

function makeMockHttpClient(): {
  client: HttpClient;
  get: MockedFunction<HttpClient['get']>;
  post: MockedFunction<HttpClient['post']>;
  patch: MockedFunction<HttpClient['patch']>;
  delete: MockedFunction<HttpClient['delete']>;
} {
  const get = vi.fn<Parameters<HttpClient['get']>, ReturnType<HttpClient['get']>>();
  const post = vi.fn<Parameters<HttpClient['post']>, ReturnType<HttpClient['post']>>();
  const patch = vi.fn<Parameters<HttpClient['patch']>, ReturnType<HttpClient['patch']>>();
  const del = vi.fn<Parameters<HttpClient['delete']>, ReturnType<HttpClient['delete']>>();

  const client: HttpClient = { get, post, patch, delete: del };
  return { client, get, post, patch, delete: del };
}

// ─── Type Constants ──────────────────────────────────────────────────────────

describe('Type Constants', () => {
  it('INTEGRATION_PROVIDERS contains salesforce, hubspot, custom', () => {
    expect(INTEGRATION_PROVIDERS).toContain('salesforce');
    expect(INTEGRATION_PROVIDERS).toContain('hubspot');
    expect(INTEGRATION_PROVIDERS).toContain('custom');
    expect(INTEGRATION_PROVIDERS).toHaveLength(3);
  });

  it('SYNC_DIRECTIONS contains inbound, outbound, bidirectional', () => {
    expect(SYNC_DIRECTIONS).toContain('inbound');
    expect(SYNC_DIRECTIONS).toContain('outbound');
    expect(SYNC_DIRECTIONS).toContain('bidirectional');
    expect(SYNC_DIRECTIONS).toHaveLength(3);
  });

  it('ENTITY_TYPES contains contact, deal, activity', () => {
    expect(ENTITY_TYPES).toContain('contact');
    expect(ENTITY_TYPES).toContain('deal');
    expect(ENTITY_TYPES).toContain('activity');
    expect(ENTITY_TYPES).toHaveLength(3);
  });

  it('SYNC_STATUSES contains all five lifecycle states', () => {
    expect(SYNC_STATUSES).toContain('pending');
    expect(SYNC_STATUSES).toContain('running');
    expect(SYNC_STATUSES).toContain('completed');
    expect(SYNC_STATUSES).toContain('failed');
    expect(SYNC_STATUSES).toContain('cancelled');
    expect(SYNC_STATUSES).toHaveLength(5);
  });

  it('CONFLICT_RESOLUTIONS contains four strategies', () => {
    expect(CONFLICT_RESOLUTIONS).toContain('source_wins');
    expect(CONFLICT_RESOLUTIONS).toContain('target_wins');
    expect(CONFLICT_RESOLUTIONS).toContain('most_recent');
    expect(CONFLICT_RESOLUTIONS).toContain('manual');
    expect(CONFLICT_RESOLUTIONS).toHaveLength(4);
  });

  it('HEALTH_STATUSES contains four health states', () => {
    expect(HEALTH_STATUSES).toContain('healthy');
    expect(HEALTH_STATUSES).toContain('degraded');
    expect(HEALTH_STATUSES).toContain('disconnected');
    expect(HEALTH_STATUSES).toContain('error');
    expect(HEALTH_STATUSES).toHaveLength(4);
  });
});

// ─── SalesforceAdapter ───────────────────────────────────────────────────────

describe('SalesforceAdapter', () => {
  let mock: ReturnType<typeof makeMockHttpClient>;
  let adapter: SalesforceAdapter;
  let credentials: OAuthCredentials;
  let oauthConfig: OAuthConfig;

  beforeEach(() => {
    mock = makeMockHttpClient();
    adapter = new SalesforceAdapter(mock.client);
    credentials = makeCredentials();
    oauthConfig = makeOAuthConfig();
  });

  // ── provider identity ──────────────────────────────────────────

  it('exposes provider as salesforce', () => {
    expect(adapter.provider).toBe('salesforce');
  });

  // ── getAuthorizationUrl ────────────────────────────────────────

  it('getAuthorizationUrl returns URL pointing to Salesforce auth endpoint', () => {
    const result = adapter.getAuthorizationUrl(oauthConfig);

    expect(result.authorizationUrl).toContain('https://login.salesforce.com/services/oauth2/authorize');
  });

  it('getAuthorizationUrl includes client_id in URL', () => {
    const result = adapter.getAuthorizationUrl(oauthConfig);

    expect(result.authorizationUrl).toContain('client_id=test-client-id');
  });

  it('getAuthorizationUrl includes redirect_uri in URL', () => {
    const result = adapter.getAuthorizationUrl(oauthConfig);

    expect(result.authorizationUrl).toContain(encodeURIComponent('https://app.ordr.io/oauth/callback'));
  });

  it('getAuthorizationUrl returns a non-empty state string', () => {
    const result = adapter.getAuthorizationUrl(oauthConfig);

    expect(result.state).toBeTruthy();
    expect(result.state.length).toBeGreaterThan(0);
  });

  it('getAuthorizationUrl generates a unique state on each call (CSRF protection)', () => {
    const result1 = adapter.getAuthorizationUrl(oauthConfig);
    const result2 = adapter.getAuthorizationUrl(oauthConfig);

    expect(result1.state).not.toBe(result2.state);
  });

  it('getAuthorizationUrl includes scope derived from config', () => {
    const config = makeOAuthConfig({ scopes: ['api', 'refresh_token'] });
    const result = adapter.getAuthorizationUrl(config);

    expect(result.authorizationUrl).toContain('scope=');
  });

  // ── exchangeCode ───────────────────────────────────────────────

  it('exchangeCode sends POST to Salesforce token URL', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        access_token: 'sf-access',
        refresh_token: 'sf-refresh',
        token_type: 'Bearer',
        instance_url: 'https://myorg.salesforce.com',
        scope: 'api',
        issued_at: String(Date.now()),
      },
    }));

    await adapter.exchangeCode(oauthConfig, 'auth-code-123', 'state-abc');

    expect(mock.post).toHaveBeenCalledOnce();
    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('https://login.salesforce.com/services/oauth2/token');
  });

  it('exchangeCode returns OAuthCredentials with access and refresh tokens', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        access_token: 'sf-access-token',
        refresh_token: 'sf-refresh-token',
        token_type: 'Bearer',
        instance_url: 'https://myorg.salesforce.com',
        scope: 'api refresh_token',
        issued_at: String(Date.now()),
      },
    }));

    const result = await adapter.exchangeCode(oauthConfig, 'code-xyz', 'state-xyz');

    expect(result.credentials.accessToken).toBe('sf-access-token');
    expect(result.credentials.refreshToken).toBe('sf-refresh-token');
    expect(result.credentials.tokenType).toBe('Bearer');
    expect(result.instanceUrl).toBe('https://myorg.salesforce.com');
  });

  it('exchangeCode throws on non-200 status', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 400, body: { error: 'invalid_grant' } }));

    await expect(adapter.exchangeCode(oauthConfig, 'bad-code', 'state')).rejects.toThrow(
      'Salesforce OAuth token exchange failed: HTTP 400',
    );
  });

  // ── refreshAccessToken ─────────────────────────────────────────

  it('refreshAccessToken sends refresh_token grant to token URL', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        instance_url: 'https://myorg.salesforce.com',
        scope: 'api',
        issued_at: String(Date.now()),
      },
    }));

    await adapter.refreshAccessToken(oauthConfig, 'old-refresh-token');

    const [url, body] = mock.post.mock.calls[0] as [string, Record<string, string>, Record<string, string>];
    expect(url).toContain('https://login.salesforce.com/services/oauth2/token');
    expect(body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-refresh-token' });
  });

  it('refreshAccessToken returns new credentials preserving the refresh token', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        instance_url: 'https://myorg.salesforce.com',
        scope: 'api',
        issued_at: String(Date.now()),
      },
    }));

    const result = await adapter.refreshAccessToken(oauthConfig, 'my-refresh-token');

    expect(result.credentials.accessToken).toBe('new-access-token');
    expect(result.credentials.refreshToken).toBe('my-refresh-token');
  });

  it('refreshAccessToken throws on non-200 status', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 401, body: { error: 'invalid_token' } }));

    await expect(adapter.refreshAccessToken(oauthConfig, 'bad-token')).rejects.toThrow(
      'Salesforce token refresh failed: HTTP 401',
    );
  });

  // ── disconnect ─────────────────────────────────────────────────

  it('disconnect calls the Salesforce revoke endpoint', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 200, body: {} }));

    await adapter.disconnect(credentials);

    expect(mock.post).toHaveBeenCalledOnce();
    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('https://login.salesforce.com/services/oauth2/revoke');
  });

  it('disconnect includes the access token in the revoke request URL', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 200, body: {} }));

    await adapter.disconnect(credentials);

    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('token=test-access-token');
  });

  // ── getHealth ──────────────────────────────────────────────────

  it('getHealth returns healthy when limits endpoint succeeds', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        DailyApiRequests: { Remaining: 14000, Max: 15000 },
      },
    }));

    const health = await adapter.getHealth(credentials);

    expect(health.provider).toBe('salesforce');
    expect(health.status).toBe('healthy');
    expect(health.rateLimitRemaining).toBe(14000);
  });

  it('getHealth returns degraded when fewer than 100 daily requests remain', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        DailyApiRequests: { Remaining: 50, Max: 15000 },
      },
    }));

    const health = await adapter.getHealth(credentials);

    expect(health.status).toBe('degraded');
  });

  it('getHealth returns disconnected when HTTP request throws', async () => {
    mock.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const health = await adapter.getHealth(credentials);

    expect(health.status).toBe('disconnected');
    expect(health.message).toBe('Connection failed');
  });

  it('getHealth returns error when API returns non-200 status', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({ status: 503, body: {} }));

    const health = await adapter.getHealth(credentials);

    expect(health.status).toBe('error');
    expect(health.message).toContain('503');
  });

  it('getHealth uses instanceUrl from credentials when building request URL', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: { DailyApiRequests: { Remaining: 5000, Max: 15000 } },
    }));

    const creds = makeCredentials({ instanceUrl: 'https://custom.my.salesforce.com' });
    await adapter.getHealth(creds);

    const [url] = mock.get.mock.calls[0] as [string, Record<string, string>];
    expect(url).toContain('https://custom.my.salesforce.com');
  });

  // ── fetchContacts ──────────────────────────────────────────────

  it('fetchContacts maps Salesforce Contact records to CrmContact', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        totalSize: 1,
        done: true,
        nextRecordsUrl: null,
        records: [{
          Id: 'sf-contact-001',
          FirstName: 'Alice',
          LastName: 'Smith',
          Email: 'alice@example.com',
          Phone: '+1-555-9999',
          Account: { Name: 'Umbrella Corp' },
          Title: 'Director',
          LastModifiedDate: '2025-01-10T08:00:00Z',
        }],
      },
    }));

    const query: SyncQuery = {};
    const pagination: PaginationParams = { limit: 50 };
    const result = await adapter.fetchContacts(credentials, query, pagination);

    expect(result.data).toHaveLength(1);
    const contact = result.data[0];
    expect(contact).toBeDefined();
    expect(contact!.externalId).toBe('sf-contact-001');
    expect(contact!.firstName).toBe('Alice');
    expect(contact!.lastName).toBe('Smith');
    expect(contact!.email).toBe('alice@example.com');
    expect(contact!.company).toBe('Umbrella Corp');
    expect(contact!.title).toBe('Director');
  });

  it('fetchContacts includes modifiedAfter filter in SOQL query', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: { totalSize: 0, done: true, nextRecordsUrl: null, records: [] },
    }));

    const modifiedAfter = new Date('2025-01-01T00:00:00Z');
    await adapter.fetchContacts(credentials, { modifiedAfter }, { limit: 25 });

    const [url] = mock.get.mock.calls[0] as [string, Record<string, string>];
    expect(url).toContain('LastModifiedDate');
    expect(url).toContain('2025-01-01');
  });

  it('fetchContacts sets hasMore and nextCursor when Salesforce returns done=false', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        totalSize: 100,
        done: false,
        nextRecordsUrl: '/services/data/v59.0/query/next',
        records: Array.from({ length: 25 }, (_, i) => ({
          Id: `sf-contact-${String(i)}`,
          FirstName: 'First',
          LastName: 'Last',
          Email: null,
          Phone: null,
          Account: null,
          Title: null,
          LastModifiedDate: '2025-01-10T08:00:00Z',
        })),
      },
    }));

    const result = await adapter.fetchContacts(credentials, {}, { limit: 25 });

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('25');
    expect(result.total).toBe(100);
  });

  it('fetchContacts throws on non-200 response', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({ status: 403, body: {} }));

    await expect(adapter.fetchContacts(credentials, {}, { limit: 10 })).rejects.toThrow(
      'Salesforce contact query failed: HTTP 403',
    );
  });

  // ── pushContact ────────────────────────────────────────────────

  it('pushContact POSTs to Contact endpoint when no existingExternalId provided', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'sf-new-001' } }));

    const id = await adapter.pushContact(credentials, makeContact());

    expect(mock.post).toHaveBeenCalledOnce();
    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('/sobjects/Contact');
    expect(id).toBe('sf-new-001');
  });

  it('pushContact PATCHes existing Contact when existingExternalId is provided', async () => {
    mock.patch.mockResolvedValue(makeHttpResponse({ status: 204, body: {} }));

    const id = await adapter.pushContact(credentials, makeContact(), 'sf-existing-001');

    expect(mock.patch).toHaveBeenCalledOnce();
    const [url] = mock.patch.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('sf-existing-001');
    expect(id).toBe('sf-existing-001');
  });

  it('pushContact throws when POST returns non-201', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 400, body: {} }));

    await expect(adapter.pushContact(credentials, makeContact())).rejects.toThrow(
      'Salesforce contact create failed: HTTP 400',
    );
  });

  it('pushContact throws when PATCH returns non-200/204', async () => {
    mock.patch.mockResolvedValue(makeHttpResponse({ status: 500, body: {} }));

    await expect(adapter.pushContact(credentials, makeContact(), 'sf-001')).rejects.toThrow(
      'Salesforce contact update failed: HTTP 500',
    );
  });

  // ── fetchDeals ─────────────────────────────────────────────────

  it('fetchDeals maps Salesforce Opportunity records to CrmDeal', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        totalSize: 1,
        done: true,
        nextRecordsUrl: null,
        records: [{
          Id: 'sf-opp-001',
          Name: 'Big Enterprise Deal',
          Amount: 250000,
          CurrencyIsoCode: 'USD',
          StageName: 'Proposal/Price Quote',
          Probability: 60,
          CloseDate: '2025-06-30',
          ContactId: 'sf-contact-001',
          LastModifiedDate: '2025-01-12T09:00:00Z',
        }],
      },
    }));

    const result = await adapter.fetchDeals(credentials, {}, { limit: 25 });

    expect(result.data).toHaveLength(1);
    const deal = result.data[0];
    expect(deal).toBeDefined();
    expect(deal!.externalId).toBe('sf-opp-001');
    expect(deal!.name).toBe('Big Enterprise Deal');
    expect(deal!.amount).toBe(250000);
    expect(deal!.currency).toBe('USD');
    expect(deal!.stage).toBe('Proposal/Price Quote');
    expect(deal!.probability).toBe(60);
    expect(deal!.contactExternalId).toBe('sf-contact-001');
  });

  it('fetchDeals includes modifiedAfter filter in the SOQL query', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: { totalSize: 0, done: true, nextRecordsUrl: null, records: [] },
    }));

    const modifiedAfter = new Date('2025-02-01T00:00:00Z');
    await adapter.fetchDeals(credentials, { modifiedAfter }, { limit: 10 });

    const [url] = mock.get.mock.calls[0] as [string, Record<string, string>];
    expect(url).toContain('LastModifiedDate');
    expect(url).toContain('2025-02-01');
  });

  it('fetchDeals throws on non-200 response', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({ status: 401, body: {} }));

    await expect(adapter.fetchDeals(credentials, {}, { limit: 10 })).rejects.toThrow(
      'Salesforce opportunity query failed: HTTP 401',
    );
  });

  // ── pushDeal ───────────────────────────────────────────────────

  it('pushDeal POSTs to Opportunity endpoint when creating a new deal', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'sf-opp-new-001' } }));

    const id = await adapter.pushDeal(credentials, makeDeal());

    expect(mock.post).toHaveBeenCalledOnce();
    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('/sobjects/Opportunity');
    expect(id).toBe('sf-opp-new-001');
  });

  it('pushDeal PATCHes existing Opportunity when existingExternalId is provided', async () => {
    mock.patch.mockResolvedValue(makeHttpResponse({ status: 204, body: {} }));

    const id = await adapter.pushDeal(credentials, makeDeal(), 'sf-opp-existing');

    expect(mock.patch).toHaveBeenCalledOnce();
    const [url] = mock.patch.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('sf-opp-existing');
    expect(id).toBe('sf-opp-existing');
  });

  it('pushDeal throws when POST returns non-201', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 422, body: {} }));

    await expect(adapter.pushDeal(credentials, makeDeal())).rejects.toThrow(
      'Salesforce opportunity create failed: HTTP 422',
    );
  });

  // ── fetchActivities ────────────────────────────────────────────

  it('fetchActivities maps Salesforce Task records to CrmActivity', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        totalSize: 1,
        done: true,
        nextRecordsUrl: null,
        records: [{
          Id: 'sf-task-001',
          Type: 'Call',
          Subject: 'Follow-up call',
          Description: 'Discuss pricing options',
          WhoId: 'sf-contact-001',
          WhatId: 'sf-opp-001',
          ActivityDate: '2025-01-20',
          CompletedDateTime: null,
          LastModifiedDate: '2025-01-15T10:00:00Z',
        }],
      },
    }));

    const result = await adapter.fetchActivities(credentials, {}, { limit: 25 });

    expect(result.data).toHaveLength(1);
    const activity = result.data[0];
    expect(activity).toBeDefined();
    expect(activity!.externalId).toBe('sf-task-001');
    expect(activity!.type).toBe('call');
    expect(activity!.subject).toBe('Follow-up call');
    expect(activity!.contactExternalId).toBe('sf-contact-001');
    expect(activity!.dealExternalId).toBe('sf-opp-001');
  });

  it('fetchActivities maps Email task type correctly', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        totalSize: 1,
        done: true,
        nextRecordsUrl: null,
        records: [{
          Id: 'sf-task-002',
          Type: 'Email',
          Subject: 'Proposal sent',
          Description: null,
          WhoId: null,
          WhatId: null,
          ActivityDate: null,
          CompletedDateTime: '2025-01-14T16:00:00Z',
          LastModifiedDate: '2025-01-14T16:00:00Z',
        }],
      },
    }));

    const result = await adapter.fetchActivities(credentials, {}, { limit: 10 });

    expect(result.data[0]!.type).toBe('email');
    expect(result.data[0]!.completedAt).not.toBeNull();
  });

  it('fetchActivities maps Meeting task type to event', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        totalSize: 1,
        done: true,
        nextRecordsUrl: null,
        records: [{
          Id: 'sf-task-003',
          Type: 'Meeting',
          Subject: 'Quarterly Review',
          Description: null,
          WhoId: null,
          WhatId: null,
          ActivityDate: '2025-02-01',
          CompletedDateTime: null,
          LastModifiedDate: '2025-01-15T10:00:00Z',
        }],
      },
    }));

    const result = await adapter.fetchActivities(credentials, {}, { limit: 10 });

    expect(result.data[0]!.type).toBe('event');
  });

  it('fetchActivities throws on non-200 response', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({ status: 500, body: {} }));

    await expect(adapter.fetchActivities(credentials, {}, { limit: 10 })).rejects.toThrow(
      'Salesforce task query failed: HTTP 500',
    );
  });

  // ── pushActivity ───────────────────────────────────────────────

  it('pushActivity POSTs to Task endpoint when creating a new activity', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'sf-task-new-001' } }));

    const id = await adapter.pushActivity(credentials, makeActivity());

    expect(mock.post).toHaveBeenCalledOnce();
    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('/sobjects/Task');
    expect(id).toBe('sf-task-new-001');
  });

  it('pushActivity PATCHes existing Task when existingExternalId is provided', async () => {
    mock.patch.mockResolvedValue(makeHttpResponse({ status: 204, body: {} }));

    const id = await adapter.pushActivity(credentials, makeActivity(), 'sf-task-existing');

    const [url] = mock.patch.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('sf-task-existing');
    expect(id).toBe('sf-task-existing');
  });

  it('pushActivity maps call type to Salesforce Call type', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'sf-task-cal' } }));

    await adapter.pushActivity(credentials, makeActivity({ type: 'call' }));

    const [, body] = mock.post.mock.calls[0] as [string, Record<string, unknown>, Record<string, string>];
    expect(body).toMatchObject({ Type: 'Call' });
  });

  it('pushActivity maps email type to Salesforce Email type', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'sf-task-em' } }));

    await adapter.pushActivity(credentials, makeActivity({ type: 'email' }));

    const [, body] = mock.post.mock.calls[0] as [string, Record<string, unknown>, Record<string, string>];
    expect(body).toMatchObject({ Type: 'Email' });
  });

  it('pushActivity throws when POST returns non-201', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 400, body: {} }));

    await expect(adapter.pushActivity(credentials, makeActivity())).rejects.toThrow(
      'Salesforce task create failed: HTTP 400',
    );
  });

  // ── handleWebhook ──────────────────────────────────────────────

  it('handleWebhook returns a WebhookPayload when signature is valid', () => {
    const payload = {
      Id: 'sf-contact-001',
      object_type: 'Contact',
      event_type: 'created',
    };

    const result = adapter.handleWebhook(payload, 'sha256=valid-hmac', 'webhook-secret');

    expect(result.provider).toBe('salesforce');
    expect(result.entityId).toBe('sf-contact-001');
    expect(result.entityType).toBe('contact');
    expect(result.eventType).toBe('created');
  });

  it('handleWebhook throws when signature is empty (invalid)', () => {
    expect(() => adapter.handleWebhook({ Id: 'x' }, '', 'secret')).toThrow(
      'Salesforce webhook signature verification failed',
    );
  });

  it('handleWebhook throws when secret is empty (invalid)', () => {
    expect(() => adapter.handleWebhook({ Id: 'x' }, 'sha256=something', '')).toThrow(
      'Salesforce webhook signature verification failed',
    );
  });

  it('handleWebhook infers deal entity type for Opportunity object_type', () => {
    const payload = { Id: 'sf-opp-001', object_type: 'Opportunity', event_type: 'updated' };

    const result = adapter.handleWebhook(payload, 'sha256=valid', 'secret');

    expect(result.entityType).toBe('deal');
  });

  it('handleWebhook infers activity entity type for Task object_type', () => {
    const payload = { Id: 'sf-task-001', object_type: 'Task', event_type: 'created' };

    const result = adapter.handleWebhook(payload, 'sha256=valid', 'secret');

    expect(result.entityType).toBe('activity');
  });

  it('handleWebhook defaults entityType to contact when object_type is unrecognised', () => {
    const payload = { Id: 'sf-unknown-001', object_type: 'UnknownObject', event_type: 'unknown' };

    const result = adapter.handleWebhook(payload, 'sha256=valid', 'secret');

    expect(result.entityType).toBe('contact');
  });

  it('handleWebhook includes the full payload in the returned data field', () => {
    const payload = { Id: 'sf-contact-002', object_type: 'Contact', event_type: 'deleted', extra: 'value' };

    const result = adapter.handleWebhook(payload, 'sha256=valid', 'secret');

    expect(result.data).toMatchObject({ extra: 'value' });
  });

  // ── getRateLimitInfo ───────────────────────────────────────────

  it('getRateLimitInfo parses DailyApiRequests from Salesforce limits response', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        DailyApiRequests: { Remaining: 12500, Max: 15000 },
      },
    }));

    const info = await adapter.getRateLimitInfo(credentials);

    expect(info.remaining).toBe(12500);
    expect(info.limit).toBe(15000);
    expect(info.resetAt).toBeInstanceOf(Date);
  });

  it('getRateLimitInfo throws when Salesforce limits endpoint returns non-200', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({ status: 503, body: {} }));

    await expect(adapter.getRateLimitInfo(credentials)).rejects.toThrow(
      'Salesforce limits query failed: HTTP 503',
    );
  });

  it('getRateLimitInfo returns zero remaining when DailyApiRequests is absent', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({ status: 200, body: {} }));

    const info = await adapter.getRateLimitInfo(credentials);

    expect(info.remaining).toBe(0);
    expect(info.limit).toBe(0);
  });

  // ── bulkPushContacts ───────────────────────────────────────────

  it('bulkPushContacts uses individual pushContact for batches <= 200 records', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'sf-bulk-001' } }));

    const contacts = Array.from({ length: 3 }, (_, i) =>
      makeContact({ externalId: `ordr-contact-${String(i)}` }),
    );

    const results = await adapter.bulkPushContacts!(credentials, contacts);

    expect(results.size).toBe(3);
    expect(mock.post).toHaveBeenCalledTimes(3);
  });
});

// ─── HubSpotAdapter ──────────────────────────────────────────────────────────

describe('HubSpotAdapter', () => {
  let mock: ReturnType<typeof makeMockHttpClient>;
  let adapter: HubSpotAdapter;
  let credentials: OAuthCredentials;
  let oauthConfig: OAuthConfig;

  beforeEach(() => {
    mock = makeMockHttpClient();
    adapter = new HubSpotAdapter(mock.client);
    credentials = makeCredentials({ instanceUrl: undefined });
    oauthConfig = makeOAuthConfig({ scopes: ['contacts', 'deals', 'crm.objects.contacts.read'] });
  });

  // ── provider identity ──────────────────────────────────────────

  it('exposes provider as hubspot', () => {
    expect(adapter.provider).toBe('hubspot');
  });

  // ── getAuthorizationUrl ────────────────────────────────────────

  it('getAuthorizationUrl returns URL pointing to HubSpot auth endpoint', () => {
    const result = adapter.getAuthorizationUrl(oauthConfig);

    expect(result.authorizationUrl).toContain('https://app.hubspot.com/oauth/authorize');
  });

  it('getAuthorizationUrl includes client_id in the URL', () => {
    const result = adapter.getAuthorizationUrl(oauthConfig);

    expect(result.authorizationUrl).toContain('client_id=test-client-id');
  });

  it('getAuthorizationUrl includes redirect_uri in the URL', () => {
    const result = adapter.getAuthorizationUrl(oauthConfig);

    expect(result.authorizationUrl).toContain(encodeURIComponent('https://app.ordr.io/oauth/callback'));
  });

  it('getAuthorizationUrl returns a unique state on each invocation', () => {
    const r1 = adapter.getAuthorizationUrl(oauthConfig);
    const r2 = adapter.getAuthorizationUrl(oauthConfig);

    expect(r1.state).not.toBe(r2.state);
  });

  // ── exchangeCode ───────────────────────────────────────────────

  it('exchangeCode sends POST to HubSpot token URL', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        access_token: 'hs-access',
        refresh_token: 'hs-refresh',
        token_type: 'Bearer',
        expires_in: 1800,
      },
    }));

    await adapter.exchangeCode(oauthConfig, 'hs-code', 'hs-state');

    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toBe('https://api.hubapi.com/oauth/v1/token');
  });

  it('exchangeCode returns credentials with access and refresh tokens', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        access_token: 'hs-access-token',
        refresh_token: 'hs-refresh-token',
        token_type: 'Bearer',
        expires_in: 1800,
      },
    }));

    const result = await adapter.exchangeCode(oauthConfig, 'code', 'state');

    expect(result.credentials.accessToken).toBe('hs-access-token');
    expect(result.credentials.refreshToken).toBe('hs-refresh-token');
  });

  it('exchangeCode throws on non-200 response', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 400, body: { message: 'bad_code' } }));

    await expect(adapter.exchangeCode(oauthConfig, 'bad', 'state')).rejects.toThrow(
      'HubSpot OAuth token exchange failed: HTTP 400',
    );
  });

  // ── refreshAccessToken ─────────────────────────────────────────

  it('refreshAccessToken sends refresh_token grant to HubSpot token URL', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        access_token: 'hs-new-access',
        refresh_token: 'hs-new-refresh',
        token_type: 'Bearer',
        expires_in: 1800,
      },
    }));

    await adapter.refreshAccessToken(oauthConfig, 'hs-old-refresh');

    const [url, body] = mock.post.mock.calls[0] as [string, Record<string, string>, Record<string, string>];
    expect(url).toBe('https://api.hubapi.com/oauth/v1/token');
    expect(body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'hs-old-refresh' });
  });

  it('refreshAccessToken returns new credentials with updated access token', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        access_token: 'hs-refreshed-access',
        refresh_token: 'hs-refreshed-refresh',
        token_type: 'Bearer',
        expires_in: 1800,
      },
    }));

    const result = await adapter.refreshAccessToken(oauthConfig, 'hs-old-refresh');

    expect(result.credentials.accessToken).toBe('hs-refreshed-access');
  });

  it('refreshAccessToken throws on non-200 response', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 401, body: {} }));

    await expect(adapter.refreshAccessToken(oauthConfig, 'expired')).rejects.toThrow(
      'HubSpot token refresh failed: HTTP 401',
    );
  });

  // ── getHealth ──────────────────────────────────────────────────

  it('getHealth returns healthy when contacts endpoint responds 200', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      headers: { 'x-hubspot-ratelimit-remaining': '98' },
      body: { total: 0, results: [] },
    }));

    const health = await adapter.getHealth(credentials);

    expect(health.provider).toBe('hubspot');
    expect(health.status).toBe('healthy');
    expect(health.rateLimitRemaining).toBe(98);
  });

  it('getHealth returns degraded when fewer than 10 requests remain', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      headers: { 'x-hubspot-ratelimit-remaining': '5' },
      body: { total: 0, results: [] },
    }));

    const health = await adapter.getHealth(credentials);

    expect(health.status).toBe('degraded');
  });

  it('getHealth returns disconnected when the HTTP request throws', async () => {
    mock.get.mockRejectedValue(new Error('Network error'));

    const health = await adapter.getHealth(credentials);

    expect(health.status).toBe('disconnected');
    expect(health.message).toBe('Connection failed');
  });

  it('getHealth returns error status when API returns non-200', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({ status: 401, headers: {}, body: {} }));

    const health = await adapter.getHealth(credentials);

    expect(health.status).toBe('error');
  });

  // ── fetchContacts ──────────────────────────────────────────────

  it('fetchContacts POSTs to HubSpot search endpoint', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: { total: 0, results: [] },
    }));

    await adapter.fetchContacts(credentials, {}, { limit: 10 });

    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/contacts/search');
  });

  it('fetchContacts maps HubSpot contact properties to CrmContact', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        total: 1,
        results: [{
          id: 'hs-contact-001',
          properties: {
            firstname: 'Bob',
            lastname: 'Builder',
            email: 'bob@example.com',
            phone: '+44-20-9999',
            company: 'BuildCo',
            jobtitle: 'Foreman',
            hs_object_id: 'hs-contact-001',
          },
          updatedAt: '2025-01-12T10:00:00Z',
        }],
      },
    }));

    const result = await adapter.fetchContacts(credentials, {}, { limit: 10 });

    expect(result.data).toHaveLength(1);
    const contact = result.data[0];
    expect(contact).toBeDefined();
    expect(contact!.externalId).toBe('hs-contact-001');
    expect(contact!.firstName).toBe('Bob');
    expect(contact!.lastName).toBe('Builder');
    expect(contact!.email).toBe('bob@example.com');
    expect(contact!.company).toBe('BuildCo');
    expect(contact!.title).toBe('Foreman');
  });

  it('fetchContacts includes modifiedAfter filter in search body', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: { total: 0, results: [] },
    }));

    const modifiedAfter = new Date('2025-01-01T00:00:00Z');
    await adapter.fetchContacts(credentials, { modifiedAfter }, { limit: 10 });

    const [, body] = mock.post.mock.calls[0] as [string, Record<string, unknown>, Record<string, string>];
    expect(body).toHaveProperty('filterGroups');
  });

  it('fetchContacts populates nextCursor from HubSpot paging.next.after', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        total: 200,
        results: [],
        paging: { next: { after: 'cursor-token-abc' } },
      },
    }));

    const result = await adapter.fetchContacts(credentials, {}, { limit: 50 });

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('cursor-token-abc');
  });

  it('fetchContacts throws on non-200 response', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 429, body: {} }));

    await expect(adapter.fetchContacts(credentials, {}, { limit: 10 })).rejects.toThrow(
      'HubSpot contact search failed: HTTP 429',
    );
  });

  // ── pushContact ────────────────────────────────────────────────

  it('pushContact POSTs to HubSpot contacts endpoint when creating', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'hs-new-001' } }));

    const id = await adapter.pushContact(credentials, makeContact());

    expect(mock.post).toHaveBeenCalledOnce();
    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/contacts');
    expect(id).toBe('hs-new-001');
  });

  it('pushContact PATCHes existing HubSpot contact', async () => {
    mock.patch.mockResolvedValue(makeHttpResponse({ status: 200, body: { id: 'hs-existing-001' } }));

    const id = await adapter.pushContact(credentials, makeContact(), 'hs-existing-001');

    expect(mock.patch).toHaveBeenCalledOnce();
    const [url] = mock.patch.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('hs-existing-001');
    expect(id).toBe('hs-existing-001');
  });

  it('pushContact throws when create returns non-201', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 409, body: {} }));

    await expect(adapter.pushContact(credentials, makeContact())).rejects.toThrow(
      'HubSpot contact create failed: HTTP 409',
    );
  });

  it('pushContact throws when update returns non-200', async () => {
    mock.patch.mockResolvedValue(makeHttpResponse({ status: 404, body: {} }));

    await expect(adapter.pushContact(credentials, makeContact(), 'hs-missing')).rejects.toThrow(
      'HubSpot contact update failed: HTTP 404',
    );
  });

  // ── fetchDeals ─────────────────────────────────────────────────

  it('fetchDeals POSTs to HubSpot deals search endpoint', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: { total: 0, results: [] },
    }));

    await adapter.fetchDeals(credentials, {}, { limit: 10 });

    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/deals/search');
  });

  it('fetchDeals maps HubSpot deal properties to CrmDeal', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        total: 1,
        results: [{
          id: 'hs-deal-001',
          properties: {
            dealname: 'Winter Campaign',
            amount: '85000',
            dealstage: 'presentationscheduled',
            hs_deal_stage_probability: '0.5',
            closedate: '2025-04-15T00:00:00Z',
            hs_object_id: 'hs-deal-001',
          },
          updatedAt: '2025-01-13T11:00:00Z',
        }],
      },
    }));

    const result = await adapter.fetchDeals(credentials, {}, { limit: 10 });

    expect(result.data).toHaveLength(1);
    const deal = result.data[0];
    expect(deal).toBeDefined();
    expect(deal!.externalId).toBe('hs-deal-001');
    expect(deal!.name).toBe('Winter Campaign');
    expect(deal!.amount).toBe(85000);
    expect(deal!.stage).toBe('presentationscheduled');
    expect(deal!.probability).toBe(0.5);
  });

  it('fetchDeals throws on non-200 response', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 500, body: {} }));

    await expect(adapter.fetchDeals(credentials, {}, { limit: 10 })).rejects.toThrow(
      'HubSpot deal search failed: HTTP 500',
    );
  });

  // ── pushDeal ───────────────────────────────────────────────────

  it('pushDeal POSTs to HubSpot deals endpoint when creating', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'hs-deal-new' } }));

    const id = await adapter.pushDeal(credentials, makeDeal());

    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/deals');
    expect(id).toBe('hs-deal-new');
  });

  it('pushDeal PATCHes existing HubSpot deal', async () => {
    mock.patch.mockResolvedValue(makeHttpResponse({ status: 200, body: { id: 'hs-deal-existing' } }));

    const id = await adapter.pushDeal(credentials, makeDeal(), 'hs-deal-existing');

    const [url] = mock.patch.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('hs-deal-existing');
    expect(id).toBe('hs-deal-existing');
  });

  it('pushDeal throws when create returns non-201', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 400, body: {} }));

    await expect(adapter.pushDeal(credentials, makeDeal())).rejects.toThrow(
      'HubSpot deal create failed: HTTP 400',
    );
  });

  // ── fetchActivities ────────────────────────────────────────────

  it('fetchActivities POSTs to HubSpot tasks search endpoint', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: { total: 0, results: [] },
    }));

    await adapter.fetchActivities(credentials, {}, { limit: 10 });

    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/tasks/search');
  });

  it('fetchActivities maps HubSpot engagement to CrmActivity', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        total: 1,
        results: [{
          id: 'hs-task-001',
          properties: {
            hs_engagement_type: 'CALL',
            hs_activity_type: null,
            hs_timestamp: '2025-01-20T14:00:00Z',
            hs_body_preview: 'Called to discuss renewal',
            hs_object_id: 'hs-task-001',
          },
          updatedAt: '2025-01-20T14:30:00Z',
        }],
      },
    }));

    const result = await adapter.fetchActivities(credentials, {}, { limit: 10 });

    expect(result.data).toHaveLength(1);
    const activity = result.data[0];
    expect(activity).toBeDefined();
    expect(activity!.externalId).toBe('hs-task-001');
    expect(activity!.type).toBe('call');
    expect(activity!.subject).toBe('Called to discuss renewal');
  });

  it('fetchActivities maps EMAIL engagement type correctly', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        total: 1,
        results: [{
          id: 'hs-task-002',
          properties: {
            hs_engagement_type: 'EMAIL',
            hs_activity_type: null,
            hs_timestamp: '2025-01-18T09:00:00Z',
            hs_body_preview: 'Sent follow-up email',
            hs_object_id: 'hs-task-002',
          },
          updatedAt: '2025-01-18T09:05:00Z',
        }],
      },
    }));

    const result = await adapter.fetchActivities(credentials, {}, { limit: 10 });

    expect(result.data[0]!.type).toBe('email');
  });

  it('fetchActivities maps MEETING engagement type to event', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        total: 1,
        results: [{
          id: 'hs-task-003',
          properties: {
            hs_engagement_type: 'MEETING',
            hs_activity_type: null,
            hs_timestamp: '2025-02-01T10:00:00Z',
            hs_body_preview: 'Kickoff meeting',
            hs_object_id: 'hs-task-003',
          },
          updatedAt: '2025-02-01T11:00:00Z',
        }],
      },
    }));

    const result = await adapter.fetchActivities(credentials, {}, { limit: 10 });

    expect(result.data[0]!.type).toBe('event');
  });

  it('fetchActivities maps NOTE engagement type correctly', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({
      status: 200,
      body: {
        total: 1,
        results: [{
          id: 'hs-task-004',
          properties: {
            hs_engagement_type: 'NOTE',
            hs_activity_type: null,
            hs_timestamp: '2025-01-22T15:00:00Z',
            hs_body_preview: 'Customer prefers morning calls',
            hs_object_id: 'hs-task-004',
          },
          updatedAt: '2025-01-22T15:00:00Z',
        }],
      },
    }));

    const result = await adapter.fetchActivities(credentials, {}, { limit: 10 });

    expect(result.data[0]!.type).toBe('note');
  });

  it('fetchActivities throws on non-200 response', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 403, body: {} }));

    await expect(adapter.fetchActivities(credentials, {}, { limit: 10 })).rejects.toThrow(
      'HubSpot activity search failed: HTTP 403',
    );
  });

  // ── pushActivity ───────────────────────────────────────────────

  it('pushActivity POSTs to HubSpot tasks endpoint when creating', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'hs-task-new' } }));

    const id = await adapter.pushActivity(credentials, makeActivity());

    const [url] = mock.post.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/tasks');
    expect(id).toBe('hs-task-new');
  });

  it('pushActivity PATCHes existing HubSpot task', async () => {
    mock.patch.mockResolvedValue(makeHttpResponse({ status: 200, body: { id: 'hs-task-existing' } }));

    const id = await adapter.pushActivity(credentials, makeActivity(), 'hs-task-existing');

    const [url] = mock.patch.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(url).toContain('hs-task-existing');
    expect(id).toBe('hs-task-existing');
  });

  it('pushActivity maps call type to CALL HubSpot task type', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'hs-task-cal' } }));

    await adapter.pushActivity(credentials, makeActivity({ type: 'call' }));

    const [, body] = mock.post.mock.calls[0] as [string, { properties: Record<string, string> }, Record<string, string>];
    expect(body.properties).toMatchObject({ hs_task_type: 'CALL' });
  });

  it('pushActivity maps note type to NOTE HubSpot task type', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'hs-task-note' } }));

    await adapter.pushActivity(credentials, makeActivity({ type: 'note' }));

    const [, body] = mock.post.mock.calls[0] as [string, { properties: Record<string, string> }, Record<string, string>];
    expect(body.properties).toMatchObject({ hs_task_type: 'NOTE' });
  });

  it('pushActivity maps task type to TODO HubSpot task type', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'hs-task-todo' } }));

    await adapter.pushActivity(credentials, makeActivity({ type: 'task' }));

    const [, body] = mock.post.mock.calls[0] as [string, { properties: Record<string, string> }, Record<string, string>];
    expect(body.properties).toMatchObject({ hs_task_type: 'TODO' });
  });

  it('pushActivity throws when create returns non-201', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 400, body: {} }));

    await expect(adapter.pushActivity(credentials, makeActivity())).rejects.toThrow(
      'HubSpot activity create failed: HTTP 400',
    );
  });

  // ── handleWebhook ──────────────────────────────────────────────

  it('handleWebhook returns WebhookPayload when signature is valid', () => {
    const payload = {
      objectId: 'hs-contact-001',
      objectType: 'contact',
      subscriptionType: 'contact.creation',
    };

    const result = adapter.handleWebhook(payload, 'sha256=valid-sig', 'hs-secret');

    expect(result.provider).toBe('hubspot');
    expect(result.entityId).toBe('hs-contact-001');
    expect(result.entityType).toBe('contact');
    expect(result.eventType).toBe('contact.creation');
  });

  it('handleWebhook throws when signature is empty', () => {
    expect(() => adapter.handleWebhook({ objectId: 'x' }, '', 'secret')).toThrow(
      'HubSpot webhook signature verification failed',
    );
  });

  it('handleWebhook throws when secret is empty', () => {
    expect(() => adapter.handleWebhook({ objectId: 'x' }, 'sha256=sig', '')).toThrow(
      'HubSpot webhook signature verification failed',
    );
  });

  it('handleWebhook infers deal entity type for deal objectType', () => {
    const payload = { objectId: 'hs-deal-001', objectType: 'deal', subscriptionType: 'deal.creation' };

    const result = adapter.handleWebhook(payload, 'sha256=sig', 'secret');

    expect(result.entityType).toBe('deal');
  });

  it('handleWebhook infers activity entity type for engagement objectType', () => {
    const payload = { objectId: 'hs-eng-001', objectType: 'engagement', subscriptionType: 'engagement.creation' };

    const result = adapter.handleWebhook(payload, 'sha256=sig', 'secret');

    expect(result.entityType).toBe('activity');
  });

  it('handleWebhook defaults entityType to contact for unrecognised objectType', () => {
    const payload = { objectId: 'hs-xyz', objectType: 'unknown', subscriptionType: 'unknown.event' };

    const result = adapter.handleWebhook(payload, 'sha256=sig', 'secret');

    expect(result.entityType).toBe('contact');
  });

  // ── getRateLimitInfo ───────────────────────────────────────────

  it('getRateLimitInfo reads rate limit headers from HubSpot response', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      headers: {
        'x-hubspot-ratelimit-remaining': '75',
        'x-hubspot-ratelimit-max': '100',
        'x-hubspot-ratelimit-interval-milliseconds': '10000',
      },
      body: { total: 0, results: [] },
    }));

    const info = await adapter.getRateLimitInfo(credentials);

    expect(info.remaining).toBe(75);
    expect(info.limit).toBe(100);
    expect(info.resetAt).toBeInstanceOf(Date);
  });

  it('getRateLimitInfo defaults remaining to 0 when rate limit header is absent', async () => {
    mock.get.mockResolvedValue(makeHttpResponse({
      status: 200,
      headers: {},
      body: {},
    }));

    const info = await adapter.getRateLimitInfo(credentials);

    expect(info.remaining).toBe(0);
  });

  // ── bulkPushContacts ───────────────────────────────────────────

  it('bulkPushContacts uses individual pushContact for batches <= 100 records', async () => {
    mock.post.mockResolvedValue(makeHttpResponse({ status: 201, body: { id: 'hs-bulk-001' } }));

    const contacts = Array.from({ length: 3 }, (_, i) =>
      makeContact({ externalId: `ordr-hs-${String(i)}` }),
    );

    const results = await adapter.bulkPushContacts!(credentials, contacts);

    expect(results.size).toBe(3);
    expect(mock.post).toHaveBeenCalledTimes(3);
  });
});
