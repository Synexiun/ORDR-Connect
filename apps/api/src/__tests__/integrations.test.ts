/**
 * Integrations route tests
 *
 * Verifies:
 * - GET /providers — list available providers (no auth)
 * - GET /:provider — get integration health (auth)
 * - POST /:provider/authorize — get OAuth URL (admin only)
 * - POST /:provider/callback — exchange OAuth code (admin only)
 * - GET /:provider/contacts — list contacts (auth)
 * - GET /:provider/contacts/:id — get contact (auth)
 * - POST /:provider/contacts — upsert contact (auth)
 * - DELETE /:provider/contacts/:id — delete contact (admin only)
 * - GET /:provider/deals — list deals (auth)
 * - 404 for unknown provider
 * - Tenant isolation from JWT context
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { integrationsRouter, configureIntegrationRoutes } from '../routes/integrations.js';
import type { CRMAdapter } from '../routes/integrations.js';
import { configureAuth } from '../middleware/auth.js';
import { configureBillingGate } from '../middleware/plan-gate.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { SubscriptionManager, InMemorySubscriptionStore, MockStripeClient } from '@ordr/billing';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { FieldEncryptor } from '@ordr/crypto';

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'integrations', action: 'read', scope: 'tenant' }],
    },
  }),
  requireRole: vi.fn(),
  requirePermission: vi.fn(),
  requireTenant: vi.fn(),
  ROLE_HIERARCHY: {},
  ROLE_PERMISSIONS: {},
  hasRole: vi.fn().mockReturnValue(true),
  hasPermission: vi.fn().mockReturnValue(true),
}));

vi.mock('@ordr/integrations', async () => {
  const actual = await vi.importActual<typeof import('@ordr/integrations')>('@ordr/integrations');
  return {
    ...actual,
    INTEGRATION_PROVIDERS: {
      salesforce: { name: 'Salesforce', authType: 'oauth2' },
      hubspot: { name: 'HubSpot', authType: 'oauth2' },
    },
    SYNC_DIRECTIONS: ['inbound', 'outbound', 'bidirectional'],
    ENTITY_TYPES: ['contact', 'deal', 'activity'],
    ensureFreshCredentials: vi.fn().mockResolvedValue({
      accessToken: 'test-at',
      refreshToken: 'test-rt',
      tokenType: 'Bearer',
      expiresAt: new Date(Date.now() + 3_600_000),
      scope: 'read write',
    }),
  };
});

// ─── Mock Adapter ─────────────────────────────────────────────────

function createMockAdapter(): CRMAdapter {
  return {
    getAuthorizationUrl: vi.fn().mockResolvedValue({
      authorizationUrl: 'https://login.salesforce.com/oauth?client_id=test',
      state: 'random-state-abc',
    }),
    exchangeToken: vi.fn().mockResolvedValue({
      credentials: {
        accessToken: 'access-token-xyz',
        refreshToken: 'refresh-token-xyz',
        expiresAt: '2026-12-31T00:00:00Z',
      },
    }),
    getContact: vi.fn().mockResolvedValue({
      id: 'sf-contact-1',
      email: 'john@example.com',
      firstName: 'John',
      lastName: 'Doe',
    }),
    listContacts: vi.fn().mockResolvedValue({
      items: [
        { id: 'sf-contact-1', email: 'john@example.com', firstName: 'John', lastName: 'Doe' },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    }),
    upsertContact: vi.fn().mockResolvedValue({
      id: 'sf-contact-1',
      email: 'john@example.com',
      firstName: 'John',
      lastName: 'Doe',
    }),
    deleteContact: vi.fn().mockResolvedValue(undefined),
    getDeal: vi.fn().mockResolvedValue({
      id: 'sf-deal-1',
      name: 'Enterprise Deal',
      amount: 50000,
      stage: 'Negotiation',
    }),
    listDeals: vi.fn().mockResolvedValue({
      items: [{ id: 'sf-deal-1', name: 'Enterprise Deal', amount: 50000, stage: 'Negotiation' }],
      total: 1,
      limit: 50,
      offset: 0,
    }),
    getHealth: vi.fn().mockResolvedValue({
      status: 'healthy',
      provider: 'salesforce',
      latencyMs: 42,
      lastCheckedAt: new Date().toISOString(),
    }),
    webhookSignatureValid: vi.fn().mockReturnValue(true),
  } as unknown as CRMAdapter;
}

function createTestApp(adapters?: Map<string, CRMAdapter>): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'integrations', action: 'read' }],
    });
    await next();
  });

  if (adapters) {
    configureIntegrationRoutes({ adapters });
  }

  app.route('/api/v1/integrations', integrationsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Integrations Routes', () => {
  let mockAdapter: CRMAdapter;
  let adapters: Map<string, CRMAdapter>;

  beforeEach(async () => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockAdapter = createMockAdapter();
    adapters = new Map([['salesforce', mockAdapter]]);
    configureIntegrationRoutes({ adapters });

    const subStore = new InMemorySubscriptionStore();
    await subStore.saveSubscription({
      id: 'sub-test',
      tenant_id: 'tenant-1',
      stripe_subscription_id: 'stripe-test',
      plan_tier: 'professional',
      status: 'active',
      current_period_start: new Date('2026-01-01'),
      current_period_end: new Date('2027-01-01'),
      cancel_at_period_end: false,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });
    configureBillingGate(
      new SubscriptionManager({
        store: subStore,
        stripe: new MockStripeClient(),
        auditLogger: new AuditLogger(new InMemoryAuditStore()),
        fieldEncryptor: new FieldEncryptor(Buffer.from('test-key-32-bytes-for-unit-tests!')),
      }),
    );
  });

  // ─── GET /providers ───────────────────────────────────────────

  describe('GET /api/v1/integrations/providers', () => {
    it('returns provider list without auth with 200', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/providers');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: string[] };
      expect(body.success).toBe(true);
      expect(body.data).toContain('salesforce');
      expect(body.data).toContain('hubspot');
    });
  });

  // ─── GET /:provider ───────────────────────────────────────────

  describe('GET /api/v1/integrations/:provider', () => {
    it('returns integration health with 200', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { status: string };
        provider: string;
      };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('healthy');
      expect(body.provider).toBe('salesforce');
    });

    it('returns 404 for unknown provider', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/unknown-crm');

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /:provider/authorize ────────────────────────────────

  describe('POST /api/v1/integrations/:provider/authorize', () => {
    it('returns OAuth authorization URL with 200', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirectUri: 'https://app.example.com/oauth/callback',
          state: 'csrf-token-abc123',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { authorizationUrl: string } };
      expect(body.success).toBe(true);
      expect(body.data.authorizationUrl).toBeDefined();
    });

    it('returns 400 for invalid redirectUri', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUri: 'not-a-url', state: 'abc' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /:provider/callback ─────────────────────────────────

  describe('POST /api/v1/integrations/:provider/callback', () => {
    it('exchanges code and returns connected status with 200', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'auth-code-xyz' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { connected: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(true);
      // Access token must NOT be in response — security invariant
      expect(JSON.stringify(body)).not.toContain('access-token-xyz');
    });

    it('returns 400 for missing code', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /:provider/contacts ──────────────────────────────────

  describe('GET /api/v1/integrations/:provider/contacts', () => {
    it('returns contact list with 200', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/contacts');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[]; total: number };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
      expect(body.total).toBe(1);
    });

    it('passes pagination parameters to listContacts', async () => {
      const app = createTestApp(adapters);
      await app.request('/api/v1/integrations/salesforce/contacts?q=john&limit=25&offset=50');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockAdapter.listContacts).toHaveBeenCalledWith(
        'john',
        expect.objectContaining({ limit: 25, offset: 50 }),
      );
    });
  });

  // ─── GET /:provider/contacts/:id ─────────────────────────────

  describe('GET /api/v1/integrations/:provider/contacts/:id', () => {
    it('returns a specific contact with 200', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/contacts/sf-contact-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('sf-contact-1');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockAdapter.getContact).toHaveBeenCalledWith('sf-contact-1');
    });
  });

  // ─── POST /:provider/contacts ─────────────────────────────────

  describe('POST /api/v1/integrations/:provider/contacts', () => {
    it('upserts a contact and returns 200', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'john@example.com', firstName: 'John', lastName: 'Doe' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('sf-contact-1');
    });

    it('returns 400 for invalid email', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /:provider/contacts/:id ──────────────────────────

  describe('DELETE /api/v1/integrations/:provider/contacts/:id', () => {
    it('deletes a contact and returns 200', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/contacts/sf-contact-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockAdapter.deleteContact).toHaveBeenCalledWith('sf-contact-1');
    });
  });

  // ─── GET /:provider/deals ─────────────────────────────────────

  describe('GET /api/v1/integrations/:provider/deals', () => {
    it('returns deal list with 200', async () => {
      const app = createTestApp(adapters);
      const res = await app.request('/api/v1/integrations/salesforce/deals');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[]; total: number };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
      expect(body.total).toBe(1);
    });

    it('passes pagination parameters to listDeals', async () => {
      const app = createTestApp(adapters);
      await app.request('/api/v1/integrations/salesforce/deals?q=enterprise&limit=10&offset=0');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockAdapter.listDeals).toHaveBeenCalledWith(
        'enterprise',
        expect.objectContaining({ limit: 10, offset: 0 }),
      );
    });
  });

  // ─── Auth Enforcement ─────────────────────────────────────────

  describe('auth enforcement', () => {
    it('calls authenticateRequest on protected provider routes', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp(adapters);

      await app.request('/api/v1/integrations/salesforce');

      expect(authenticateRequest).toHaveBeenCalled();
    });
  });
});

// ─── Extended deps helpers ────────────────────────────────────────
// Mocks for Phase 52 activity/field-mapping/disconnect endpoints

const mockFetchActivities = vi.fn().mockResolvedValue({
  data: [
    {
      externalId: 'act-1',
      type: 'call',
      subject: 'Demo call',
      description: null,
      contactExternalId: null,
      dealExternalId: null,
      dueDate: null,
      completedAt: null,
      lastModified: new Date(),
      metadata: {},
    },
  ],
  total: 1,
  hasMore: false,
  nextCursor: null,
});
const mockPushActivity = vi.fn().mockResolvedValue('sf-act-1');
const mockListFieldMappings = vi.fn().mockResolvedValue([]);
const mockReplaceFieldMappings = vi.fn().mockResolvedValue(undefined);
const mockGetAdapterDefaultMappings = vi
  .fn()
  .mockReturnValue([
    { entityType: 'contact', direction: 'both', sourceField: 'email', targetField: 'Email' },
  ]);
const mockDisconnectIntegration = vi.fn().mockResolvedValue(undefined);
const mockAuditLogExt = vi.fn().mockResolvedValue(undefined);

/**
 * Creates a test app wired with Phase 52 extended deps.
 * Provides oauthConfigs + mocked ensureFreshCredentials so withCredentials
 * middleware succeeds for /:provider/activities routes.
 */
