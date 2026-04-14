/**
 * SMS provider — Twilio integration for ORDR-Connect
 *
 * COMPLIANCE:
 * - NEVER logs message content (PHI/PII) — only metadata
 * - All outbound SMS requires TCPA consent verification (external gate)
 * - Opt-out keywords are detected on inbound messages
 * - Webhook signatures are validated to prevent spoofing
 * - Phone numbers validated to E.164 format
 * - Provider errors are wrapped — raw Twilio errors never exposed
 */

import { Twilio } from 'twilio';
import { type Result, ok, err, ValidationError, InternalError } from '@ordr/core';

import type { SendResult, SmsOptions, InboundSmsMessage } from './types.js';
import { MESSAGE_STATUSES } from './types.js';

// ─── E.164 Phone Validation ─────────────────────────────────────

/**
 * Strict E.164 phone number format: + followed by 1-15 digits.
 * No spaces, dashes, or parentheses.
 */
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Validate phone number is in E.164 format.
 */
export function validatePhoneNumber(phone: string): Result<string, ValidationError> {
  if (!E164_REGEX.test(phone)) {
    return err(
      new ValidationError('Invalid phone number format', {
        phone: ['Must be in E.164 format (e.g., +14155551234)'],
      }),
    );
  }
  return ok(phone);
}

// ─── Twilio Client Interface ─────────────────────────────────────

/**
 * Abstraction over the Twilio client to allow testing without
 * real HTTP calls. Production code injects the real Twilio client.
 */
export interface TwilioClient {
  messages: {
    create(params: TwilioCreateParams): Promise<TwilioMessageInstance>;
  };
}

export interface TwilioCreateParams {
  readonly to: string;
  readonly from: string;
  readonly body: string;
  readonly statusCallback?: string | undefined;
  readonly maxPrice?: number | undefined;
  readonly validityPeriod?: number | undefined;
  readonly mediaUrl?: readonly string[] | undefined;
}

export interface TwilioMessageInstance {
  readonly sid: string;
  readonly status: string;
  readonly errorCode: number | null;
  readonly errorMessage: string | null;
}

// ─── Webhook Signature Validation ────────────────────────────────

/**
 * Interface for Twilio webhook signature validation.
 * In production, use twilio.validateRequest from the SDK.
 */
export interface TwilioWebhookValidator {
  validateRequest(
    authToken: string,
    signature: string,
    url: string,
    params: Record<string, string>,
  ): boolean;
}

// ─── SMS Provider ────────────────────────────────────────────────

export class SmsProvider {
  private readonly client: TwilioClient;
  private readonly fromNumber: string;
  private readonly authToken: string;
  private readonly webhookValidator: TwilioWebhookValidator | undefined;

  constructor(config: {
    readonly client: TwilioClient;
    readonly fromNumber: string;
    readonly authToken: string;
    readonly webhookValidator?: TwilioWebhookValidator | undefined;
  }) {
    this.client = config.client;
    this.fromNumber = config.fromNumber;
    this.authToken = config.authToken;
    this.webhookValidator = config.webhookValidator;
  }

  /**
   * Send an SMS message via Twilio.
   *
   * SECURITY: Message body is passed to Twilio but NEVER logged.
   * Only metadata (recipient hash, status, provider message ID) is loggable.
   *
   * TCPA: Consent verification is the caller's responsibility — this method
   * handles transport only. The orchestration layer MUST call ConsentManager
   * before invoking send().
   */
  async send(to: string, body: string, opts?: SmsOptions): Promise<Result<SendResult>> {
    // Validate phone number
    const phoneResult = validatePhoneNumber(to);
    if (!phoneResult.success) {
      return phoneResult;
    }

    // Validate body is non-empty
    if (!body || body.trim().length === 0) {
      return err(
        new ValidationError('SMS body cannot be empty', {
          body: ['Message body is required'],
        }),
      );
    }

    // Validate body length (Twilio max is 1600 characters for concatenated SMS)
    if (body.length > 1600) {
      return err(
        new ValidationError('SMS body exceeds maximum length', {
          body: ['Message body must be 1600 characters or fewer'],
        }),
      );
    }

    try {
      const message = await this.client.messages.create({
        to,
        from: this.fromNumber,
        body,
        statusCallback: opts?.statusCallback,
        maxPrice: opts?.maxPrice,
        validityPeriod: opts?.validityPeriod,
        mediaUrl: opts?.mediaUrl,
      });

      return ok({
        success: true,
        messageId: message.sid,
        providerMessageId: message.sid,
        status: this.mapTwilioStatus(message.status),
        error: undefined,
      });
    } catch (error: unknown) {
      // SECURITY: Never expose raw provider errors — wrap with safe message
      const safeMessage = this.extractSafeErrorMessage(error);
      return err(new InternalError(safeMessage));
    }
  }

