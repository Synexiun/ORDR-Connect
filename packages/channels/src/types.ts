/**
 * Channel types — multi-channel messaging for ORDR-Connect
 *
 * COMPLIANCE: All types enforce readonly properties. Message content is
 * referenced by encrypted storage ID — NEVER stored in-memory as plaintext
 * beyond the immediate send operation. PHI/PII must never be logged.
 */

// ─── Channel ─────────────────────────────────────────────────────

export const CHANNELS = {
  SMS: 'sms',
  EMAIL: 'email',
  VOICE: 'voice',
  WHATSAPP: 'whatsapp',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

// ─── Direction ───────────────────────────────────────────────────

export const MESSAGE_DIRECTIONS = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
} as const;

export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[keyof typeof MESSAGE_DIRECTIONS];

// ─── Status ──────────────────────────────────────────────────────

export const MESSAGE_STATUSES = {
  PENDING: 'pending',
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  BOUNCED: 'bounced',
  OPTED_OUT: 'opted_out',
  RETRYING: 'retrying',
  DLQ: 'dlq',
} as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[keyof typeof MESSAGE_STATUSES];

// ─── Message Events ──────────────────────────────────────────────

export const MESSAGE_EVENTS = {
  ENQUEUE: 'enqueue',
  SEND: 'send',
  DELIVER: 'deliver',
  FAIL: 'fail',
  RETRY: 'retry',
  OPT_OUT: 'opt_out',
  BOUNCE: 'bounce',
  DLQ: 'dlq',
} as const;

export type MessageEvent = (typeof MESSAGE_EVENTS)[keyof typeof MESSAGE_EVENTS];

// ─── Delivery Attempt ────────────────────────────────────────────

export interface DeliveryAttempt {
  readonly attemptNumber: number;
  readonly status: MessageStatus;
  readonly timestamp: Date;
  readonly providerResponse: string | undefined;
  readonly errorCode: string | undefined;
}

// ─── Message ─────────────────────────────────────────────────────

export interface Message {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly channel: Channel;
  readonly direction: MessageDirection;
  readonly status: MessageStatus;
  /** Encrypted storage reference — NEVER raw content */
  readonly contentRef: string;
  /** SHA-256 hash of original content for integrity verification */
  readonly contentHash: string;
  readonly attempts: readonly DeliveryAttempt[];
  readonly maxRetries: number;
  readonly scheduledAt: Date | undefined;
  readonly sentAt: Date | undefined;
  readonly deliveredAt: Date | undefined;
  readonly metadata: Readonly<Record<string, string>>;
}

// ─── Consent ─────────────────────────────────────────────────────

export const CONSENT_STATUSES = {
  OPTED_IN: 'opted_in',
  OPTED_OUT: 'opted_out',
  UNKNOWN: 'unknown',
  REVOKED: 'revoked',
} as const;

export type ConsentStatus = (typeof CONSENT_STATUSES)[keyof typeof CONSENT_STATUSES];

export const CONSENT_METHODS = {
  SMS_KEYWORD: 'sms_keyword',
  WEB_FORM: 'web_form',
  VERBAL: 'verbal',
  WRITTEN: 'written',
} as const;

export type ConsentMethod = (typeof CONSENT_METHODS)[keyof typeof CONSENT_METHODS];

export interface ConsentRecord {
  readonly customerId: string;
  readonly tenantId: string;
  readonly channel: Channel;
  readonly status: ConsentStatus;
  readonly consentedAt: Date;
  readonly method: ConsentMethod;
  readonly evidenceRef: string;
}

// ─── Channel Config ──────────────────────────────────────────────

export interface SmsChannelConfig {
  readonly provider: 'twilio';
  readonly accountSid: string;
  readonly authToken: string;
  readonly fromNumber: string;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
}

export interface EmailChannelConfig {
  readonly provider: 'sendgrid';
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly fromName: string;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
}

export interface VoiceChannelConfig {
  readonly provider: 'twilio';
  readonly accountSid: string;
  readonly authToken: string;
  readonly fromNumber: string;
}

export interface WhatsAppChannelConfig {
  readonly provider: 'twilio';
  readonly accountSid: string;
  readonly authToken: string;
  readonly fromNumber: string;
}

export type ChannelConfig =
  | SmsChannelConfig
  | EmailChannelConfig
  | VoiceChannelConfig
  | WhatsAppChannelConfig;

// ─── Send Result ─────────────────────────────────────────────────

export interface SendResult {
  readonly success: boolean;
  readonly messageId: string;
  readonly providerMessageId: string | undefined;
  readonly status: MessageStatus;
  readonly error: string | undefined;
}

// ─── SMS Options ─────────────────────────────────────────────────

export interface SmsOptions {
  readonly statusCallback?: string | undefined;
  readonly maxPrice?: string | undefined;
  readonly validityPeriod?: number | undefined;
  readonly mediaUrl?: readonly string[] | undefined;
}

// ─── Email Options ───────────────────────────────────────────────

export interface EmailOptions {
  readonly replyTo?: string | undefined;
  readonly cc?: readonly string[] | undefined;
  readonly bcc?: readonly string[] | undefined;
  readonly templateId?: string | undefined;
  readonly dynamicTemplateData?: Readonly<Record<string, unknown>> | undefined;
  readonly unsubscribeGroupId?: number | undefined;
  readonly trackingEnabled?: boolean | undefined;
}

// ─── Inbound Message ─────────────────────────────────────────────

export interface InboundSmsMessage {
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly messageSid: string;
  readonly accountSid: string;
  readonly numMedia: number;
  readonly mediaUrls: readonly string[];
}

// ─── Email Event (SendGrid webhook) ──────────────────────────────

export interface EmailEvent {
  readonly email: string;
  readonly event: string;
  readonly timestamp: number;
  readonly sgMessageId: string | undefined;
  readonly reason: string | undefined;
  readonly bounce_classification: string | undefined;
}

// ─── Consent Store (dependency injection) ────────────────────────

export interface ConsentStore {
  getConsent(customerId: string, channel: Channel): Promise<ConsentRecord | undefined>;
  saveConsent(record: ConsentRecord): Promise<void>;
  revokeConsent(customerId: string, channel: Channel, revokedAt: Date): Promise<void>;
}

// ─── Rate Limit Entry ────────────────────────────────────────────

export interface RateLimitEntry {
  readonly timestamps: readonly number[];
}

// ─── Rate Limit Config ───────────────────────────────────────────

export interface RateLimitConfig {
  readonly maxMessages: number;
  readonly windowMs: number;
}
