import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmailProvider, validateEmail } from '../email.js';
import type { SendGridClient, SendGridMessage } from '../email.js';
import { MESSAGE_STATUSES } from '../types.js';

// ─── Mock SendGrid Client ────────────────────────────────────────

function createMockSendGridClient(
  overrides?: Partial<{
    sendResult: { statusCode: number; headers: Record<string, string>; messageId?: string };
    sendError: Error;
  }>,
): SendGridClient {
  return {
    send: overrides?.sendError
      ? vi.fn().mockRejectedValue(overrides.sendError)
      : vi.fn().mockResolvedValue(
          overrides?.sendResult ?? {
            statusCode: 202,
            headers: { 'x-message-id': 'sg_msg_123' },
            messageId: 'sg_msg_123',
          },
        ),
  };
}

function createProvider(
  clientOverrides?: Parameters<typeof createMockSendGridClient>[0],
): EmailProvider {
  return new EmailProvider({
    client: createMockSendGridClient(clientOverrides),
    fromEmail: 'noreply@ordr-connect.com',
    fromName: 'ORDR Connect',
  });
}

// ─── Email Validation ────────────────────────────────────────────

describe('validateEmail', () => {
  it('accepts valid email addresses', () => {
    expect(validateEmail('user@example.com').success).toBe(true);
    expect(validateEmail('test.user+tag@company.co.uk').success).toBe(true);
    expect(validateEmail('admin@sub.domain.org').success).toBe(true);
  });

  it('lowercases the email on success', () => {
    const result = validateEmail('User@Example.COM');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('user@example.com');
    }
  });

  it('rejects empty string', () => {
    expect(validateEmail('').success).toBe(false);
  });

  it('rejects email without @', () => {
    expect(validateEmail('userexample.com').success).toBe(false);
  });

  it('rejects email without domain', () => {
    expect(validateEmail('user@').success).toBe(false);
  });

  it('rejects email over 254 characters', () => {
    const longEmail = 'a'.repeat(250) + '@b.com';
    expect(validateEmail(longEmail).success).toBe(false);
  });
});

// ─── Email Send ──────────────────────────────────────────────────

