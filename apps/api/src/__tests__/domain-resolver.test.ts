/**
 * Domain Resolver Middleware Tests
 *
 * SOC2 CC6.1 — Verify domain-to-tenant resolution is server-side only.
 * Rule 2 — tenant_id NEVER from client input.
 *
 * Tests:
 * - Custom domain resolves to correct tenant
 * - Unknown domains fall through without error
 * - Cache hits on second lookup
 * - Cache expires after TTL
 * - localhost/IP/internal domains are skipped
 * - Missing Host header falls through
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  domainResolver,
  configureDomainResolver,
  clearDomainCache,
  getDomainCacheSize,
} from '../middleware/domain-resolver.js';
import type { Env } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();

  // Initialize requestId to avoid undefined
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-request-id');
    await next();
  });

  app.use('*', domainResolver);

  app.get('/test', (c) => {
    const ctx = c.get('tenantContext');
    return c.json({
      tenantId: ctx?.tenantId ?? null,
      resolved: ctx !== undefined,
    });
  });

  return app;
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  clearDomainCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearDomainCache();
});

// ─── Domain Resolution ──────────────────────────────────────────

describe('domain resolver — resolution', () => {
  it('resolves a custom domain to a tenant ID', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();
    const res = await app.request('http://app.acme.com/test', {
      headers: { Host: 'app.acme.com' },
    });

    const body = await res.json();
    expect(body.resolved).toBe(true);
    expect(body.tenantId).toBe('tenant-abc');
    expect(lookup).toHaveBeenCalledWith('app.acme.com');
  });

  it('falls through when domain is not found', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    configureDomainResolver(lookup);

    const app = createTestApp();
    const res = await app.request('http://unknown.com/test', {
      headers: { Host: 'unknown.com' },
    });

    const body = await res.json();
    expect(body.resolved).toBe(false);
    expect(body.tenantId).toBeNull();
  });

  it('lowercases the domain before lookup', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();
    await app.request('http://APP.ACME.COM/test', {
      headers: { Host: 'APP.ACME.COM' },
    });

    expect(lookup).toHaveBeenCalledWith('app.acme.com');
  });

  it('strips port from Host header', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();
    await app.request('http://app.acme.com:8443/test', {
      headers: { Host: 'app.acme.com:8443' },
    });

    expect(lookup).toHaveBeenCalledWith('app.acme.com');
  });
});

// ─── Skipped Domains ─────────────────────────────────────────────

describe('domain resolver — skip rules', () => {
  it('skips localhost', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();
    const res = await app.request('http://localhost/test', {
      headers: { Host: 'localhost' },
    });

    const body = await res.json();
    expect(body.resolved).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips IP addresses', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();
    const res = await app.request('http://192.168.1.1/test', {
      headers: { Host: '192.168.1.1' },
    });

    const body = await res.json();
    expect(body.resolved).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips .internal domains', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();
    const res = await app.request('http://api.service.internal/test', {
      headers: { Host: 'api.service.internal' },
    });

    const body = await res.json();
    expect(body.resolved).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('falls through when no Host header present', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();
    const res = await app.request('http://example.com/test');

    const body = await res.json();
    // Without explicit Host header, Hono may or may not provide one.
    // The middleware should handle gracefully either way.
    expect(res.status).toBe(200);
  });

  it('falls through when resolver is not configured', async () => {
    configureDomainResolver(null as unknown as (domain: string) => Promise<string | null>);

    // Re-import to simulate unconfigured state — for this test, set to null
    const app = createTestApp();
    const res = await app.request('http://app.acme.com/test', {
      headers: { Host: 'app.acme.com' },
    });

    expect(res.status).toBe(200);
  });
});

// ─── Cache Behavior ──────────────────────────────────────────────

describe('domain resolver — cache', () => {
  it('caches domain lookup on first request', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();
    await app.request('http://app.acme.com/test', {
      headers: { Host: 'app.acme.com' },
    });

    expect(getDomainCacheSize()).toBe(1);
  });

  it('hits cache on second request (no DB lookup)', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();

    // First request — populates cache
    await app.request('http://app.acme.com/test', {
      headers: { Host: 'app.acme.com' },
    });
    expect(lookup).toHaveBeenCalledTimes(1);

    // Second request — hits cache
    const res2 = await app.request('http://app.acme.com/test', {
      headers: { Host: 'app.acme.com' },
    });
    expect(lookup).toHaveBeenCalledTimes(1); // Still 1 — cache hit

    const body = await res2.json();
    expect(body.tenantId).toBe('tenant-abc');
  });

  it('does not cache misses (null results)', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    configureDomainResolver(lookup);

    const app = createTestApp();
    await app.request('http://unknown.com/test', {
      headers: { Host: 'unknown.com' },
    });

    expect(getDomainCacheSize()).toBe(0);
  });

  it('expires cache entries after TTL', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const realNow = Date.now();
    let fakeTime = realNow;

    vi.spyOn(Date, 'now').mockImplementation(() => fakeTime);

    const app = createTestApp();

    // First request — populates cache at fakeTime
    await app.request('http://app.acme.com/test', {
      headers: { Host: 'app.acme.com' },
    });
    expect(lookup).toHaveBeenCalledTimes(1);

    // Advance time past TTL (5 minutes = 300_000ms)
    fakeTime = realNow + 6 * 60 * 1000;

    // Second request — cache expired, should re-fetch
    await app.request('http://app.acme.com/test', {
      headers: { Host: 'app.acme.com' },
    });
    expect(lookup).toHaveBeenCalledTimes(2); // Re-fetched due to expiry
  });

  it('clearDomainCache empties all entries', async () => {
    const lookup = vi.fn().mockResolvedValue('tenant-abc');
    configureDomainResolver(lookup);

    const app = createTestApp();
    await app.request('http://app.acme.com/test', {
      headers: { Host: 'app.acme.com' },
    });
    expect(getDomainCacheSize()).toBe(1);

    clearDomainCache();
    expect(getDomainCacheSize()).toBe(0);
  });

  it('caches different domains independently', async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce('tenant-1')
      .mockResolvedValueOnce('tenant-2');
    configureDomainResolver(lookup);

    const app = createTestApp();

    await app.request('http://app1.acme.com/test', {
      headers: { Host: 'app1.acme.com' },
    });
    await app.request('http://app2.acme.com/test', {
      headers: { Host: 'app2.acme.com' },
    });

    expect(getDomainCacheSize()).toBe(2);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
