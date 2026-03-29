/**
 * Slack Notification Provider
 * Posts messages to Slack channels using Incoming Webhooks or Bot tokens.
 *
 * For channel IDs: use the Slack Web API channels.list or copy from URL.
 * ISO 27001 A.13.2.3 — Electronic messaging: secure channel delivery.
 */
import type {
  NotificationProvider,
  ChannelDestination,
  DeliveryResult,
  NotificationPriority,
} from '../types.js';

export class SlackProvider implements NotificationProvider {
  readonly channel = 'slack' as const;
  private readonly defaultToken: string | undefined;

  constructor(defaultToken?: string) {
    this.defaultToken = defaultToken;
  }

  isConfigured(): boolean {
    return this.defaultToken !== undefined && this.defaultToken.length > 0;
  }

  async send(
    body: string,
    subject: string | undefined,
    dest: ChannelDestination,
    priority: NotificationPriority,
  ): Promise<DeliveryResult> {
    const sentAt = new Date();
    const token = dest.slackToken ?? this.defaultToken;
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (token === undefined) {
      return {
        channel: 'slack',
        status: 'failed',
        errorCode: 'NOT_CONFIGURED',
        errorMessage: 'Slack token not configured',
        sentAt,
      };
    }
    // Support webhook URLs as an alternative
    if (dest.webhookUrl !== undefined && dest.webhookUrl.includes('hooks.slack.com')) {
      return this.sendViaWebhook(body, subject, dest.webhookUrl, priority, sentAt);
    }
    if (dest.slackChannelId === undefined) {
      return {
        channel: 'slack',
        status: 'failed',
        errorCode: 'NO_DESTINATION',
        errorMessage: 'slackChannelId required',
        sentAt,
      };
    }
    const emoji =
      priority === 'critical'
        ? ':rotating_light:'
        : priority === 'high'
          ? ':warning:'
          : priority === 'normal'
            ? ':clipboard:'
            : ':information_source:';
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} ${subject ?? 'ORDR-Connect Notification'}`,
          emoji: true,
        },
      },
      { type: 'section', text: { type: 'mrkdwn', text: body } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Priority: *${priority.toUpperCase()}* | ${new Date().toISOString()}`,
          },
        ],
      },
    ];
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channel: dest.slackChannelId, blocks, text: subject ?? body }),
      });
      const json = (await res.json()) as { ok: boolean; ts?: string; error?: string };
      if (!json.ok) {
        return {
          channel: 'slack',
          status: 'failed',
          errorCode: json.error ?? 'API_ERROR',
          sentAt,
          ...(json.error !== undefined ? { errorMessage: json.error } : {}),
        };
      }
      return {
        channel: 'slack',
        status: 'sent',
        sentAt,
        ...(json.ts !== undefined ? { messageId: json.ts } : {}),
      };
    } catch (err) {
      return {
        channel: 'slack',
        status: 'failed',
        errorCode: 'NETWORK_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown',
        sentAt,
      };
    }
  }

  private async sendViaWebhook(
    body: string,
    subject: string | undefined,
    url: string,
    priority: NotificationPriority,
    sentAt: Date,
  ): Promise<DeliveryResult> {
    const tag = priority === 'critical' ? '[CRITICAL]' : priority === 'high' ? '[HIGH]' : '';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${tag} *${subject ?? 'Notification'}*\n${body}` }),
      });
      if (!res.ok)
        return { channel: 'slack', status: 'failed', errorCode: String(res.status), sentAt };
      return { channel: 'slack', status: 'sent', sentAt };
    } catch (err) {
      return {
        channel: 'slack',
        status: 'failed',
        errorCode: 'NETWORK_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown',
        sentAt,
      };
    }
  }
}
