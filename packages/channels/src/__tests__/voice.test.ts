import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoiceProvider, CALL_STATUSES } from '../voice.js';
import type { TwilioVoiceClient, IvrFlow } from '../voice.js';
import type { TwilioWebhookValidator } from '../sms.js';
import { MESSAGE_STATUSES } from '../types.js';

// ─── Mock Twilio Voice Client ───────────────────────────────────

function createMockVoiceClient(
  overrides?: Partial<{
    createResult: { sid: string; status: string; direction: string };
    createError: Error;
  }>,
): TwilioVoiceClient {
  return {
    calls: {
      create: overrides?.createError
        ? vi.fn().mockRejectedValue(overrides.createError)
        : vi.fn().mockResolvedValue(
            overrides?.createResult ?? {
              sid: 'CA_test_123456',
              status: 'queued',
              direction: 'outbound-api',
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
  clientOverrides?: Parameters<typeof createMockVoiceClient>[0],
  webhookValidator?: TwilioWebhookValidator,
): VoiceProvider {
  return new VoiceProvider({
    client: createMockVoiceClient(clientOverrides),
    fromNumber: '+15005550006',
    authToken: 'test_auth_token',
    statusCallbackUrl: 'https://example.com/voice/status',
    recordingCallbackUrl: 'https://example.com/voice/recording',
    webhookValidator,
  });
}

// ─── Call Initiation ────────────────────────────────────────────

describe('VoiceProvider — initiateCall', () => {
  let provider: VoiceProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('initiates a call successfully', async () => {
    const result = await provider.initiateCall('+14155551234', '<Response><Say>Hello</Say></Response>');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.callSid).toBe('CA_test_123456');
      expect(result.data.status).toBe(CALL_STATUSES.QUEUED);
      expect(result.data.direction).toBe('outbound-api');
    }
  });

  it('rejects invalid phone number', async () => {
    const result = await provider.initiateCall('not-a-phone', '<Response><Say>Hello</Say></Response>');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects empty TwiML', async () => {
    const result = await provider.initiateCall('+14155551234', '');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects whitespace-only TwiML', async () => {
    const result = await provider.initiateCall('+14155551234', '   ');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('wraps provider errors safely', async () => {
    const errorProvider = createProvider({
      createError: Object.assign(new Error('Twilio internal'), { code: 21217 }),
    });
    const result = await errorProvider.initiateCall('+14155551234', '<Response/>');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).not.toContain('Twilio internal');
      expect(result.error.message).toContain('provider error code: 21217');
    }
  });

  it('wraps unknown provider errors with generic message', async () => {
    const errorProvider = createProvider({
      createError: new Error('Something unexpected'),
    });
    const result = await errorProvider.initiateCall('+14155551234', '<Response/>');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Voice call failed due to a provider error');
    }
  });

  it('passes AMD machine detection option to Twilio', async () => {
    const client = createMockVoiceClient();
    const amdProvider = new VoiceProvider({
      client,
      fromNumber: '+15005550006',
      authToken: 'test',
    });

    await amdProvider.initiateCall('+14155551234', '<Response/>', {
      machineDetection: 'DetectMessageEnd',
    });

    expect(client.calls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        machineDetection: 'DetectMessageEnd',
      }),
    );
  });

  it('uses default status callback events', async () => {
    const client = createMockVoiceClient();
    const cbProvider = new VoiceProvider({
      client,
      fromNumber: '+15005550006',
      authToken: 'test',
    });

    await cbProvider.initiateCall('+14155551234', '<Response/>');

    expect(client.calls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      }),
    );
  });

  it('maps completed call status correctly', async () => {
    const completedProvider = createProvider({
      createResult: {
        sid: 'CA_completed_123',
        status: 'completed',
        direction: 'outbound-api',
      },
    });
    const result = await completedProvider.initiateCall('+14155551234', '<Response/>');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(CALL_STATUSES.COMPLETED);
    }
  });
});

// ─── TwiML Generation ───────────────────────────────────────────

