/**
 * WhatsApp webhook route tests
 *
 * Verifies:
 * - POST / — signature validation, inbound messages, opt-out handling, status updates
 *
 * SECURITY: Webhook routes do NOT use JWT auth — they use Twilio signature validation
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import {
  whatsappWebhooksRouter,
  configureWhatsAppWebhookRoutes,
} from '../routes/webhooks-whatsapp.js';

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

function createMockWhatsAppProvider(signatureValid = true) {
  return {
    validateWebhookSignature: vi.fn().mockReturnValue(signatureValid),
    parseWebhook: vi.fn().mockReturnValue({
      success: true,
      data: {
        from: '+14155551234',
        body: 'Hello',
        numMedia: 0,
        mediaUrls: [],
        profileName: 'John',
        waId: '14155551234',
        messageSid: 'SM_wa_inbound_123',
        accountSid: 'AC_test_456',
      },
    }),
    parseStatusWebhook: vi.fn().mockReturnValue({
      success: true,
      data: {
        messageSid: 'SM_wa_status_123',
        accountSid: 'AC_test_456',
        messageStatus: 'delivered',
        from: '+15005550006',
        to: '+14155551234',
        channelPrefix: 'whatsapp',
        errorCode: undefined,
        timestamp: new Date(),
      },
    }),
    mapTwilioStatusToMessageStatus: vi.fn().mockReturnValue('delivered'),
  };
}

function createMockConsentManager(isOptOut = false) {
  return {
    isOptOutKeyword: vi.fn().mockReturnValue(isOptOut),
    revokeConsent: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    checkConsent: vi.fn().mockResolvedValue('opted_in'),
    verifyConsentForSend: vi.fn().mockResolvedValue({ success: true, data: true }),
    recordConsent: vi.fn(),
    isOptInKeyword: vi.fn().mockReturnValue(false),
    buildOptOutRecord: vi.fn(),
  };
}

function createMockConsentStore() {
  return {
    getConsent: vi.fn().mockResolvedValue(undefined),
    saveConsent: vi.fn().mockResolvedValue(undefined),
    revokeConsent: vi.fn().mockResolvedValue(undefined),
  };
}

function buildFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function setupApp(signatureValid = true, isOptOut = false) {
  const mocks = {
    auditLogger: createMockAuditLogger(),
    eventProducer: createMockEventProducer(),
    whatsAppProvider: createMockWhatsAppProvider(signatureValid),
    consentManager: createMockConsentManager(isOptOut),
    consentStore: createMockConsentStore(),
    updateMessageStatus: vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      tenantId: 'tenant-1',
      customerId: 'cust-1',
    }),
    findCustomerByPhone: vi.fn().mockResolvedValue({
      customerId: 'cust-1',
      tenantId: 'tenant-1',
    }),
  };

  configureWhatsAppWebhookRoutes({
    ...mocks,
    auditLogger: mocks.auditLogger as never,
    whatsAppWebhookUrl: 'https://example.com/api/v1/webhooks/twilio/whatsapp',
  } as never);

  const app = new Hono<Env>();
  app.use('*', requestId);
  app.route('/api/v1/webhooks/twilio/whatsapp', whatsappWebhooksRouter);

  return { app, mocks };
}

// ---- POST / (inbound messages) ---------------------------------------------

describe('POST /api/v1/webhooks/twilio/whatsapp — inbound', () => {
  it('returns 403 for invalid signature', async () => {
    const { app } = setupApp(false);

    const body = buildFormBody({
      From: 'whatsapp:+14155551234',
      Body: 'Hello',
      MessageSid: 'SM_wa_123',
      AccountSid: 'AC_test_456',
      WaId: '14155551234',
    });

    const res = await app.request('/api/v1/webhooks/twilio/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'invalid',
      },
      body,
    });

    expect(res.status).toBe(403);
  });

  it('processes valid inbound WhatsApp message', async () => {
    const { app, mocks } = setupApp(true);

    const body = buildFormBody({
      From: 'whatsapp:+14155551234',
      Body: 'Hello from WhatsApp',
      MessageSid: 'SM_wa_123',
      AccountSid: 'AC_test_456',
      WaId: '14155551234',
      NumMedia: '0',
    });

    const res = await app.request('/api/v1/webhooks/twilio/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid-sig',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(mocks.eventProducer.publish).toHaveBeenCalled();
  });

  it('detects opt-out keyword and revokes consent', async () => {
    const { app, mocks } = setupApp(true, true);
    mocks.whatsAppProvider.parseWebhook.mockReturnValue({
      success: true,
      data: {
        from: '+14155551234',
        body: 'STOP',
        numMedia: 0,
        mediaUrls: [],
        profileName: 'John',
        waId: '14155551234',
        messageSid: 'SM_optout_123',
        accountSid: 'AC_test_456',
      },
    });

    const body = buildFormBody({
      From: 'whatsapp:+14155551234',
      Body: 'STOP',
      MessageSid: 'SM_optout_123',
      AccountSid: 'AC_test_456',
      WaId: '14155551234',
    });

    const res = await app.request('/api/v1/webhooks/twilio/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid-sig',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(mocks.consentManager.revokeConsent).toHaveBeenCalled();
    expect(mocks.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'opt_out_whatsapp',
      }),
    );
  });

  it('logs signature validation failure to audit', async () => {
    const { app, mocks } = setupApp(false);

    const body = buildFormBody({ From: 'whatsapp:+14155551234', Body: 'test' });
    await app.request('/api/v1/webhooks/twilio/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'bad-sig',
      },
      body,
    });

    expect(mocks.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'signature_validation_failed',
        resource: 'twilio_whatsapp_webhook',
      }),
    );
  });
});

// ---- POST / (status updates) -----------------------------------------------

describe('POST /api/v1/webhooks/twilio/whatsapp — status', () => {
  it('processes status update webhook', async () => {
    const { app, mocks } = setupApp(true);

    const body = buildFormBody({
      MessageSid: 'SM_wa_status_123',
      MessageStatus: 'delivered',
      From: 'whatsapp:+15005550006',
      To: 'whatsapp:+14155551234',
      AccountSid: 'AC_test_456',
    });

    const res = await app.request('/api/v1/webhooks/twilio/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid-sig',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(mocks.updateMessageStatus).toHaveBeenCalled();
    expect(mocks.eventProducer.publish).toHaveBeenCalled();
  });

  it('returns 200 TwiML even when status parse fails', async () => {
    const { app, mocks } = setupApp(true);
    mocks.whatsAppProvider.parseStatusWebhook.mockReturnValue({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'bad payload' },
    });

    const body = buildFormBody({
      MessageSid: 'SM_bad',
      MessageStatus: 'unknown-status',
      From: 'whatsapp:+15005550006',
      To: 'whatsapp:+14155551234',
      AccountSid: 'AC_test_456',
    });

    const res = await app.request('/api/v1/webhooks/twilio/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid-sig',
      },
      body,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<Response>');
  });

  it('handles missing customer gracefully on inbound', async () => {
    const { app, mocks } = setupApp(true);
    mocks.findCustomerByPhone.mockResolvedValue(null);

    const body = buildFormBody({
      From: 'whatsapp:+19999999999',
      Body: 'Unknown sender',
      MessageSid: 'SM_wa_unknown',
      AccountSid: 'AC_test_456',
      WaId: '19999999999',
    });

    const res = await app.request('/api/v1/webhooks/twilio/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid-sig',
      },
      body,
    });

    expect(res.status).toBe(200);
    // Should not publish event since customer not found
    expect(mocks.eventProducer.publish).not.toHaveBeenCalled();
  });
});
