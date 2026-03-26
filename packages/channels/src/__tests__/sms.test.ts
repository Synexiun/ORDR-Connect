import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmsProvider, validatePhoneNumber } from '../sms.js';
import type { TwilioClient, TwilioWebhookValidator } from '../sms.js';
import { MESSAGE_STATUSES } from '../types.js';

// ─── Mock Twilio Client ──────────────────────────────────────────

function createMockTwilioClient(
  overrides?: Partial<{
    createResult: {
      sid: string;
      status: string;
      errorCode: number | null;
      errorMessage: string | null;
    };
    createError: Error;
  }>,
): TwilioClient {
  return {
    messages: {
      create: overrides?.createError
        ? vi.fn().mockRejectedValue(overrides.createError)
        : vi.fn().mockResolvedValue(
            overrides?.createResult ?? {
              sid: 'SM_test_123456',
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
  clientOverrides?: Parameters<typeof createMockTwilioClient>[0],
  webhookValidator?: TwilioWebhookValidator,
): SmsProvider {
  return new SmsProvider({
    client: createMockTwilioClient(clientOverrides),
    fromNumber: '+15005550006',
    authToken: 'test_auth_token',
    webhookValidator,
  });
}

// ─── Phone Validation ────────────────────────────────────────────

describe('validatePhoneNumber', () => {
  it('accepts valid E.164 numbers', () => {
    expect(validatePhoneNumber('+14155551234').success).toBe(true);
    expect(validatePhoneNumber('+442071234567').success).toBe(true);
    expect(validatePhoneNumber('+61291234567').success).toBe(true);
  });

  it('rejects numbers without + prefix', () => {
    const result = validatePhoneNumber('14155551234');
    expect(result.success).toBe(false);
  });

  it('rejects numbers with spaces', () => {
    const result = validatePhoneNumber('+1 415 555 1234');
    expect(result.success).toBe(false);
  });

  it('rejects numbers with dashes', () => {
    const result = validatePhoneNumber('+1-415-555-1234');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = validatePhoneNumber('');
    expect(result.success).toBe(false);
  });

  it('rejects numbers starting with +0', () => {
    const result = validatePhoneNumber('+0155551234');
    expect(result.success).toBe(false);
  });
});

// ─── SMS Send ────────────────────────────────────────────────────

describe('SmsProvider — send', () => {
  let provider: SmsProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('sends an SMS successfully', async () => {
    const result = await provider.send('+14155551234', 'Hello, test!');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.messageId).toBe('SM_test_123456');
      expect(result.data.providerMessageId).toBe('SM_test_123456');
      expect(result.data.status).toBe(MESSAGE_STATUSES.QUEUED);
    }
  });

  it('rejects invalid phone number', async () => {
    const result = await provider.send('not-a-phone', 'Hello');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects empty body', async () => {
    const result = await provider.send('+14155551234', '');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects body over 1600 characters', async () => {
    const longBody = 'a'.repeat(1601);
    const result = await provider.send('+14155551234', longBody);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('wraps provider errors safely', async () => {
    const errorProvider = createProvider({
      createError: Object.assign(new Error('Twilio internal'), { code: 21211 }),
    });
    const result = await errorProvider.send('+14155551234', 'Hello');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      // SECURITY: must not expose raw Twilio error message
      expect(result.error.message).not.toContain('Twilio internal');
      expect(result.error.message).toContain('provider error code: 21211');
    }
  });

  it('wraps unknown provider errors with generic message', async () => {
    const errorProvider = createProvider({
      createError: new Error('Something unexpected'),
    });
    const result = await errorProvider.send('+14155551234', 'Hello');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('SMS delivery failed due to a provider error');
    }
  });

  it('maps twilio "delivered" status correctly', async () => {
    const deliveredProvider = createProvider({
      createResult: {
        sid: 'SM_delivered_123',
        status: 'delivered',
        errorCode: null,
        errorMessage: null,
      },
    });
    const result = await deliveredProvider.send('+14155551234', 'Hello');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(MESSAGE_STATUSES.DELIVERED);
    }
  });

  it('passes options to Twilio client', async () => {
    const client = createMockTwilioClient();
    const optProvider = new SmsProvider({
      client,
      fromNumber: '+15005550006',
      authToken: 'test',
    });

    await optProvider.send('+14155551234', 'Hello', {
      statusCallback: 'https://example.com/webhook',
      maxPrice: '0.50',
    });

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCallback: 'https://example.com/webhook',
        maxPrice: '0.50',
      }),
    );
  });
});

// ─── Webhook Parsing ─────────────────────────────────────────────

describe('SmsProvider — parseWebhook', () => {
  let provider: SmsProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('parses a valid Twilio webhook payload', () => {
    const result = provider.parseWebhook({
      From: '+14155551234',
      To: '+15005550006',
      Body: 'Hello there',
      MessageSid: 'SM_inbound_123',
      AccountSid: 'AC_test_456',
      NumMedia: '0',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBe('+14155551234');
      expect(result.data.to).toBe('+15005550006');
      expect(result.data.body).toBe('Hello there');
      expect(result.data.messageSid).toBe('SM_inbound_123');
      expect(result.data.numMedia).toBe(0);
    }
  });

  it('parses webhook with media URLs', () => {
    const result = provider.parseWebhook({
      From: '+14155551234',
      To: '+15005550006',
      Body: 'Check this image',
      MessageSid: 'SM_media_123',
      AccountSid: 'AC_test_456',
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/image0.jpg',
      MediaUrl1: 'https://api.twilio.com/image1.jpg',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.numMedia).toBe(2);
      expect(result.data.mediaUrls).toHaveLength(2);
      expect(result.data.mediaUrls[0]).toContain('image0.jpg');
    }
  });

  it('rejects payload missing required fields', () => {
    const result = provider.parseWebhook({
      From: '+14155551234',
      // missing To, Body, MessageSid, AccountSid
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

// ─── Webhook Signature Validation ────────────────────────────────

describe('SmsProvider — validateWebhookSignature', () => {
  it('validates signature with configured validator', () => {
    const validator = createMockWebhookValidator(true);
    const provider = createProvider(undefined, validator);

    const valid = provider.validateWebhookSignature(
      'valid-sig',
      'https://example.com/webhook',
      { From: '+14155551234', Body: 'test' },
    );

    expect(valid).toBe(true);
    expect(validator.validateRequest).toHaveBeenCalledWith(
      'test_auth_token',
      'valid-sig',
      'https://example.com/webhook',
      { From: '+14155551234', Body: 'test' },
    );
  });

  it('rejects invalid signature', () => {
    const validator = createMockWebhookValidator(false);
    const provider = createProvider(undefined, validator);

    const valid = provider.validateWebhookSignature(
      'invalid-sig',
      'https://example.com/webhook',
      { From: '+14155551234' },
    );

    expect(valid).toBe(false);
  });

  it('fails closed when no validator is configured', () => {
    const provider = createProvider();
    const valid = provider.validateWebhookSignature(
      'any-sig',
      'https://example.com/webhook',
      {},
    );

    // SECURITY: No validator = reject everything (fail closed)
    expect(valid).toBe(false);
  });
});
