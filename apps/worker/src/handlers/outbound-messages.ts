/**
 * Outbound Message Handlers — consent → compliance → send → audit pipeline
 *
 * SOC2 CC6.1 — Access control: consent verification before send.
 * ISO 27001 A.13.2.1 — Information transfer: compliance gate before delivery.
 * HIPAA §164.312(e)(1) — Transmission security.
 *
 * Pipeline:
 * 1. Consent check — TCPA/CAN-SPAM verification
 * 2. Compliance gate — regulatory rules evaluation
 * 3. Send via appropriate channel provider
 * 4. Update message status
 * 5. Audit log the entire flow
 *
 * SECURITY:
 * - Consent check BEFORE every outbound message — no exceptions
 * - Compliance gate BEFORE every customer-facing action — no exceptions
 * - NEVER logs message content — only metadata (channel, status, IDs)
 * - All failures are audit-logged
 */

import type { EventEnvelope } from '@ordr/events';
import { createEventEnvelope, TOPICS, EventType } from '@ordr/events';
import type { EventProducer } from '@ordr/events';
import type { AuditLogger } from '@ordr/audit';
import type {
  ConsentManager,
  ConsentStore,
  SmsProvider,
  EmailProvider,
  MessageStateMachine,
  Channel,
} from '@ordr/channels';
import type { ComplianceGate } from '@ordr/compliance';
import type { NotificationWriter } from '../types.js';

// ─── Outbound Message Payload ────────────────────────────────────

interface OutboundMessagePayload {
  readonly messageId: string;
  readonly customerId: string;
  readonly channel: string;
  readonly contentRef: string;
}

// ─── Dependencies ────────────────────────────────────────────────

export interface OutboundMessagesDeps {
  readonly consentManager: ConsentManager;
  readonly consentStore: ConsentStore;
  readonly complianceGate: ComplianceGate;
  readonly smsProvider: SmsProvider;
  readonly emailProvider: EmailProvider;
  readonly eventProducer: EventProducer;
  readonly auditLogger: AuditLogger;
  readonly stateMachine: MessageStateMachine;
  readonly notificationWriter: NotificationWriter;
  readonly getCustomerContact: (
    tenantId: string,
    customerId: string,
    channel: string,
  ) => Promise<{ readonly contact: string; readonly contentBody: string } | null>;
  readonly updateMessageStatus: (messageId: string, status: string) => Promise<void>;
}

// ─── Handler Factory ─────────────────────────────────────────────

