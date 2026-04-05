/**
 * Per-endpoint rate limit tier tests -- rateLimit(tier) factory
 *
 * Tests the new per-tier middleware factory separately from rateLimitMiddleware
 * (which tests the global ceiling). Each Vitest file runs in fresh module
 * isolation, so limiter starts as null here -- the no-op test comes first.
 *
 * Covers:
 * - 4 tiers: key construction + window config
 * - Agent tier: path-param, then X-Agent-Id header, then write fallback
 * - No-op when limiter is null (module starts unconfigured)
 * - 429 response shape + X-RateLimit-* headers
 * - Redis key pattern verification via mock RedisLikeClient
 *
 * SOC2 CC6.6 -- Rate limiting protects system availability.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { rateLimit, configureRateLimit } from '../rate-limit.js';
import { RedisRateLimiter } from '@ordr/auth';
import type { RateLimiter, RateLimitConfig, RateLimitResult } from '@ordr/auth';
import type { Env } from '../../types.js';

// ---- Helpers -----------------------------------------------------------------

const TENANT = 'tenant-abc';
const AGENT = 'agent-xyz';

function makeMockLimiter(
  allowed = true,
  remaining = 50,
): RateLimiter & { lastKey: string; lastConfig: RateLimitConfig | null } {
  const state = { lastKey: '', lastConfig: null as RateLimitConfig | null };
  return {
    get lastKey() {
      return state.lastKey;
    },
    get lastConfig() {
      return state.lastConfig;
    },
    check: vi.fn().mockImplementation((key: string, config: RateLimitConfig) => {
      state.lastKey = key;
      state.lastConfig = config;
      const result: RateLimitResult = {
        allowed,
        remaining,
        resetAt: new Date(Date.now() + 60_000),
      };
      return Promise.resolve(result);
    }),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Build a mini Hono app that injects tenantContext and applies rateLimit(tier).
 *
 * agentIdInPath=true  => route is /:agentId/actions (c.req.param('agentId') resolves)
 * agentIdInPath=false => route is /action (no path param; use X-Agent-Id header or fallback)
 */
function buildApp(tier: Parameters<typeof rateLimit>[0], agentIdInPath = false): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('tenantContext', {
      tenantId: TENANT,
      userId: 'user-1',
      roles: [],
      permissions: [],
    });
    await next();
  });
  if (agentIdInPath) {
    app.post('/:agentId/actions', rateLimit(tier), (c) => c.json({ ok: true }));
  } else {
    app.post('/action', rateLimit(tier), (c) => c.json({ ok: true }));
  }
  return app;
}

// ---- Tests -------------------------------------------------------------------
// IMPORTANT: The no-op test uses vi.isolateModules() to get a fresh module instance
// with limiter === null, independent of test ordering or other describe blocks.
// All other tests call configureRateLimit(mock) at the start of each test case.

