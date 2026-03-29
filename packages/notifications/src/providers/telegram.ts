/**
 * Telegram Notification Provider
 * Uses Telegram Bot API to send messages to users/channels.
 *
 * Setup: Create a bot via @BotFather, get token.
 * User must start a conversation with the bot first to get their chat_id.
 *
 * Rate limits: 30 messages/second, 20 messages/minute to same group.
 * ISO 27001 A.13.2.3 — Electronic messaging security.
 */
import type {
  NotificationProvider,
  ChannelDestination,
  DeliveryResult,
  NotificationPriority,
  TelegramConfig,
} from '../types.js';

export class TelegramProvider implements NotificationProvider {
  readonly channel = 'telegram' as const;
  private readonly config: TelegramConfig | undefined;

  constructor(config?: TelegramConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config !== undefined && this.config.botToken.length > 0;
  }

  async send(
    body: string,
    _subject: string | undefined,
    dest: ChannelDestination,
    _priority: NotificationPriority,
  ): Promise<DeliveryResult> {
    const sentAt = new Date();
    if (!this.isConfigured() || this.config === undefined) {
      return {
        channel: 'telegram',
        status: 'failed',
        errorCode: 'NOT_CONFIGURED',
        errorMessage: 'Telegram bot token not configured',
        sentAt,
      };
    }
    if (dest.telegramChatId === undefined) {
      return {
        channel: 'telegram',
        status: 'failed',
        errorCode: 'NO_DESTINATION',
        errorMessage: 'telegramChatId required',
        sentAt,
      };
    }
    try {
      const apiUrl = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: dest.telegramChatId,
          text: body,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        return {
          channel: 'telegram',
          status: 'failed',
          errorCode: String(res.status),
          errorMessage: errText.slice(0, 200),
          sentAt,
        };
      }
      const json = (await res.json()) as { result?: { message_id?: number } };
      return {
        channel: 'telegram',
        status: 'sent',
        messageId: String(json.result?.message_id ?? ''),
        sentAt,
      };
    } catch (err) {
      return {
        channel: 'telegram',
        status: 'failed',
        errorCode: 'NETWORK_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        sentAt,
      };
    }
  }
}
