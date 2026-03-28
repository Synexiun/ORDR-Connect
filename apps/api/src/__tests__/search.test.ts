/**
 * Search route tests
 *
 * Verifies:
 * - POST / — full-text search
 * - GET /suggest — type-ahead suggestions
 * - POST /faceted — faceted search
 * - POST /index — index entity (admin only)
 * - DELETE /index/:entityType/:entityId — remove from index (admin only)
 * - POST /reindex/:entityType — reindex type (admin only)
 * - Auth required on all routes
 * - Tenant isolation from JWT context
 * - Limit validation against MAX_SEARCH_LIMIT
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { searchRouter, configureSearchRoutes } from '../routes/search.js';
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
      permissions: [{ resource: 'search', action: 'read', scope: 'tenant' }],
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

vi.mock('@ordr/search', async () => {
  const actual = await vi.importActual<typeof import('@ordr/search')>('@ordr/search');
  return {
    ...actual,
    MAX_SEARCH_LIMIT: 100,
    MAX_SUGGESTION_LIMIT: 20,
    SEARCHABLE_ENTITY_TYPES: ['contact', 'deal', 'ticket', 'activity'],
  };
});

// ─── Mock Dependencies ────────────────────────────────────────────

function createMockEngine() {
  return {
    // Returns SearchResults directly (no wrapper)
    search: vi.fn().mockResolvedValue({
      results: [{ id: 'contact-1', entityType: 'contact', score: 0.95, displayTitle: 'John Doe' }],
      total: 1,
      facets: [],
      took: 5,
    }),
    // Returns Suggestion[] directly (no wrapper)
    suggest: vi
      .fn()
      .mockResolvedValue([{ id: 'contact-1', label: 'John Doe', entityType: 'contact' }]),
    // Returns SearchResults directly (no wrapper)
    facetedSearch: vi.fn().mockResolvedValue({
      results: [],
      total: 10,
      facets: [{ field: 'status', buckets: [{ value: 'active', count: 10 }] }],
      took: 3,
    }),
  };
}

function createMockIndexer() {
  return {
    // Returns IndexEntry directly (no wrapper)
    indexEntity: vi.fn().mockResolvedValue({
      id: 'idx-1',
      entityType: 'contact',
      entityId: 'contact-1',
      tenantId: 'tenant-1',
      indexed_at: new Date().toISOString(),
    }),
    // removeEntity returns boolean
    removeEntity: vi.fn().mockResolvedValue(true),
    // reindexAll returns count number
    reindexAll: vi.fn().mockResolvedValue(42),
  };
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [{ resource: 'search', action: 'read' }],
    });
    await next();
  });

  app.route('/api/v1/search', searchRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Search Routes', () => {
  let mockEngine: ReturnType<typeof createMockEngine>;
  let mockIndexer: ReturnType<typeof createMockIndexer>;

  beforeEach(async () => {
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockEngine = createMockEngine();
    mockIndexer = createMockIndexer();
    configureSearchRoutes({
      engine: mockEngine as never,
      indexer: mockIndexer as never,
    });

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

  // ─── POST / ───────────────────────────────────────────────────

  describe('POST /api/v1/search', () => {
    it('returns search results with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'john doe', limit: 10 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[]; total: number };
      expect(body.success).toBe(true);
      expect(body.total).toBe(1);
    });

    it('passes query and tenantId positionally to search engine', async () => {
      const app = createTestApp();
      await app.request('/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test' }),
      });

      expect(mockEngine.search).toHaveBeenCalledWith('test', expect.any(Object), 'tenant-1');
    });

    it('returns 400 for missing query', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when limit exceeds MAX_SEARCH_LIMIT', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test', limit: 9999 }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /suggest ─────────────────────────────────────────────

  describe('GET /api/v1/search/suggest', () => {
    it('returns suggestions with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search/suggest?q=john');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
    });

    it('passes prefix, entityType and tenantId positionally to suggest engine', async () => {
      const app = createTestApp();
      await app.request('/api/v1/search/suggest?q=john&entityType=contact');

      expect(mockEngine.suggest).toHaveBeenCalledWith('john', 'contact', 'tenant-1');
    });

    it('returns 400 for missing q parameter', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search/suggest');

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /faceted ────────────────────────────────────────────

  describe('POST /api/v1/search/faceted', () => {
    it('returns faceted results with 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search/faceted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facets: [{ type: 'entity_type', field: 'status' }],
          query: 'active',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns 400 for empty facets array', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search/faceted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facets: [] }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /index ──────────────────────────────────────────────

  describe('POST /api/v1/search/index', () => {
    it('indexes an entity and returns 201', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'contact',
          entityId: 'contact-1',
          fields: {
            email: { value: 'john@example.com', weight: 'A', isPhi: false },
            name: { value: 'John Doe', weight: 'B', isPhi: false },
          },
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns 400 for invalid entityType', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'invalid_type',
          entityId: 'e-1',
          fields: {},
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /index/:entityType/:entityId ──────────────────────

  describe('DELETE /api/v1/search/index/:entityType/:entityId', () => {
    it('removes entity from index and returns 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search/index/contact/contact-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
      expect(mockIndexer.removeEntity).toHaveBeenCalledWith('contact', 'contact-1', 'tenant-1');
    });
  });

  // ─── POST /reindex/:entityType ────────────────────────────────

  describe('POST /api/v1/search/reindex/:entityType', () => {
    it('triggers reindex and returns 200', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/search/reindex/contact', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { reindexed: number } };
      expect(body.success).toBe(true);
      expect(body.data.reindexed).toBe(42);
    });

    it('passes entityType and tenantId to reindexAll', async () => {
      const app = createTestApp();
      await app.request('/api/v1/search/reindex/deal', { method: 'POST' });

      expect(mockIndexer.reindexAll).toHaveBeenCalledWith('deal', 'tenant-1');
    });
  });

  // ─── Auth Enforcement ─────────────────────────────────────────

  describe('auth enforcement', () => {
    it('calls authenticateRequest on search routes', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      const app = createTestApp();

      await app.request('/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test' }),
      });

      expect(authenticateRequest).toHaveBeenCalled();
    });
  });
});
