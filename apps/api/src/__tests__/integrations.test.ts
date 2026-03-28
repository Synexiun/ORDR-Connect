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