function createAppWithExtendedDeps(): Hono<Env> {
  const extAdapter = {
    ...createMockAdapter(),
    fetchActivities: mockFetchActivities,
    pushActivity: mockPushActivity,
    refreshAccessToken: vi.fn().mockResolvedValue({
      credentials: {
        accessToken: 'test-at',
        refreshToken: 'test-rt',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 3_600_000),
        scope: 'read write',
      },
    }),
  } as unknown as CRMAdapter;
  const extAdapters = new Map([['salesforce', extAdapter]]);

  configureIntegrationRoutes({
    adapters: extAdapters,
    listFieldMappings: mockListFieldMappings,
    replaceFieldMappings: mockReplaceFieldMappings,
    getAdapterDefaultMappings: mockGetAdapterDefaultMappings,
    disconnectIntegration: mockDisconnectIntegration,
    auditLogger: { log: mockAuditLogExt },
    // Required so withCredentials doesn't crash at oauthConfigs.get():
    oauthConfigs: new Map([['salesforce', {} as never]]),
    credManagerDeps: {} as never,
    fieldEncryptor: {} as never,
    // Webhook deps stubs (not exercised in these tests):
    lookupTenantByProvider: vi.fn().mockResolvedValue(null),
    insertWebhookLog: vi.fn().mockResolvedValue('log-1'),
    updateWebhookLogProcessed: vi.fn().mockResolvedValue(undefined),
    getWebhookSecret: vi.fn().mockResolvedValue(null),
    isRecentDuplicateWebhook: vi.fn().mockResolvedValue(false),
    eventProducer: { emit: vi.fn() } as never,
  } as never);

  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'integrations', action: 'read' }],
    });
    await next();
  });
  app.route('/api/v1/integrations', integrationsRouter);
  return app;
}

