import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WhatsAppProvider } from '../whatsapp.js';
import type { TwilioWhatsAppClient } from '../whatsapp.js';
import type { TwilioWebhookValidator } from '../sms.js';
import { MESSAGE_STATUSES } from '../types.js';

// ─── Mock Twilio WhatsApp Client ────────────────────────────────

function createMockWhatsAppClient(
  overrides?: Partial<{
    createResult: {
      sid: string;
      status: string;
      errorCode: number | null;
      errorMessage: string | null;
    };
    createError: Error;
  }>,
): TwilioWhatsAppClient {
  return {
    messages: {
      create: overrides?.createError
        ? vi.fn().mockRejectedValue(overrides.createError)
        : vi.fn().mockResolvedValue(
            overrides?.createResult ?? {
              sid: 'SM_wa_test_123456',
              status: 'queued',
              errorCode: null,
              errorMessage: null,
            },
          ),
    },
  };
}

function createMockWebhookValidator(isValid: boolean): TwilioWebhookValidator {
  return {
    validateRequest: vi.fn().mockReturnValue(isValid),
  };
}

function createProvider(
  clientOverrides?: Parameters<typeof createMockWhatsAppClient>[0],
  webhookValidator?: TwilioWebhookValidator,
): WhatsAppProvider {
  return new WhatsAppProvider({
    client: createMockWhatsAppClient(clientOverrides),
    fromNumber: 'whatsapp:+14155238886',
    authToken: 'test_auth_token',
    webhookValidator,
    statusCallbackUrl: 'https://example.com/whatsapp/status',
  });
}

// ─── Template Send ──────────────────────────────────────────────

describe('WhatsAppProvider — sendTemplate', () => {
  let provider: WhatsAppProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('sends a template message successfully', async () => {
    const result = await provider.sendTemplate(
      '+14155551234',
      'HX_template_123',
      { name: 'John' },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.messageId).toBe('SM_wa_test_123456');
      expect(result.data.status).toBe(MESSAGE_STATUSES.QUEUED);
    }
  });

  it('rejects invalid phone number', async () => {
    const result = await provider.sendTemplate(
      'not-a-phone',
      'HX_template_123',
      { name: 'John' },
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects empty template SID', async () => {
    const result = await provider.sendTemplate('+14155551234', '', { name: 'John' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('formats phone number with whatsapp: prefix', async () => {
    const client = createMockWhatsAppClient();
    const prefixProvider = new WhatsAppProvider({
      client,
      fromNumber: 'whatsapp:+14155238886',
      authToken: 'test',
    });

    await prefixProvider.sendTemplate('+14155551234', 'HX_tmpl', { key: 'val' });

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'whatsapp:+14155551234',
      }),
    );
  });

  it('wraps provider errors safely', async () => {
    const errorProvider = createProvider({
      createError: Object.assign(new Error('Twilio internal'), { code: 63016 }),
    });
    const result = await errorProvider.sendTemplate('+14155551234', 'HX_tmpl', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).not.toContain('Twilio internal');
      expect(result.error.message).toContain('provider error code: 63016');
    }
  });
});

// ─── Session Message Send ───────────────────────────────────────

describe('WhatsAppProvider — sendMessage', () => {
  let provider: WhatsAppProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('sends a session message successfully', async () => {
    const result = await provider.sendMessage('+14155551234', 'Hello from ORDR!');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.messageId).toBe('SM_wa_test_123456');
    }
  });

  it('sends a message with media URL', async () => {
    const client = createMockWhatsAppClient();
    const mediaProvider = new WhatsAppProvider({
      client,
      fromNumber: 'whatsapp:+14155238886',
      authToken: 'test',
    });

    await mediaProvider.sendMessage('+14155551234', 'Check this out', 'https://example.com/image.png');

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaUrl: ['https://example.com/image.png'],
      }),
    );
  });

  it('rejects invalid phone number', async () => {
    const result = await provider.sendMessage('bad-number', 'Hello');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects empty body', async () => {
    const result = await provider.sendMessage('+14155551234', '');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects body over 1600 characters', async () => {
    const longBody = 'a'.repeat(1601);
    const result = await provider.sendMessage('+14155551234', longBody);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('wraps unknown provider errors with generic message', async () => {
    const errorProvider = createProvider({
      createError: new Error('Something unexpected'),
    });
    const result = await errorProvider.sendMessage('+14155551234', 'Hello');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('WhatsApp delivery failed due to a provider error');
    }
  });
});