describe('VoiceProvider — generateTwiml', () => {
  let provider: VoiceProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('generates TwiML for a Say step', () => {
    const flow: IvrFlow = [
      { type: 'say', text: 'Welcome to ORDR', voice: 'alice', language: 'en-US' },
    ];
    const twiml = provider.generateTwiml(flow);
    expect(twiml).toContain('<Say voice="alice" language="en-US">Welcome to ORDR</Say>');
    expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('</Response>');
  });

  it('generates TwiML for a Gather step', () => {
    const flow: IvrFlow = [
      { type: 'gather', input: 'dtmf', timeout: 5, numDigits: 1, action: '/gather' },
    ];
    const twiml = provider.generateTwiml(flow);
    expect(twiml).toContain('input="dtmf"');
    expect(twiml).toContain('timeout="5"');
    expect(twiml).toContain('numDigits="1"');
    expect(twiml).toContain('action="/gather"');
  });

  it('generates TwiML for a Dial step', () => {
    const flow: IvrFlow = [
      { type: 'dial', number: '+14155551234', timeout: 30, record: true },
    ];
    const twiml = provider.generateTwiml(flow);
    expect(twiml).toContain('<Dial');
    expect(twiml).toContain('timeout="30"');
    expect(twiml).toContain('record="record-from-answer-dual"');
    expect(twiml).toContain('+14155551234');
  });

  it('generates TwiML for a Record step', () => {
    const flow: IvrFlow = [
      { type: 'record', maxLength: 120, action: '/recording', transcribe: true },
    ];
    const twiml = provider.generateTwiml(flow);
    expect(twiml).toContain('<Record');
    expect(twiml).toContain('maxLength="120"');
    expect(twiml).toContain('transcribe="true"');
  });

  it('generates TwiML for a Pause step', () => {
    const flow: IvrFlow = [{ type: 'pause', length: 3 }];
    const twiml = provider.generateTwiml(flow);
    expect(twiml).toContain('<Pause length="3"/>');
  });

  it('generates TwiML for a Hangup step', () => {
    const flow: IvrFlow = [{ type: 'hangup' }];
    const twiml = provider.generateTwiml(flow);
    expect(twiml).toContain('<Hangup/>');
  });

  it('generates TwiML for a multi-step IVR flow', () => {
    const flow: IvrFlow = [
      { type: 'say', text: 'Press 1 for sales' },
      { type: 'gather', input: 'dtmf', timeout: 10, numDigits: 1, action: '/menu' },
      { type: 'say', text: 'Sorry, we did not receive your input' },
      { type: 'hangup' },
    ];
    const twiml = provider.generateTwiml(flow);
    expect(twiml).toContain('<Say>Press 1 for sales</Say>');
    expect(twiml).toContain('<Gather');
    expect(twiml).toContain('<Hangup/>');
  });

  it('escapes XML special characters in text', () => {
    const flow: IvrFlow = [
      { type: 'say', text: 'Press 1 & wait for "response"' },
    ];
    const twiml = provider.generateTwiml(flow);
    expect(twiml).toContain('&amp;');
    expect(twiml).toContain('&quot;');
    expect(twiml).not.toContain('& wait');
  });
});

// ─── Status Webhook Parsing ─────────────────────────────────────

