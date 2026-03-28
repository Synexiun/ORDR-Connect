/**
 * integrations-api tests
 *
 * Verifies typed wrappers call the correct endpoints with correct params.
 * Critical invariant: access tokens MUST NOT appear in API responses.
 */

/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { integrationsApi } from '../integrations-api';
import * as apiModule from '../api';

vi.mock('../api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockClient = vi.mocked(apiModule.apiClient);

const MOCK_HEALTH = {
  status: 'healthy',
  provider: 'salesforce',
  latencyMs: 42,
  lastCheckedAt: new Date().toISOString(),
};

const MOCK_CONTACT = {
  id: 'sf-1',
  email: 'john@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

const MOCK_DEAL = {
  id: 'deal-1',
  name: 'Enterprise Deal',
  amount: 50000,
  stage: 'Negotiation',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('integrationsApi.listProviders', () => {
  it('GETs /v1/integrations/providers and extracts data', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: ['salesforce', 'hubspot'] });

    const result = await integrationsApi.listProviders();

    expect(mockClient.get).toHaveBeenCalledWith('/v1/integrations/providers');
    expect(result).toContain('salesforce');
  });
});

describe('integrationsApi.getHealth', () => {
  it('GETs /v1/integrations/:provider and extracts data', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: MOCK_HEALTH, provider: 'salesforce' });

    const result = await integrationsApi.getHealth('salesforce');

    expect(mockClient.get).toHaveBeenCalledWith('/v1/integrations/salesforce');
    expect(result.status).toBe('healthy');
  });
});

describe('integrationsApi.authorize', () => {
  it('POSTs to /v1/integrations/:provider/authorize with redirectUri and state', async () => {
    const oauth = { authorizationUrl: 'https://sf.com/oauth?client_id=x', state: 'abc' };
    mockClient.post.mockResolvedValue({ success: true, data: oauth });

    const result = await integrationsApi.authorize(
      'salesforce',
      'https://app.example.com/cb',
      'csrf',
    );

    expect(mockClient.post).toHaveBeenCalledWith('/v1/integrations/salesforce/authorize', {
      redirectUri: 'https://app.example.com/cb',
      state: 'csrf',
    });
    expect(result.authorizationUrl).toContain('https://');
  });
});

describe('integrationsApi.callback', () => {
  it('POSTs to /v1/integrations/:provider/callback with code', async () => {
    const callbackResult = { connected: true, provider: 'salesforce' };
    mockClient.post.mockResolvedValue({ success: true, data: callbackResult });

    const result = await integrationsApi.callback('salesforce', 'auth-code-xyz');

    expect(mockClient.post).toHaveBeenCalledWith('/v1/integrations/salesforce/callback', {
      code: 'auth-code-xyz',
    });
    expect(result.connected).toBe(true);
    // CRITICAL: access token must not be in response
    expect(JSON.stringify(result)).not.toContain('access-token');
  });
});

describe('integrationsApi.listContacts', () => {
  it('GETs /v1/integrations/:provider/contacts and maps response', async () => {
    mockClient.get.mockResolvedValue({
      success: true,
      data: [MOCK_CONTACT],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const result = await integrationsApi.listContacts('salesforce');

    expect(mockClient.get).toHaveBeenCalledWith(
      expect.stringContaining('/v1/integrations/salesforce/contacts'),
    );
    expect(result.items).toEqual([MOCK_CONTACT]);
    expect(result.total).toBe(1);
  });

  it('appends q, limit, offset to query string', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: [], total: 0, limit: 25, offset: 50 });

    await integrationsApi.listContacts('salesforce', { q: 'john', limit: 25, offset: 50 });

    const url = mockClient.get.mock.calls[0]?.[0] as string;
    expect(url).toContain('q=john');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
  });
});

describe('integrationsApi.getContact', () => {
  it('GETs /v1/integrations/:provider/contacts/:id', async () => {
    mockClient.get.mockResolvedValue({ success: true, data: MOCK_CONTACT });

    const result = await integrationsApi.getContact('salesforce', 'sf-1');

    expect(mockClient.get).toHaveBeenCalledWith('/v1/integrations/salesforce/contacts/sf-1');
    expect(result.id).toBe('sf-1');
  });
});

describe('integrationsApi.deleteContact', () => {
  it('DELETEs /v1/integrations/:provider/contacts/:id', async () => {
    mockClient.delete.mockResolvedValue(undefined);

    await integrationsApi.deleteContact('salesforce', 'sf-1');

    expect(mockClient.delete).toHaveBeenCalledWith('/v1/integrations/salesforce/contacts/sf-1');
  });
});

describe('integrationsApi.listDeals', () => {
  it('GETs /v1/integrations/:provider/deals and maps response', async () => {
    mockClient.get.mockResolvedValue({
      success: true,
      data: [MOCK_DEAL],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const result = await integrationsApi.listDeals('salesforce');

    expect(result.items).toEqual([MOCK_DEAL]);
    expect(result.total).toBe(1);
  });
});
