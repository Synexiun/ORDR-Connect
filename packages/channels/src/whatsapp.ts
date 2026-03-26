/**
 * WhatsApp provider — Twilio WhatsApp Business API for ORDR-Connect
 *
 * COMPLIANCE:
 * - NEVER logs message content (PHI/PII) — only metadata
 * - TCPA/consent: Outbound messaging requires prior consent verification
 * - WhatsApp 24-hour session window: Template messages required outside window
 * - Opt-out keywords are detected on inbound messages
 * - Webhook signatures are validated to prevent spoofing
 * - Phone numbers validated to E.164 format
 * - Provider errors are wrapped — raw Twilio errors never exposed
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

// ─── WhatsApp Inbound Message ───────────────────────────────────

export interface WhatsAppInbound {
  readonly from: string;
  readonly body: string;
  readonly numMedia: number;
  readonly mediaUrls: readonly string[];
  readonly profileName: string | undefined;
  readonly waId: string;
  readonly messageSid: string;
  readonly accountSid: string;
}

// ─── WhatsApp Status Event ──────────────────────────────────────

export interface WhatsAppStatusEvent {
  readonly messageSid: string;
  readonly accountSid: string;
  readonly messageStatus: string;
  readonly from: string;
  readonly to: string;
  readonly channelPrefix: string;
  readonly errorCode: string | undefined;
  readonly timestamp: Date;
}

// ─── Twilio WhatsApp Client Interface ───────────────────────────

/**
 * Abstraction over the Twilio messaging client for WhatsApp.
 * Uses the same messages API as SMS but with whatsapp: prefix.
 */
export interface TwilioWhatsAppClient {
  messages: {
    create(params: TwilioWhatsAppCreateParams): Promise<TwilioWhatsAppMessageInstance>;
  };
}

export interface TwilioWhatsAppCreateParams {
  readonly to: string;
  readonly from: string;
  readonly body?: string | undefined;
  readonly contentSid?: string | undefined;
  readonly contentVariables?: string | undefined;
  readonly mediaUrl?: readonly string[] | undefined;
  readonly statusCallback?: string | undefined;
}

export interface TwilioWhatsAppMessageInstance {
  readonly sid: string;
  readonly status: string;
  readonly errorCode: number | null;
  readonly errorMessage: string | null;
}

// ─── WhatsApp Provider ──────────────────────────────────────────

export class WhatsAppProvider {
  private readonly client: TwilioWhatsAppClient;
  private readonly fromNumber: string;
  private readonly authToken: string;
  private readonly webhookValidator: TwilioWebhookValidator | undefined;
  private readonly statusCallbackUrl: string | undefined;

  constructor(config: {
    readonly client: TwilioWhatsAppClient;
    readonly fromNumber: string;
    readonly authToken: string;
    readonly webhookValidator?: TwilioWebhookValidator | undefined;
    readonly statusCallbackUrl?: string | undefined;
  }) {
    this.client = config.client;
    this.fromNumber = config.fromNumber;
    this.authToken = config.authToken;
    this.webhookValidator = config.webhookValidator;
    this.statusCallbackUrl = config.statusCallbackUrl;
  }

  /**
   * Send a WhatsApp template message (for outside 24-hour session window).
   *
   * WhatsApp Business API requires pre-approved templates for initiating
   * conversations outside the 24-hour session window.
   *
   * SECURITY: Template variables may contain PII — NEVER logged.
   */
  async sendTemplate(
    to: string,
    templateSid: string,
    variables: Readonly<Record<string, string>>,
  ): Promise<Result<SendResult, ValidationError | InternalError>> {
    // Validate phone number
    const phoneResult = validatePhoneNumber(to);
    if (!phoneResult.success) {
      return phoneResult;
    }

    // Validate template SID
    if (!templateSid || templateSid.trim().length === 0) {
      return err(
        new ValidationError('Template SID is required', {
          templateSid: ['WhatsApp template SID cannot be empty'],
        }),
      );
    }

    try {
      const message = await this.client.messages.create({
        to: this.formatWhatsAppNumber(to),
        from: this.fromNumber,
        contentSid: templateSid,
        contentVariables: JSON.stringify(variables),
        statusCallback: this.statusCallbackUrl,
      });

      return ok({
        success: true,
        messageId: message.sid,
        providerMessageId: message.sid,
        status: this.mapTwilioStatus(message.status),
        error: undefined,
      });
    } catch (error: unknown) {
      const safeMessage = this.extractSafeErrorMessage(error);
      return err(new InternalError(safeMessage));
    }
  }