describe('rateLimit -- no-op when limiter is null', () => {
  it('passes through when configureRateLimit was not called', async () => {
    // vi.resetModules() clears the module registry so the re-import gets a
    // fresh module instance where limiter === null, regardless of whether
    // other tests in this file have already called configureRateLimit().
    vi.resetModules();
    const { rateLimit: freshRateLimit } = (await import('../rate-limit.js')) as {
      rateLimit: typeof rateLimit;
    };
    // Restore the module registry so subsequent tests get their own fresh
    // configureRateLimit state via the top-level import.
    vi.resetModules();

    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('tenantContext', { tenantId: TENANT, userId: 'user-1', roles: [], permissions: [] });
      await next();
    });
    app.post('/action', freshRateLimit('write'), (c) => c.json({ ok: true }));

    const res = await app.request('/action', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

describe('rateLimit -- write tier', () => {
  it('uses rl:write:{tenantId} key with 100 req/min config', async () => {
    const mock = makeMockLimiter();
    configureRateLimit(mock);
    const app = buildApp('write');
    await app.request('/action', { method: 'POST' });
    expect(mock.lastKey).toBe(`rl:write:${TENANT}`);
    expect(mock.lastConfig).toMatchObject({ windowMs: 60_000, maxRequests: 100 });
  });
});

describe('rateLimit -- read tier', () => {
  it('uses rl:read:{tenantId} key with 500 req/min config', async () => {
    const mock = makeMockLimiter();
    configureRateLimit(mock);
    const app = buildApp('read');
    await app.request('/action', { method: 'POST' });
    expect(mock.lastKey).toBe(`rl:read:${TENANT}`);
    expect(mock.lastConfig).toMatchObject({ windowMs: 60_000, maxRequests: 500 });
  });
});

describe('rateLimit -- bulk tier', () => {
  it('uses rl:bulk:{tenantId} key with 20 req/min config', async () => {
    const mock = makeMockLimiter();
    configureRateLimit(mock);
    const app = buildApp('bulk');
    await app.request('/action', { method: 'POST' });
    expect(mock.lastKey).toBe(`rl:bulk:${TENANT}`);
    expect(mock.lastConfig).toMatchObject({ windowMs: 60_000, maxRequests: 20 });
  });
});

describe('rateLimit -- agent tier, agentId from path param', () => {
  it('uses rl:agent:{tenantId}:{agentId} key with 200 req/min config', async () => {
    const mock = makeMockLimiter();
    configureRateLimit(mock);
    const app = buildApp('agent', true); // route: /:agentId/actions
    await app.request(`/${AGENT}/actions`, { method: 'POST' });
    expect(mock.lastKey).toBe(`rl:agent:${TENANT}:${AGENT}`);
    expect(mock.lastConfig).toMatchObject({ windowMs: 60_000, maxRequests: 200 });
  });
});

describe('rateLimit -- agent tier, agentId from X-Agent-Id header', () => {
  it('reads agentId from header when not in path params', async () => {
    const mock = makeMockLimiter();
    configureRateLimit(mock);
    const app = buildApp('agent'); // route: /action, no :agentId
    await app.request('/action', {
      method: 'POST',
      headers: { 'X-Agent-Id': AGENT },
    });
    expect(mock.lastKey).toBe(`rl:agent:${TENANT}:${AGENT}`);
    expect(mock.lastConfig).toMatchObject({ windowMs: 60_000, maxRequests: 200 });
  });
});

describe('rateLimit -- agent tier fallback to write when agentId absent', () => {
  it('uses rl:write:{tenantId} with write config when no agentId', async () => {
    const mock = makeMockLimiter();
    configureRateLimit(mock);
    const app = buildApp('agent'); // no :agentId path; no X-Agent-Id header
    await app.request('/action', { method: 'POST' }); // intentionally no X-Agent-Id
    expect(mock.lastKey).toBe(`rl:write:${TENANT}`);
    expect(mock.lastConfig).toMatchObject({ windowMs: 60_000, maxRequests: 100 });
  });
});

describe('rateLimit -- 429 response shape', () => {
  it('returns 429 with RATE_LIMITED body, Retry-After, and X-RateLimit-* headers', async () => {
    const mock = makeMockLimiter(false, 0);
    configureRateLimit(mock);
    const app = buildApp('write');
    const res = await app.request('/action', { method: 'POST' });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
  });
});

describe('rateLimit -- allowed response headers', () => {
  it('sets X-RateLimit-* headers on an allowed response', async () => {
    const mock = makeMockLimiter(true, 42);
    configureRateLimit(mock);
    const app = buildApp('read');
    const res = await app.request('/action', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('42');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('500');
    const reset = Number(res.headers.get('X-RateLimit-Reset'));
    expect(reset).toBeGreaterThan(Date.now() / 1000);
  });
});

describe('rateLimit -- Redis key pattern verification', () => {
  it('passes the rl:{tier}:{tenantId} key as KEYS[1] to the Lua script runner', async () => {
    // Mock the RedisLikeClient.eval method (this is the ioredis Lua script runner,
    // NOT JavaScript eval -- it sends a Lua script to Redis for atomic execution).
    const redisMock = vi.fn().mockResolvedValue([1, 99, Date.now() + 60_000]);
    const mockRedisClient = { eval: redisMock };

    const redisLimiter = new RedisRateLimiter(mockRedisClient);
    configureRateLimit(redisLimiter);

    const app = buildApp('bulk');
    await app.request('/action', { method: 'POST' });

    expect(redisMock).toHaveBeenCalledOnce();
    const args = redisMock.mock.calls[0] as unknown[];
    // Argument order: (luaScript, numkeys, KEYS[1], ARGV[1], ARGV[2], ARGV[3])
    expect(args[1]).toBe(1); // numkeys
    expect(args[2]).toBe(`rl:bulk:${TENANT}`); // KEYS[1]
  });
});
