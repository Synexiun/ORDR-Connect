/**
 * Web Push Notification Provider
 * Implements RFC 8030 Web Push Protocol with VAPID authentication (RFC 8292).
 *
 * Supports: Chrome, Firefox, Edge, Safari 16+
 * Requires: Service Worker registration on the client
 *
 * SOC2 CC6.6 — Notifications delivered securely over TLS.
 * HIPAA §164.312(e)(1) — Encrypted transmission for PHI-adjacent alerts.
 */
import type {
  NotificationProvider,
  ChannelDestination,
  DeliveryResult,
  NotificationPriority,
  PushVapidConfig,
} from '../types.js';
import webPush from 'web-push';

export class PushProvider implements NotificationProvider {
  readonly channel = 'push' as const;
  private configured = false;

  constructor(vapid?: PushVapidConfig) {
    if (vapid !== undefined) {
      webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      this.configured = true;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async send(
    body: string,
    subject: string | undefined,
    dest: ChannelDestination,
    priority: NotificationPriority,
  ): Promise<DeliveryResult> {
    const sentAt = new Date();
    if (!this.configured) {
      return {
        channel: 'push',
        status: 'failed',
        errorCode: 'NOT_CONFIGURED',
        errorMessage: 'VAPID keys not configured',
        sentAt,
      };
    }
    if (dest.pushSubscription === undefined) {
      return {
        channel: 'push',
        status: 'failed',
        errorCode: 'NO_DESTINATION',
        errorMessage: 'pushSubscription required',
        sentAt,
      };
    }
    const payload = JSON.stringify({
      title: subject ?? 'ORDR-Connect',
      body,
      badge: '/icons/badge-72x72.png',
      icon: '/icons/icon-192x192.png',
      urgency: priority === 'critical' ? 'high' : priority === 'high' ? 'normal' : 'low',
      timestamp: Date.now(),
    });
    try {
      const result = await webPush.sendNotification(dest.pushSubscription, payload, {
        urgency: priority === 'critical' || priority === 'high' ? 'high' : 'normal',
        TTL: priority === 'critical' ? 86400 : 3600, // seconds
      });
      const headers = result.headers as Record<string, string | string[] | undefined>;
      const locationHeader = headers['location'];
      const msgId: string | undefined = Array.isArray(locationHeader)
        ? locationHeader[0]
        : locationHeader;
      return {
        channel: 'push',
        status: 'sent',
        sentAt,
        ...(msgId !== undefined ? { messageId: msgId } : {}),
      };
    } catch (err: unknown) {
      const webPushErr = err as { statusCode?: number; body?: string };
      if (webPushErr.statusCode === 410 || webPushErr.statusCode === 404) {
        // Subscription expired
        return {
          channel: 'push',
          status: 'bounced',
          errorCode: String(webPushErr.statusCode),
          errorMessage: 'Subscription expired',
          sentAt,
        };
      }
      return {
        channel: 'push',
        status: 'failed',
        errorCode: String(webPushErr.statusCode ?? 'UNKNOWN'),
        errorMessage: webPushErr.body?.slice(0, 200) ?? 'Push delivery failed',
        sentAt,
      };
    }
  }
}
