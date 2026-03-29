/**
 * @ordr/notifications — Universal Notification Engine Types
 *
 * SOC2 CC7.2 — Monitoring: alert on significant events.
 * ISO 27001 A.16.1.2 — Reporting information security events.
 * HIPAA §164.308(a)(5)(ii)(C) — Log-in monitoring: alert on anomalies.
 */

export type NotificationChannel =
  | 'email'
  | 'sms'
  | 'push'
  | 'in_app'
  | 'telegram'
  | 'whatsapp'
  | 'slack'
  | 'teams'
  | 'signal'
  | 'discord'
  | 'webhook';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'opted_out';

export interface ChannelDestination {
  email?: string;
  phone?: string; // E.164 format
  pushSubscription?: PushSubscriptionData;
  telegramChatId?: string;
  whatsappNumber?: string; // E.164
  slackChannelId?: string;
  slackToken?: string;
  teamsWebhookUrl?: string;
  signalNumber?: string; // E.164, requires Signal CLI
  discordWebhookUrl?: string;
  webhookUrl?: string;
  webhookSecret?: string; // HMAC-SHA256 signing secret
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
}

export interface NotificationTemplate {
  subject?: string; // for email
  body: string; // main body (can be Handlebars template)
  bodyHtml?: string; // HTML version for email
  imageUrl?: string; // for push/rich notifications
  actionUrl?: string; // deep link
  actionLabel?: string;
}

export interface NotificationRequest {
  readonly tenantId: string;
  readonly userId?: string;
  readonly channels: readonly NotificationChannel[];
  readonly priority: NotificationPriority;
  /** Template name from registry or inline template object */
  readonly template: string | NotificationTemplate;
  /** Data interpolated into template via Handlebars */
  readonly data: Record<string, unknown>;
  readonly to: ChannelDestination;
  /** Ordered fallback channels if primary fails */
  readonly fallback?: readonly NotificationChannel[];
  /** Deduplicate within this window (seconds) — e.g. 3600 for 1 hour */
  readonly deduplicationKey?: string;
  readonly deduplicationWindowSeconds?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  readonly channel: NotificationChannel;
  readonly status: DeliveryStatus;
  readonly messageId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly sentAt: Date;
}

export interface DispatchResult {
  readonly notificationId: string;
  readonly tenantId: string;
  readonly results: readonly DeliveryResult[];
  readonly overallStatus: 'success' | 'partial' | 'failed';
}

export interface NotificationPreference {
  readonly userId: string;
  readonly tenantId: string;
  readonly channel: NotificationChannel;
  readonly eventType: string;
  readonly enabled: boolean;
  readonly destination?: ChannelDestination;
  readonly quietHours?: { start: string; end: string; timezone: string };
}

export interface PushVapidConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string; // mailto: or https:
}

export interface TelegramConfig {
  readonly botToken: string;
}

export interface SlackConfig {
  readonly defaultToken?: string;
}

export interface SignalConfig {
  /** URL of Signal CLI REST API instance, e.g. http://signal-api:8080 */
  readonly apiUrl: string;
  /** Sender number in E.164 format */
  readonly senderNumber: string;
}

export interface NotificationEngineConfig {
  readonly vapid?: PushVapidConfig;
  readonly telegram?: TelegramConfig;
  readonly slack?: SlackConfig;
  readonly signal?: SignalConfig;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  isConfigured(): boolean;
  send(
    body: string,
    subject: string | undefined,
    dest: ChannelDestination,
    priority: NotificationPriority,
  ): Promise<DeliveryResult>;
}
