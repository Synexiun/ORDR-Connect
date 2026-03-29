/**
 * Notification Dispatch Engine
 *
 * Orchestrates multi-channel notification delivery with:
 * - Channel fallback chains (try email → fallback to SMS)
 * - Deduplication (prevent duplicate sends within a time window)
 * - Priority-based retry logic
 * - Delivery result tracking
 *
 * SOC2 CC7.2 — Monitoring: alert on significant events.
 * ISO 27001 A.16.1.2 — Reporting information security events.
 * HIPAA §164.308(a)(5)(ii)(C) — Log-in monitoring: alert on anomalies.
 */
import { randomUUID } from 'node:crypto';
import type {
  NotificationRequest,
  DispatchResult,
  DeliveryResult,
  NotificationChannel,
  NotificationProvider,
  ChannelDestination,
  NotificationPriority,
} from './types.js';
import { templateEngine } from './templates.js';

export class NotificationDispatcher {
  private readonly providers = new Map<NotificationChannel, NotificationProvider>();
  private readonly dedupeStore = new Map<string, number>(); // key → expiresAt epoch ms

  registerProvider(provider: NotificationProvider): void {
    this.providers.set(provider.channel, provider);
  }

  async dispatch(request: NotificationRequest): Promise<DispatchResult> {
    const notificationId = randomUUID();

    // Deduplication check
    if (request.deduplicationKey !== undefined) {
      const dedupKey = `${request.tenantId}:${request.deduplicationKey}`;
      const existing = this.dedupeStore.get(dedupKey);
      if (existing !== undefined && existing > Date.now()) {
        return {
          notificationId,
          tenantId: request.tenantId,
          results: request.channels.map((channel) => ({
            channel,
            status: 'pending' as const,
            errorCode: 'DEDUPLICATED',
            errorMessage: 'Suppressed by deduplication',
            sentAt: new Date(),
          })),
          overallStatus: 'success',
        };
      }
      const windowMs = (request.deduplicationWindowSeconds ?? 3600) * 1000;
      this.dedupeStore.set(dedupKey, Date.now() + windowMs);
    }

    // Render template
    const rendered = templateEngine.render(request.template, request.data);

    // Dispatch to all requested channels in parallel
    const results: DeliveryResult[] = [];
    const channelPromises = request.channels.map(async (channel) => {
      const result = await this.sendToChannel(
        channel,
        rendered.body,
        rendered.subject,
        request.to,
        request.priority,
      );
      results.push(result);

      // If failed and fallback is configured, try fallback channels
      if (result.status === 'failed' && request.fallback !== undefined) {
        for (const fallbackChannel of request.fallback) {
          if (fallbackChannel === channel) continue;
          const fallbackResult = await this.sendToChannel(
            fallbackChannel,
            rendered.body,
            rendered.subject,
            request.to,
            request.priority,
          );
          results.push(fallbackResult);
          if (fallbackResult.status === 'sent' || fallbackResult.status === 'delivered') break;
        }
      }
    });

    await Promise.allSettled(channelPromises);

    const successCount = results.filter(
      (r) => r.status === 'sent' || r.status === 'delivered',
    ).length;
    const overallStatus =
      successCount === results.length ? 'success' : successCount > 0 ? 'partial' : 'failed';

    return { notificationId, tenantId: request.tenantId, results, overallStatus };
  }

  private async sendToChannel(
    channel: NotificationChannel,
    body: string,
    subject: string | undefined,
    dest: ChannelDestination,
    priority: NotificationPriority,
  ): Promise<DeliveryResult> {
    const provider = this.providers.get(channel);
    if (provider === undefined) {
      return {
        channel,
        status: 'failed',
        errorCode: 'NO_PROVIDER',
        errorMessage: `No provider registered for channel: ${channel}`,
        sentAt: new Date(),
      };
    }
    if (!provider.isConfigured()) {
      return {
        channel,
        status: 'failed',
        errorCode: 'NOT_CONFIGURED',
        errorMessage: `Provider ${channel} is not configured`,
        sentAt: new Date(),
      };
    }
    return provider.send(body, subject, dest, priority);
  }

  /** Purge expired deduplication entries (call periodically). */
  purgeDedupeCache(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.dedupeStore) {
      if (expiresAt <= now) this.dedupeStore.delete(key);
    }
  }
}
