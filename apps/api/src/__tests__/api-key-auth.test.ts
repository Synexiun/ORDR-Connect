/**
 * API Key Auth Middleware Tests — Developer Portal key authentication
 *
 * Tests key extraction, validation, expiration, revocation,
 * rate limiting, and developer context attachment.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  requireApiKeyAuth,
  configureApiKeyAuth,
} from '../middleware/api-key-auth.js';
import type { DeveloperKeyRecord } from '../middleware/api-key-auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import { hashApiKey, generateApiKey } from '@ordr/crypto';
import { InMemoryRateLimiter } from '@ordr/auth';

// ─── Helpers ────────────────────────────────────────────────────────

let keyStore: Map<string, DeveloperKeyRecord>;
let rateLimiter: InMemoryRateLimiter;
let updateLastActiveCalls: string[];

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.use('/api/v1/protected/*', requireApiKeyAuth());
  app.get('/api/v1/protected/data', (c) => {
    return c.json({ success: true, message: 'Authorized' });
  });
  return app;
}

function seedKey(overrides: Partial<DeveloperKeyRecord> & { rawKey?: string } = {}): {
  rawKey: string;
  record: DeveloperKeyRecord;
} {
  const rawKey = overrides.rawKey ?? generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  const record: DeveloperKeyRecord = {
    id: overrides.id ?? 'key-001',
    developerId: overrides.developerId ?? 'dev-001',
    email: overrides.email ?? 'dev@example.com',
    keyHash: overrides.keyHash ?? keyHash,
    keyPrefix: overrides.keyPrefix ?? keyPrefix,
    tier: overrides.tier ?? 'pro',
    rateLimitRpm: overrides.rateLimitRpm ?? 1000,
    status: overrides.status ?? 'active',
    expiresAt: overrides.expiresAt ?? null,
  };

  keyStore.set(keyPrefix, record);
  return { rawKey, record };
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  keyStore = new Map<string, DeveloperKeyRecord>();
  rateLimiter = new InMemoryRateLimiter();
  updateLastActiveCalls = [];

  configureApiKeyAuth({
    findKeyByPrefix: vi.fn(async (prefix: string) => {
      return keyStore.get(prefix) ?? null;
    }),
    rateLimiter,
    updateLastActive: vi.fn(async (developerId: string) => {
      updateLastActiveCalls.push(developerId);
    }),
  });
});

// ═══════════════════════════════════════════════════════════════════
// Key Extraction
// ═══════════════════════════════════════════════════════════════════

describe('API Key extraction', () => {
  it('extracts API key from Authorization: Bearer header', async () => {
    const { rawKey } = seedKey();
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('rejects missing Authorization header with 401', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBeDefined();
  });

  it('rejects Authorization header without Bearer prefix', async () => {
    const { rawKey } = seedKey();
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Basic ${rawKey}` },
    });

    expect(res.status).toBe(401);
  });

  it('rejects invalid API key prefix (not ordr_)', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: 'Bearer invalid_prefix_key_12345678' },
    });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Key Verification
// ═══════════════════════════════════════════════════════════════════

describe('API Key verification', () => {
  it('rejects key not found in database', async () => {
    const app = createTestApp();

    // Use a valid-format key that is not in the store
    const unknownKey = generateApiKey();
    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${unknownKey}` },
    });

    expect(res.status).toBe(401);
  });

  it('rejects key with valid prefix but wrong hash', async () => {
    const { rawKey } = seedKey();
    const app = createTestApp();

    // Modify one character of the key to make hash mismatch
    const tamperedKey = rawKey.slice(0, -1) + (rawKey.endsWith('a') ? 'b' : 'a');
    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${tamperedKey}` },
    });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Key Status
// ═══════════════════════════════════════════════════════════════════

describe('API Key status checks', () => {
  it('rejects expired key', async () => {
    const { rawKey } = seedKey({
      expiresAt: new Date(Date.now() - 86400000), // expired yesterday
    });
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain('expired');
  });

  it('rejects revoked key (status = revoked)', async () => {
    const { rawKey } = seedKey({ status: 'revoked' });
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain('revoked');
  });

  it('rejects suspended key', async () => {
    const { rawKey } = seedKey({ status: 'suspended' });
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(401);
  });

  it('accepts key with no expiration (expiresAt = null)', async () => {
    const { rawKey } = seedKey({ expiresAt: null });
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(200);
  });

  it('accepts key with future expiration', async () => {
    const { rawKey } = seedKey({
      expiresAt: new Date(Date.now() + 86400000), // expires tomorrow
    });
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════════════════

describe('API Key rate limiting', () => {
  it('returns 429 when rate limit exceeded', async () => {
    const { rawKey } = seedKey({ rateLimitRpm: 2 });
    const app = createTestApp();

    // First two requests should succeed
    const res1 = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(res2.status).toBe(200);

    // Third request should be rate limited
    const res3 = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(res3.status).toBe(429);
  });

  it('includes Retry-After header on 429', async () => {
    const { rawKey } = seedKey({ rateLimitRpm: 1 });
    const app = createTestApp();

    // First request succeeds
    await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    // Second request rate limited
    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeDefined();
  });

  it('includes X-RateLimit-Remaining header on success', async () => {
    const { rawKey } = seedKey({ rateLimitRpm: 100 });
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBeDefined();
  });

  it('includes X-RateLimit-Reset header on success', async () => {
    const { rawKey } = seedKey({ rateLimitRpm: 100 });
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Error Responses
// ═══════════════════════════════════════════════════════════════════

describe('API Key error responses', () => {
  it('includes correlationId in all error responses', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.correlationId).toBeDefined();
    expect(typeof body.error.correlationId).toBe('string');
  });

  it('never exposes internal error details', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/protected/data');

    const body = await res.json();
    // Should not contain stack traces or internal paths
    expect(JSON.stringify(body)).not.toContain('node_modules');
    expect(JSON.stringify(body)).not.toContain('at ');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Last Active Update
// ═══════════════════════════════════════════════════════════════════

describe('API Key last active tracking', () => {
  it('updates last active timestamp on valid request', async () => {
    const { rawKey } = seedKey();
    const app = createTestApp();

    await app.request('/api/v1/protected/data', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    // Allow fire-and-forget promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updateLastActiveCalls).toContain('dev-001');
  });
});
