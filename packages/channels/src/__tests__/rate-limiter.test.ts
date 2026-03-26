import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ChannelRateLimiter, DEFAULT_RATE_LIMITS } from '../rate-limiter.js';

// ─── Setup ───────────────────────────────────────────────────────

let limiter: ChannelRateLimiter;

beforeEach(() => {
  limiter = new ChannelRateLimiter();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── checkLimit ──────────────────────────────────────────────────

describe('ChannelRateLimiter — checkLimit', () => {
  it('allows first message on a fresh limiter', () => {
    expect(limiter.checkLimit('sms', '+14155551234')).toBe(true);
  });

  it('allows message when no prior messages for this recipient', () => {
    limiter.record('sms', '+14155559999');
    expect(limiter.checkLimit('sms', '+14155551234')).toBe(true);
  });

  it('blocks SMS when rate limit is exceeded (1 per 60s)', () => {
    limiter.record('sms', '+14155551234');
    expect(limiter.checkLimit('sms', '+14155551234')).toBe(false);
  });

  it('allows SMS after window expires', () => {
    limiter.record('sms', '+14155551234');
    expect(limiter.checkLimit('sms', '+14155551234')).toBe(false);

    // Advance past the 60-second SMS window
    vi.advanceTimersByTime(60_001);
    expect(limiter.checkLimit('sms', '+14155551234')).toBe(true);
  });

  it('allows multiple emails within limit (3 per hour)', () => {
    limiter.record('email', 'user@example.com');
    expect(limiter.checkLimit('email', 'user@example.com')).toBe(true);

    limiter.record('email', 'user@example.com');
    expect(limiter.checkLimit('email', 'user@example.com')).toBe(true);

    limiter.record('email', 'user@example.com');
    expect(limiter.checkLimit('email', 'user@example.com')).toBe(false);
  });

  it('isolates rate limits per recipient', () => {
    limiter.record('sms', '+14155551111');
    expect(limiter.checkLimit('sms', '+14155551111')).toBe(false);
    expect(limiter.checkLimit('sms', '+14155552222')).toBe(true);
  });

  it('isolates rate limits per channel', () => {
    limiter.record('sms', '+14155551234');
    expect(limiter.checkLimit('sms', '+14155551234')).toBe(false);
    expect(limiter.checkLimit('email', '+14155551234')).toBe(true);
  });
});

// ─── record ──────────────────────────────────────────────────────

describe('ChannelRateLimiter — record', () => {
  it('records a message and returns true when within limit', () => {
    expect(limiter.record('sms', '+14155551234')).toBe(true);
  });

  it('returns false when recording would exceed limit', () => {
    limiter.record('sms', '+14155551234');
    expect(limiter.record('sms', '+14155551234')).toBe(false);
  });

  it('records multiple emails up to the limit', () => {
    expect(limiter.record('email', 'user@example.com')).toBe(true);
    expect(limiter.record('email', 'user@example.com')).toBe(true);
    expect(limiter.record('email', 'user@example.com')).toBe(true);
    expect(limiter.record('email', 'user@example.com')).toBe(false);
  });
});

// ─── Sliding Window ──────────────────────────────────────────────

describe('ChannelRateLimiter — sliding window behavior', () => {
  it('slides the window correctly for email (3 per hour)', () => {
    // Send 3 emails at t=0
    limiter.record('email', 'user@example.com');
    limiter.record('email', 'user@example.com');
    limiter.record('email', 'user@example.com');
    expect(limiter.checkLimit('email', 'user@example.com')).toBe(false);

    // Advance 1 hour + 1ms — all 3 should slide out
    vi.advanceTimersByTime(3_600_001);
    expect(limiter.checkLimit('email', 'user@example.com')).toBe(true);
  });

  it('partially slides the window (staggered sends)', () => {
    // Send email at t=0
    limiter.record('email', 'user@example.com');

    // Advance 30 minutes, send another
    vi.advanceTimersByTime(1_800_000);
    limiter.record('email', 'user@example.com');

    // Advance 15 minutes, send another
    vi.advanceTimersByTime(900_000);
    limiter.record('email', 'user@example.com');

    // At t=45min, all 3 are within the hour window
    expect(limiter.checkLimit('email', 'user@example.com')).toBe(false);

    // Advance 16 minutes (total t=61min) — first email slides out
    vi.advanceTimersByTime(960_001);
    expect(limiter.checkLimit('email', 'user@example.com')).toBe(true);
  });
});

// ─── getCurrentCount ─────────────────────────────────────────────

describe('ChannelRateLimiter — getCurrentCount', () => {
  it('returns 0 for no messages', () => {
    expect(limiter.getCurrentCount('sms', '+14155551234')).toBe(0);
  });

  it('returns correct count within window', () => {
    limiter.record('email', 'user@example.com');
    limiter.record('email', 'user@example.com');
    expect(limiter.getCurrentCount('email', 'user@example.com')).toBe(2);
  });

  it('excludes expired entries from count', () => {
    limiter.record('sms', '+14155551234');
    expect(limiter.getCurrentCount('sms', '+14155551234')).toBe(1);

    vi.advanceTimersByTime(60_001);
    expect(limiter.getCurrentCount('sms', '+14155551234')).toBe(0);
  });
});

// ─── getTimeUntilNextSlot ────────────────────────────────────────

describe('ChannelRateLimiter — getTimeUntilNextSlot', () => {
  it('returns 0 when no messages have been sent', () => {
    expect(limiter.getTimeUntilNextSlot('sms', '+14155551234')).toBe(0);
  });

  it('returns remaining time when rate limited', () => {
    vi.setSystemTime(new Date(1000000));
    limiter.record('sms', '+14155551234');

    vi.advanceTimersByTime(30_000); // 30 seconds later
    const remaining = limiter.getTimeUntilNextSlot('sms', '+14155551234');
    // Should be ~30 seconds remaining (60s window - 30s elapsed)
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30_001);
  });

  it('returns 0 after window expires', () => {
    limiter.record('sms', '+14155551234');
    vi.advanceTimersByTime(60_001);
    expect(limiter.getTimeUntilNextSlot('sms', '+14155551234')).toBe(0);
  });
});

// ─── Reset ───────────────────────────────────────────────────────

describe('ChannelRateLimiter — reset', () => {
  it('resets rate limit for a specific recipient', () => {
    limiter.record('sms', '+14155551234');
    expect(limiter.checkLimit('sms', '+14155551234')).toBe(false);

    limiter.reset('sms', '+14155551234');
    expect(limiter.checkLimit('sms', '+14155551234')).toBe(true);
  });

  it('resetAll clears all entries', () => {
    limiter.record('sms', '+14155551234');
    limiter.record('email', 'user@example.com');

    limiter.resetAll();

    expect(limiter.checkLimit('sms', '+14155551234')).toBe(true);
    expect(limiter.checkLimit('email', 'user@example.com')).toBe(true);
  });
});

// ─── Custom Limits ───────────────────────────────────────────────

describe('ChannelRateLimiter — custom limits', () => {
  it('accepts custom rate limit configuration', () => {
    const custom = new ChannelRateLimiter({
      sms: { maxMessages: 5, windowMs: 10_000 },
    });

    for (let i = 0; i < 5; i++) {
      expect(custom.record('sms', '+14155551234')).toBe(true);
    }
    expect(custom.record('sms', '+14155551234')).toBe(false);
  });

  it('preserves default limits for non-customized channels', () => {
    const custom = new ChannelRateLimiter({
      sms: { maxMessages: 10, windowMs: 1_000 },
    });

    // Email should still use default (3 per hour)
    expect(custom.getConfig('email')).toEqual(DEFAULT_RATE_LIMITS.email);
  });
});

// ─── Default Config ──────────────────────────────────────────────

describe('DEFAULT_RATE_LIMITS', () => {
  it('has SMS at 1 per 60 seconds', () => {
    expect(DEFAULT_RATE_LIMITS.sms).toEqual({ maxMessages: 1, windowMs: 60_000 });
  });

  it('has email at 3 per hour', () => {
    expect(DEFAULT_RATE_LIMITS.email).toEqual({ maxMessages: 3, windowMs: 3_600_000 });
  });

  it('has voice at 1 per 5 minutes', () => {
    expect(DEFAULT_RATE_LIMITS.voice).toEqual({ maxMessages: 1, windowMs: 300_000 });
  });

  it('has whatsapp at 1 per 60 seconds', () => {
    expect(DEFAULT_RATE_LIMITS.whatsapp).toEqual({ maxMessages: 1, windowMs: 60_000 });
  });
});
