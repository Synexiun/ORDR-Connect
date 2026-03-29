/**
 * Microsoft Teams Notification Provider
 * Posts Adaptive Cards via Incoming Webhook connector or Power Automate.
 */
import type {
  NotificationProvider,
  ChannelDestination,
  DeliveryResult,
  NotificationPriority,
} from '../types.js';

export class TeamsProvider implements NotificationProvider {
  readonly channel = 'teams' as const;

  isConfigured(): boolean {
    return true;
  } // webhook URL comes per-request

  async send(
    body: string,
    subject: string | undefined,
    dest: ChannelDestination,
    priority: NotificationPriority,
  ): Promise<DeliveryResult> {
    const sentAt = new Date();
    const url = dest.teamsWebhookUrl;
    if (url === undefined || url.length === 0) {
      return {
        channel: 'teams',
        status: 'failed',
        errorCode: 'NO_DESTINATION',
        errorMessage: 'teamsWebhookUrl required',
        sentAt,
      };
    }
    const themeColor =
      priority === 'critical'
        ? 'FF0000'
        : priority === 'high'
          ? 'FF8C00'
          : priority === 'normal'
            ? '0078D4'
            : '28A745';
    const card = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor,
      summary: subject ?? 'ORDR-Connect Notification',
      sections: [
        {
          activityTitle: `**${subject ?? 'ORDR-Connect Notification'}**`,
          activitySubtitle: `Priority: ${priority.toUpperCase()} | ${new Date().toISOString()}`,
          text: body,
          markdown: true,
        },
      ],
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
      });
      if (!res.ok) {
        return { channel: 'teams', status: 'failed', errorCode: String(res.status), sentAt };
      }
      return { channel: 'teams', status: 'sent', sentAt };
    } catch (err) {
      return {
        channel: 'teams',
        status: 'failed',
        errorCode: 'NETWORK_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown',
        sentAt,
      };
    }
  }
}
