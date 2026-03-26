/**
 * Voice provider — Twilio Programmable Voice for ORDR-Connect
 *
 * COMPLIANCE:
 * - NEVER logs call content, TwiML, or audio (PHI/PII) — only metadata
 * - TCPA: Consent verification is the caller's responsibility (external gate)
 * - Recordings stored by reference only (recording SID) — actual audio stays
 *   in Twilio's HIPAA-compliant storage; never downloaded to our systems
 * - Webhook signatures are validated to prevent spoofing
 * - Phone numbers validated to E.164 format
 * - Provider errors are wrapped — raw Twilio errors never exposed
 * - Answering Machine Detection (AMD) supported via machineDetection param
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
  InternalError,
} from '@ordr/core';

import type { SendResult } from './types.js';
import { MESSAGE_STATUSES } from './types.js';
import { validatePhoneNumber } from './sms.js';
import type { TwilioWebhookValidator } from './sms.js';

// ─── Call Status ────────────────────────────────────────────────

export const CALL_STATUSES = {
  QUEUED: 'queued',
  RINGING: 'ringing',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  BUSY: 'busy',
  NO_ANSWER: 'no-answer',
  CANCELED: 'canceled',
  FAILED: 'failed',
} as const;

export type CallStatus = (typeof CALL_STATUSES)[keyof typeof CALL_STATUSES];

// ─── Call Result ────────────────────────────────────────────────

export interface CallResult {
  readonly callSid: string;
  readonly status: CallStatus;
  readonly direction: 'outbound-api' | 'outbound-dial' | 'inbound';
}

// ─── Voice Options ──────────────────────────────────────────────

export interface VoiceOptions {
  readonly statusCallback?: string | undefined;
  readonly statusCallbackEvent?: readonly string[] | undefined;
  readonly recordingStatusCallback?: string | undefined;
  readonly timeout?: number | undefined;
  readonly machineDetection?: 'Enable' | 'DetectMessageEnd' | undefined;
  readonly machineDetectionTimeout?: number | undefined;
  readonly maxPrice?: string | undefined;
}

// ─── IVR Flow Types ─────────────────────────────────────────────

export interface SayStep {
  readonly type: 'say';
  readonly text: string;
  readonly voice?: string | undefined;
  readonly language?: string | undefined;
}

export interface GatherStep {
  readonly type: 'gather';
  readonly input: 'dtmf' | 'speech' | 'dtmf speech';
  readonly timeout: number;
  readonly numDigits?: number | undefined;
  readonly action: string;
}

export interface DialStep {
  readonly type: 'dial';
  readonly number: string;
  readonly timeout: number;
  readonly record?: boolean | undefined;
}

export interface RecordStep {
  readonly type: 'record';
  readonly maxLength: number;
  readonly action: string;
  readonly transcribe: boolean;
}

export interface PauseStep {
  readonly type: 'pause';
  readonly length: number;
}

export interface HangupStep {
  readonly type: 'hangup';
}

export type IvrStep = SayStep | GatherStep | DialStep | RecordStep | PauseStep | HangupStep;

export type IvrFlow = readonly IvrStep[];

// ─── Webhook Events ─────────────────────────────────────────────

export interface CallStatusEvent {
  readonly callSid: string;
  readonly accountSid: string;
  readonly callStatus: CallStatus;
  readonly from: string;
  readonly to: string;
  readonly direction: string;
  readonly duration: number | undefined;
  readonly timestamp: Date;
}

export interface RecordingEvent {
  readonly recordingSid: string;
  readonly callSid: string;
  readonly accountSid: string;
  readonly recordingDuration: number;
  readonly recordingStatus: string;
  readonly timestamp: Date;
}

export interface GatherEvent {
  readonly callSid: string;
  readonly accountSid: string;
  readonly digits: string | undefined;
  readonly speechResult: string | undefined;
  readonly confidence: number | undefined;
}

// ─── Twilio Voice Client Interface ──────────────────────────────

/**
 * Abstraction over the Twilio voice client to allow testing
 * without real HTTP calls.
 */