// ─── Activity endpoint tests ──────────────────────────────────────

describe('GET /api/v1/integrations/:provider/activities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns activities list with total and hasMore', async () => {
    const app = createAppWithExtendedDeps();
    const res = await app.request('/api/v1/integrations/salesforce/activities');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; items: unknown[]; hasMore: boolean };
    expect(body.success).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.hasMore).toBe(false);
    expect(mockFetchActivities).toHaveBeenCalledOnce();
  });
});

describe('POST /api/v1/integrations/:provider/activities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes activity and returns 201 with externalId', async () => {
    const app = createAppWithExtendedDeps();
    const res = await app.request('/api/v1/integrations/salesforce/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: '00000000-0000-0000-0000-000000000001',
        type: 'call',
        subject: 'Demo call',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; externalId: string };
    expect(body.success).toBe(true);
    expect(body.externalId).toBe('sf-act-1');
  });

  it('returns 400 for invalid body (missing type)', async () => {
    const app = createAppWithExtendedDeps();
    const res = await app.request('/api/v1/integrations/salesforce/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: '00000000-0000-0000-0000-000000000001',
        subject: 'Demo call',
        // type missing — required field
      }),
    });

    expect(res.status).toBe(400);
  });
});

// ─── Field mapping endpoint tests ────────────────────────────────

