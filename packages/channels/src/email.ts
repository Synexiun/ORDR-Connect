/**
 * Email provider — SendGrid integration for ORDR-Connect
 *
 * COMPLIANCE:
 * - NEVER logs email content (PHI/PII) — only metadata
 * - CAN-SPAM: All emails include List-Unsubscribe header
 * - Email addresses validated before send
 * - Provider errors are wrapped — raw SendGrid errors never exposed
 * - Webhook events are parsed and validated
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
  InternalError,
} from '@ordr/core';

import type {
  SendResult,
  EmailOptions,
  EmailEvent,
} from './types.js';
import { MESSAGE_STATUSES } from './types.js';

// ─── Email Validation ────────────────────────────────────────────

/**
 * RFC 5322 simplified email validation.
 * Balances strictness with practical use. Does not allow IP addresses.
 */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validate email address format.
 */
export function validateEmail(email: string): Result<string, ValidationError> {
  if (!email || email.trim().length === 0) {
    return err(
      new ValidationError('Email address is required', {
        email: ['Email address cannot be empty'],
      }),
    );
  }

  if (email.length > 254) {
    return err(
      new ValidationError('Email address too long', {
        email: ['Email address must be 254 characters or fewer'],
      }),
    );
  }

  if (!EMAIL_REGEX.test(email)) {
    return err(
      new ValidationError('Invalid email address format', {
        email: ['Must be a valid email address (e.g., user@example.com)'],
      }),
    );
  }

  return ok(email.toLowerCase());
}

// ─── SendGrid Client Interface ───────────────────────────────────

/**
 * Abstraction over the SendGrid mail client to allow testing
 * without real HTTP calls.
 */
export interface SendGridClient {
  send(msg: SendGridMessage): Promise<SendGridResponse>;
}

export interface SendGridMessage {
  readonly to: string;
  readonly from: { readonly email: string; readonly name: string };
  readonly subject: string;
  readonly text?: string | undefined;
  readonly html?: string | undefined;
  readonly replyTo?: string | undefined;
  readonly cc?: readonly string[] | undefined;
  readonly bcc?: readonly string[] | undefined;
  readonly templateId?: string | undefined;
  readonly dynamicTemplateData?: Readonly<Record<string, unknown>> | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly asm?: { readonly groupId: number } | undefined;
  readonly trackingSettings?: {
    readonly clickTracking?: { readonly enable: boolean } | undefined;
    readonly openTracking?: { readonly enable: boolean } | undefined;
  } | undefined;
}

export interface SendGridResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly messageId?: string | undefined;
}

// ─── Branded Email ──────────────────────────────────────────────

/**
 * Branding options for email templates.
 * SECURITY: No secrets, no PHI — only visual branding fields (Rule 5, Rule 6).
 */
export interface BrandedEmailOptions {
  readonly logoUrl: string | null;
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly bgColor: string;
  readonly textColor: string;
  readonly footerText: string | null;
  readonly fromName: string | null;
  readonly fromAddress: string | null;
}

/**
 * Default branding options matching ORDR-Connect brand.
 */
export const DEFAULT_BRANDED_EMAIL_OPTIONS: BrandedEmailOptions = {
  logoUrl: null,
  primaryColor: '#3b82f6',
  accentColor: '#10b981',
  bgColor: '#0f172a',
  textColor: '#e2e8f0',
  footerText: null,
  fromName: null,
  fromAddress: null,
} as const;

/**
 * Wraps email HTML content in a branded template with logo header,
 * brand colors, footer text, and unsubscribe link.
 *
 * SECURITY:
 * - No secrets injected into template (Rule 5)
 * - No PHI in the branded wrapper (Rule 6)
 * - Colors are validated server-side before storage
 * - Unsubscribe link included for CAN-SPAM compliance
 */