export interface TwilioVoiceClient {
  calls: {
    create(params: TwilioCallCreateParams): Promise<TwilioCallInstance>;
  };
}

export interface TwilioCallCreateParams {
  readonly to: string;
  readonly from: string;
  readonly twiml: string;
  readonly statusCallback?: string | undefined;
  readonly statusCallbackEvent?: readonly string[] | undefined;
  readonly recordingStatusCallback?: string | undefined;
  readonly timeout?: number | undefined;
  readonly machineDetection?: string | undefined;
  readonly machineDetectionTimeout?: number | undefined;
  readonly maxPrice?: string | undefined;
}

export interface TwilioCallInstance {
  readonly sid: string;
  readonly status: string;
  readonly direction: string;
}

// ─── Voice Provider ─────────────────────────────────────────────

export class VoiceProvider {
  private readonly client: TwilioVoiceClient;
  private readonly fromNumber: string;
  private readonly authToken: string;
  private readonly statusCallbackUrl: string | undefined;
  private readonly recordingCallbackUrl: string | undefined;
  private readonly webhookValidator: TwilioWebhookValidator | undefined;

  constructor(config: {
    readonly client: TwilioVoiceClient;
    readonly fromNumber: string;
    readonly authToken: string;
    readonly statusCallbackUrl?: string | undefined;
    readonly recordingCallbackUrl?: string | undefined;
    readonly webhookValidator?: TwilioWebhookValidator | undefined;
  }) {
    this.client = config.client;
    this.fromNumber = config.fromNumber;
    this.authToken = config.authToken;
    this.statusCallbackUrl = config.statusCallbackUrl;
    this.recordingCallbackUrl = config.recordingCallbackUrl;
    this.webhookValidator = config.webhookValidator;
  }

  /**
   * Initiate an outbound voice call via Twilio.
   *
   * SECURITY: TwiML content is passed to Twilio but NEVER logged.
   * Only metadata (call SID, status, direction) is loggable.
   *
   * TCPA: Consent verification is the caller's responsibility — this method
   * handles transport only. The orchestration layer MUST call ConsentManager
   * before invoking initiateCall().
   */
  async initiateCall(
    to: string,
    twiml: string,
    opts?: VoiceOptions,
  ): Promise<Result<CallResult, ValidationError | InternalError>> {
    // Validate phone number
    const phoneResult = validatePhoneNumber(to);
    if (!phoneResult.success) {
      return phoneResult;
    }

    // Validate TwiML is non-empty
    if (!twiml || twiml.trim().length === 0) {
      return err(
        new ValidationError('TwiML content cannot be empty', {
          twiml: ['TwiML is required for voice calls'],
        }),
      );
    }

    try {
      const callParams: TwilioCallCreateParams = {
        to,
        from: this.fromNumber,
        twiml,
        statusCallback: opts?.statusCallback ?? this.statusCallbackUrl,
        statusCallbackEvent: opts?.statusCallbackEvent ?? [
          'initiated',
          'ringing',
          'answered',
          'completed',
        ],
        recordingStatusCallback: opts?.recordingStatusCallback ?? this.recordingCallbackUrl,
        timeout: opts?.timeout ?? 30,
        machineDetection: opts?.machineDetection,
        machineDetectionTimeout: opts?.machineDetectionTimeout ?? 5000,
        maxPrice: opts?.maxPrice,
      };

      const call = await this.client.calls.create(callParams);

      return ok({
        callSid: call.sid,
        status: this.mapCallStatus(call.status),
        direction: this.mapDirection(call.direction),
      });
    } catch (error: unknown) {
      // SECURITY: Never expose raw provider errors — wrap with safe message
      const safeMessage = this.extractSafeErrorMessage(error);
      return err(new InternalError(safeMessage));
    }
  }

