import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelRouter } from '../router.js';
import type { ChannelPreference, ComplianceGate, OutboundMessage } from '../router.js';
import type { SmsProvider } from '../sms.js';
import type { EmailProvider } from '../email.js';
import type { VoiceProvider } from '../voice.js';
import type { WhatsAppProvider } from '../whatsapp.js';
import type { ConsentManager } from '../consent.js';
import type { ChannelRateLimiter } from '../rate-limiter.js';
import type { CircuitBreaker } from '../circuit-breaker.js';
import type { Channel, ConsentStore, ConsentStatus } from '../types.js';
import { CHANNELS, CONSENT_STATUSES, MESSAGE_STATUSES } from '../types.js';

// ─── Mock Factories ─────────────────────────────────────────────

function createMockConsentManager(
  statusMap: Partial<Record<Channel, ConsentStatus>> = {},
): ConsentManager {
  return {
    checkConsent: vi.fn(async (_customerId: string, channel: Channel) => {
      return statusMap[channel] ?? CONSENT_STATUSES.OPTED_IN;
    }),
    verifyConsentForSend: vi.fn().mockResolvedValue({ success: true, data: true }),
    recordConsent: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    revokeConsent: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    isOptOutKeyword: vi.fn().mockReturnValue(false),
    isOptInKeyword: vi.fn().mockReturnValue(false),
    buildOptOutRecord: vi.fn(),
  } as unknown as ConsentManager;
}

function createMockConsentStore(): ConsentStore {
  return {
    getConsent: vi.fn().mockResolvedValue(undefined),
    saveConsent: vi.fn().mockResolvedValue(undefined),
    revokeConsent: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockComplianceGate(
  blockedChannels: Channel[] = [],
): ComplianceGate {
  return {
    checkChannel: vi.fn(async (channel: Channel) => {
      if (blockedChannels.includes(channel)) {
        return {
          success: false as const,
          error: {
            name: 'ComplianceViolationError',
            message: `Channel ${channel} blocked`,
            code: 'COMPLIANCE_VIOLATION' as const,
            statusCode: 451,
            isOperational: true,
            correlationId: undefined,
            regulation: 'TEST',
            toSafeResponse: vi.fn(),
          },
        };
      }
      return { success: true as const, data: true as const };
    }),
  };
}

function createMockRateLimiter(
  limitedChannels: Channel[] = [],
): ChannelRateLimiter {
  return {
    checkLimit: vi.fn((channel: Channel) => !limitedChannels.includes(channel)),
    record: vi.fn().mockReturnValue(true),
    getCurrentCount: vi.fn().mockReturnValue(0),
    getTimeUntilNextSlot: vi.fn().mockReturnValue(0),
    reset: vi.fn(),
    resetAll: vi.fn(),
    getConfig: vi.fn().mockReturnValue({ maxMessages: 1, windowMs: 60000 }),
  } as unknown as ChannelRateLimiter;
}

function createMockCircuitBreaker(available = true): CircuitBreaker {
  return {
    execute: vi.fn(async (fn: () => Promise<unknown>) => {
      if (!available) {
        return {
          success: false as const,
          error: {
            name: 'InternalError',
            message: 'Circuit open',
            code: 'INTERNAL_ERROR' as const,
            statusCode: 500,
            isOperational: false,
            correlationId: undefined,
            toSafeResponse: vi.fn(),
          },
        };
      }
      const result = await fn();
      return { success: true as const, data: result };
    }),
    getState: vi.fn().mockReturnValue(available ? 'closed' : 'open'),
    getFailureCount: vi.fn().mockReturnValue(0),
    getName: vi.fn().mockReturnValue('test'),
    isAvailable: vi.fn().mockReturnValue(available),
    reset: vi.fn(),
  } as unknown as CircuitBreaker;
}

function createMockSmsProvider(): SmsProvider {
  return {
    send: vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        messageId: 'SM_test',
        providerMessageId: 'SM_test',
        status: MESSAGE_STATUSES.QUEUED,
        error: undefined,
      },
    }),
    parseWebhook: vi.fn(),
    validateWebhookSignature: vi.fn(),
  } as unknown as SmsProvider;
}

