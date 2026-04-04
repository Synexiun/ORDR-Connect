/**
 * Webhook inbound endpoint tests
 *
 * Verifies:
 * - Valid HMAC (Salesforce) → 200 { received: true }, Kafka published
 * - Invalid HMAC → 200 { received: true }, no Kafka publish, compliance.violation audit
 * - HubSpot replay attack (stale timestamp) → signature treated as invalid, no Kafka
 * - Unknown provider → 200 { received: true } (always-200 policy to prevent retry storms)
 * - Malformed JSON body → 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { configureIntegrationRoutes, integrationsRouter } from '../routes/integrations.js';

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
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

const TENANT_ID = 'tenant-1';
const WEBHOOK_SECRET = 'super-secret-key-for-testing-hmac';
const RAW_BODY = JSON.stringify({
  event_type: 'contact.created',
  Id: 'sf-001',
  object_type: 'contact',
});

function sfSignature(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('base64');
}

const mockInsertWebhookLog = vi.fn().mockResolvedValue('wh-log-1');
const mockUpdateWebhookLogProcessed = vi.fn().mockResolvedValue(undefined);
const mockLookupTenant = vi.fn().mockResolvedValue(TENANT_ID);
const mockGetWebhookSecret = vi.fn().mockResolvedValue('encrypted-secret');
const mockIsRecentDuplicate = vi.fn().mockResolvedValue(false);
const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockAuditLog = vi.fn().mockResolvedValue(undefined);
const mockFieldEncryptor = {
  decryptField: vi.fn().mockReturnValue(WEBHOOK_SECRET),
  encryptField: vi.fn(),
};
const mockAdapter = {
  handleWebhook: vi.fn().mockReturnValue({
    provider: 'salesforce',
    eventType: 'contact.created',
    entityType: 'contact',
    entityId: 'sf-001',
    data: {},
    timestamp: new Date(),
  }),
  getHealth: vi.fn().mockResolvedValue({ status: 'healthy', latencyMs: 10 }),
};

function buildApp(adapters?: Map<string, never>): Hono<Env> {
  configureIntegrationRoutes({
    adapters: adapters ?? new Map([['salesforce', mockAdapter as never]]),
    lookupTenantByProvider: mockLookupTenant,
    insertWebhookLog: mockInsertWebhookLog,
    updateWebhookLogProcessed: mockUpdateWebhookLogProcessed,
    getWebhookSecret: mockGetWebhookSecret,
    isRecentDuplicateWebhook: mockIsRecentDuplicate,
    fieldEncryptor: mockFieldEncryptor as never,
    credManagerDeps: {} as never,
    oauthConfigs: new Map(),
    eventProducer: { publish: mockPublish } as never,
    auditLogger: { log: mockAuditLog },
  });

  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/integrations', integrationsRouter);
  return app;
}

describe('POST /integrations/:provider/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('valid Salesforce HMAC → 200 received:true, Kafka published', async () => {
    const app = buildApp();
    const sig = sfSignature(RAW_BODY);
    const res = await app.request('/integrations/salesforce/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-salesforce-signature': sig,
      },
      body: RAW_BODY,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.received).toBe(true);
    expect(mockPublish).toHaveBeenCalledOnce();
    expect(mockUpdateWebhookLogProcessed).toHaveBeenCalledWith({ id: 'wh-log-1' });
  });

  it('invalid HMAC → 200 received:true, no Kafka, compliance.violation audit', async () => {
    const app = buildApp();
    const res = await app.request('/integrations/salesforce/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-salesforce-signature': 'wrong-sig',
      },
      body: RAW_BODY,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['received']).toBe(true);
    expect(mockPublish).not.toHaveBeenCalled();

    const auditCalls = mockAuditLog.mock.calls as Array<[{ eventType: string }]>;
    expect(auditCalls.some(([e]) => e.eventType === 'compliance.violation')).toBe(true);
  });

  it('HubSpot: stale timestamp → signature treated as invalid, no Kafka', async () => {
    const mockHsAdapter = {
      handleWebhook: vi.fn().mockReturnValue({
        entityType: 'contact',
        entityId: 'hs-1',
        eventType: 'contact.creation',
        data: {},
      }),
    };
    const app = buildApp(new Map([['hubspot', mockHsAdapter as never]]));
    const staleTs = String(Date.now() - 10 * 60 * 1000); // 10 minutes ago

    const res = await app.request('/integrations/hubspot/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hubspot-signature-v3': 'any-sig',
        'x-hubspot-request-timestamp': staleTs,
      },
      body: JSON.stringify({
        subscriptionType: 'contact.creation',
        objectType: 'contact',
        objectId: 'hs-1',
      }),
    });

    expect(res.status).toBe(200);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('unknown provider → 200 received:true (always-200 policy prevents retry storms)', async () => {
    const app = buildApp();
    const res = await app.request('/integrations/unknown/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.received).toBe(true);
  });

  it('malformed JSON → 400', async () => {
    const app = buildApp();
    const res = await app.request('/integrations/salesforce/webhook', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
