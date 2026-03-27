/**
 * Webhook Routes — Twilio SMS + SendGrid email delivery webhooks
 *
 * SOC2 CC6.1 — Access control: provider signature validation (NOT JWT).
 * ISO 27001 A.14.2.5 — Secure system engineering: validate all external input.
 * HIPAA §164.312(e)(1) — Transmission security: verify webhook origin.
 *
 * SECURITY:
 * - Webhook routes do NOT use JWT auth — they use provider signature validation
 * - Twilio signature MUST be validated before processing
 * - NEVER log message content (may contain PHI)
 * - Opt-out keywords are detected on inbound SMS and consent revoked immediately
 * - All events are published to Kafka for downstream processing
 */

import { Hono } from 'hono';
import type { AuditLogger } from '@ordr/audit';
import type { EventProducer } from '@ordr/events';
import { createEventEnvelope, TOPICS, EventType } from '@ordr/events';
import type { SmsProvider } from '@ordr/channels';
import type { EmailProvider } from '@ordr/channels';
import type { ConsentManager } from '@ordr/channels';
import type { MessageStateMachine } from '@ordr/channels';
import type { ConsentStore, Channel, MessageStatus, MessageEvent } from '@ordr/channels';
import { MESSAGE_EVENTS, MESSAGE_STATUSES } from '@ordr/channels';
import type { Env } from '../types.js';

// ---- Dependencies (injected at startup) ------------------------------------

interface WebhookDependencies {
  readonly auditLogger: AuditLogger;
  readonly eventProducer: EventProducer;
  readonly smsProvider: SmsProvider;
  readonly emailProvider: EmailProvider;
  readonly consentManager: ConsentManager;
  readonly consentStore: ConsentStore;
  readonly stateMachine: MessageStateMachine;
  readonly twilioWebhookUrl: string;
  readonly updateMessageStatus: (
    providerMessageId: string,
    status: MessageStatus,
  ) => Promise<{
    readonly messageId: string;
    readonly tenantId: string;
    readonly customerId: string;
  } | null>;
  readonly findCustomerByPhone: (
    phone: string,
  ) => Promise<{ readonly customerId: string; readonly tenantId: string } | null>;
  readonly findCustomerByEmail: (
    email: string,
  ) => Promise<{ readonly customerId: string; readonly tenantId: string } | null>;
}

let deps: WebhookDependencies | null = null;

export function configureWebhookRoutes(dependencies: WebhookDependencies): void {
  deps = dependencies;
}

// ---- Twilio status → MessageEvent mapping ----------------------------------

function mapTwilioStatusToEvent(status: string): MessageEvent | null {
  switch (status.toLowerCase()) {
    case 'queued':
      return MESSAGE_EVENTS.ENQUEUE;
    case 'sent':
      return MESSAGE_EVENTS.SEND;
    case 'delivered':
      return MESSAGE_EVENTS.DELIVER;
    case 'failed':
    case 'undelivered':
      return MESSAGE_EVENTS.FAIL;
    default:
      return null;
  }
}

// ---- Router ----------------------------------------------------------------

const webhooksRouter = new Hono<Env>();

// NOTE: No requireAuth() — webhooks authenticate via provider signature validation

// ---- POST /twilio — Twilio SMS delivery status + inbound messages ----------