export function createOutboundMessagesHandler(
  deps: OutboundMessagesDeps,
): (event: EventEnvelope<unknown>) => Promise<void> {
  return async (event: EventEnvelope<unknown>): Promise<void> => {
    const { tenantId, payload, metadata } = event;
    const data = payload as OutboundMessagePayload;

    const messageId = data.messageId;
    const customerId = data.customerId;
    const channel = data.channel;

    // ── 1. Consent Check — MUST pass before any outbound message ──

    const consentResult = await deps.consentManager.verifyConsentForSend(
      customerId,
      channel as Channel,
      deps.consentStore,
    );

    if (!consentResult.success) {
      // Consent denied — update status, audit, and notify
      await deps.updateMessageStatus(messageId, 'opted_out');

      await deps.auditLogger.log({
        tenantId,
        eventType: 'compliance.violation',
        actorType: 'system',
        actorId: 'worker',
        resource: 'outbound_message',
        resourceId: messageId,
        action: 'consent_denied',
        details: {
          customerId,
          channel,
          correlationId: metadata.correlationId,
        },
        timestamp: new Date(),
      });

      await deps.notificationWriter
        .insert({
          tenantId,
          type: 'compliance',
          severity: 'high',
          title: 'Message blocked: consent not given',
          description: `Outbound ${channel} message blocked — customer has not provided consent. Message ID: ${messageId}.`,
          actionLabel: 'View customer',
          actionRoute: `/customers/${customerId}`,
          metadata: { messageId, customerId, channel },
        })
        .catch((notifErr: unknown) => {
          console.error('[ORDR:WORKER] Failed to write consent_denied notification:', notifErr);
        });

      return;
    }

    // ── 2. Compliance Gate — MUST pass before any customer-facing action ──

    const complianceResult = deps.complianceGate.check(`send_${channel}`, {
      tenantId,
      customerId,
      channel,
      data: { contentRef: data.contentRef },
      timestamp: new Date(),
    });

    if (!complianceResult.allowed) {
      const violationMessages = complianceResult.violations
        .map((v) => v.violation?.message ?? 'Unknown violation')
        .join('; ');

      // Compliance denied — update status, audit, and notify
      await deps.updateMessageStatus(messageId, 'failed');

      await deps.auditLogger.log({
        tenantId,
        eventType: 'compliance.violation',
        actorType: 'system',
        actorId: 'worker',
        resource: 'outbound_message',
        resourceId: messageId,
        action: 'compliance_blocked',
        details: {
          customerId,
          channel,
          violations: violationMessages,
          correlationId: metadata.correlationId,
        },
        timestamp: new Date(),
      });

      await deps.notificationWriter
        .insert({
          tenantId,
          type: 'compliance',
          severity: 'high',
          title: 'Message blocked: compliance violation',
          description: `Outbound ${channel} message blocked by compliance gate. Message ID: ${messageId}. Violations: ${violationMessages}`,
          actionLabel: 'View customer',
          actionRoute: `/customers/${customerId}`,
          metadata: { messageId, customerId, channel },
        })
        .catch((notifErr: unknown) => {
          console.error('[ORDR:WORKER] Failed to write compliance_blocked notification:', notifErr);
        });

      return;
    }

    // ── 3. Resolve customer contact info ──

    const contactInfo = await deps.getCustomerContact(tenantId, customerId, channel);
    if (!contactInfo) {
      await deps.updateMessageStatus(messageId, 'failed');

      await deps.auditLogger.log({
        tenantId,
        eventType: 'data.read',
        actorType: 'system',
        actorId: 'worker',
        resource: 'outbound_message',
        resourceId: messageId,
        action: 'contact_not_found',
        details: { customerId, channel, correlationId: metadata.correlationId },
        timestamp: new Date(),
      });

      return;
    }

    // ── 4. Send via appropriate channel provider ──

    let sendSuccess = false;
    let providerMessageId: string | undefined;

    if (channel === 'sms') {
      const result = await deps.smsProvider.send(contactInfo.contact, contactInfo.contentBody);
      if (result.success) {
        sendSuccess = true;
        providerMessageId = result.data.providerMessageId ?? undefined;
      }
    } else if (channel === 'email') {
      const result = await deps.emailProvider.send(
        contactInfo.contact,
        'Message from ORDR-Connect',
        contactInfo.contentBody,
      );
      if (result.success) {
        sendSuccess = true;
        providerMessageId = result.data.providerMessageId ?? undefined;
      }
    }

    // ── 5. Update message status ──

    const newStatus = sendSuccess ? 'sent' : 'failed';
    await deps.updateMessageStatus(messageId, newStatus);

    // ── 6. Audit log ──

    await deps.auditLogger.log({
      tenantId,
      eventType: 'data.updated',
      actorType: 'system',
      actorId: 'worker',
      resource: 'outbound_message',
      resourceId: messageId,
      action: sendSuccess ? 'sent' : 'send_failed',
      details: {
        customerId,
        channel,
        success: sendSuccess,
        providerMessageId,
        correlationId: metadata.correlationId,
      },
      timestamp: new Date(),
    });

    // ── 7. Publish interaction event ──

    if (sendSuccess) {
      const interactionEvent = createEventEnvelope(
        EventType.INTERACTION_LOGGED,
        tenantId,
        {
          interactionId: messageId,
          customerId,
          channel,
          direction: 'outbound',
          type: 'message',
        },
        {
          correlationId: metadata.correlationId,
          source: 'worker',
        },
      );

      await deps.eventProducer
        .publish(TOPICS.INTERACTION_EVENTS, interactionEvent)
        .catch((publishErr: unknown) => {
          console.error('[ORDR:WORKER] Failed to publish interaction.logged event:', publishErr);
        });
    }
  };
}