describe('GET /api/v1/integrations/:provider/field-mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stored mappings when custom rows exist', async () => {
    mockListFieldMappings.mockResolvedValueOnce([
      {
        id: 'm-1',
        entityType: 'contact',
        direction: 'both',
        sourceField: 'email',
        targetField: 'Email',
        transform: null,
      },
    ]);
    const app = createAppWithExtendedDeps();
    const res = await app.request('/api/v1/integrations/salesforce/field-mappings');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it('returns adapter defaults when no custom rows exist', async () => {
    mockListFieldMappings.mockResolvedValueOnce([]);
    const app = createAppWithExtendedDeps();
    const res = await app.request('/api/v1/integrations/salesforce/field-mappings');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    // Default from mockGetAdapterDefaultMappings (1 entry)
    expect(body.data).toHaveLength(1);
    expect(mockGetAdapterDefaultMappings).toHaveBeenCalledWith('salesforce');
  });
});

describe('PUT /api/v1/integrations/:provider/field-mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces mappings and returns 200', async () => {
    const app = createAppWithExtendedDeps();
    const res = await app.request('/api/v1/integrations/salesforce/field-mappings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mappings: [
          { entityType: 'contact', direction: 'both', sourceField: 'email', targetField: 'Email' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(mockReplaceFieldMappings).toHaveBeenCalledOnce();
    expect(mockReplaceFieldMappings).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', provider: 'salesforce' }),
    );
  });

  it('returns 400 when mappings array exceeds 200', async () => {
    const app = createAppWithExtendedDeps();
    const res = await app.request('/api/v1/integrations/salesforce/field-mappings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mappings: Array.from({ length: 201 }, () => ({
          entityType: 'contact',
          direction: 'both',
          sourceField: 'email',
          targetField: 'Email',
        })),
      }),
    });

    expect(res.status).toBe(400);
  });
});

// ─── Disconnect endpoint test ─────────────────────────────────────

describe('DELETE /api/v1/integrations/:provider (disconnect)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disconnects integration and returns 204', async () => {
    const app = createAppWithExtendedDeps();
    const res = await app.request('/api/v1/integrations/salesforce', {
      method: 'DELETE',
    });

    expect(res.status).toBe(204);
    expect(mockDisconnectIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', provider: 'salesforce' }),
    );
  });
});
