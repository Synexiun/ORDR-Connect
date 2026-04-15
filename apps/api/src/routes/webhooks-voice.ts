/**
 * Voice Webhook Routes — Twilio Programmable Voice callbacks
 *
 * SOC2 CC6.1 — Access control: provider signature validation (NOT JWT).
 * ISO 27001 A.14.2.5 — Secure system engineering: validate all external input.
 * HIPAA §164.312(e)(1) — Transmission security: verify webhook origin.
 * HIPAA §164.312(a)(1) — Access control: recordings stored by reference only.
 *
 * SECURITY:
 * - Webhook routes do NOT use JWT auth — they use Twilio signature validation
 * - NEVER log call content, TwiML, or audio (may contain PHI)
 * - Recordings stored by reference (SID) only — audio stays in Twilio
 * - All events are published to Kafka for downstream processing
 */

import { Hono } from 'hono';
import type { AuditLogger } from '@ordr/audit';
import type { EventProducer } from '@ordr/events';
import { createEventEnvelope, TOPICS, EventType } from '@ordr/events';
import type { VoiceProvider } from '@ordr/channels';
import type { MessageStatus } from '@ordr/channels';
import type { Env } from '../types.js';

// ---- Dependencies (injected at startup) ------------------------------------

interface VoiceWebhookDependencies {
  readonly auditLogger: AuditLogger;
  readonly eventProducer: EventProducer;
  readonly voiceProvider: VoiceProvider;
  readonly voiceWebhookUrl: string;
  readonly voiceRecordingWebhookUrl: string;
  readonly voiceGatherWebhookUrl: string;
  readonly updateCallStatus: (
    callSid: string,
    status: MessageStatus,
  ) => Promise<{
    readonly messageId: string;
    readonly tenantId: string;
    readonly customerId: string;
  } | null>;
  readonly storeRecordingReference: (
    callSid: string,
    recordingSid: string,
    durationSeconds: number,
  ) => Promise<void>;
}

let deps: VoiceWebhookDependencies | null = null;

export function configureVoiceWebhookRoutes(dependencies: VoiceWebhookDependencies): void {
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

const voiceWebhooksRouter = new Hono<Env>();

// NOTE: No requireAuth() — webhooks authenticate via Twilio signature validation

// ---- POST /status — Voice call status updates ------------------------------

voiceWebhooksRouter.post('/status', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Voice webhook routes not configured');

  const requestId = c.get('requestId');

  const rawBody = await c.req.text();
  const params = parseFormBody(rawBody);

  // SECURITY: Validate Twilio signature — MUST happen before processing
  const signature = c.req.header('x-twilio-signature') ?? '';
  const isValid = deps.voiceProvider.validateWebhookSignature(
    signature,
    deps.voiceWebhookUrl,
    params,
  );

  if (!isValid) {
    await deps.auditLogger.log({
      tenantId: 'system',
      eventType: 'compliance.violation',
      actorType: 'system',
      actorId: 'webhook',
      resource: 'twilio_voice_webhook',
      resourceId: requestId,
      action: 'signature_validation_failed',
      details: { source: 'twilio_voice' },
      timestamp: new Date(),
    });

    return c.text('', 403);
  }

  // Parse the status webhook
  const parseResult = deps.voiceProvider.parseStatusWebhook(params);
  if (!parseResult.success) {
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
      'Content-Type': 'text/xml',
    });
  }

  const statusEvent = parseResult.data;

  // Map call status to message status and update
  const messageStatus = deps.voiceProvider.mapCallStatusToMessageStatus(statusEvent.callStatus);
  const callRecord = await deps.updateCallStatus(statusEvent.callSid, messageStatus);

  if (callRecord) {
    // Audit log for call status mutation (SOC2 CC6.1 / HIPAA §164.312(b))
    await deps.auditLogger.log({
      tenantId: callRecord.tenantId,
      eventType: 'data.updated',
      actorType: 'system',
      actorId: 'twilio_voice_webhook',
      resource: 'call',
      resourceId: statusEvent.callSid,
      action: 'update_status',
      details: {
        messageId: callRecord.messageId,
        callStatus: statusEvent.callStatus,
        messageStatus,
        direction: statusEvent.direction,
        duration: statusEvent.duration,
      },
      timestamp: new Date(),
    });
    // Publish interaction event — NO call content
    const interactionEvent = createEventEnvelope(
      EventType.INTERACTION_LOGGED,
      callRecord.tenantId,
      {
        interactionId: statusEvent.callSid,
        customerId: callRecord.customerId,
        channel: 'voice',
        direction: statusEvent.direction === 'inbound' ? 'inbound' : 'outbound',
        type: 'status_update',
        callStatus: statusEvent.callStatus,
        duration: statusEvent.duration,
      },
      {
        correlationId: requestId,
        source: 'twilio_voice_webhook',
      },
    );

    await deps.eventProducer
      .publish(TOPICS.INTERACTION_EVENTS, interactionEvent)
      .catch((publishErr: unknown) => {
        console.error(
          JSON.stringify({
            level: 'error',
            component: 'webhooks-voice',
            event: 'kafka_publish_failure',
            topic: 'interaction_events',
            action: 'voice.interaction.logged',
            error: publishErr instanceof Error ? publishErr.message : 'Unknown error',
          }),
        );
      });
  }

  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
    'Content-Type': 'text/xml',
  });
});