export function injectBranding(html: string, brand: BrandedEmailOptions): string {
  const logoHtml = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="Logo" style="max-height:48px;max-width:200px;margin-bottom:16px;" />`
    : '';

  const footerHtml = brand.footerText
    ? `<p style="margin:0;font-size:12px;color:${escapeHtml(brand.textColor)};">${escapeHtml(brand.footerText)}</p>`
    : '';

  const unsubscribeHtml = '<p style="margin:8px 0 0 0;font-size:11px;"><a href="{{unsubscribe_url}}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a></p>';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:${escapeHtml(brand.bgColor)};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${escapeHtml(brand.bgColor)};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr><td style="padding:24px;text-align:center;border-bottom:2px solid ${escapeHtml(brand.accentColor)};">
          ${logoHtml}
        </td></tr>
        <!-- Content -->
        <tr><td style="padding:32px 24px;color:${escapeHtml(brand.textColor)};background-color:${escapeHtml(brand.bgColor)};">
          ${html}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px;text-align:center;border-top:1px solid ${escapeHtml(brand.primaryColor)}30;">
          ${footerHtml}
          ${unsubscribeHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Minimal HTML escaping for attribute values.
 * Prevents injection in style attributes and src URLs.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ─── Email Provider ──────────────────────────────────────────────

export class EmailProvider {
  private readonly client: SendGridClient;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(config: {
    readonly client: SendGridClient;
    readonly fromEmail: string;
    readonly fromName: string;
  }) {
    this.client = config.client;
    this.fromEmail = config.fromEmail;
    this.fromName = config.fromName;
  }

  /**
   * Send an email via SendGrid.
   *
   * SECURITY: Email content is passed to SendGrid but NEVER logged.
   * Only metadata (recipient hash, status, provider message ID) is loggable.
   *
   * CAN-SPAM: All emails include List-Unsubscribe header.
   */
  async send(
    to: string,
    subject: string,
    body: string,
    opts?: EmailOptions,
    branding?: BrandedEmailOptions,
  ): Promise<Result<SendResult, ValidationError | InternalError>> {
    // Validate email address
    const emailResult = validateEmail(to);
    if (!emailResult.success) {
      return emailResult;
    }

    // Validate subject
    if (!subject || subject.trim().length === 0) {
      return err(
        new ValidationError('Email subject is required', {
          subject: ['Subject line cannot be empty'],
        }),
      );
    }

    // Validate body
    if (!body || body.trim().length === 0) {
      return err(
        new ValidationError('Email body is required', {
          body: ['Email body cannot be empty'],
        }),
      );
    }

    try {
      // Apply branding if provided — wraps content in branded template
      const finalHtml = branding ? injectBranding(body, branding) : body;
      const fromEmail = branding?.fromAddress ?? this.fromEmail;
      const fromName = branding?.fromName ?? this.fromName;

      const message: SendGridMessage = {
        to: emailResult.data,
        from: { email: fromEmail, name: fromName },
        subject,
        html: finalHtml,
        replyTo: opts?.replyTo,
        cc: opts?.cc,
        bcc: opts?.bcc,
        templateId: opts?.templateId,
        dynamicTemplateData: opts?.dynamicTemplateData,
        // CAN-SPAM: Always include List-Unsubscribe header
        headers: {
          'List-Unsubscribe': `<mailto:unsubscribe@${this.extractDomain(this.fromEmail)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        asm: opts?.unsubscribeGroupId !== undefined
          ? { groupId: opts.unsubscribeGroupId }
          : undefined,
        trackingSettings: opts?.trackingEnabled !== undefined
          ? {
              clickTracking: { enable: opts.trackingEnabled },
              openTracking: { enable: opts.trackingEnabled },
            }
          : undefined,
      };

      const response = await this.client.send(message);

      const messageId = response.messageId ?? this.generateMessageId();

      return ok({
        success: true,
        messageId,
        providerMessageId: response.messageId,
        status: this.mapStatusCode(response.statusCode),
        error: undefined,
      });
    } catch (error: unknown) {
      // SECURITY: Never expose raw provider errors
      const safeMessage = this.extractSafeErrorMessage(error);
      return err(new InternalError(safeMessage));
    }
  }

  /**
   * Parse SendGrid event webhook payload.
   *
   * SendGrid sends arrays of event objects. Each event is validated
   * and mapped to our EmailEvent type.
   */
  parseWebhook(
    events: unknown[],
  ): Result<readonly EmailEvent[], ValidationError> {
    if (!Array.isArray(events)) {
      return err(
        new ValidationError('Invalid webhook payload', {
          events: ['Expected an array of events'],
        }),
      );
    }

    const parsed: EmailEvent[] = [];

    for (const raw of events) {
      if (typeof raw !== 'object' || raw === null) {
        continue;
      }

      const event = raw as Record<string, unknown>;

      if (typeof event['email'] !== 'string' || typeof event['event'] !== 'string') {
        continue; // Skip malformed events
      }

      parsed.push({
        email: event['email'] as string,
        event: event['event'] as string,
        timestamp: typeof event['timestamp'] === 'number' ? event['timestamp'] : Date.now() / 1000,
        sgMessageId: typeof event['sg_message_id'] === 'string' ? event['sg_message_id'] : undefined,
        reason: typeof event['reason'] === 'string' ? event['reason'] : undefined,
        bounce_classification: typeof event['bounce_classification'] === 'string'
          ? event['bounce_classification']
          : undefined,
      });
    }

    return ok(parsed);
  }

  /**
   * Map a SendGrid event type string to our MessageStatus.
   */
  mapEventToStatus(eventType: string): SendResult['status'] {
    switch (eventType) {
      case 'delivered':
        return MESSAGE_STATUSES.DELIVERED;
      case 'bounce':
      case 'dropped':
        return MESSAGE_STATUSES.BOUNCED;
      case 'deferred':
        return MESSAGE_STATUSES.RETRYING;
      case 'processed':
        return MESSAGE_STATUSES.QUEUED;
      case 'open':
      case 'click':
        return MESSAGE_STATUSES.DELIVERED;
      case 'spamreport':
      case 'unsubscribe':
        return MESSAGE_STATUSES.OPTED_OUT;
      default:
        return MESSAGE_STATUSES.SENT;
    }
  }

  // ─── Private ─────────────────────────────────────────────────

  /**
   * Extract domain from email address for unsubscribe header.
   */
  private extractDomain(email: string): string {
    const parts = email.split('@');
    return parts[1] ?? 'example.com';
  }

  /**
   * Map HTTP status code to MessageStatus.
   */
  private mapStatusCode(statusCode: number): SendResult['status'] {
    if (statusCode >= 200 && statusCode < 300) {
      return MESSAGE_STATUSES.QUEUED;
    }
    return MESSAGE_STATUSES.FAILED;
  }

  /**
   * Generate a local message ID when provider doesn't return one.
   */
  private generateMessageId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `ordr_email_${timestamp}_${random}`;
  }

  /**
   * Extract a safe, non-leaking error message.
   * NEVER exposes internal paths, stack traces, or raw provider messages.
   */
  private extractSafeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const sgError = error as { code?: number; response?: { body?: unknown } };
      if (typeof sgError.code === 'number') {
        return `Email delivery failed (provider error code: ${sgError.code})`;
      }
    }
    return 'Email delivery failed due to a provider error';
  }
}