function createMockEmailProvider(): EmailProvider {
  return {
    send: vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        messageId: 'SG_test',
        providerMessageId: 'SG_test',
        status: MESSAGE_STATUSES.QUEUED,
        error: undefined,
      },
    }),
    parseWebhook: vi.fn(),
    mapEventToStatus: vi.fn(),
  } as unknown as EmailProvider;
}

function createMockVoiceProvider(): VoiceProvider {
  return {
    initiateCall: vi.fn().mockResolvedValue({
      success: true,
      data: {
        callSid: 'CA_test',
        status: 'queued',
        direction: 'outbound-api',
      },
    }),
    mapCallStatusToMessageStatus: vi.fn().mockReturnValue(MESSAGE_STATUSES.QUEUED),
    generateTwiml: vi.fn().mockReturnValue('<Response/>'),
    parseStatusWebhook: vi.fn(),
    parseRecordingWebhook: vi.fn(),
    parseGatherWebhook: vi.fn(),
    validateWebhookSignature: vi.fn(),
  } as unknown as VoiceProvider;
}

function createMockWhatsAppProvider(): WhatsAppProvider {
  return {
    sendMessage: vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        messageId: 'SM_wa_test',
        providerMessageId: 'SM_wa_test',
        status: MESSAGE_STATUSES.QUEUED,
        error: undefined,
      },
    }),
    sendTemplate: vi.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        messageId: 'SM_wa_tmpl',
        providerMessageId: 'SM_wa_tmpl',
        status: MESSAGE_STATUSES.QUEUED,
        error: undefined,
      },
    }),
    parseWebhook: vi.fn(),
    parseStatusWebhook: vi.fn(),
    validateWebhookSignature: vi.fn(),
    mapTwilioStatusToMessageStatus: vi.fn(),
  } as unknown as WhatsAppProvider;
}

// ─── Default Preferences ────────────────────────────────────────

const defaultPreferences: readonly ChannelPreference[] = [
  { channel: CHANNELS.SMS, priority: 1, contactValue: '+14155551234' },
  { channel: CHANNELS.EMAIL, priority: 2, contactValue: 'test@example.com' },
  { channel: CHANNELS.WHATSAPP, priority: 3, contactValue: '+14155551234' },
  { channel: CHANNELS.VOICE, priority: 4, contactValue: '+14155551234' },
];

const defaultMessage: OutboundMessage = {
  customerId: 'cust-1',
  tenantId: 'tenant-1',
  contentRef: 'enc_ref_123',
  contentType: 'text',
  metadata: {},
};

function createRouter(overrides?: {
  consentMap?: Partial<Record<Channel, ConsentStatus>>;
  blockedChannels?: Channel[];
  limitedChannels?: Channel[];
  unavailableChannels?: Channel[];
}): ChannelRouter {
  const circuitBreakers: Record<Channel, CircuitBreaker> = {
    [CHANNELS.SMS]: createMockCircuitBreaker(!overrides?.unavailableChannels?.includes(CHANNELS.SMS)),
    [CHANNELS.EMAIL]: createMockCircuitBreaker(!overrides?.unavailableChannels?.includes(CHANNELS.EMAIL)),
    [CHANNELS.VOICE]: createMockCircuitBreaker(!overrides?.unavailableChannels?.includes(CHANNELS.VOICE)),
    [CHANNELS.WHATSAPP]: createMockCircuitBreaker(!overrides?.unavailableChannels?.includes(CHANNELS.WHATSAPP)),
  };

  return new ChannelRouter({
    sms: createMockSmsProvider(),
    email: createMockEmailProvider(),
    voice: createMockVoiceProvider(),
    whatsApp: createMockWhatsAppProvider(),
    consent: createMockConsentManager(overrides?.consentMap),
    consentStore: createMockConsentStore(),
    compliance: createMockComplianceGate(overrides?.blockedChannels),
    rateLimiter: createMockRateLimiter(overrides?.limitedChannels),
    circuitBreakers,
  });
}

