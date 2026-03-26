/**
 * WhatsApp Webhook Routes — Twilio WhatsApp Business API callbacks
 *
 * SOC2 CC6.1 — Access control: provider signature validation (NOT JWT).
 * ISO 27001 A.14.2.5 — Secure system engineering: validate all external input.
 * HIPAA §164.312(e)(1) — Transmission security: verify webhook origin.
 *
 * SECURITY:
 * - Webhook routes do NOT use JWT auth — they use Twilio signature validation
 * - NEVER log message content (may contain PHI)
 * - Opt-out keywords are detected on inbound messages and consent revoked immediately
 * - All events are published to Kafka for downstream processing
 */

import { Hono } from 'hono';
import type { AuditLogger } from '@ordr/audit';
import type { EventProducer } from '@ordr/events';
import { createEventEnvelope, TOPICS, EventType } from '@ordr/events';
import type { WhatsAppProvider } from '@ordr/channels';
import type { ConsentManager } from '@ordr/channels';
import type { ConsentStore, Channel, MessageStatus } from '@ordr/channels';
import type { Env } from '../types.js';

// ---- Dependencies (injected at startup) ------------------------------------

interface WhatsAppWebhookDependencies {
  readonly auditLogger: AuditLogger;
  readonly eventProducer: EventProducer;
  readonly whatsAppProvider: WhatsAppProvider;
  readonly consentManager: ConsentManager;
  readonly consentStore: ConsentStore;
  readonly whatsAppWebhookUrl: string;
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
}

let deps: WhatsAppWebhookDependencies | null = null;

export function configureWhatsAppWebhookRoutes(dependencies: WhatsAppWebhookDependencies): void {
  deps = dependencies;
}

// ---- Helper: Parse form-encoded body ----------------------------------------

function parseFormBody(rawBody: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of rawBody.split('&')) {
    const [key, value] = pair.split('=');
    if (key !== undefined && value !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  }
  return params;
}

// ---- Router ----------------------------------------------------------------

const whatsappWebhooksRouter = new Hono<Env>();

// NOTE: No requireAuth() — webhooks authenticate via Twilio signature validation

// ---- POST / — WhatsApp inbound messages + status updates -------------------

whatsappWebhooksRouter.post('/', async (c) => {
  if (!deps) throw new Error('[ORDR:API] WhatsApp webhook routes not configured');

  const requestId = c.get('requestId') ?? 'unknown';

  const rawBody = await c.req.text();
  const params = parseFormBody(rawBody);

  // SECURITY: Validate Twilio signature — MUST happen before processing
  const signature = c.req.header('x-twilio-signature') ?? '';
  const isValid = deps.whatsAppProvider.validateWebhookSignature(
    signature,
    deps.whatsAppWebhookUrl,
    params,
  );

  if (!isValid) {
    await deps.auditLogger.log({
      tenantId: 'system',
      eventType: 'compliance.violation',
      actorType: 'system',
      actorId: 'webhook',
      resource: 'twilio_whatsapp_webhook',
      resourceId: requestId,
      action: 'signature_validation_failed',
      details: { source: 'twilio_whatsapp' },
      timestamp: new Date(),
    });

    return c.text('', 403);
  }

  const messageSid = params['MessageSid'] ?? '';
  const messageStatus = params['MessageStatus'] ?? '';

  // Determine if this is an inbound message or a status update
  // Inbound WhatsApp messages have a From starting with "whatsapp:" and have a Body
  const isInbound = params['Body'] !== undefined && !messageStatus;

  if (isInbound) {
    // ── Inbound WhatsApp message ──
    const parseResult = deps.whatsAppProvider.parseWebhook(params);
    if (!parseResult.success) {
      return c.text(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        200,
        { 'Content-Type': 'text/xml' },
      );
    }

    const inbound = parseResult.data;
    const fromNumber = inbound.from;
    const messageBody = inbound.body;

    // Check for opt-out keywords — same as SMS (STOP, UNSUBSCRIBE, etc.)
    if (deps.consentManager.isOptOutKeyword(messageBody)) {
      const customer = await deps.findCustomerByPhone(fromNumber);
      if (customer) {
        // Revoke WhatsApp consent immediately
        await deps.consentManager.revokeConsent(
          customer.customerId,
          'whatsapp' as Channel,
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
          action: 'opt_out_whatsapp',
          details: { source: 'inbound_whatsapp', messageSid },
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
          channel: 'whatsapp',
          direction: 'inbound',
          type: 'message',
          hasMedia: inbound.numMedia > 0,
        },
        {
          correlationId: requestId,
          source: 'twilio_whatsapp_webhook',
        },
      );

      await deps.eventProducer.publish(TOPICS.INTERACTION_EVENTS, interactionEvent).catch((publishErr: unknown) => {
        console.error('[ORDR:API] Failed to publish whatsapp interaction.logged event:', publishErr);
      });
    }

    return c.text(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      200,
      { 'Content-Type': 'text/xml' },
    );
  }

  // ── Status update ──
  if (messageStatus && messageSid) {
    const parseResult = deps.whatsAppProvider.parseStatusWebhook(params);
    if (!parseResult.success) {
      return c.text(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        200,
        { 'Content-Type': 'text/xml' },
      );
    }

    const statusEvent = parseResult.data;
    const newStatus = deps.whatsAppProvider.mapTwilioStatusToMessageStatus(statusEvent.messageStatus);

    const messageRecord = await deps.updateMessageStatus(messageSid, newStatus);

    if (messageRecord) {
      // Publish interaction.logged event — NO message content
      const interactionEvent = createEventEnvelope(
        EventType.INTERACTION_LOGGED,
        messageRecord.tenantId,
        {
          interactionId: messageSid,
          customerId: messageRecord.customerId,
          channel: 'whatsapp',
          direction: 'outbound',
          type: 'status_update',
          messageStatus: statusEvent.messageStatus,
        },
        {
          correlationId: requestId,
          source: 'twilio_whatsapp_webhook',
        },
      );

      await deps.eventProducer.publish(TOPICS.INTERACTION_EVENTS, interactionEvent).catch((publishErr: unknown) => {
        console.error('[ORDR:API] Failed to publish whatsapp status event:', publishErr);
      });
    }
  }

  return c.text(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    200,
    { 'Content-Type': 'text/xml' },
  );
});

export { whatsappWebhooksRouter };
