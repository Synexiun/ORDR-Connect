/**
 * Discord Notification Provider
 * Posts messages via Discord webhook URLs (Integrations → Webhooks).
 */
import type {
  NotificationProvider,
  ChannelDestination,
  DeliveryResult,
  NotificationPriority,
} from '../types.js';

export class DiscordProvider implements NotificationProvider {
  readonly channel = 'discord' as const;

  isConfigured(): boolean {
    return true;
  }

  async send(
    body: string,
    subject: string | undefined,
    dest: ChannelDestination,
    priority: NotificationPriority,
  ): Promise<DeliveryResult> {
    const sentAt = new Date();
    const url = dest.discordWebhookUrl;
    if (url === undefined || url.length === 0) {
      return {
        channel: 'discord',
        status: 'failed',
        errorCode: 'NO_DESTINATION',
        errorMessage: 'discordWebhookUrl required',
        sentAt,
      };
    }
    const color =
      priority === 'critical'
        ? 0xff0000
        : priority === 'high'
          ? 0xff8c00
          : priority === 'normal'
            ? 0x0078d4
            : 0x28a745;
    const payload = {
      username: 'ORDR-Connect',
      avatar_url: 'https://ordr.ai/icon-192.png',
      embeds: [
        {
          title: subject ?? 'Notification',
          description: body,
          color,
          timestamp: new Date().toISOString(),
          footer: { text: `Priority: ${priority.toUpperCase()}` },
        },
      ],
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok)
        return { channel: 'discord', status: 'failed', errorCode: String(res.status), sentAt };
      return { channel: 'discord', status: 'sent', sentAt };
    } catch (err) {
      return {
        channel: 'discord',
        status: 'failed',
        errorCode: 'NETWORK_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown',
        sentAt,
      };
    }
  }
}