// ---- POST /recording — Recording completed callback ------------------------

voiceWebhooksRouter.post('/recording', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Voice webhook routes not configured');

  const requestId = c.get('requestId');

  const rawBody = await c.req.text();
  const params = parseFormBody(rawBody);

  // SECURITY: Validate Twilio signature
  const signature = c.req.header('x-twilio-signature') ?? '';
  const isValid = deps.voiceProvider.validateWebhookSignature(
    signature,
    deps.voiceRecordingWebhookUrl,
    params,
  );

  if (!isValid) {
    await deps.auditLogger.log({
      tenantId: 'system',
      eventType: 'compliance.violation',
      actorType: 'system',
      actorId: 'webhook',
      resource: 'twilio_recording_webhook',
      resourceId: requestId,
      action: 'signature_validation_failed',
      details: { source: 'twilio_recording' },
      timestamp: new Date(),
    });

    return c.text('', 403);
  }

  // Parse the recording webhook
  const parseResult = deps.voiceProvider.parseRecordingWebhook(params);
  if (!parseResult.success) {
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
      'Content-Type': 'text/xml',
    });
  }

  const recording = parseResult.data;

  // HIPAA: Store only the recording reference (SID).
  // The actual audio stays in Twilio's HIPAA-compliant storage.
  // Wrap in try/catch so the audit log always runs (SOC2 CC6.1).
  let storeSuccess = true;
  let storeError: string | undefined;
  try {
    await deps.storeRecordingReference(
      recording.callSid,
      recording.recordingSid,
      recording.recordingDuration,
    );
  } catch (err: unknown) {
    storeSuccess = false;
    storeError = err instanceof Error ? err.message : 'Unknown storage error';
    console.error(
      JSON.stringify({
        level: 'error',
        component: 'voice_webhook',
        event: 'recording_store_failure',
        callSid: recording.callSid,
        recordingSid: recording.recordingSid,
        error: storeError,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  // Audit log the recording reference storage — runs even on failure
  await deps.auditLogger.log({
    tenantId: 'system',
    eventType: 'compliance.check',
    actorType: 'system',
    actorId: 'webhook',
    resource: 'recording',
    resourceId: recording.recordingSid,
    action: storeSuccess ? 'recording_reference_stored' : 'recording_reference_store_failed',
    details: {
      callSid: recording.callSid,
      durationSeconds: recording.recordingDuration,
      status: recording.recordingStatus,
      ...(storeError !== undefined ? { error: storeError } : {}),
    },
    timestamp: new Date(),
  });

  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
    'Content-Type': 'text/xml',
  });
});

// ---- POST /gather — DTMF/speech input from IVR ----------------------------

voiceWebhooksRouter.post('/gather', async (c) => {
  if (!deps) throw new Error('[ORDR:API] Voice webhook routes not configured');

  const requestId = c.get('requestId');

  const rawBody = await c.req.text();
  const params = parseFormBody(rawBody);

  // SECURITY: Validate Twilio signature
  const signature = c.req.header('x-twilio-signature') ?? '';
  const isValid = deps.voiceProvider.validateWebhookSignature(
    signature,
    deps.voiceGatherWebhookUrl,
    params,
  );

  if (!isValid) {
    await deps.auditLogger.log({
      tenantId: 'system',
      eventType: 'compliance.violation',
      actorType: 'system',
      actorId: 'webhook',
      resource: 'twilio_gather_webhook',
      resourceId: requestId,
      action: 'signature_validation_failed',
      details: { source: 'twilio_gather' },
      timestamp: new Date(),
    });

    return c.text('', 403);
  }

  // Parse the gather webhook
  const parseResult = deps.voiceProvider.parseGatherWebhook(params);
  if (!parseResult.success) {
    // Return empty TwiML on parse failure
    return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
      'Content-Type': 'text/xml',
    });
  }

  const gather = parseResult.data;

  // Publish gather event — SECURITY: digits/speech are IVR navigation, not PHI,
  // but we still avoid logging the actual values. Only metadata is published.
  const interactionEvent = createEventEnvelope(
    EventType.INTERACTION_LOGGED,
    'system',
    {
      interactionId: gather.callSid,
      channel: 'voice',
      direction: 'inbound',
      type: 'ivr_input',
      hasDigits: gather.digits !== undefined,
      hasSpeech: gather.speechResult !== undefined,
    },
    {
      correlationId: requestId,
      source: 'twilio_gather_webhook',
    },
  );

  await deps.eventProducer
    .publish(TOPICS.INTERACTION_EVENTS, interactionEvent)
    .catch((publishErr: unknown) => {
      console.error(
        JSON.stringify({
          level: 'error',
          component: 'webhooks-voice',
          event: 'kafka_publish_failure',
          topic: 'interaction_events',
          action: 'gather.interaction.logged',
          error: publishErr instanceof Error ? publishErr.message : 'Unknown error',
        }),
      );
    });

  // Return empty TwiML — downstream processor handles the IVR flow
  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
    'Content-Type': 'text/xml',
  });
});

export { voiceWebhooksRouter };