describe('VoiceProvider — parseStatusWebhook', () => {
  let provider: VoiceProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('parses a valid voice status webhook', () => {
    const result = provider.parseStatusWebhook({
      CallSid: 'CA_test_123',
      AccountSid: 'AC_test_456',
      CallStatus: 'completed',
      From: '+14155551234',
      To: '+15005550006',
      CallDuration: '45',
      Direction: 'outbound-api',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.callSid).toBe('CA_test_123');
      expect(result.data.callStatus).toBe(CALL_STATUSES.COMPLETED);
      expect(result.data.duration).toBe(45);
      expect(result.data.direction).toBe('outbound-api');
    }
  });

  it('rejects payload missing required fields', () => {
    const result = provider.parseStatusWebhook({
      CallSid: 'CA_test_123',
      // missing AccountSid, CallStatus, From, To
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('handles missing duration gracefully', () => {
    const result = provider.parseStatusWebhook({
      CallSid: 'CA_test_123',
      AccountSid: 'AC_test_456',
      CallStatus: 'ringing',
      From: '+14155551234',
      To: '+15005550006',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBeUndefined();
    }
  });
});

// ─── Recording Webhook Parsing ──────────────────────────────────

describe('VoiceProvider — parseRecordingWebhook', () => {
  let provider: VoiceProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('parses a valid recording webhook', () => {
    const result = provider.parseRecordingWebhook({
      RecordingSid: 'RE_test_789',
      CallSid: 'CA_test_123',
      AccountSid: 'AC_test_456',
      RecordingDuration: '30',
      RecordingStatus: 'completed',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recordingSid).toBe('RE_test_789');
      expect(result.data.callSid).toBe('CA_test_123');
      expect(result.data.recordingDuration).toBe(30);
      expect(result.data.recordingStatus).toBe('completed');
    }
  });

  it('rejects payload missing required fields', () => {
    const result = provider.parseRecordingWebhook({
      RecordingSid: 'RE_test_789',
      // missing CallSid, AccountSid, RecordingStatus
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

// ─── Gather Webhook Parsing ─────────────────────────────────────

describe('VoiceProvider — parseGatherWebhook', () => {
  let provider: VoiceProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('parses DTMF gather webhook', () => {
    const result = provider.parseGatherWebhook({
      CallSid: 'CA_test_123',
      AccountSid: 'AC_test_456',
      Digits: '1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.digits).toBe('1');
      expect(result.data.speechResult).toBeUndefined();
    }
  });

  it('parses speech gather webhook', () => {
    const result = provider.parseGatherWebhook({
      CallSid: 'CA_test_123',
      AccountSid: 'AC_test_456',
      SpeechResult: 'sales department',
      Confidence: '0.92',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.speechResult).toBe('sales department');
      expect(result.data.confidence).toBeCloseTo(0.92);
    }
  });

  it('rejects payload missing required fields', () => {
    const result = provider.parseGatherWebhook({
      Digits: '5',
      // missing CallSid, AccountSid
    });

    expect(result.success).toBe(false);
  });
});

// ─── Webhook Signature Validation ───────────────────────────────

describe('VoiceProvider — validateWebhookSignature', () => {
  it('validates signature with configured validator', () => {
    const validator = createMockWebhookValidator(true);
    const provider = createProvider(undefined, validator);

    const valid = provider.validateWebhookSignature(
      'valid-sig',
      'https://example.com/webhook',
      { CallSid: 'CA_test_123', CallStatus: 'completed' },
    );

    expect(valid).toBe(true);
    expect(validator.validateRequest).toHaveBeenCalledWith(
      'test_auth_token',
      'valid-sig',
      'https://example.com/webhook',
      { CallSid: 'CA_test_123', CallStatus: 'completed' },
    );
  });

  it('rejects invalid signature', () => {
    const validator = createMockWebhookValidator(false);
    const provider = createProvider(undefined, validator);

    const valid = provider.validateWebhookSignature(
      'invalid-sig',
      'https://example.com/webhook',
      {},
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

    expect(valid).toBe(false);
  });
});

// ─── Call Status to Message Status Mapping ──────────────────────

describe('VoiceProvider — mapCallStatusToMessageStatus', () => {
  let provider: VoiceProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('maps queued to QUEUED', () => {
    expect(provider.mapCallStatusToMessageStatus(CALL_STATUSES.QUEUED)).toBe(MESSAGE_STATUSES.QUEUED);
  });

  it('maps ringing to SENT', () => {
    expect(provider.mapCallStatusToMessageStatus(CALL_STATUSES.RINGING)).toBe(MESSAGE_STATUSES.SENT);
  });

  it('maps in-progress to SENT', () => {
    expect(provider.mapCallStatusToMessageStatus(CALL_STATUSES.IN_PROGRESS)).toBe(MESSAGE_STATUSES.SENT);
  });

  it('maps completed to DELIVERED', () => {
    expect(provider.mapCallStatusToMessageStatus(CALL_STATUSES.COMPLETED)).toBe(MESSAGE_STATUSES.DELIVERED);
  });

  it('maps busy to FAILED', () => {
    expect(provider.mapCallStatusToMessageStatus(CALL_STATUSES.BUSY)).toBe(MESSAGE_STATUSES.FAILED);
  });

  it('maps no-answer to FAILED', () => {
    expect(provider.mapCallStatusToMessageStatus(CALL_STATUSES.NO_ANSWER)).toBe(MESSAGE_STATUSES.FAILED);
  });

  it('maps failed to FAILED', () => {
    expect(provider.mapCallStatusToMessageStatus(CALL_STATUSES.FAILED)).toBe(MESSAGE_STATUSES.FAILED);
  });
});
