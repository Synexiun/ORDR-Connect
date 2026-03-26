/**
 * Webhook route tests
 *
 * Verifies:
 * - POST /twilio — signature validation, status updates, opt-out handling
 * - POST /sendgrid — event parsing, status updates, unsubscribe handling
 *
 * SECURITY: Webhook routes do NOT use JWT auth — they use provider signature validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { webhooksRouter, configureWebhookRoutes } from '../routes/webhooks.js';

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

function createMockSmsProvider() {
  return {
    send: vi.fn().mockResolvedValue({ success: true, data: { messageId: 'msg-1', status: 'sent' } }),
    parseWebhook: vi.fn().mockReturnValue({
      success: true,
      data: {
        from: '+14155551234',
        to: '+14155555678',
        body: 'Hello',
        messageSid: 'SM123',
        accountSid: 'AC123',
        numMedia: 0,
        mediaUrls: [],
      },
    }),
    validateWebhookSignature: vi.fn().mockReturnValue(true),
  };
}

function createMockEmailProvider() {
  return {
    send: vi.fn().mockResolvedValue({ success: true, data: { messageId: 'email-1', status: 'queued' } }),
    parseWebhook: vi.fn().mockReturnValue({
      success: true,
      data: [{ email: 'test@example.com', event: 'delivered', timestamp: 123, sgMessageId: 'sg-1' }],
    }),
    mapEventToStatus: vi.fn().mockReturnValue('delivered'),
  };
}

function createMockConsentManager() {
  return {
    checkConsent: vi.fn().mockResolvedValue('opted_in'),
    verifyConsentForSend: vi.fn().mockResolvedValue({ success: true }),
    recordConsent: vi.fn().mockResolvedValue({ success: true }),
    revokeConsent: vi.fn().mockResolvedValue({ success: true }),
    isOptOutKeyword: vi.fn().mockReturnValue(false),
    isOptInKeyword: vi.fn().mockReturnValue(false),
    buildOptOutRecord: vi.fn(),
  };
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.route('/api/v1/webhooks', webhooksRouter);
  return app;
}

// ---- Tests ------------------------------------------------------------------

describe('Webhook Routes', () => {
  let mockAudit: ReturnType<typeof createMockAuditLogger>;
  let mockProducer: ReturnType<typeof createMockEventProducer>;
  let mockSms: ReturnType<typeof createMockSmsProvider>;
  let mockEmail: ReturnType<typeof createMockEmailProvider>;
  let mockConsent: ReturnType<typeof createMockConsentManager>;
  let mockUpdateStatus: ReturnType<typeof vi.fn>;
  let mockFindByPhone: ReturnType<typeof vi.fn>;
  let mockFindByEmail: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAudit = createMockAuditLogger();
    mockProducer = createMockEventProducer();
    mockSms = createMockSmsProvider();
    mockEmail = createMockEmailProvider();
    mockConsent = createMockConsentManager();
    mockUpdateStatus = vi.fn().mockResolvedValue({ messageId: 'msg-1', tenantId: 'tenant-1', customerId: 'cust-1' });
    mockFindByPhone = vi.fn().mockResolvedValue({ customerId: 'cust-1', tenantId: 'tenant-1' });
    mockFindByEmail = vi.fn().mockResolvedValue({ customerId: 'cust-1', tenantId: 'tenant-1' });

    configureWebhookRoutes({
      auditLogger: mockAudit as never,
      eventProducer: mockProducer as never,
      smsProvider: mockSms as never,
      emailProvider: mockEmail as never,
      consentManager: mockConsent as never,
      consentStore: {} as never,
      stateMachine: {} as never,
      twilioWebhookUrl: 'https://api.example.com/api/v1/webhooks/twilio',
      updateMessageStatus: mockUpdateStatus,
      findCustomerByPhone: mockFindByPhone,
      findCustomerByEmail: mockFindByEmail,
    });
  });

  // ---- POST /twilio -----------------------------------------------------------

  describe('POST /api/v1/webhooks/twilio', () => {
    it('returns 403 when Twilio signature is invalid', async () => {
      mockSms.validateWebhookSignature.mockReturnValue(false);

      const app = createTestApp();
      const res = await app.request('/api/v1/webhooks/twilio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'invalid-signature',
        },
        body: 'MessageSid=SM123&MessageStatus=delivered',
      });

      expect(res.status).toBe(403);
    });

    it('audits invalid signature attempts', async () => {
      mockSms.validateWebhookSignature.mockReturnValue(false);

      const app = createTestApp();
      await app.request('/api/v1/webhooks/twilio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'bad-sig',
        },
        body: 'MessageSid=SM123',
      });

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'compliance.violation',
          action: 'signature_validation_failed',
        }),
      );
    });

    it('processes delivery status updates', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/webhooks/twilio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'valid-sig',
        },
        body: 'MessageSid=SM123&MessageStatus=delivered&SmsSid=SM123',
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Response');
    });

    it('handles inbound SMS and checks for opt-out keywords', async () => {
      mockConsent.isOptOutKeyword.mockReturnValue(true);
      mockSms.parseWebhook.mockReturnValue({
        success: true,
        data: {
          from: '+14155551234',
          to: '+14155555678',
          body: 'STOP',
          messageSid: 'SM456',
          accountSid: 'AC123',
          numMedia: 0,
          mediaUrls: [],
        },
      });

      const app = createTestApp();
      const res = await app.request('/api/v1/webhooks/twilio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'valid-sig',
        },
        body: 'From=%2B14155551234&To=%2B14155555678&Body=STOP&MessageSid=SM456&AccountSid=AC123&Direction=inbound',
      });

      expect(res.status).toBe(200);
      expect(mockConsent.revokeConsent).toHaveBeenCalled();
    });

    it('publishes interaction.logged event for inbound messages', async () => {
      const app = createTestApp();
      await app.request('/api/v1/webhooks/twilio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'valid-sig',
        },
        body: 'From=%2B14155551234&To=%2B14155555678&Body=Hello&MessageSid=SM789&AccountSid=AC123&Direction=inbound',
      });

      expect(mockProducer.publish).toHaveBeenCalled();
    });

    it('returns TwiML response for inbound messages', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/webhooks/twilio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'valid-sig',
        },
        body: 'From=%2B14155551234&To=%2B14155555678&Body=Hi&MessageSid=SM101&AccountSid=AC123&Direction=inbound',
      });

      const text = await res.text();
      expect(text).toContain('<?xml');
      expect(text).toContain('Response');
    });
  });

  // ---- POST /sendgrid ---------------------------------------------------------

  describe('POST /api/v1/webhooks/sendgrid', () => {
    it('processes delivery events', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/webhooks/sendgrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { email: 'test@example.com', event: 'delivered', timestamp: 123, sg_message_id: 'sg-1' },
        ]),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { received: boolean };
      expect(body.received).toBe(true);
    });

    it('updates message status on delivery', async () => {
      const app = createTestApp();
      await app.request('/api/v1/webhooks/sendgrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { email: 'test@example.com', event: 'delivered', timestamp: 123, sg_message_id: 'sg-1' },
        ]),
      });

      expect(mockUpdateStatus).toHaveBeenCalled();
    });

    it('revokes consent on unsubscribe events', async () => {
      mockEmail.parseWebhook.mockReturnValue({
        success: true,
        data: [{ email: 'test@example.com', event: 'unsubscribe', timestamp: 123, sgMessageId: 'sg-1' }],
      });
      mockEmail.mapEventToStatus.mockReturnValue('opted_out');

      const app = createTestApp();
      await app.request('/api/v1/webhooks/sendgrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { email: 'test@example.com', event: 'unsubscribe', timestamp: 123, sg_message_id: 'sg-1' },
        ]),
      });

      expect(mockConsent.revokeConsent).toHaveBeenCalled();
    });

    it('revokes consent on spam report events', async () => {
      mockEmail.parseWebhook.mockReturnValue({
        success: true,
        data: [{ email: 'test@example.com', event: 'spamreport', timestamp: 123, sgMessageId: 'sg-2' }],
      });
      mockEmail.mapEventToStatus.mockReturnValue('opted_out');

      const app = createTestApp();
      await app.request('/api/v1/webhooks/sendgrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { email: 'test@example.com', event: 'spamreport', timestamp: 123, sg_message_id: 'sg-2' },
        ]),
      });

      expect(mockConsent.revokeConsent).toHaveBeenCalled();
    });

    it('handles invalid JSON gracefully', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/webhooks/sendgrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(200);
    });

    it('handles empty events array', async () => {
      mockEmail.parseWebhook.mockReturnValue({ success: true, data: [] });

      const app = createTestApp();
      const res = await app.request('/api/v1/webhooks/sendgrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([]),
      });

      expect(res.status).toBe(200);
    });
  });
});