// ─── Webhook Parsing ────────────────────────────────────────────

describe('WhatsAppProvider — parseWebhook', () => {
  let provider: WhatsAppProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('parses a valid inbound WhatsApp message', () => {
    const result = provider.parseWebhook({
      From: 'whatsapp:+14155551234',
      Body: 'Hello there',
      MessageSid: 'SM_inbound_wa_123',
      AccountSid: 'AC_test_456',
      NumMedia: '0',
      WaId: '14155551234',
      ProfileName: 'John Doe',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBe('+14155551234'); // whatsapp: prefix stripped
      expect(result.data.body).toBe('Hello there');
      expect(result.data.messageSid).toBe('SM_inbound_wa_123');
      expect(result.data.profileName).toBe('John Doe');
      expect(result.data.waId).toBe('14155551234');
      expect(result.data.numMedia).toBe(0);
    }
  });

  it('parses webhook with media', () => {
    const result = provider.parseWebhook({
      From: 'whatsapp:+14155551234',
      Body: 'Image',
      MessageSid: 'SM_media_wa_123',
      AccountSid: 'AC_test_456',
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/wa_image0.jpg',
      WaId: '14155551234',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.numMedia).toBe(1);
      expect(result.data.mediaUrls).toHaveLength(1);
    }
  });

  it('rejects payload missing required fields', () => {
    const result = provider.parseWebhook({
      From: 'whatsapp:+14155551234',
      // missing Body, MessageSid, AccountSid, WaId
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

// ─── Webhook Signature Validation ───────────────────────────────

describe('WhatsAppProvider — validateWebhookSignature', () => {
  it('validates signature with configured validator', () => {
    const validator = createMockWebhookValidator(true);
    const provider = createProvider(undefined, validator);

    const valid = provider.validateWebhookSignature(
      'valid-sig',
      'https://example.com/whatsapp',
      { From: 'whatsapp:+14155551234', Body: 'test' },
    );

    expect(valid).toBe(true);
    expect(validator.validateRequest).toHaveBeenCalledWith(
      'test_auth_token',
      'valid-sig',
      'https://example.com/whatsapp',
      { From: 'whatsapp:+14155551234', Body: 'test' },
    );
  });

  it('rejects invalid signature', () => {
    const validator = createMockWebhookValidator(false);
    const provider = createProvider(undefined, validator);

    const valid = provider.validateWebhookSignature('bad', 'https://example.com/wa', {});
    expect(valid).toBe(false);
  });

  it('fails closed when no validator is configured', () => {
    const provider = createProvider();
    const valid = provider.validateWebhookSignature('any', 'https://example.com/wa', {});
    expect(valid).toBe(false);
  });
});

// ─── Status to Message Status Mapping ───────────────────────────

describe('WhatsAppProvider — mapTwilioStatusToMessageStatus', () => {
  let provider: WhatsAppProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('maps queued to QUEUED', () => {
    expect(provider.mapTwilioStatusToMessageStatus('queued')).toBe(MESSAGE_STATUSES.QUEUED);
  });

  it('maps sent to SENT', () => {
    expect(provider.mapTwilioStatusToMessageStatus('sent')).toBe(MESSAGE_STATUSES.SENT);
  });

  it('maps delivered to DELIVERED', () => {
    expect(provider.mapTwilioStatusToMessageStatus('delivered')).toBe(MESSAGE_STATUSES.DELIVERED);
  });

  it('maps read to DELIVERED', () => {
    expect(provider.mapTwilioStatusToMessageStatus('read')).toBe(MESSAGE_STATUSES.DELIVERED);
  });

  it('maps failed to FAILED', () => {
    expect(provider.mapTwilioStatusToMessageStatus('failed')).toBe(MESSAGE_STATUSES.FAILED);
  });

  it('maps undelivered to FAILED', () => {
    expect(provider.mapTwilioStatusToMessageStatus('undelivered')).toBe(MESSAGE_STATUSES.FAILED);
  });
});
