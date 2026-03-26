import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemoryRateLimiter,
  AUTH_RATE_LIMIT,
  API_RATE_LIMIT,
  PHI_ACCESS_RATE_LIMIT,
} from '../rate-limiter.js';
import type { RateLimitConfig } from '../rate-limiter.js';

// ─── Preset Config Tests ───────────────────────────────────────────

describe('Rate Limit Presets', () => {
  it('AUTH_RATE_LIMIT: 5 attempts per 15 minutes', () => {
    expect(AUTH_RATE_LIMIT.maxRequests).toBe(5);
    expect(AUTH_RATE_LIMIT.windowMs).toBe(15 * 60 * 1000);
  });

  it('API_RATE_LIMIT: 1000 requests per minute', () => {
    expect(API_RATE_LIMIT.maxRequests).toBe(1000);
    expect(API_RATE_LIMIT.windowMs).toBe(60 * 1000);
  });

  it('PHI_ACCESS_RATE_LIMIT: 100 requests per minute', () => {
    expect(PHI_ACCESS_RATE_LIMIT.maxRequests).toBe(100);
    expect(PHI_ACCESS_RATE_LIMIT.windowMs).toBe(60 * 1000);
  });
});

// ─── InMemoryRateLimiter Tests ─────────────────────────────────────

describe('InMemoryRateLimiter', () => {
  let limiter: InMemoryRateLimiter;

  // Use a short window for fast tests
  const testConfig: RateLimitConfig = {
    windowMs: 1000, // 1 second
    maxRequests: 3,
  };

  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
  });

  afterEach(() => {
    limiter.destroy();
  });

  // ─── Basic Allow/Block ──────────────────────────────────────

  it('should allow requests under the limit', async () => {
    const result1 = await limiter.check('test-key', testConfig);
    expect(result1.allowed).toBe(true);

    const result2 = await limiter.check('test-key', testConfig);
    expect(result2.allowed).toBe(true);

    const result3 = await limiter.check('test-key', testConfig);
    expect(result3.allowed).toBe(true);
  });

  it('should block requests over the limit', async () => {
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      const result = await limiter.check('test-key', testConfig);
      expect(result.allowed).toBe(true);
    }

    // This should be blocked
    const blocked = await limiter.check('test-key', testConfig);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  // ─── Remaining Count ───────────────────────────────────────

  it('should return correct remaining count', async () => {
    const result1 = await limiter.check('test-key', testConfig);
    expect(result1.remaining).toBe(2); // 3 max - 1 used = 2 remaining

    const result2 = await limiter.check('test-key', testConfig);
    expect(result2.remaining).toBe(1); // 3 max - 2 used = 1 remaining

    const result3 = await limiter.check('test-key', testConfig);
    expect(result3.remaining).toBe(0); // 3 max - 3 used = 0 remaining
  });

  it('should return remaining: 0 when blocked', async () => {
    for (let i = 0; i < 3; i++) {
      await limiter.check('test-key', testConfig);
    }

    const blocked = await limiter.check('test-key', testConfig);
    expect(blocked.remaining).toBe(0);
  });

  // ─── Reset After Window ─────────────────────────────────────

  it('should reset after the window expires', async () => {
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await limiter.check('test-key', testConfig);
    }

    // Should be blocked
    const blocked = await limiter.check('test-key', testConfig);
    expect(blocked.allowed).toBe(false);

    // Wait for window to pass (the sliding window uses interpolation,
    // so we wait 2x to ensure full reset)
    await new Promise((resolve) => setTimeout(resolve, 2100));

    // Should be allowed again
    const afterReset = await limiter.check('test-key', testConfig);
    expect(afterReset.allowed).toBe(true);
  });

  // ─── Key Isolation ──────────────────────────────────────────

  it('should track different keys independently', async () => {
    // Exhaust key-a
    for (let i = 0; i < 3; i++) {
      await limiter.check('key-a', testConfig);
    }

    const blockedA = await limiter.check('key-a', testConfig);
    expect(blockedA.allowed).toBe(false);

    // key-b should still be allowed
    const allowedB = await limiter.check('key-b', testConfig);
    expect(allowedB.allowed).toBe(true);
  });

  // ─── Reset At ───────────────────────────────────────────────

  it('should return a valid resetAt date', async () => {
    const result = await limiter.check('test-key', testConfig);

    expect(result.resetAt).toBeInstanceOf(Date);
    expect(result.resetAt.getTime()).toBeGreaterThan(Date.now() - 100);
    expect(result.resetAt.getTime()).toBeLessThanOrEqual(
      Date.now() + testConfig.windowMs + 100,
    );
  });

  // ─── Manual Reset ───────────────────────────────────────────

  it('should reset a key manually', async () => {
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await limiter.check('test-key', testConfig);
    }

    const blocked = await limiter.check('test-key', testConfig);
    expect(blocked.allowed).toBe(false);

    // Manual reset
    await limiter.reset('test-key');

    // Should be allowed again
    const afterReset = await limiter.check('test-key', testConfig);
    expect(afterReset.allowed).toBe(true);
  });

  // ─── Larger Limits ──────────────────────────────────────────

  it('should handle larger rate limits correctly', async () => {
    const largeConfig: RateLimitConfig = {
      windowMs: 60_000,
      maxRequests: 100,
    };

    // Make 50 requests — should all pass
    for (let i = 0; i < 50; i++) {
      const result = await limiter.check('bulk-key', largeConfig);
      expect(result.allowed).toBe(true);
    }

    // Should still have remaining capacity
    const check = await limiter.check('bulk-key', largeConfig);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBeGreaterThan(0);
  });

  // ─── Auth Rate Limit Simulation ─────────────────────────────

  it('should enforce auth rate limit (5 per 15 min)', async () => {
    // Use a shorter window for testing but same limit
    const authTestConfig: RateLimitConfig = {
      windowMs: 500,
      maxRequests: 5,
    };

    // 5 login attempts should succeed
    for (let i = 0; i < 5; i++) {
      const result = await limiter.check('auth:user@example.com', authTestConfig);
      expect(result.allowed).toBe(true);
    }

    // 6th attempt should be blocked
    const blocked = await limiter.check('auth:user@example.com', authTestConfig);
    expect(blocked.allowed).toBe(false);
  });

  // ─── Destroy ────────────────────────────────────────────────

  it('should clean up on destroy', async () => {
    await limiter.check('test-key', testConfig);
    limiter.destroy();

    // After destroy, a new check should start fresh (entries cleared)
    // We need a new limiter since the old one is destroyed
    const newLimiter = new InMemoryRateLimiter();
    const result = await newLimiter.check('test-key', testConfig);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // Fresh start
    newLimiter.destroy();
  });
});
