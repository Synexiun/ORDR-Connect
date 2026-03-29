/**
 * Generic Webhook Notification Provider
 * Posts JSON payloads to any HTTP endpoint with HMAC-SHA256 signature.
 * Signature header: X-ORDR-Signature: sha256=<hex>
 */
import { createHmac } from 'node:crypto';
import type {
  NotificationProvider,
  ChannelDestination,
  DeliveryResult,
  NotificationPriority,
} from '../types.js';

export class WebhookProvider implements NotificationProvider {
  readonly channel = 'webhook' as const;

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
    if (dest.webhookUrl === undefined) {
      return {
        channel: 'webhook',
        status: 'failed',
        errorCode: 'NO_DESTINATION',
        errorMessage: 'webhookUrl required',
        sentAt,
      };
    }
    const payload = JSON.stringify({ subject, body, priority, timestamp: sentAt.toISOString() });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'ORDR-Connect/1.0',
    };
    if (dest.webhookSecret !== undefined) {
      const sig = createHmac('sha256', dest.webhookSecret).update(payload).digest('hex');
      headers['X-ORDR-Signature'] = `sha256=${sig}`;
    }
    try {
      const res = await fetch(dest.webhookUrl, { method: 'POST', headers, body: payload });
      if (!res.ok)
        return { channel: 'webhook', status: 'failed', errorCode: String(res.status), sentAt };
      return { channel: 'webhook', status: 'sent', sentAt };
    } catch (err) {
      return {
        channel: 'webhook',
        status: 'failed',
        errorCode: 'NETWORK_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown',
        sentAt,
      };
    }
  }
}