  /**
   * Generate TwiML XML from an IVR flow definition.
   *
   * SECURITY: Generated TwiML may contain prompts — the output is passed
   * to Twilio but MUST NOT be logged as it may reference PHI.
   */
  generateTwiml(flow: IvrFlow): string {
    const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>'];

    for (const step of flow) {
      switch (step.type) {
        case 'say': {
          const attrs: string[] = [];
          if (step.voice) attrs.push(`voice="${this.escapeXml(step.voice)}"`);
          if (step.language) attrs.push(`language="${this.escapeXml(step.language)}"`);
          const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
          parts.push(`<Say${attrStr}>${this.escapeXml(step.text)}</Say>`);
          break;
        }
        case 'gather': {
          const gatherAttrs: string[] = [
            `input="${this.escapeXml(step.input)}"`,
            `timeout="${step.timeout}"`,
            `action="${this.escapeXml(step.action)}"`,
          ];
          if (step.numDigits !== undefined) {
            gatherAttrs.push(`numDigits="${step.numDigits}"`);
          }
          parts.push(`<Gather ${gatherAttrs.join(' ')}></Gather>`);
          break;
        }
        case 'dial': {
          const dialAttrs: string[] = [`timeout="${step.timeout}"`];
          if (step.record) dialAttrs.push('record="record-from-answer-dual"');
          parts.push(`<Dial ${dialAttrs.join(' ')}>${this.escapeXml(step.number)}</Dial>`);
          break;
        }
        case 'record': {
          const recAttrs: string[] = [
            `maxLength="${step.maxLength}"`,
            `action="${this.escapeXml(step.action)}"`,
            `transcribe="${step.transcribe}"`,
          ];
          parts.push(`<Record ${recAttrs.join(' ')}/>`);
          break;
        }
        case 'pause':
          parts.push(`<Pause length="${step.length}"/>`);
          break;
        case 'hangup':
          parts.push('<Hangup/>');
          break;
      }
    }

    parts.push('</Response>');
    return parts.join('');
  }

  /**
   * Parse a Twilio voice call status webhook payload.
   *
   * SECURITY: Only metadata is extracted — call content is NEVER logged.
   */
  parseStatusWebhook(
    body: Record<string, string>,
  ): Result<CallStatusEvent, ValidationError> {
    const callSid = body['CallSid'];
    const accountSid = body['AccountSid'];
    const callStatus = body['CallStatus'];
    const from = body['From'];
    const to = body['To'];

    if (!callSid || !accountSid || !callStatus || !from || !to) {
      return err(
        new ValidationError('Invalid Twilio voice webhook payload', {
          webhook: ['Missing required fields: CallSid, AccountSid, CallStatus, From, To'],
        }),
      );
    }

    const durationStr = body['CallDuration'] ?? body['Duration'];
    const duration = durationStr !== undefined ? parseInt(durationStr, 10) : undefined;

    return ok({
      callSid,
      accountSid,
      callStatus: this.mapCallStatus(callStatus),
      from,
      to,
      direction: body['Direction'] ?? 'outbound-api',
      duration: duration !== undefined && !isNaN(duration) ? duration : undefined,
      timestamp: new Date(),
    });
  }

  /**
   * Parse a Twilio recording completed webhook payload.
   *
   * HIPAA: Only recording SID and metadata are extracted.
   * Actual audio remains in Twilio's HIPAA-compliant storage.
   * We NEVER download or store recordings locally.
   */
  parseRecordingWebhook(
    body: Record<string, string>,
  ): Result<RecordingEvent, ValidationError> {
    const recordingSid = body['RecordingSid'];
    const callSid = body['CallSid'];
    const accountSid = body['AccountSid'];
    const recordingStatus = body['RecordingStatus'];

    if (!recordingSid || !callSid || !accountSid || !recordingStatus) {
      return err(
        new ValidationError('Invalid Twilio recording webhook payload', {
          webhook: ['Missing required fields: RecordingSid, CallSid, AccountSid, RecordingStatus'],
        }),
      );
    }

    const durationStr = body['RecordingDuration'];
    const recordingDuration = durationStr !== undefined ? parseInt(durationStr, 10) : 0;

    return ok({
      recordingSid,
      callSid,
      accountSid,
      recordingDuration: isNaN(recordingDuration) ? 0 : recordingDuration,
      recordingStatus,
      timestamp: new Date(),
    });
  }