describe('EmailProvider — send', () => {
  let provider: EmailProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('sends an email successfully', async () => {
    const result = await provider.send(
      'user@example.com',
      'Test Subject',
      '<p>Hello</p>',
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.providerMessageId).toBe('sg_msg_123');
      expect(result.data.status).toBe(MESSAGE_STATUSES.QUEUED);
    }
  });

  it('includes List-Unsubscribe header (CAN-SPAM)', async () => {
    const client = createMockSendGridClient();
    const canSpamProvider = new EmailProvider({
      client,
      fromEmail: 'noreply@ordr-connect.com',
      fromName: 'ORDR Connect',
    });

    await canSpamProvider.send('user@example.com', 'Subject', '<p>Body</p>');

    const sentMessage = (client.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SendGridMessage;
    expect(sentMessage.headers).toBeDefined();
    expect(sentMessage.headers?.['List-Unsubscribe']).toContain('mailto:unsubscribe@');
    expect(sentMessage.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('rejects invalid email address', async () => {
    const result = await provider.send('not-an-email', 'Subject', '<p>Body</p>');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects empty subject', async () => {
    const result = await provider.send('user@example.com', '', '<p>Body</p>');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects empty body', async () => {
    const result = await provider.send('user@example.com', 'Subject', '');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('wraps provider errors safely', async () => {
    const errorProvider = createProvider({
      sendError: Object.assign(new Error('SendGrid internal error'), { code: 403 }),
    });

    const result = await errorProvider.send('user@example.com', 'Subject', '<p>Body</p>');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      // SECURITY: must not expose raw SendGrid error message
      expect(result.error.message).not.toContain('SendGrid internal error');
      expect(result.error.message).toContain('provider error code: 403');
    }
  });

  it('wraps unknown provider errors with generic message', async () => {
    const errorProvider = createProvider({
      sendError: new Error('Something unexpected'),
    });

    const result = await errorProvider.send('user@example.com', 'Subject', '<p>Body</p>');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Email delivery failed due to a provider error');
    }
  });

  it('passes email options through to SendGrid', async () => {
    const client = createMockSendGridClient();
    const optProvider = new EmailProvider({
      client,
      fromEmail: 'noreply@ordr-connect.com',
      fromName: 'ORDR Connect',
    });

    await optProvider.send('user@example.com', 'Subject', '<p>Body</p>', {
      replyTo: 'reply@example.com',
      cc: ['cc@example.com'],
      unsubscribeGroupId: 42,
      trackingEnabled: true,
    });

    const sentMessage = (client.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SendGridMessage;
    expect(sentMessage.replyTo).toBe('reply@example.com');
    expect(sentMessage.cc).toEqual(['cc@example.com']);
    expect(sentMessage.asm).toEqual({ groupId: 42 });
    expect(sentMessage.trackingSettings?.clickTracking?.enable).toBe(true);
  });

  it('generates local messageId when provider does not return one', async () => {
    const noIdProvider = createProvider({
      sendResult: {
        statusCode: 202,
        headers: {},
        messageId: undefined,
      },
    });

    const result = await noIdProvider.send('user@example.com', 'Subject', '<p>Body</p>');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.messageId).toMatch(/^ordr_email_/);
      expect(result.data.providerMessageId).toBeUndefined();
    }
  });

  it('maps non-2xx status codes to failed', async () => {
    const failProvider = createProvider({
      sendResult: {
        statusCode: 400,
        headers: {},
        messageId: 'sg_fail_123',
      },
    });

    const result = await failProvider.send('user@example.com', 'Subject', '<p>Body</p>');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(MESSAGE_STATUSES.FAILED);
    }
  });
});

// ─── Webhook Parsing ─────────────────────────────────────────────

describe('EmailProvider — parseWebhook', () => {
  let provider: EmailProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('parses valid SendGrid event webhooks', () => {
    const result = provider.parseWebhook([
      {
        email: 'user@example.com',
        event: 'delivered',
        timestamp: 1700000000,
        sg_message_id: 'sg_123',
      },
      {
        email: 'other@example.com',
        event: 'bounce',
        timestamp: 1700000001,
        sg_message_id: 'sg_456',
        reason: 'Mailbox full',
        bounce_classification: 'content',
      },
    ]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.email).toBe('user@example.com');
      expect(result.data[0]?.event).toBe('delivered');
      expect(result.data[0]?.sgMessageId).toBe('sg_123');
      expect(result.data[1]?.event).toBe('bounce');
      expect(result.data[1]?.reason).toBe('Mailbox full');
    }
  });

  it('skips malformed events in the array', () => {
    const result = provider.parseWebhook([
      { email: 'user@example.com', event: 'delivered', timestamp: 1700000000 },
      { bad: 'data' }, // missing email and event
      null,
      'not an object',
    ]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
    }
  });

  it('handles empty array', () => {
    const result = provider.parseWebhook([]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });
});

// ─── Event Status Mapping ────────────────────────────────────────

describe('EmailProvider — mapEventToStatus', () => {
  let provider: EmailProvider;

  beforeEach(() => {
    provider = createProvider();
  });

  it('maps "delivered" to DELIVERED', () => {
    expect(provider.mapEventToStatus('delivered')).toBe(MESSAGE_STATUSES.DELIVERED);
  });

  it('maps "bounce" to BOUNCED', () => {
    expect(provider.mapEventToStatus('bounce')).toBe(MESSAGE_STATUSES.BOUNCED);
  });

  it('maps "deferred" to RETRYING', () => {
    expect(provider.mapEventToStatus('deferred')).toBe(MESSAGE_STATUSES.RETRYING);
  });

  it('maps "unsubscribe" to OPTED_OUT', () => {
    expect(provider.mapEventToStatus('unsubscribe')).toBe(MESSAGE_STATUSES.OPTED_OUT);
  });

  it('maps "spamreport" to OPTED_OUT', () => {
    expect(provider.mapEventToStatus('spamreport')).toBe(MESSAGE_STATUSES.OPTED_OUT);
  });

  it('maps unknown events to SENT', () => {
    expect(provider.mapEventToStatus('some_unknown_event')).toBe(MESSAGE_STATUSES.SENT);
  });
});
