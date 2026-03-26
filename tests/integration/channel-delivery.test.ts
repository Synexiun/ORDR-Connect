/**
 * Integration test — Channel delivery pipeline.
 *
 * Tests message routing through SMS/Email/Voice/WhatsApp channels with
 * mocked providers. Verifies consent checks, CAN-SPAM headers, circuit
 * breaker behavior, channel fallback, and delivery audit logging.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  setupTestEnvironment,
  createTestTenant,
} from './setup.js';

// Channels
import {
  SmsProvider,
  validatePhoneNumber,
  EmailProvider,
  validateEmail,
  VoiceProvider,
  WhatsAppProvider,
  ConsentManager,
  CircuitBreaker,
  MessageStateMachine,
  CIRCUIT_STATES,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  OPT_OUT_KEYWORDS,
  OPT_IN_KEYWORDS,
  injectBranding,
  DEFAULT_BRANDED_EMAIL_OPTIONS,
  MESSAGE_STATUSES,
  MESSAGE_EVENTS,
} from '@ordr/channels';
import type {
  TwilioClient,
  SendGridClient,
  SendGridResponse,
  TwilioVoiceClient,
  TwilioCallInstance,
  TwilioWhatsAppClient,
  TwilioWhatsAppMessageInstance,
  ConsentStore,
  ConsentRecord,
  Channel,
} from '@ordr/channels';

// Audit
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import type { AuditEventInput } from '@ordr/audit';

// Core
import { isOk, isErr } from '@ordr/core';

// ── Mock Providers ───────────────────────────────────────────────────

function createMockTwilioClient(): TwilioClient {
  return {
    messages: {
      create: async (_params) => ({
        sid: `SM_${Date.now()}`,
        status: 'queued',
        errorCode: null,
        errorMessage: null,
      }),
    },
  };
}

function createMockSendGridClient(): SendGridClient {
  return {
    send: async (_msg) => ([{ statusCode: 202, headers: {} }]) as unknown as SendGridResponse,
  };
}

function createMockVoiceClient(): TwilioVoiceClient {
  return {
    calls: {
      create: async (_params) => ({
        sid: `CA_${Date.now()}`,
        status: 'queued',
        direction: 'outbound-api',
      }) as TwilioCallInstance,
    },
  };
}

function createMockWhatsAppClient(): TwilioWhatsAppClient {
  return {
    messages: {
      create: async (_params) => ({
        sid: `WA_${Date.now()}`,
        status: 'queued',
        errorCode: null,
        errorMessage: null,
      }) as TwilioWhatsAppMessageInstance,
    },
  };
}

function createMockConsentStore(): ConsentStore {
  const records = new Map<string, ConsentRecord>();

  return {
    getConsent: async (customerId: string, channel: Channel): Promise<ConsentRecord | undefined> => {
      return records.get(`${customerId}:${channel}`) ?? undefined;
    },
    saveConsent: async (record: ConsentRecord): Promise<void> => {
      records.set(`${record.customerId}:${record.channel}`, record);
    },
    revokeConsent: async (customerId: string, channel: Channel, revokedAt: Date): Promise<void> => {
      records.delete(`${customerId}:${channel}`);
    },
  };
}

function makeAuditInput(tenantId: string, overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId,
    eventType: overrides?.eventType ?? 'data.created',
    actorType: overrides?.actorType ?? 'system',
    actorId: overrides?.actorId ?? 'channel-router',
    resource: overrides?.resource ?? 'message',
    resourceId: overrides?.resourceId ?? 'msg-001',
    action: overrides?.action ?? 'send',
    details: overrides?.details ?? {},
    timestamp: overrides?.timestamp ?? new Date('2026-01-15T14:00:00.000Z'),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Channel Delivery — End-to-End', () => {
  let auditStore: InMemoryAuditStore;
  let auditLogger: AuditLogger;

  beforeAll(async () => {
    await setupTestEnvironment();
  });

  beforeEach(() => {
    auditStore = new InMemoryAuditStore();
    auditLogger = new AuditLogger(auditStore);
  });

  // ── SMS Delivery ───────────────────────────────────────────────

  describe('SMS delivery via Twilio (mocked)', () => {
    it('sends SMS through mocked Twilio client', async () => {
      const client = createMockTwilioClient();
      const provider = new SmsProvider({
        client,
        fromNumber: '+15551234567',
        authToken: 'test_auth_token',
      });

      const result = await provider.send('+15559876543', 'Test message — no PHI');
      expect(isOk(result)).toBe(true);
    });

    it('validates phone number format before sending', () => {
      const validResult = validatePhoneNumber('+15551234567');
      expect(isOk(validResult)).toBe(true);

      const invalidResult = validatePhoneNumber('555-123-4567');
      expect(isErr(invalidResult)).toBe(true);
    });

    it('rejects phone numbers not in E.164 format', () => {
      const result = validatePhoneNumber('not-a-phone');
      expect(isErr(result)).toBe(true);
    });
  });

  // ── Email Delivery ─────────────────────────────────────────────

  describe('Email delivery via SendGrid (mocked)', () => {
    it('sends email through mocked SendGrid client', async () => {
      const client = createMockSendGridClient();
      const provider = new EmailProvider({
        client,
        fromEmail: 'noreply@example.com',
        fromName: 'ORDR Connect',
      });

      const result = await provider.send(
        'customer@example.com',
        'Follow-up — no PHI',
        'Your account update reference: tok_upd_001',
      );
      expect(isOk(result)).toBe(true);
    });

    it('validates email address format', () => {
      const valid = validateEmail('user@example.com');
      expect(isOk(valid)).toBe(true);

      const invalid = validateEmail('not-an-email');
      expect(isErr(invalid)).toBe(true);
    });

    it('rejects empty email address', () => {
      const result = validateEmail('');
      expect(isErr(result)).toBe(true);
    });

    it('branded email injects CAN-SPAM compliant content', () => {
      const html = '<p>Hello</p>';
      const branded = injectBranding(html, {
        ...DEFAULT_BRANDED_EMAIL_OPTIONS,
        footerText: 'ORDR Test | 123 Test St, Test City, TS 12345',
      });

      expect(branded).toContain('ORDR Test');
      expect(branded).toContain('123 Test St');
    });
  });

  // ── Voice Call ─────────────────────────────────────────────────

  describe('Voice call initiation (mocked)', () => {
    it('initiates voice call through mocked client', async () => {
      const client = createMockVoiceClient();
      const provider = new VoiceProvider({
        client,
        fromNumber: '+15551234567',
        authToken: 'test_auth_token',
      });

      const twiml = '<Response><Say>Hello, this is a test call.</Say></Response>';
      const result = await provider.initiateCall('+15559876543', twiml);
      expect(isOk(result)).toBe(true);
    });
  });

  // ── WhatsApp Delivery ──────────────────────────────────────────

  describe('WhatsApp delivery (mocked)', () => {
    it('sends WhatsApp template through mocked client', async () => {
      const client = createMockWhatsAppClient();
      const provider = new WhatsAppProvider({
        client,
        fromNumber: 'whatsapp:+15551234567',
        authToken: 'test_auth_token',
      });

      const result = await provider.sendTemplate(
        '+15559876543',
        'HX_template_001',
        { name: 'Test User' },
      );
      expect(isOk(result)).toBe(true);
    });
  });

  // ── Consent Management ─────────────────────────────────────────

  describe('Consent checks before delivery', () => {
    it('consent manager grants access when opted in', async () => {
      const store = createMockConsentStore();
      const manager = new ConsentManager();

      // Record consent
      await manager.recordConsent(
        {
          customerId: 'cust-001',
          tenantId: 'tnt-001',
          channel: 'sms',
          status: 'opted_in',
          method: 'web_form',
          evidenceRef: 'form-001',
          consentedAt: new Date('2026-01-01'),
        },
        store,
      );

      const status = await manager.checkConsent('cust-001', 'sms', store);
      expect(status).toBe('opted_in');
    });

    it('consent manager detects opted-out status', async () => {
      const store = createMockConsentStore();
      const manager = new ConsentManager();

      await manager.recordConsent(
        {
          customerId: 'cust-002',
          tenantId: 'tnt-001',
          channel: 'sms',
          status: 'opted_out',
          method: 'sms_keyword',
          evidenceRef: 'STOP',
          consentedAt: new Date('2026-01-10'),
        },
        store,
      );

      const status = await manager.checkConsent('cust-002', 'sms', store);
      expect(status).toBe('opted_out');
    });

    it('consent verification rejects send without consent', async () => {
      const store = createMockConsentStore();
      const manager = new ConsentManager();

      // No consent recorded — status will be unknown
      const result = await manager.verifyConsentForSend('cust-new', 'sms', store);
      expect(isErr(result)).toBe(true);
    });

    it('opt-out keywords are recognized', () => {
      expect(OPT_OUT_KEYWORDS).toContain('STOP');
      expect(OPT_OUT_KEYWORDS).toContain('UNSUBSCRIBE');
      expect(OPT_OUT_KEYWORDS).toContain('CANCEL');
    });

    it('opt-in keywords are recognized', () => {
      expect(OPT_IN_KEYWORDS).toContain('START');
      expect(OPT_IN_KEYWORDS).toContain('YES');
    });
  });

  // ── Circuit Breaker ────────────────────────────────────────────

  describe('Circuit breaker on repeated failures', () => {
    it('circuit breaker starts in closed state', () => {
      const cb = new CircuitBreaker('sms-provider');
      expect(cb.getState()).toBe(CIRCUIT_STATES.CLOSED);
    });

    it('circuit breaker opens after threshold failures via execute', async () => {
      const cb = new CircuitBreaker('sms-provider', {
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        halfOpenMaxAttempts: 1,
      });

      // Force failures through execute
      for (let i = 0; i < 3; i++) {
        await cb.execute(async () => { throw new Error('provider down'); });
      }

      // Should now reject
      const result = await cb.execute(async () => 'success');
      expect(isErr(result)).toBe(true);
    });

    it('circuit breaker allows requests when closed', async () => {
      const cb = new CircuitBreaker('voice-provider');

      const result = await cb.execute(async () => 'success');
      expect(isOk(result)).toBe(true);
    });

    it('default circuit breaker config has expected values', () => {
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(5);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs).toBe(30_000);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.halfOpenMaxAttempts).toBe(3);
    });
  });

  // ── Message State Machine ──────────────────────────────────────

  describe('Message state machine transitions', () => {
    it('transitions from pending to queued via enqueue', () => {
      const sm = new MessageStateMachine();
      const next = sm.transition(MESSAGE_STATUSES.PENDING, MESSAGE_EVENTS.ENQUEUE);
      expect(next).toBe(MESSAGE_STATUSES.QUEUED);
    });

    it('transitions from queued to sent via send', () => {
      const sm = new MessageStateMachine();
      const next = sm.transition(MESSAGE_STATUSES.QUEUED, MESSAGE_EVENTS.SEND);
      expect(next).toBe(MESSAGE_STATUSES.SENT);
    });

    it('transitions from sent to delivered via deliver', () => {
      const sm = new MessageStateMachine();
      const next = sm.transition(MESSAGE_STATUSES.SENT, MESSAGE_EVENTS.DELIVER);
      expect(next).toBe(MESSAGE_STATUSES.DELIVERED);
    });

    it('rejects invalid state transition', () => {
      const sm = new MessageStateMachine();
      // Cannot go directly from pending to delivered
      expect(() => sm.transition(MESSAGE_STATUSES.PENDING, MESSAGE_EVENTS.DELIVER)).toThrow();
    });

    it('delivered is a terminal state', () => {
      const sm = new MessageStateMachine();
      expect(sm.isTerminal(MESSAGE_STATUSES.DELIVERED)).toBe(true);
    });
  });

  // ── Delivery Audit Trail ───────────────────────────────────────

  describe('Delivery confirmation audit logging', () => {
    it('logs successful SMS delivery to audit', async () => {
      const tnt = await createTestTenant('sms-audit');

      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'sms_sent',
        details: {
          channel: 'sms',
          providerSid: 'SM_12345',
          toRef: 'tok_phone_001', // Tokenized
          status: 'queued',
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.details['channel']).toBe('sms');
      // Verify no raw phone number in audit
      expect(JSON.stringify(events[0]!.details)).not.toMatch(/\+1\d{10}/);
    });

    it('logs email delivery to audit', async () => {
      const tnt = await createTestTenant('email-audit');

      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'email_sent',
        details: {
          channel: 'email',
          status: 'accepted',
          toRef: 'tok_email_001',
          canSpamCompliant: true,
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events[0]!.details['canSpamCompliant']).toBe(true);
    });

    it('logs channel fallback to audit', async () => {
      const tnt = await createTestTenant('fallback-audit');

      await auditLogger.log(makeAuditInput(tnt.id, {
        action: 'channel_fallback',
        details: {
          primaryChannel: 'sms',
          fallbackChannel: 'email',
          reason: 'circuit_breaker_open',
        },
      }));

      const events = auditStore.getAllEvents(tnt.id);
      expect(events[0]!.action).toBe('channel_fallback');
      expect(events[0]!.details['reason']).toBe('circuit_breaker_open');
    });

    it('audit chain remains intact after multiple deliveries', async () => {
      const tnt = await createTestTenant('delivery-chain');

      await auditLogger.log(makeAuditInput(tnt.id, { action: 'sms_sent', resourceId: 'msg-001' }));
      await auditLogger.log(makeAuditInput(tnt.id, { action: 'email_sent', resourceId: 'msg-002' }));
      await auditLogger.log(makeAuditInput(tnt.id, { action: 'voice_initiated', resourceId: 'msg-003' }));
      await auditLogger.log(makeAuditInput(tnt.id, { action: 'whatsapp_sent', resourceId: 'msg-004' }));

      const integrity = await auditLogger.verifyIntegrity(tnt.id);
      expect(integrity.valid).toBe(true);
      expect(integrity.totalEvents).toBe(4);
    });
  });
});