  /**
   * Parse a Twilio Gather (DTMF/speech) webhook payload.
   */
  parseGatherWebhook(
    body: Record<string, string>,
  ): Result<GatherEvent, ValidationError> {
    const callSid = body['CallSid'];
    const accountSid = body['AccountSid'];

    if (!callSid || !accountSid) {
      return err(
        new ValidationError('Invalid Twilio gather webhook payload', {
          webhook: ['Missing required fields: CallSid, AccountSid'],
        }),
      );
    }

    const confidenceStr = body['Confidence'];
    const confidence = confidenceStr !== undefined ? parseFloat(confidenceStr) : undefined;

    return ok({
      callSid,
      accountSid,
      digits: body['Digits'] ?? undefined,
      speechResult: body['SpeechResult'] ?? undefined,
      confidence: confidence !== undefined && !isNaN(confidence) ? confidence : undefined,
    });
  }

  /**
   * Validate a Twilio webhook signature to prevent spoofing.
   *
   * SECURITY: All inbound webhooks MUST be validated before processing.
   * An invalid signature means the request may not be from Twilio.
   */
  validateWebhookSignature(
    signature: string,
    url: string,
    body: Record<string, string>,
  ): boolean {
    if (!this.webhookValidator) {
      // If no validator is configured, reject all requests (fail closed)
      return false;
    }

    return this.webhookValidator.validateRequest(
      this.authToken,
      signature,
      url,
      body,
    );
  }

  // ─── Private ─────────────────────────────────────────────────

  /**
   * Map Twilio call status strings to our CallStatus type.
   */
  private mapCallStatus(twilioStatus: string): CallStatus {
    switch (twilioStatus.toLowerCase()) {
      case 'queued':
        return CALL_STATUSES.QUEUED;
      case 'ringing':
        return CALL_STATUSES.RINGING;
      case 'in-progress':
        return CALL_STATUSES.IN_PROGRESS;
      case 'completed':
        return CALL_STATUSES.COMPLETED;
      case 'busy':
        return CALL_STATUSES.BUSY;
      case 'no-answer':
        return CALL_STATUSES.NO_ANSWER;
      case 'canceled':
        return CALL_STATUSES.CANCELED;
      case 'failed':
        return CALL_STATUSES.FAILED;
      default:
        return CALL_STATUSES.QUEUED;
    }
  }

  /**
   * Map Twilio call direction to our limited set.
   */
  private mapDirection(direction: string): CallResult['direction'] {
    switch (direction.toLowerCase()) {
      case 'inbound':
        return 'inbound';
      case 'outbound-dial':
        return 'outbound-dial';
      default:
        return 'outbound-api';
    }
  }

  /**
   * Map call status to message status for the state machine.
   */
  mapCallStatusToMessageStatus(callStatus: CallStatus): SendResult['status'] {
    switch (callStatus) {
      case CALL_STATUSES.QUEUED:
        return MESSAGE_STATUSES.QUEUED;
      case CALL_STATUSES.RINGING:
      case CALL_STATUSES.IN_PROGRESS:
        return MESSAGE_STATUSES.SENT;
      case CALL_STATUSES.COMPLETED:
        return MESSAGE_STATUSES.DELIVERED;
      case CALL_STATUSES.BUSY:
      case CALL_STATUSES.NO_ANSWER:
      case CALL_STATUSES.CANCELED:
      case CALL_STATUSES.FAILED:
        return MESSAGE_STATUSES.FAILED;
      default:
        return MESSAGE_STATUSES.QUEUED;
    }
  }

  /**
   * Escape XML special characters to prevent injection.
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Extract a safe, non-leaking error message from a Twilio error.
   * NEVER exposes internal paths, stack traces, or raw provider messages.
   */
  private extractSafeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const twilioError = error as { code?: number; status?: number };
      if (typeof twilioError.code === 'number') {
        return `Voice call failed (provider error code: ${twilioError.code})`;
      }
    }
    return 'Voice call failed due to a provider error';
  }
}
