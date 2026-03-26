/**
 * Developer Account Route Tests — /v1/developers endpoints
 *
 * Tests registration, profile retrieval, key rotation, usage tracking,
 * audit logging, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createPortalApp } from '../app.js';
import { developersRouter, configureDeveloperRoutes } from '../routes/developers.js';
import { configureApiKeyAuth, hashApiKey, clearRateLimitStore } from '../middleware/api-key-auth.js';
import type { Env } from '../types.js';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';

// ── Test Fixtures ─────────────────────────────────────────────────

interface MockDeveloper {
  id: string;
  email: string;
  displayName: string | null;
  organization: string | null;
  apiKeyHash: string;
  apiKeyPrefix: string;
  tier: 'free' | 'pro' | 'enterprise';
  rateLimitRpm: number;
  sandboxTenantId: string | null;
  createdAt: Date;
  lastActiveAt: Date | null;
  status: 'active' | 'suspended' | 'revoked';
}

const devStore = new Map<string, MockDeveloper>();
const devByEmail = new Map<string, MockDeveloper>();
const devByKeyHash = new Map<string, MockDeveloper>();
const usageStore: Array<{
  developerId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  timestamp: Date;
}> = [];

let auditStore: InMemoryAuditStore;
let auditLogger: AuditLogger;

function createTestApp(): Hono<Env> {
  return createPortalApp({ corsOrigins: [], nodeEnv: 'test' });
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(async () => {
  devStore.clear();
  devByEmail.clear();
  devByKeyHash.clear();
  usageStore.length = 0;
  clearRateLimitStore();

  auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);

  configureDeveloperRoutes({
    auditLogger,
    findByEmail: async (email) => devByEmail.get(email) ?? null,
    findById: async (id) => devStore.get(id) ?? null,
    createDeveloper: async (data) => {
      const dev: MockDeveloper = {
        id: `dev-${Date.now()}`,
        email: data.email,
        displayName: data.displayName ?? null,
        organization: data.organization ?? null,
        apiKeyHash: data.apiKeyHash,
        apiKeyPrefix: data.apiKeyPrefix,
        tier: 'free',
        rateLimitRpm: 60,
        sandboxTenantId: null,
        createdAt: new Date(),
        lastActiveAt: null,
        status: 'active',
      };
      devStore.set(dev.id, dev);
      devByEmail.set(dev.email, dev);
      devByKeyHash.set(dev.apiKeyHash, dev);
      return dev;
    },
    updateApiKey: async (developerId, apiKeyHash, apiKeyPrefix) => {
      const dev = devStore.get(developerId);
      if (dev) {
        devByKeyHash.delete(dev.apiKeyHash);
        dev.apiKeyHash = apiKeyHash;
        dev.apiKeyPrefix = apiKeyPrefix;
        devByKeyHash.set(apiKeyHash, dev);
      }
    },
    getUsage: async (developerId, limit) => {
      return usageStore
        .filter((u) => u.developerId === developerId)
        .slice(0, limit);
    },
  });

  configureApiKeyAuth({
    findByKeyHash: async (keyHash) => {
      const dev = devByKeyHash.get(keyHash);
      if (!dev) return null;
      return {
        id: dev.id,
        email: dev.email,
        tier: dev.tier,
        rateLimitRpm: dev.rateLimitRpm,
        status: dev.status,
      };
    },
    updateLastActive: async () => {},
  });
});

// ── Registration Tests ───────────────────────────────────────────

describe('POST /v1/developers/register', () => {
  it('creates a developer account and returns API key', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.com' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; data: { apiKey: string; email: string; id: string } };
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('dev@example.com');
    expect(body.data.apiKey).toBeDefined();
    expect(body.data.apiKey.length).toBeGreaterThan(8);
    expect(body.data.id).toBeDefined();
  });

  it('returns API key that starts with devk_ prefix', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dev2@example.com' }),
    });

    const body = await res.json() as { data: { apiKey: string; apiKeyPrefix: string } };
    expect(body.data.apiKey.startsWith('devk_')).toBe(true);
    expect(body.data.apiKeyPrefix).toBe(body.data.apiKey.slice(0, 8));
  });

  it('stores API key as SHA-256 hash (not plaintext)', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hash-test@example.com' }),
    });

    const body = await res.json() as { data: { apiKey: string; id: string } };
    const dev = devStore.get(body.data.id);
    expect(dev).toBeDefined();
    expect(dev!.apiKeyHash).not.toBe(body.data.apiKey);
    expect(dev!.apiKeyHash).toBe(hashApiKey(body.data.apiKey));
  });

  it('rejects duplicate email', async () => {
    const app = createTestApp();

    // Register first
    await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com' }),
    });

    // Try again with same email
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com' }),
    });

    expect(res.status).toBe(409);
  });

  it('rejects invalid email format', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects missing email', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('accepts optional displayName and organization', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'full@example.com',
        displayName: 'Test Dev',
        organization: 'Acme Corp',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: { displayName: string; organization: string } };
    expect(body.data.displayName).toBe('Test Dev');
    expect(body.data.organization).toBe('Acme Corp');
  });

  it('generates audit log entry on registration', async () => {
    const app = createTestApp();
    await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'audit-test@example.com' }),
    });

    const events = auditStore.getAllEvents('developer-portal');
    expect(events.length).toBeGreaterThan(0);
    const registerEvent = events.find((e) => e.action === 'register');
    expect(registerEvent).toBeDefined();
    expect(registerEvent!.resource).toBe('developer_accounts');
  });

  it('returns correct default tier and rate limit', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'defaults@example.com' }),
    });

    const body = await res.json() as { data: { tier: string; rateLimitRpm: number } };
    expect(body.data.tier).toBe('free');
    expect(body.data.rateLimitRpm).toBe(60);
  });
});

// ── Profile Tests ────────────────────────────────────────────────

describe('GET /v1/developers/me', () => {
  it('returns developer profile with valid API key', async () => {
    const app = createTestApp();

    // Register
    const regRes = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'me@example.com' }),
    });
    const regBody = await regRes.json() as { data: { apiKey: string } };

    // Get profile
    const res = await app.request('/v1/developers/me', {
      headers: { 'X-API-Key': regBody.data.apiKey },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { email: string } };
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('me@example.com');
  });

  it('returns 401 without API key', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid API key', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/me', {
      headers: { 'X-API-Key': 'invalid_key_12345678901234567890' },
    });
    expect(res.status).toBe(401);
  });

  it('does not expose apiKeyHash in response', async () => {
    const app = createTestApp();

    const regRes = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nohash@example.com' }),
    });
    const regBody = await regRes.json() as { data: { apiKey: string } };

    const res = await app.request('/v1/developers/me', {
      headers: { 'X-API-Key': regBody.data.apiKey },
    });

    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).not.toHaveProperty('apiKeyHash');
    expect(body.data).toHaveProperty('apiKeyPrefix');
  });
});

// ── Key Rotation Tests ───────────────────────────────────────────

describe('POST /v1/developers/rotate-key', () => {
  it('returns new API key and invalidates old one', async () => {
    const app = createTestApp();

    // Register
    const regRes = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rotate@example.com' }),
    });
    const regBody = await regRes.json() as { data: { apiKey: string } };
    const oldKey = regBody.data.apiKey;

    // Rotate
    const rotateRes = await app.request('/v1/developers/rotate-key', {
      method: 'POST',
      headers: { 'X-API-Key': oldKey },
    });

    expect(rotateRes.status).toBe(200);
    const rotateBody = await rotateRes.json() as { data: { apiKey: string; apiKeyPrefix: string } };
    expect(rotateBody.data.apiKey).toBeDefined();
    expect(rotateBody.data.apiKey).not.toBe(oldKey);
    expect(rotateBody.data.apiKeyPrefix).toBeDefined();
  });

  it('old key becomes invalid after rotation', async () => {
    const app = createTestApp();

    // Register
    const regRes = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rotate-old@example.com' }),
    });
    const regBody = await regRes.json() as { data: { apiKey: string } };
    const oldKey = regBody.data.apiKey;

    // Rotate
    await app.request('/v1/developers/rotate-key', {
      method: 'POST',
      headers: { 'X-API-Key': oldKey },
    });

    // Old key should fail
    const res = await app.request('/v1/developers/me', {
      headers: { 'X-API-Key': oldKey },
    });
    expect(res.status).toBe(401);
  });

  it('new key works after rotation', async () => {
    const app = createTestApp();

    // Register
    const regRes = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rotate-new@example.com' }),
    });
    const regBody = await regRes.json() as { data: { apiKey: string } };

    // Rotate
    const rotateRes = await app.request('/v1/developers/rotate-key', {
      method: 'POST',
      headers: { 'X-API-Key': regBody.data.apiKey },
    });
    const rotateBody = await rotateRes.json() as { data: { apiKey: string } };

    // New key should work
    const res = await app.request('/v1/developers/me', {
      headers: { 'X-API-Key': rotateBody.data.apiKey },
    });
    expect(res.status).toBe(200);
  });

  it('generates audit log for key rotation', async () => {
    const app = createTestApp();

    const regRes = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rotate-audit@example.com' }),
    });
    const regBody = await regRes.json() as { data: { apiKey: string } };

    await app.request('/v1/developers/rotate-key', {
      method: 'POST',
      headers: { 'X-API-Key': regBody.data.apiKey },
    });

    const events = auditStore.getAllEvents('developer-portal');
    const rotateEvent = events.find((e) => e.action === 'rotate_key');
    expect(rotateEvent).toBeDefined();
  });
});

// ── Usage Tests ──────────────────────────────────────────────────

describe('GET /v1/developers/usage', () => {
  it('returns usage stats for developer', async () => {
    const app = createTestApp();

    // Register
    const regRes = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'usage@example.com' }),
    });
    const regBody = await regRes.json() as { data: { apiKey: string; id: string } };

    // Add some mock usage
    usageStore.push({
      developerId: regBody.data.id,
      endpoint: '/v1/customers',
      method: 'GET',
      statusCode: 200,
      latencyMs: 45,
      timestamp: new Date(),
    });

    // Get usage
    const res = await app.request('/v1/developers/usage', {
      headers: { 'X-API-Key': regBody.data.apiKey },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: { recentRequests: unknown[]; totalRequests: number; tier: string; rateLimitRpm: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.totalRequests).toBe(1);
    expect(body.data.tier).toBe('free');
    expect(body.data.rateLimitRpm).toBe(60);
  });

  it('returns empty usage for new developer', async () => {
    const app = createTestApp();

    const regRes = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'empty-usage@example.com' }),
    });
    const regBody = await regRes.json() as { data: { apiKey: string } };

    const res = await app.request('/v1/developers/usage', {
      headers: { 'X-API-Key': regBody.data.apiKey },
    });

    const body = await res.json() as { data: { totalRequests: number } };
    expect(body.data.totalRequests).toBe(0);
  });

  it('requires API key authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/usage');
    expect(res.status).toBe(401);
  });
});

// ── Error Handling Tests ─────────────────────────────────────────

describe('Error handling', () => {
  it('returns correlation ID in error responses', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bad' }),
    });

    const body = await res.json() as { success: boolean; error: { correlationId: string } };
    expect(body.success).toBe(false);
    expect(body.error.correlationId).toBeDefined();
  });

  it('returns structured error for invalid JSON', async () => {
    const app = createTestApp();
    const res = await app.request('/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });
});
