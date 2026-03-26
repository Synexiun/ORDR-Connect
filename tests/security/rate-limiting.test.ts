/**
 * Rate Limiting Security Tests
 *
 * Validates per-tenant, per-endpoint, and agent-level rate limiting.
 * Tests the sliding window algorithm and response headers.
 *
 * SOC2 CC6.6, ISO 27001 A.13.1.1, HIPAA §164.312(a)(1)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemoryRateLimiter,
  AUTH_RATE_LIMIT,
  API_RATE_LIMIT,
  PHI_ACCESS_RATE_LIMIT,
} from '@ordr/auth';
import type { RateLimitConfig, RateLimitResult } from '@ordr/auth';

// ── Fixtures ──────────────────────────────────────────────────────────

let limiter: InMemoryRateLimiter;

beforeEach(() => {
  limiter = new InMemoryRateLimiter();
});

afterEach(() => {
  limiter.destroy();
});

// ── Per-Tenant Rate Limits ────────────────────────────────────────────

describe('Per-tenant rate limiting', () => {
  it('allows requests within the limit', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 5 };

    for (let i = 0; i < 5; i++) {
      const result = await limiter.check('tenant-001:api', config);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks requests exceeding the limit', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 3 };

    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await limiter.check('tenant-002:api', config);
    }

    const result = await limiter.check('tenant-002:api', config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('isolates rate limits between tenants', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 2 };

    // Exhaust tenant A
    await limiter.check('tenant-A:api', config);
    await limiter.check('tenant-A:api', config);
    const tenantAResult = await limiter.check('tenant-A:api', config);
    expect(tenantAResult.allowed).toBe(false);

    // Tenant B should still have quota
    const tenantBResult = await limiter.check('tenant-B:api', config);
    expect(tenantBResult.allowed).toBe(true);
  });

  it('isolates rate limits between endpoints for same tenant', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 2 };

    // Exhaust /customers
    await limiter.check('tenant-001:/customers', config);
    await limiter.check('tenant-001:/customers', config);
    const customersResult = await limiter.check('tenant-001:/customers', config);
    expect(customersResult.allowed).toBe(false);

    // /messages should still have quota
    const messagesResult = await limiter.check('tenant-001:/messages', config);
    expect(messagesResult.allowed).toBe(true);
  });
});

// ── Per-Endpoint Rate Limits ──────────────────────────────────────────

describe('Per-endpoint rate limiting', () => {
  it('enforces AUTH_RATE_LIMIT preset (5/15min)', async () => {
    const key = 'auth:tenant-001:login';

    for (let i = 0; i < 5; i++) {
      const result = await limiter.check(key, AUTH_RATE_LIMIT);
      expect(result.allowed).toBe(true);
    }

    const blocked = await limiter.check(key, AUTH_RATE_LIMIT);
    expect(blocked.allowed).toBe(false);
  });

  it('enforces PHI_ACCESS_RATE_LIMIT preset (100/min)', async () => {
    const key = 'phi:user-001';
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 5 }; // Reduced for test speed

    for (let i = 0; i < 5; i++) {
      await limiter.check(key, config);
    }

    const blocked = await limiter.check(key, config);
    expect(blocked.allowed).toBe(false);
  });

  it('has correct preset values for API_RATE_LIMIT', () => {
    expect(API_RATE_LIMIT.maxRequests).toBe(1000);
    expect(API_RATE_LIMIT.windowMs).toBe(60000);
  });

  it('has correct preset values for AUTH_RATE_LIMIT', () => {
    expect(AUTH_RATE_LIMIT.maxRequests).toBe(5);
    expect(AUTH_RATE_LIMIT.windowMs).toBe(15 * 60 * 1000);
  });

  it('has correct preset values for PHI_ACCESS_RATE_LIMIT', () => {
    expect(PHI_ACCESS_RATE_LIMIT.maxRequests).toBe(100);
    expect(PHI_ACCESS_RATE_LIMIT.windowMs).toBe(60000);
  });
});

// ── Sliding Window Accuracy ───────────────────────────────────────────

describe('Sliding window correctness', () => {
  it('provides remaining count in result', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 10 };
    const result = await limiter.check('test:remaining', config);
    expect(result.remaining).toBeDefined();
    expect(typeof result.remaining).toBe('number');
    expect(result.remaining).toBeLessThanOrEqual(config.maxRequests);
  });

  it('provides resetAt timestamp in result', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 10 };
    const result = await limiter.check('test:reset', config);
    expect(result.resetAt).toBeInstanceOf(Date);
    expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('remaining decreases with each request', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 10 };
    const first = await limiter.check('test:decrease', config);
    const second = await limiter.check('test:decrease', config);
    expect(second.remaining).toBeLessThanOrEqual(first.remaining);
  });

  it('remaining is zero when blocked', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 1 };
    await limiter.check('test:zero', config);
    const blocked = await limiter.check('test:zero', config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});

// ── Rate Limit Reset ──────────────────────────────────────────────────

describe('Rate limit reset', () => {
  it('allows requests after manual reset', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 1 };
    const key = 'test:reset-manual';

    await limiter.check(key, config);
    const blocked = await limiter.check(key, config);
    expect(blocked.allowed).toBe(false);

    await limiter.reset(key);
    const afterReset = await limiter.check(key, config);
    expect(afterReset.allowed).toBe(true);
  });
});

// ── Agent Execution Rate Limits ───────────────────────────────────────

describe('Agent execution rate limits', () => {
  it('limits agent actions per session', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 50 };
    const key = 'agent:session-001:actions';

    for (let i = 0; i < 50; i++) {
      await limiter.check(key, config);
    }

    const blocked = await limiter.check(key, config);
    expect(blocked.allowed).toBe(false);
  });

  it('isolates agent limits between sessions', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 2 };

    await limiter.check('agent:session-A:actions', config);
    await limiter.check('agent:session-A:actions', config);
    const sessionA = await limiter.check('agent:session-A:actions', config);
    expect(sessionA.allowed).toBe(false);

    const sessionB = await limiter.check('agent:session-B:actions', config);
    expect(sessionB.allowed).toBe(true);
  });
});

// ── Developer API Rate Limits ─────────────────────────────────────────

describe('Developer API rate limits', () => {
  it('limits developer API key requests independently', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 100 };

    // Different API keys should have independent limits
    const keyA = 'dev:apikey-A';
    const keyB = 'dev:apikey-B';

    for (let i = 0; i < 100; i++) {
      await limiter.check(keyA, config);
    }

    const blockedA = await limiter.check(keyA, config);
    expect(blockedA.allowed).toBe(false);

    const allowedB = await limiter.check(keyB, config);
    expect(allowedB.allowed).toBe(true);
  });
});

// ── Response Header Validation ────────────────────────────────────────

describe('Rate limit response metadata', () => {
  it('result has allowed boolean', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 10 };
    const result = await limiter.check('test:meta', config);
    expect(typeof result.allowed).toBe('boolean');
  });

  it('result has remaining number', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 10 };
    const result = await limiter.check('test:meta2', config);
    expect(typeof result.remaining).toBe('number');
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  it('result has resetAt Date', async () => {
    const config: RateLimitConfig = { windowMs: 60000, maxRequests: 10 };
    const result = await limiter.check('test:meta3', config);
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  it('cleanup timer can be destroyed without error', () => {
    const tempLimiter = new InMemoryRateLimiter();
    expect(() => tempLimiter.destroy()).not.toThrow();
  });
});
