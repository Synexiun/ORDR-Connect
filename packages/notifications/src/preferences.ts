/**
 * Notification Preferences Manager
 * Manages per-user, per-channel, per-event-type notification preferences.
 * Handles quiet hours (do not disturb windows) and opt-outs.
 */
import type { NotificationPreference, NotificationChannel } from './types.js';

export interface PreferenceStore {
  get(userId: string, tenantId: string, eventType: string): Promise<NotificationPreference[]>;
  upsert(pref: NotificationPreference): Promise<void>;
  getAll(userId: string, tenantId: string): Promise<NotificationPreference[]>;
  delete(
    userId: string,
    tenantId: string,
    channel: NotificationChannel,
    eventType: string,
  ): Promise<void>;
}

export class InMemoryPreferenceStore implements PreferenceStore {
  private readonly store = new Map<string, NotificationPreference>();

  private key(
    userId: string,
    tenantId: string,
    channel: NotificationChannel,
    eventType: string,
  ): string {
    return `${tenantId}:${userId}:${channel}:${eventType}`;
  }

  get(userId: string, tenantId: string, eventType: string): Promise<NotificationPreference[]> {
    const results: NotificationPreference[] = [];
    for (const [, pref] of this.store) {
      if (pref.userId === userId && pref.tenantId === tenantId && pref.eventType === eventType) {
        results.push(pref);
      }
    }
    return Promise.resolve(results);
  }

  getAll(userId: string, tenantId: string): Promise<NotificationPreference[]> {
    const results: NotificationPreference[] = [];
    for (const [, pref] of this.store) {
      if (pref.userId === userId && pref.tenantId === tenantId) results.push(pref);
    }
    return Promise.resolve(results);
  }

  upsert(pref: NotificationPreference): Promise<void> {
    this.store.set(this.key(pref.userId, pref.tenantId, pref.channel, pref.eventType), pref);
    return Promise.resolve();
  }

  delete(
    userId: string,
    tenantId: string,
    channel: NotificationChannel,
    eventType: string,
  ): Promise<void> {
    this.store.delete(this.key(userId, tenantId, channel, eventType));
    return Promise.resolve();
  }
}

export class PreferenceManager {
  constructor(private readonly store: PreferenceStore) {}

  async shouldSend(
    userId: string,
    tenantId: string,
    channel: NotificationChannel,
    eventType: string,
  ): Promise<boolean> {
    const prefs = await this.store.get(userId, tenantId, eventType);
    const channelPref = prefs.find((p) => p.channel === channel);
    if (channelPref === undefined) return true; // default: enabled
    if (!channelPref.enabled) return false;
    if (channelPref.quietHours !== undefined) {
      return !this.isQuietHours(channelPref.quietHours);
    }
    return true;
  }

  private isQuietHours(qh: { start: string; end: string; timezone: string }): boolean {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: qh.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    const currentMins = hour * 60 + minute;
    const [startH, startM] = qh.start.split(':').map(Number);
    const [endH, endM] = qh.end.split(':').map(Number);
    const startMins = (startH ?? 0) * 60 + (startM ?? 0);
    const endMins = (endH ?? 0) * 60 + (endM ?? 0);
    if (startMins <= endMins) return currentMins >= startMins && currentMins < endMins;
    return currentMins >= startMins || currentMins < endMins; // spans midnight
  }

  async getAll(userId: string, tenantId: string): Promise<NotificationPreference[]> {
    return this.store.getAll(userId, tenantId);
  }

  async upsert(pref: NotificationPreference): Promise<void> {
    return this.store.upsert(pref);
  }
}