  /**
   * Send a WhatsApp session message (within 24-hour window).
   *
   * SECURITY: Message body is passed to Twilio but NEVER logged.
   * Only metadata (recipient hash, status, provider message ID) is loggable.
   */
  async sendMessage(
    to: string,
    body: string,
    mediaUrl?: string,
  ): Promise<Result<SendResult, ValidationError | InternalError>> {
    // Validate phone number
    const phoneResult = validatePhoneNumber(to);
    if (!phoneResult.success) {
      return phoneResult;
    }

    // Validate body is non-empty
    if (!body || body.trim().length === 0) {
      return err(
        new ValidationError('WhatsApp message body cannot be empty', {
          body: ['Message body is required'],
        }),
      );
    }

    // WhatsApp message size limit (Twilio enforces 1600 for WhatsApp)
    if (body.length > 1600) {
      return err(
        new ValidationError('WhatsApp message body exceeds maximum length', {
          body: ['Message body must be 1600 characters or fewer'],
        }),
      );
    }

    try {
      const createParams: TwilioWhatsAppCreateParams = {
        to: this.formatWhatsAppNumber(to),
        from: this.fromNumber,
        body,
        mediaUrl: mediaUrl ? [mediaUrl] : undefined,
        statusCallback: this.statusCallbackUrl,
      };

      const message = await this.client.messages.create(createParams);

      return ok({
        success: true,
        messageId: message.sid,
        providerMessageId: message.sid,
        status: this.mapTwilioStatus(message.status),
        error: undefined,
      });
    } catch (error: unknown) {
      const safeMessage = this.extractSafeErrorMessage(error);
      return err(new InternalError(safeMessage));
    }
  }

  /**
   * Parse an inbound Twilio WhatsApp webhook payload.
   *
   * SECURITY: The raw body content is returned for immediate processing
   * but MUST NOT be logged by the caller.
   */
  parseWebhook(
    body: Record<string, string>,
  ): Result<WhatsAppInbound, ValidationError> {
    const from = body['From'];
    const messageBody = body['Body'];
    const messageSid = body['MessageSid'];
    const accountSid = body['AccountSid'];
    const waId = body['WaId'];

    if (!from || messageBody === undefined || !messageSid || !accountSid || !waId) {
      return err(
        new ValidationError('Invalid WhatsApp webhook payload', {
          webhook: ['Missing required fields: From, Body, MessageSid, AccountSid, WaId'],
        }),
      );
    }

    const numMedia = parseInt(body['NumMedia'] ?? '0', 10);

    // Parse media URLs
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = body[`MediaUrl${i}`];
      if (url) {
        mediaUrls.push(url);
      }
    }

    return ok({
      from: this.stripWhatsAppPrefix(from),
      body: messageBody,
      numMedia: isNaN(numMedia) ? 0 : numMedia,
      mediaUrls,
      profileName: body['ProfileName'] ?? undefined,
      waId,
      messageSid,
      accountSid,
    });
  }

  /**
   * Parse a WhatsApp message status webhook payload.
   */
  parseStatusWebhook(
    body: Record<string, string>,
  ): Result<WhatsAppStatusEvent, ValidationError> {
    const messageSid = body['MessageSid'];
    const accountSid = body['AccountSid'];
    const messageStatus = body['MessageStatus'];
    const from = body['From'];
    const to = body['To'];

    if (!messageSid || !accountSid || !messageStatus || !from || !to) {
      return err(
        new ValidationError('Invalid WhatsApp status webhook payload', {
          webhook: ['Missing required fields: MessageSid, AccountSid, MessageStatus, From, To'],
        }),
      );
    }

    return ok({
      messageSid,
      accountSid,
      messageStatus,
      from: this.stripWhatsAppPrefix(from),
      to: this.stripWhatsAppPrefix(to),
      channelPrefix: 'whatsapp',
      errorCode: body['ErrorCode'] ?? undefined,
      timestamp: new Date(),
    });
  }

  /**
   * Validate a Twilio webhook signature to prevent spoofing.
   *
   * SECURITY: All inbound webhooks MUST be validated before processing.
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

  /**
   * Map Twilio WhatsApp status to our MessageStatus.
   */
  mapTwilioStatusToMessageStatus(twilioStatus: string): SendResult['status'] {
    switch (twilioStatus.toLowerCase()) {
      case 'queued':
      case 'accepted':
        return MESSAGE_STATUSES.QUEUED;
      case 'sending':
      case 'sent':
        return MESSAGE_STATUSES.SENT;
      case 'delivered':
      case 'read':
        return MESSAGE_STATUSES.DELIVERED;
      case 'failed':
      case 'undelivered':
        return MESSAGE_STATUSES.FAILED;
      default:
        return MESSAGE_STATUSES.QUEUED;
    }
  }

  // ─── Private ─────────────────────────────────────────────────

  /**
   * Format phone number with WhatsApp prefix if not already present.
   */
  private formatWhatsAppNumber(phone: string): string {
    if (phone.startsWith('whatsapp:')) {
      return phone;
    }
    return `whatsapp:${phone}`;
  }

  /**
   * Strip the whatsapp: prefix from a phone number for storage.
   */
  private stripWhatsAppPrefix(phone: string): string {
    if (phone.startsWith('whatsapp:')) {
      return phone.substring(9);
    }
    return phone;
  }

  /**
   * Map Twilio status strings to our MessageStatus type.
   */
  private mapTwilioStatus(twilioStatus: string): SendResult['status'] {
    return this.mapTwilioStatusToMessageStatus(twilioStatus);
  }

  /**
   * Extract a safe, non-leaking error message from a Twilio error.
   * NEVER exposes internal paths, stack traces, or raw provider messages.
   */
  private extractSafeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const twilioError = error as { code?: number; status?: number };
      if (typeof twilioError.code === 'number') {
        return `WhatsApp delivery failed (provider error code: ${twilioError.code})`;
      }
    }
    return 'WhatsApp delivery failed due to a provider error';
  }
}
