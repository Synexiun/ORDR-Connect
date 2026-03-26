/**
 * Voice webhook route tests
 *
 * Verifies:
 * - POST /status — signature validation, status updates, event publishing
 * - POST /recording — signature validation, recording reference storage
 * - POST /gather — signature validation, DTMF/speech parsing
 *
 * SECURITY: Webhook routes do NOT use JWT auth — they use Twilio signature validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { voiceWebhooksRouter, configureVoiceWebhookRoutes } from '../routes/webhooks-voice.js';

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

function createMockVoiceProvider(signatureValid = true) {
  return {
    validateWebhookSignature: vi.fn().mockReturnValue(signatureValid),
    parseStatusWebhook: vi.fn().mockReturnValue({
      success: true,
      data: {
        callSid: 'CA_test_123',
        accountSid: 'AC_test_456',
        callStatus: 'completed',
        from: '+14155551234',
        to: '+15005550006',
        direction: 'outbound-api',
        duration: 45,
        timestamp: new Date(),
      },
    }),
    parseRecordingWebhook: vi.fn().mockReturnValue({
      success: true,
      data: {
        recordingSid: 'RE_test_789',
        callSid: 'CA_test_123',
        accountSid: 'AC_test_456',
        recordingDuration: 30,
        recordingStatus: 'completed',
        timestamp: new Date(),
      },
    }),
    parseGatherWebhook: vi.fn().mockReturnValue({
      success: true,
      data: {
        callSid: 'CA_test_123',
        accountSid: 'AC_test_456',
        digits: '1',
        speechResult: undefined,
        confidence: undefined,
      },
    }),
    mapCallStatusToMessageStatus: vi.fn().mockReturnValue('delivered'),
  };
}

function buildFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function setupApp(signatureValid = true) {
  const mocks = {
    auditLogger: createMockAuditLogger(),
    eventProducer: createMockEventProducer(),
    voiceProvider: createMockVoiceProvider(signatureValid),
    updateCallStatus: vi.fn().mockResolvedValue({
      messageId: 'msg-1',
      tenantId: 'tenant-1',
      customerId: 'cust-1',
    }),
    storeRecordingReference: vi.fn().mockResolvedValue(undefined),
  };

  configureVoiceWebhookRoutes({
    ...mocks,
    voiceWebhookUrl: 'https://example.com/api/v1/webhooks/twilio/voice/status',
    voiceRecordingWebhookUrl: 'https://example.com/api/v1/webhooks/twilio/voice/recording',
    voiceGatherWebhookUrl: 'https://example.com/api/v1/webhooks/twilio/voice/gather',
  });

  const app = new Hono<Env>();
  app.use('*', requestId);
  app.route('/api/v1/webhooks/twilio/voice', voiceWebhooksRouter);

  return { app, mocks };
}

// ---- POST /status ----------------------------------------------------------

describe('POST /api/v1/webhooks/twilio/voice/status', () => {
  it('returns 403 for invalid signature', async () => {
    const { app } = setupApp(false);

    const body = buildFormBody({
      CallSid: 'CA_test_123',
      CallStatus: 'completed',
      From: '+14155551234',
      To: '+15005550006',
      AccountSid: 'AC_test_456',
    });

    const res = await app.request('/api/v1/webhooks/twilio/voice/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'invalid',
      },
      body,
    });

    expect(res.status).toBe(403);
  });

  it('processes valid voice status webhook', async () => {
    const { app, mocks } = setupApp(true);

    const body = buildFormBody({
      CallSid: 'CA_test_123',
      CallStatus: 'completed',
      From: '+14155551234',
      To: '+15005550006',
      AccountSid: 'AC_test_456',
      CallDuration: '45',
    });

    const res = await app.request('/api/v1/webhooks/twilio/voice/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid-sig',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(mocks.updateCallStatus).toHaveBeenCalled();
    expect(mocks.eventProducer.publish).toHaveBeenCalled();
  });

  it('returns 200 TwiML even when parse fails', async () => {
    const { app, mocks } = setupApp(true);
    mocks.voiceProvider.parseStatusWebhook.mockReturnValue({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'bad payload' },
    });

    const body = buildFormBody({ incomplete: 'data' });
    const res = await app.request('/api/v1/webhooks/twilio/voice/status', {
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

  it('logs signature validation failure to audit', async () => {
    const { app, mocks } = setupApp(false);

    const body = buildFormBody({ CallSid: 'CA_spoofed' });
    await app.request('/api/v1/webhooks/twilio/voice/status', {
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
        resource: 'twilio_voice_webhook',
      }),
    );
  });
});

// ---- POST /recording -------------------------------------------------------

describe('POST /api/v1/webhooks/twilio/voice/recording', () => {
  it('returns 403 for invalid signature', async () => {
    const { app } = setupApp(false);

    const body = buildFormBody({
      RecordingSid: 'RE_test_789',
      CallSid: 'CA_test_123',
    });

    const res = await app.request('/api/v1/webhooks/twilio/voice/recording', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'invalid',
      },
      body,
    });

    expect(res.status).toBe(403);
  });

  it('stores recording reference on valid webhook', async () => {
    const { app, mocks } = setupApp(true);

    const body = buildFormBody({
      RecordingSid: 'RE_test_789',
      CallSid: 'CA_test_123',
      AccountSid: 'AC_test_456',
      RecordingDuration: '30',
      RecordingStatus: 'completed',
    });

    const res = await app.request('/api/v1/webhooks/twilio/voice/recording', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'valid-sig',
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(mocks.storeRecordingReference).toHaveBeenCalledWith('CA_test_123', 'RE_test_789', 30);
  });
});

// ---- POST /gather ----------------------------------------------------------

describe('POST /api/v1/webhooks/twilio/voice/gather', () => {
  it('returns 403 for invalid signature', async () => {
    const { app } = setupApp(false);

    const body = buildFormBody({
      CallSid: 'CA_test_123',
      Digits: '1',
    });

    const res = await app.request('/api/v1/webhooks/twilio/voice/gather', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'invalid',
      },
      body,
    });

    expect(res.status).toBe(403);
  });

  it('publishes interaction event on valid gather', async () => {
    const { app, mocks } = setupApp(true);

    const body = buildFormBody({
      CallSid: 'CA_test_123',
      AccountSid: 'AC_test_456',
      Digits: '3',
    });

    const res = await app.request('/api/v1/webhooks/twilio/voice/gather', {
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
});