webhooksRouter.post('/twilio', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');

  const requestId = c.get('requestId');

  // Parse the form-encoded body
  const rawBody = await c.req.text();
  const params: Record<string, string> = {};
  for (const pair of rawBody.split('&')) {
    const [key, value] = pair.split('=');
    if (key !== undefined && value !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  }

  // SECURITY: Validate Twilio signature — MUST happen before processing
  const signature = c.req.header('x-twilio-signature') ?? '';
  const isValid = deps.smsProvider.validateWebhookSignature(
    signature,
    deps.twilioWebhookUrl,
    params,
  );

  if (!isValid) {
    // Audit log invalid signature attempt
    await deps.auditLogger.log({
      tenantId: 'system',
      eventType: 'compliance.violation',
      actorType: 'system',
      actorId: 'webhook',
      resource: 'twilio_webhook',
      resourceId: requestId,
      action: 'signature_validation_failed',
      details: { source: 'twilio' },
      timestamp: new Date(),
    });

    return c.text('', 403);
  }

  const messageSid = params['MessageSid'] ?? params['SmsSid'] ?? '';
  const messageStatus = params['MessageStatus'] ?? params['SmsStatus'] ?? '';

  // Determine if this is a delivery status update or an inbound message
  const isInbound =
    params['Direction'] === 'inbound' ||
    (params['Body'] !== undefined &&
      (params['MessageStatus'] === undefined || params['MessageStatus'].length === 0));

  if (isInbound) {
    // ── Inbound SMS message ──
    const parseResult = deps.smsProvider.parseWebhook(params);
    if (!parseResult.success) {
      return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
        'Content-Type': 'text/xml',
      });
    }

    const inbound = parseResult.data;
    const fromNumber = inbound.from;
    const messageBody = inbound.body;

    // Check for opt-out keywords
    if (deps.consentManager.isOptOutKeyword(messageBody)) {
      // Find customer by phone number
      const customer = await deps.findCustomerByPhone(fromNumber);
      if (customer) {
        // Revoke consent immediately — TCPA requirement
        await deps.consentManager.revokeConsent(
          customer.customerId,
          'sms' as Channel,
          deps.consentStore,
        );

        // Audit log consent revocation
        await deps.auditLogger.log({
          tenantId: customer.tenantId,
          eventType: 'compliance.check',
          actorType: 'system',
          actorId: 'webhook',
          resource: 'consent',
          resourceId: customer.customerId,
          action: 'opt_out_sms',
          details: { source: 'inbound_sms', messageSid },
          timestamp: new Date(),
        });
      }
    }

    // Publish interaction.logged event — NO message content
    const customer = await deps.findCustomerByPhone(fromNumber);
    if (customer) {
      const interactionEvent = createEventEnvelope(
        EventType.INTERACTION_LOGGED,
        customer.tenantId,
        {
          interactionId: messageSid,
          customerId: customer.customerId,
          channel: 'sms',
          direction: 'inbound',
          type: 'message',
        },
        {
          correlationId: requestId,
          source: 'twilio_webhook',
        },
      );

      await deps.eventProducer
        .publish(TOPICS.INTERACTION_EVENTS, interactionEvent)
        .catch((publishErr: unknown) => {
          console.error('[ORDR:API] Failed to publish interaction.logged event:', publishErr);
        });
    }

    // Return TwiML response (empty — no auto-reply)
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
      'Content-Type': 'text/xml',
    });
  }

  // ── Delivery status update ──
  const event = mapTwilioStatusToEvent(messageStatus);
  if (event && messageSid) {
    // Update message status via state machine
    const messageRecord = await deps.updateMessageStatus(
      messageSid,
      mapTwilioStatusToMessageStatus(messageStatus),
    );

    if (messageRecord) {
      // Publish interaction.logged event — NO message content
      const interactionEvent = createEventEnvelope(
        EventType.INTERACTION_LOGGED,
        messageRecord.tenantId,
        {
          interactionId: messageSid,
          customerId: messageRecord.customerId,
          channel: 'sms',
          direction: 'outbound',
          type: 'status_update',
        },
        {
          correlationId: requestId,
          source: 'twilio_webhook',
        },
      );

      await deps.eventProducer
        .publish(TOPICS.INTERACTION_EVENTS, interactionEvent)
        .catch((publishErr: unknown) => {
          console.error('[ORDR:API] Failed to publish interaction.logged event:', publishErr);
        });
    }
  }

  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
    'Content-Type': 'text/xml',
  });
});

// ---- POST /sendgrid — SendGrid email event webhooks ------------------------

webhooksRouter.post('/sendgrid', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Webhook routes not configured');

  const requestId = c.get('requestId');

  // Parse the JSON body — SendGrid sends arrays of event objects
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  if (body === null || !Array.isArray(body as unknown)) {
    return c.json({ received: true }, 200);
  }

  // Parse webhook events

  const parseResult = deps.emailProvider.parseWebhook(body as unknown[]);
  if (!parseResult.success) {
    return c.json({ received: true }, 200);
  }

  const events = parseResult.data;

  // Process each event
  for (const emailEvent of events) {
    const providerMessageId = emailEvent.sgMessageId ?? '';
    if (!providerMessageId) continue;

    // Map event type to message status
    const newStatus = deps.emailProvider.mapEventToStatus(emailEvent.event);

    // Update message status
    const messageRecord = await deps.updateMessageStatus(providerMessageId, newStatus);

    if (messageRecord) {
      // Check for unsubscribe events — revoke consent
      if (emailEvent.event === 'unsubscribe' || emailEvent.event === 'spamreport') {
        const customer = await deps.findCustomerByEmail(emailEvent.email);
        if (customer) {
          await deps.consentManager.revokeConsent(
            customer.customerId,
            'email' as Channel,
            deps.consentStore,
          );

          // Audit log consent revocation
          await deps.auditLogger.log({
            tenantId: customer.tenantId,
            eventType: 'compliance.check',
            actorType: 'system',
            actorId: 'webhook',
            resource: 'consent',
            resourceId: customer.customerId,
            action: 'opt_out_email',
            details: { source: 'sendgrid_webhook', eventType: emailEvent.event },
            timestamp: new Date(),
          });
        }
      }

      // Publish interaction.logged event — NO email content
      const interactionEvent = createEventEnvelope(
        EventType.INTERACTION_LOGGED,
        messageRecord.tenantId,
        {
          interactionId: providerMessageId,
          customerId: messageRecord.customerId,
          channel: 'email',
          direction: 'outbound',
          type: 'status_update',
        },
        {
          correlationId: requestId,
          source: 'sendgrid_webhook',
        },
      );

      await deps.eventProducer
        .publish(TOPICS.INTERACTION_EVENTS, interactionEvent)
        .catch((publishErr: unknown) => {
          console.error('[ORDR:API] Failed to publish interaction.logged event:', publishErr);
        });
    }
  }

  return c.json({ received: true }, 200);
});

// ---- Helpers ----------------------------------------------------------------

function mapTwilioStatusToMessageStatus(status: string): MessageStatus {
  switch (status.toLowerCase()) {
    case 'queued':
      return MESSAGE_STATUSES.QUEUED;
    case 'sent':
      return MESSAGE_STATUSES.SENT;
    case 'delivered':
      return MESSAGE_STATUSES.DELIVERED;
    case 'failed':
    case 'undelivered':
      return MESSAGE_STATUSES.FAILED;
    default:
      return MESSAGE_STATUSES.SENT;
  }
}

export { webhooksRouter };
