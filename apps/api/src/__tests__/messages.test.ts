/**
 * Message route tests
 *
 * Verifies:
 * - GET / — list messages (metadata only, no content)
 * - GET /:id — get message detail (metadata only)
 * - POST /send — manual send with consent + compliance gates
 *
 * SECURITY: Message content is NEVER returned in responses — metadata only
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createTenantId } from '@ordr/core';
import { requestId } from '../middleware/request-id.js';
import { messagesRouter, configureMessageRoutes } from '../routes/messages.js';
import { configureAuth } from '../middleware/auth.js';
import { configureBillingGate } from '../middleware/plan-gate.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { ComplianceViolationError } from '@ordr/core';
import { SubscriptionManager, InMemorySubscriptionStore, MockStripeClient } from '@ordr/billing';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { FieldEncryptor } from '@ordr/crypto';

// Mock @ordr/auth so requireAuth() succeeds with our test context
vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [
        { resource: 'messages', action: 'create', scope: 'tenant' },
        { resource: 'messages', action: 'read', scope: 'tenant' },
      ],
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

// ---- Test Helpers -----------------------------------------------------------

function createMockAuditLogger() {
  return {
    log: vi.fn().mockResolvedValue({
      id: 'audit-1',
      sequenceNumber: 1,
      hash: 'abc',
      previousHash: '000',
    }),
    getLastEvent: vi.fn().mockResolvedValue(null),
    verifyIntegrity: vi.fn(),
    generateMerkleRoot: vi.fn(),
    generateProof: vi.fn(),
    verifyProof: vi.fn(),
  };
}

function createMockEventProducer() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    publishBatch: vi.fn().mockResolvedValue(undefined),
  };
}

const mockMessage = {
  id: 'msg-1',
  tenantId: 'tenant-1',
  customerId: 'cust-1',
  channel: 'sms',
  direction: 'outbound',
  status: 'delivered',
  sentAt: new Date('2026-01-01'),
  deliveredAt: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  // Simulate authenticated user
  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: createTenantId('tenant-1'),
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    });
    await next();
  });

  app.route('/api/v1/messages', messagesRouter);
  return app;
}

// ---- Tests ------------------------------------------------------------------

describe('Message Routes', () => {
  let mockAudit: ReturnType<typeof createMockAuditLogger>;
  let mockProducer: ReturnType<typeof createMockEventProducer>;

  beforeEach(() => {
    // Configure auth with a dummy JWT config so requireAuth() doesn't
    // short-circuit with "Authentication service unavailable"
    configureAuth({
      publicKey: 'test-key',
      privateKey: 'test-key',
      issuer: 'test',
      audience: 'test',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockAudit = createMockAuditLogger();
    mockProducer = createMockEventProducer();

    configureMessageRoutes({
      auditLogger: mockAudit as never,
      eventProducer: mockProducer as never,
      consentManager: {
        verifyConsentForSend: vi.fn().mockResolvedValue({ success: true }),
      } as never,
      consentStore: {} as never,
      complianceGate: {
        check: vi
          .fn()
          .mockReturnValue({ allowed: true, results: [], violations: [], timestamp: new Date() }),
      } as never,
      smsProvider: {
        send: vi
          .fn()
          .mockResolvedValue({ success: true, data: { messageId: 'sms-1', status: 'sent' } }),
      } as never,
      emailProvider: {
        send: vi
          .fn()
          .mockResolvedValue({ success: true, data: { messageId: 'email-1', status: 'queued' } }),
      } as never,
      findMessageById: vi.fn().mockResolvedValue(mockMessage),
      listMessages: vi.fn().mockResolvedValue({ data: [mockMessage], total: 1 }),
      createMessage: vi.fn().mockResolvedValue(mockMessage),
      getCustomerContact: vi
        .fn()
        .mockResolvedValue({ contact: '+14155551234', contentBody: 'Hello World' }),
    });

    // Configure billing gate — messages router uses quotaGate('messages') on POST /send
    const subStore = new InMemorySubscriptionStore();
    void subStore.saveSubscription({
      id: 'sub-test-001',
      tenant_id: 'tenant-1',
      plan_tier: 'professional',
      status: 'active',
      stripe_subscription_id: 'sub_test',
      current_period_start: new Date(),
      current_period_end: new Date(Date.now() + 30 * 86_400_000),
      cancel_at_period_end: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const billingAudit = new AuditLogger(new InMemoryAuditStore());
    const fieldEncryptor = new FieldEncryptor(Buffer.from('test-key-32-bytes-for-unit-tests!'));
    configureBillingGate(
      new SubscriptionManager({
        store: subStore,
        stripe: new MockStripeClient(),
        auditLogger: billingAudit,
        fieldEncryptor,
      }),
    );
  });

  // ---- GET / ------------------------------------------------------------------

  describe('GET /api/v1/messages', () => {
    it('returns paginated message list with metadata only', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/messages');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: Record<string, unknown>[];
        pagination: { total: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
      expect(body.pagination.total).toBe(1);
    });

    it('does NOT include message content in response', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/messages');

      const body = (await res.json()) as { data: Record<string, unknown>[] };
      for (const msg of body.data) {
        expect(msg).not.toHaveProperty('content');
        expect(msg).not.toHaveProperty('body');
        expect(msg).not.toHaveProperty('contentRef');
        expect(msg).not.toHaveProperty('contentHash');
      }
    });

    it('supports customerId filter', async () => {
      const app = createTestApp();
      const res = await app.request(
        '/api/v1/messages?customerId=00000000-0000-0000-0000-000000000001',
      );

      expect(res.status).toBe(200);
    });

    it('supports channel filter', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/messages?channel=sms');

      expect(res.status).toBe(200);
    });
  });

  // ---- GET /:id ---------------------------------------------------------------

  describe('GET /api/v1/messages/:id', () => {
    it('returns message metadata', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/messages/msg-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('msg-1');
    });

    it('does NOT include content in single message response', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/messages/msg-1');

      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data).not.toHaveProperty('content');
      expect(body.data).not.toHaveProperty('contentRef');
    });

    it('returns 404 for non-existent message', async () => {
      configureMessageRoutes({
        auditLogger: mockAudit as never,
        eventProducer: mockProducer as never,
        consentManager: { verifyConsentForSend: vi.fn() } as never,
        consentStore: {} as never,
        complianceGate: { check: vi.fn() } as never,
        smsProvider: { send: vi.fn() } as never,
        emailProvider: { send: vi.fn() } as never,
        findMessageById: vi.fn().mockResolvedValue(null),
        listMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
        createMessage: vi.fn(),
        getCustomerContact: vi.fn(),
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/messages/non-existent');

      expect(res.status).toBe(404);
    });
  });

  // ---- POST /send -------------------------------------------------------------

  describe('POST /api/v1/messages/send', () => {
    it('sends message after consent + compliance checks', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: '00000000-0000-0000-0000-000000000001',
          channel: 'sms',
          contentRef: 'encrypted-content-ref-123',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('returns 451 when consent check fails', async () => {
      configureMessageRoutes({
        auditLogger: mockAudit as never,
        eventProducer: mockProducer as never,
        consentManager: {
          verifyConsentForSend: vi.fn().mockResolvedValue({
            success: false,
            error: new ComplianceViolationError('TCPA requires consent', 'TCPA'),
          }),
        } as never,
        consentStore: {} as never,
        complianceGate: { check: vi.fn() } as never,
        smsProvider: { send: vi.fn() } as never,
        emailProvider: { send: vi.fn() } as never,
        findMessageById: vi.fn(),
        listMessages: vi.fn(),
        createMessage: vi.fn(),
        getCustomerContact: vi.fn(),
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: '00000000-0000-0000-0000-000000000001',
          channel: 'sms',
          contentRef: 'ref-123',
        }),
      });

      expect(res.status).toBe(451);
    });

    it('publishes interaction.logged event on send', async () => {
      const app = createTestApp();
      await app.request('/api/v1/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: '00000000-0000-0000-0000-000000000001',
          channel: 'sms',
          contentRef: 'ref-123',
        }),
      });

      expect(mockProducer.publish).toHaveBeenCalled();
    });

    it('returns 400 for invalid channel', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: '00000000-0000-0000-0000-000000000001',
          channel: 'pigeon',
          contentRef: 'ref-123',
        }),
      });

      expect(res.status).toBe(400);
    });
  });
});
