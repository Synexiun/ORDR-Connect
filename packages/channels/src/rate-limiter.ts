/**
 * Channel-specific rate limiting — per-recipient sliding window
 *
 * COMPLIANCE: Rate limiting is required by SOC2 (availability protection)
 * and prevents abuse of messaging channels. Per-recipient limits prevent
 * harassment and protect deliverability reputation.
 *
 * MVP: In-memory sliding window. Production will use Redis with sorted sets.
 *
 * Default limits:
 *   SMS:      1 message per phone number per 60 seconds
 *   Email:    3 messages per email per 3600 seconds (1 hour)
 *   Voice:    1 call per phone per 300 seconds (5 minutes)
 *   WhatsApp: 1 message per number per 60 seconds
 */

import type { Channel, RateLimitConfig } from './types.js';

// ─── Default Limits ──────────────────────────────────────────────

export const DEFAULT_RATE_LIMITS: Readonly<Record<Channel, RateLimitConfig>> = {
  sms: { maxMessages: 1, windowMs: 60_000 },
  email: { maxMessages: 3, windowMs: 3_600_000 },
  voice: { maxMessages: 1, windowMs: 300_000 },
  whatsapp: { maxMessages: 1, windowMs: 60_000 },
} as const;

// ─── Channel Rate Limiter ────────────────────────────────────────

export class ChannelRateLimiter {
  /**
   * In-memory storage: Map<compositeKey, timestamp[]>
   * Key format: `${channel}:${recipient}`
   *
   * NOTE: This is MVP-grade. Production deployment MUST use Redis
   * with sorted sets for distributed rate limiting across instances.
   */
  private readonly store: Map<string, number[]>;
  private readonly limits: Readonly<Record<Channel, RateLimitConfig>>;

  constructor(customLimits?: Partial<Readonly<Record<Channel, RateLimitConfig>>>) {
    this.store = new Map();
    this.limits = {
      ...DEFAULT_RATE_LIMITS,
      ...customLimits,
    };
  }

  /**
   * Check if a message to the given recipient on the given channel
   * is within rate limits. Returns true if the message can be sent.
   *
   * This method is idempotent — calling it does NOT consume a slot.
   * Use `record()` to actually register a sent message.
   */
  checkLimit(channel: Channel, recipient: string): boolean {
    const config = this.limits[channel];
    if (!config) {
      return false;
    }

    const key = this.buildKey(channel, recipient);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const timestamps = this.store.get(key);
    if (!timestamps) {
      return true;
    }

    // Count only timestamps within the sliding window
    const recentCount = timestamps.filter((ts) => ts > windowStart).length;
    return recentCount < config.maxMessages;
  }

  /**
   * Record a sent message for rate limiting purposes.
   * Call this AFTER successfully sending a message.
   *
   * Returns true if recorded successfully, false if over limit.
   */
  record(channel: Channel, recipient: string): boolean {
    if (!this.checkLimit(channel, recipient)) {
      return false;
    }

    const key = this.buildKey(channel, recipient);
    const now = Date.now();

    const existing = this.store.get(key);
    if (existing) {
      existing.push(now);
      // Prune old entries to prevent memory leak
      this.pruneEntries(key, channel);
    } else {
      this.store.set(key, [now]);
    }

    return true;
  }

  /**
   * Get the number of messages sent within the current window.
   */
  getCurrentCount(channel: Channel, recipient: string): number {
    const config = this.limits[channel];
    if (!config) {
      return 0;
    }

    const key = this.buildKey(channel, recipient);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const timestamps = this.store.get(key);
    if (!timestamps) {
      return 0;
    }

    return timestamps.filter((ts) => ts > windowStart).length;
  }

  /**
   * Get the time in milliseconds until the next message can be sent.
   * Returns 0 if a message can be sent now.
   */
  getTimeUntilNextSlot(channel: Channel, recipient: string): number {
    if (this.checkLimit(channel, recipient)) {
      return 0;
    }

    const config = this.limits[channel];
    if (!config) {
      return Infinity;
    }

    const key = this.buildKey(channel, recipient);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const timestamps = this.store.get(key);
    if (!timestamps) {
      return 0;
    }

    // Find the oldest timestamp in the window — that's when the first slot opens
    const inWindow = timestamps
      .filter((ts) => ts > windowStart)
      .sort((a, b) => a - b);

    if (inWindow.length < config.maxMessages) {
      return 0;
    }

    const oldest = inWindow[0];
    if (oldest === undefined) {
      return 0;
    }

    return oldest + config.windowMs - now;
  }

  /**
   * Reset rate limit state for a specific recipient.
   * Used in testing and when consent is revoked (no more messages).
   */
  reset(channel: Channel, recipient: string): void {
    const key = this.buildKey(channel, recipient);
    this.store.delete(key);
  }

  /**
   * Reset all rate limit state. USE WITH CAUTION.
   */
  resetAll(): void {
    this.store.clear();
  }

  /**
   * Get the configured rate limit for a channel.
   */
  getConfig(channel: Channel): RateLimitConfig {
    return this.limits[channel];
  }

  // ─── Private ─────────────────────────────────────────────────

  private buildKey(channel: Channel, recipient: string): string {
    return `${channel}:${recipient}`;
  }

  /**
   * Remove timestamps outside the window to prevent unbounded memory growth.
   */
  private pruneEntries(key: string, channel: Channel): void {
    const config = this.limits[channel];
    if (!config) {
      return;
    }

    const timestamps = this.store.get(key);
    if (!timestamps) {
      return;
    }

    const now = Date.now();
    const windowStart = now - config.windowMs;
    const pruned = timestamps.filter((ts) => ts > windowStart);

    if (pruned.length === 0) {
      this.store.delete(key);
    } else {
      this.store.set(key, pruned);
    }
  }
}