  /**
   * Parse an inbound Twilio SMS webhook payload.
   *
   * SECURITY: The raw body content is returned for immediate processing
   * but MUST NOT be logged by the caller.
   */
  parseWebhook(body: Record<string, string>): Result<InboundSmsMessage, ValidationError> {
    const from = body['From'];
    const to = body['To'];
    const messageBody = body['Body'];
    const messageSid = body['MessageSid'];
    const accountSid = body['AccountSid'];
    const numMedia = parseInt(body['NumMedia'] ?? '0', 10);

    if (
      typeof from !== 'string' ||
      typeof to !== 'string' ||
      messageBody === undefined ||
      typeof messageSid !== 'string' ||
      typeof accountSid !== 'string'
    ) {
      return err(
        new ValidationError('Invalid Twilio webhook payload', {
          webhook: ['Missing required fields: From, To, Body, MessageSid, AccountSid'],
        }),
      );
    }

    // Parse media URLs
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = body[`MediaUrl${i}`];
      if (url !== undefined) {
        mediaUrls.push(url);
      }
    }

    return ok({
      from,
      to,
      body: messageBody,
      messageSid,
      accountSid,
      numMedia,
      mediaUrls,
    });
  }

  /**
   * Validate a Twilio webhook signature to prevent spoofing.
   *
   * SECURITY: All inbound webhooks MUST be validated before processing.
   * An invalid signature means the request may not be from Twilio.
   */
  validateWebhookSignature(signature: string, url: string, body: Record<string, string>): boolean {
    if (!this.webhookValidator) {
      // If no validator is configured, reject all requests (fail closed)
      return false;
    }

    return this.webhookValidator.validateRequest(this.authToken, signature, url, body);
  }

  // ─── Private ─────────────────────────────────────────────────

  /**
   * Map Twilio status strings to our MessageStatus type.
   */
  private mapTwilioStatus(twilioStatus: string): SendResult['status'] {
    switch (twilioStatus) {
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
        return MESSAGE_STATUSES.QUEUED;
    }
  }

  /**
   * Extract a safe, non-leaking error message from a Twilio error.
   * NEVER exposes internal paths, stack traces, or raw provider messages.
   */
  private extractSafeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      // Check for known Twilio error codes
      const twilioError = error as { code?: number; status?: number };
      if (typeof twilioError.code === 'number') {
        return `SMS delivery failed (provider error code: ${twilioError.code})`;
      }
    }
    return 'SMS delivery failed due to a provider error';
  }
}

// ─── Real Client Factory ─────────────────────────────────────────

/**
 * Create a real Twilio SDK client that satisfies TwilioClient.
 *
 * Wraps the SDK in a thin adapter that matches our interface exactly,
 * including the readonly→mutable conversion required for mediaUrl.
 *
 * SECURITY:
 * - Credentials sourced from environment only — never from client input (Rule 5)
 * - accountSid/authToken consumed at factory time — not stored on the returned object
 */
export function createRealTwilioClient(accountSid: string, authToken: string): TwilioClient {
  const sdk = new Twilio(accountSid, authToken);
  return {
    messages: {
      create: async (params: TwilioCreateParams): Promise<TwilioMessageInstance> => {
        // Conditionally spread optional params — exactOptionalPropertyTypes requires
        // absent properties, not properties explicitly set to undefined.
        const sdkParams: Parameters<typeof sdk.messages.create>[0] = {
          to: params.to,
          from: params.from,
          body: params.body,
          ...(params.statusCallback !== undefined && { statusCallback: params.statusCallback }),
          ...(params.maxPrice !== undefined && { maxPrice: params.maxPrice }),
          ...(params.validityPeriod !== undefined && { validityPeriod: params.validityPeriod }),
          // readonly string[] → string[] for Twilio SDK compatibility
          ...(params.mediaUrl !== undefined && { mediaUrl: [...params.mediaUrl] }),
        };
        return sdk.messages.create(sdkParams);
      },
    },
  };
}