// ─── Channel Selection: Consent Filtering ───────────────────────

describe('ChannelRouter — consent filtering', () => {
  it('selects channel with opted-in consent', async () => {
    const router = createRouter();
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(CHANNELS.SMS); // highest priority
    }
  });

  it('skips channels where customer has opted out', async () => {
    const router = createRouter({
      consentMap: {
        [CHANNELS.SMS]: CONSENT_STATUSES.OPTED_OUT,
      },
    });
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(CHANNELS.EMAIL); // next priority
    }
  });

  it('skips channels with unknown consent', async () => {
    const router = createRouter({
      consentMap: {
        [CHANNELS.SMS]: CONSENT_STATUSES.UNKNOWN,
        [CHANNELS.EMAIL]: CONSENT_STATUSES.UNKNOWN,
      },
    });
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(CHANNELS.WHATSAPP);
    }
  });

  it('returns compliance error when no channels have consent', async () => {
    const router = createRouter({
      consentMap: {
        [CHANNELS.SMS]: CONSENT_STATUSES.OPTED_OUT,
        [CHANNELS.EMAIL]: CONSENT_STATUSES.OPTED_OUT,
        [CHANNELS.WHATSAPP]: CONSENT_STATUSES.OPTED_OUT,
        [CHANNELS.VOICE]: CONSENT_STATUSES.OPTED_OUT,
      },
    });
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('COMPLIANCE_VIOLATION');
    }
  });
});

// ─── Channel Selection: Compliance Filtering ────────────────────

describe('ChannelRouter — compliance filtering', () => {
  it('skips channels blocked by compliance', async () => {
    const router = createRouter({
      blockedChannels: [CHANNELS.SMS],
    });
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(CHANNELS.EMAIL);
    }
  });

  it('returns compliance error when all channels blocked', async () => {
    const router = createRouter({
      blockedChannels: [CHANNELS.SMS, CHANNELS.EMAIL, CHANNELS.WHATSAPP, CHANNELS.VOICE],
    });
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('COMPLIANCE_VIOLATION');
    }
  });
});

// ─── Channel Selection: Rate Limit Filtering ────────────────────

describe('ChannelRouter — rate limit filtering', () => {
  it('skips channels at rate limit', async () => {
    const router = createRouter({
      limitedChannels: [CHANNELS.SMS, CHANNELS.EMAIL],
    });
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(CHANNELS.WHATSAPP);
    }
  });

  it('returns error when all channels rate limited', async () => {
    const router = createRouter({
      limitedChannels: [CHANNELS.SMS, CHANNELS.EMAIL, CHANNELS.WHATSAPP, CHANNELS.VOICE],
    });
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });
});

// ─── Channel Selection: Preference Ordering ─────────────────────

describe('ChannelRouter — preference ordering', () => {
  it('respects priority ordering (1 = most preferred)', async () => {
    const router = createRouter();
    const reversedPrefs: ChannelPreference[] = [
      { channel: CHANNELS.VOICE, priority: 4, contactValue: '+14155551234' },
      { channel: CHANNELS.EMAIL, priority: 1, contactValue: 'test@example.com' },
      { channel: CHANNELS.SMS, priority: 3, contactValue: '+14155551234' },
    ];
    const result = await router.selectChannel('cust-1', 'tenant-1', reversedPrefs, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(CHANNELS.EMAIL);
    }
  });

  it('uses cost optimization as tiebreaker', async () => {
    const router = createRouter();
    const samepriorityPrefs: ChannelPreference[] = [
      { channel: CHANNELS.VOICE, priority: 1, contactValue: '+14155551234' },
      { channel: CHANNELS.EMAIL, priority: 1, contactValue: 'test@example.com' },
      { channel: CHANNELS.SMS, priority: 1, contactValue: '+14155551234' },
    ];
    const result = await router.selectChannel('cust-1', 'tenant-1', samepriorityPrefs, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      // Email is cheapest (cost order: email=1, sms=2, whatsapp=3, voice=4)
      expect(result.data.channel).toBe(CHANNELS.EMAIL);
    }
  });
});

