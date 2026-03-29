/**
 * @ordr/notifications — Universal Notification Engine
 * Multi-channel notification delivery: email, SMS, push, Telegram,
 * WhatsApp, Slack, Teams, Signal, Discord, and generic webhooks.
 */
export type {
  NotificationChannel,
  NotificationPriority,
  DeliveryStatus,
  ChannelDestination,
  PushSubscriptionData,
  NotificationTemplate,
  NotificationRequest,
  DeliveryResult,
  DispatchResult,
  NotificationPreference,
  PushVapidConfig,
  TelegramConfig,
  SlackConfig,
  SignalConfig,
  NotificationEngineConfig,
  NotificationProvider,
} from './types.js';

export { NotificationDispatcher } from './dispatch.js';
export { templateEngine, TemplateEngine } from './templates.js';
export { PreferenceManager, InMemoryPreferenceStore } from './preferences.js';
export type { PreferenceStore } from './preferences.js';

// Providers
export { TelegramProvider } from './providers/telegram.js';
export { PushProvider } from './providers/push.js';
export { SlackProvider } from './providers/slack.js';
export { TeamsProvider } from './providers/teams.js';
export { SignalProvider } from './providers/signal.js';
export { DiscordProvider } from './providers/discord.js';
export { WebhookProvider } from './providers/webhook.js';