// ─── Channel Selection: Circuit Breaker ─────────────────────────

describe('ChannelRouter — circuit breaker integration', () => {
  it('skips circuit-broken channels', async () => {
    const router = createRouter({
      unavailableChannels: [CHANNELS.SMS],
    });
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(CHANNELS.EMAIL);
    }
  });

  it('returns error when all channels are circuit-broken', async () => {
    const router = createRouter({
      unavailableChannels: [CHANNELS.SMS, CHANNELS.EMAIL, CHANNELS.WHATSAPP, CHANNELS.VOICE],
    });
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });
});

// ─── Channel Selection: Empty Preferences ───────────────────────

describe('ChannelRouter — empty preferences', () => {
  it('returns validation error for empty preferences', async () => {
    const router = createRouter();
    const result = await router.selectChannel('cust-1', 'tenant-1', [], defaultMessage);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

// ─── Send Dispatch ──────────────────────────────────────────────

describe('ChannelRouter — send', () => {
  it('dispatches SMS to sms provider', async () => {
    const router = createRouter();
    const result = await router.send(CHANNELS.SMS, '+14155551234', 'Hello');
    expect(result.success).toBe(true);
  });

  it('dispatches email to email provider', async () => {
    const router = createRouter();
    const result = await router.send(CHANNELS.EMAIL, 'test@example.com', '<p>Hello</p>', { subject: 'Test' });
    expect(result.success).toBe(true);
  });

  it('dispatches voice to voice provider', async () => {
    const router = createRouter();
    const result = await router.send(CHANNELS.VOICE, '+14155551234', '<Response><Say>Hello</Say></Response>');
    expect(result.success).toBe(true);
  });

  it('dispatches whatsapp session message', async () => {
    const router = createRouter();
    const result = await router.send(CHANNELS.WHATSAPP, '+14155551234', 'Hello via WhatsApp');
    expect(result.success).toBe(true);
  });

  it('dispatches whatsapp template message when templateSid provided', async () => {
    const router = createRouter();
    const result = await router.send(CHANNELS.WHATSAPP, '+14155551234', 'template body', {
      templateSid: 'HX_tmpl_123',
      var_name: 'John',
    });
    expect(result.success).toBe(true);
  });

  it('uses default subject for email when none provided', async () => {
    const router = createRouter();
    const result = await router.send(CHANNELS.EMAIL, 'test@example.com', '<p>Hello</p>');
    expect(result.success).toBe(true);
  });
});

// ─── Combined Filter Chain ──────────────────────────────────────

describe('ChannelRouter — combined filter chain', () => {
  it('falls through multiple filter layers', async () => {
    const router = createRouter({
      consentMap: {
        [CHANNELS.SMS]: CONSENT_STATUSES.OPTED_OUT, // filtered by consent
      },
      blockedChannels: [CHANNELS.EMAIL], // filtered by compliance
      limitedChannels: [CHANNELS.WHATSAPP], // filtered by rate limit
    });

    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe(CHANNELS.VOICE); // only one left
    }
  });

  it('returns contact value for selected channel', async () => {
    const router = createRouter();
    const result = await router.selectChannel('cust-1', 'tenant-1', defaultPreferences, defaultMessage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contactValue).toBe('+14155551234');
      expect(result.data.priority).toBe(1);
    }
  });
});
