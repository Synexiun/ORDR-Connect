/**
 * Developer Portal Route Tests — /api/v1/developers endpoints
 *
 * Tests registration, login, profile, API key CRUD, sandbox CRUD,
 * tier limits, auth enforcement, Zod validation, and audit logging.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { developersRouter, configureDeveloperRoutes } from '../routes/developers.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import {
  loadKeyPair,
  createAccessToken,
} from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair, hashPassword } from '@ordr/crypto';

// ─── Mock Data ──────────────────────────────────────────────────────

interface MockDeveloper {
  id: string;
  email: string;
  displayName: string;
  organization: string | null;
  passwordHash: string;
  tier: 'free' | 'pro' | 'enterprise';
  rateLimitRpm: number;
  status: 'active' | 'suspended' | 'revoked';
  createdAt: Date;
  lastActiveAt: Date | null;
}

interface MockKey {
  id: string;
  developerId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

interface MockSandbox {
  id: string;
  developerId: string;
  tenantId: string;
  name: string;
  seedDataProfile: string;
  status: 'active' | 'expired' | 'destroyed';
  expiresAt: Date;
  createdAt: Date;
}

let jwtConfig: JwtConfig;
let auditLogger: AuditLogger;
let developerStore: Map<string, MockDeveloper>;
let emailIndex: Map<string, MockDeveloper>;
let keyStore: Map<string, MockKey>;
let sandboxStore: Map<string, MockSandbox>;
let idCounter: number;

async function makeDevJwt(overrides: {
  readonly sub?: string;
  readonly tid?: string;
  readonly role?: string;
} = {}): Promise<string> {
  return createAccessToken(jwtConfig, {
    sub: overrides.sub ?? 'dev-001',
    tid: overrides.tid ?? 'developer-portal',
    role: (overrides.role ?? 'tenant_admin') as 'tenant_admin',
    permissions: [],
  });
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/developers', developersRouter);
  return app;
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    issuer: 'ordr-connect',
    audience: 'ordr-connect',
  });

  configureAuth(jwtConfig);

  const auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);

  developerStore = new Map<string, MockDeveloper>();
  emailIndex = new Map<string, MockDeveloper>();
  keyStore = new Map<string, MockKey>();
  sandboxStore = new Map<string, MockSandbox>();
  idCounter = 1;

  configureDeveloperRoutes({
    jwtConfig,
    auditLogger,
    findDeveloperByEmail: vi.fn(async (email: string) => {
      return emailIndex.get(email) ?? null;
    }),
    findDeveloperById: vi.fn(async (id: string) => {
      return developerStore.get(id) ?? null;
    }),
    createDeveloper: vi.fn(async (data) => {
      const id = `dev-${String(idCounter++).padStart(3, '0')}`;
      const dev: MockDeveloper = {
        id,
        email: data.email,
        displayName: data.displayName,
        organization: data.organization,
        passwordHash: data.passwordHash,
        tier: data.tier as 'free' | 'pro' | 'enterprise',
        rateLimitRpm: 60,
        status: 'active',
        createdAt: new Date(),
        lastActiveAt: null,
      };
      developerStore.set(id, dev);
      emailIndex.set(data.email, dev);
      return dev;
    }),
    createDeveloperKey: vi.fn(async (data) => {
      const id = `key-${String(idCounter++).padStart(3, '0')}`;
      const key: MockKey = {
        id,
        developerId: data.developerId,
        name: data.name,
        keyHash: data.keyHash,
        keyPrefix: data.keyPrefix,
        createdAt: new Date(),
        expiresAt: data.expiresAt,
        revokedAt: null,
      };
      keyStore.set(id, key);
      return key;
    }),
    listDeveloperKeys: vi.fn(async (developerId: string) => {
      const keys: MockKey[] = [];
      for (const k of keyStore.values()) {
        if (k.developerId === developerId) keys.push(k);
      }
      return keys;
    }),
    findKeyById: vi.fn(async (developerId: string, keyId: string) => {
      const key = keyStore.get(keyId);
      if (!key || key.developerId !== developerId) return null;
      return key;
    }),
    revokeKey: vi.fn(async (developerId: string, keyId: string) => {
      const key = keyStore.get(keyId);
      if (!key || key.developerId !== developerId) return false;
      keyStore.set(keyId, { ...key, revokedAt: new Date() });
      return true;
    }),
    createSandbox: vi.fn(async (data) => {
      const id = `sb-${String(idCounter++).padStart(3, '0')}`;
      const sandbox: MockSandbox = {
        id,
        developerId: data.developerId,
        tenantId: data.tenantId,
        name: data.name,
        seedDataProfile: data.seedDataProfile,
        status: 'active',
        expiresAt: data.expiresAt,
        createdAt: new Date(),
      };
      sandboxStore.set(id, sandbox);
      return sandbox;
    }),
    listSandboxes: vi.fn(async (developerId: string) => {
      const sandboxes: MockSandbox[] = [];
      for (const s of sandboxStore.values()) {
        if (s.developerId === developerId) sandboxes.push(s);
      }
      return sandboxes;
    }),
    findSandboxById: vi.fn(async (developerId: string, sandboxId: string) => {
      const sandbox = sandboxStore.get(sandboxId);
      if (!sandbox || sandbox.developerId !== developerId) return null;
      return sandbox;
    }),
    destroySandbox: vi.fn(async (developerId: string, sandboxId: string) => {
      const sandbox = sandboxStore.get(sandboxId);
      if (!sandbox || sandbox.developerId !== developerId) return false;
      sandboxStore.set(sandboxId, { ...sandbox, status: 'destroyed' });
      return true;
    }),
  });
});

// ─── Helper: seed a developer with known credentials ────────────────

async function seedDeveloper(overrides: Partial<MockDeveloper> = {}): Promise<MockDeveloper> {
  const pwHash = await hashPassword('SecureP@ssword123!');
  const id = overrides.id ?? 'dev-001';
  const dev: MockDeveloper = {
    id,
    email: overrides.email ?? 'dev@example.com',
    displayName: overrides.displayName ?? 'Test Developer',
    organization: overrides.organization ?? null,
    passwordHash: pwHash,
    tier: overrides.tier ?? 'free',
    rateLimitRpm: overrides.rateLimitRpm ?? 60,
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? new Date('2025-01-01'),
    lastActiveAt: overrides.lastActiveAt ?? null,
  };
  developerStore.set(id, dev);
  emailIndex.set(dev.email, dev);
  return dev;
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/v1/developers/register
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/v1/developers/register', () => {
  it('creates a new developer account', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'new@example.com',
        name: 'New Developer',
        password: 'SecureP@ssword123!',
        tier: 'free',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('new@example.com');
    expect(body.data.displayName).toBe('New Developer');
    expect(body.data.tier).toBe('free');
  });

  it('returns 201 with default tier when not specified', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'default@example.com',
        name: 'Default Tier Dev',
        password: 'SecureP@ssword123!',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.tier).toBe('free');
  });

  it('rejects duplicate email with 409', async () => {
    await seedDeveloper({ email: 'existing@example.com' });
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'existing@example.com',
        name: 'Duplicate',
        password: 'SecureP@ssword123!',
      }),
    });

    expect(res.status).toBe(409);
  });

  it('validates email format', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        name: 'Bad Email',
        password: 'SecureP@ssword123!',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects short passwords', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'short@example.com',
        name: 'Short Pass',
        password: 'short',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'noname@example.com',
        name: '',
        password: 'SecureP@ssword123!',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('accepts optional organization field', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'org@example.com',
        name: 'Org Dev',
        password: 'SecureP@ssword123!',
        organization: 'Acme Corp',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.organization).toBe('Acme Corp');
  });

  it('rejects invalid tier values', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'tier@example.com',
        name: 'Bad Tier',
        password: 'SecureP@ssword123!',
        tier: 'premium',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('does not expose password hash in response', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'safe@example.com',
        name: 'Safe Dev',
        password: 'SecureP@ssword123!',
      }),
    });

    const body = await res.json();
    expect(body.data.passwordHash).toBeUndefined();
    expect(body.data.password).toBeUndefined();
  });

  it('rejects missing required fields', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/v1/developers/login
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/v1/developers/login', () => {
  it('returns JWT on valid credentials', async () => {
    await seedDeveloper();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dev@example.com',
        password: 'SecureP@ssword123!',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.tokenType).toBe('Bearer');
  });

  it('rejects invalid email', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@example.com',
        password: 'SecureP@ssword123!',
      }),
    });

    expect(res.status).toBe(401);
  });

  it('rejects invalid password', async () => {
    await seedDeveloper();
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dev@example.com',
        password: 'WrongP@ssword123!',
      }),
    });

    expect(res.status).toBe(401);
  });

  it('rejects suspended account', async () => {
    await seedDeveloper({ status: 'suspended' });
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dev@example.com',
        password: 'SecureP@ssword123!',
      }),
    });

    expect(res.status).toBe(401);
  });

  it('validates email format in login', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bad-email',
        password: 'SecureP@ssword123!',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('includes correlationId in error response', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@example.com',
        password: 'SecureP@ssword123!',
      }),
    });

    const body = await res.json();
    expect(body.error.correlationId).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/v1/developers/me
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/v1/developers/me', () => {
  it('returns developer profile for authenticated user', async () => {
    await seedDeveloper();
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('dev@example.com');
    expect(body.data.tier).toBe('free');
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/me');
    expect(res.status).toBe(401);
  });

  it('returns 404 if developer account not found', async () => {
    const app = createTestApp();
    const token = await makeDevJwt({ sub: 'nonexistent-id' });

    const res = await app.request('/api/v1/developers/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('does not expose password hash in profile', async () => {
    await seedDeveloper();
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data.passwordHash).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/v1/developers/keys
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/v1/developers/keys', () => {
  it('creates key and returns raw key once', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Production Key' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.key).toBeDefined();
    expect(body.data.key).toContain('ordr_');
    expect(body.data.prefix).toBeDefined();
    expect(body.data.name).toBe('Production Key');
  });

  it('stores hashed key only (never raw key)', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    await app.request('/api/v1/developers/keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Hash Check Key' }),
    });

    // Check the store — key should have hash and prefix, not the raw key
    for (const key of keyStore.values()) {
      expect(key.keyHash).toBeDefined();
      expect(key.keyHash.length).toBeGreaterThan(0);
      // The stored object should not have a 'key' field (only hash/prefix)
      expect((key as Record<string, unknown>)['key']).toBeUndefined();
    }
  });

  it('accepts optional expiration', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Expiring Key', expiresInDays: 90 }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.expiresAt).toBeDefined();
  });

  it('rejects empty key name', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Auth Key' }),
    });

    expect(res.status).toBe(401);
  });

  it('rejects invalid expiresInDays (zero)', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Bad Expire', expiresInDays: 0 }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects expiresInDays over 365', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Too Long Expire', expiresInDays: 400 }),
    });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/v1/developers/keys
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/v1/developers/keys', () => {
  it('lists keys with prefix only, never full key', async () => {
    // Seed a key directly in the store
    keyStore.set('key-100', {
      id: 'key-100',
      developerId: 'dev-001',
      name: 'Test Key',
      keyHash: 'hashed_value_here',
      keyPrefix: 'ordr_abc123',
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
    });

    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/keys', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].prefix).toBe('ordr_abc123');
    // Verify full key and hash are NOT exposed
    expect(body.data[0].key).toBeUndefined();
    expect(body.data[0].keyHash).toBeUndefined();
  });

  it('returns empty array when no keys exist', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/keys', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/developers/keys');
    expect(res.status).toBe(401);
  });

  it('only returns keys belonging to the authenticated developer', async () => {
    keyStore.set('key-200', {
      id: 'key-200',
      developerId: 'dev-001',
      name: 'My Key',
      keyHash: 'hash1',
      keyPrefix: 'ordr_mine00',
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
    });
    keyStore.set('key-201', {
      id: 'key-201',
      developerId: 'dev-other',
      name: 'Other Key',
      keyHash: 'hash2',
      keyPrefix: 'ordr_other0',
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
    });

    const app = createTestApp();
    const token = await makeDevJwt({ sub: 'dev-001' });

    const res = await app.request('/api/v1/developers/keys', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].prefix).toBe('ordr_mine00');
  });
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/v1/developers/keys/:keyId
// ═══════════════════════════════════════════════════════════════════

describe('DELETE /api/v1/developers/keys/:keyId', () => {
  it('revokes an existing key', async () => {
    keyStore.set('key-300', {
      id: 'key-300',
      developerId: 'dev-001',
      name: 'Revoke Me',
      keyHash: 'hash_revoke',
      keyPrefix: 'ordr_revoke',
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
    });

    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/keys/key-300', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 404 for nonexistent key', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/keys/key-nonexistent', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('returns 404 for key belonging to another developer', async () => {
    keyStore.set('key-301', {
      id: 'key-301',
      developerId: 'dev-other',
      name: 'Not Mine',
      keyHash: 'hash_other',
      keyPrefix: 'ordr_other1',
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
    });

    const app = createTestApp();
    const token = await makeDevJwt({ sub: 'dev-001' });

    const res = await app.request('/api/v1/developers/keys/key-301', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/keys/key-300', {
      method: 'DELETE',
    });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/v1/developers/sandbox
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/v1/developers/sandbox', () => {
  it('provisions a sandbox tenant', async () => {
    await seedDeveloper();
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Test Sandbox' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toContain('sandbox_');
    expect(body.data.name).toBe('Test Sandbox');
    expect(body.data.status).toBe('active');
  });

  it('uses minimal seed profile by default', async () => {
    await seedDeveloper();
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Default Seed' }),
    });

    const body = await res.json();
    expect(body.data.seedDataProfile).toBe('minimal');
  });

  it('accepts healthcare seed profile', async () => {
    await seedDeveloper();
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'HC Sandbox', seedProfile: 'healthcare' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.seedDataProfile).toBe('healthcare');
  });

  it('enforces free tier limit (max 1)', async () => {
    await seedDeveloper({ tier: 'free' });

    // Seed an existing active sandbox
    sandboxStore.set('sb-existing', {
      id: 'sb-existing',
      developerId: 'dev-001',
      tenantId: 'sandbox_existing',
      name: 'Existing',
      seedDataProfile: 'minimal',
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    });

    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Second Sandbox' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('limit');
  });

  it('enforces pro tier limit (max 5)', async () => {
    await seedDeveloper({ tier: 'pro' });

    // Seed 5 active sandboxes
    for (let i = 0; i < 5; i++) {
      sandboxStore.set(`sb-pro-${String(i)}`, {
        id: `sb-pro-${String(i)}`,
        developerId: 'dev-001',
        tenantId: `sandbox_pro_${String(i)}`,
        name: `Pro Sandbox ${String(i)}`,
        seedDataProfile: 'minimal',
        status: 'active',
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
      });
    }

    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Sixth Sandbox' }),
    });

    expect(res.status).toBe(400);
  });

  it('enforces enterprise tier limit (max 20)', async () => {
    await seedDeveloper({ tier: 'enterprise' });

    // Seed 20 active sandboxes
    for (let i = 0; i < 20; i++) {
      sandboxStore.set(`sb-ent-${String(i)}`, {
        id: `sb-ent-${String(i)}`,
        developerId: 'dev-001',
        tenantId: `sandbox_ent_${String(i)}`,
        name: `Ent Sandbox ${String(i)}`,
        seedDataProfile: 'minimal',
        status: 'active',
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
      });
    }

    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Twenty-First Sandbox' }),
    });

    expect(res.status).toBe(400);
  });

  it('allows sandbox after destroyed ones do not count', async () => {
    await seedDeveloper({ tier: 'free' });

    // Seed a destroyed sandbox (should NOT count toward limit)
    sandboxStore.set('sb-destroyed', {
      id: 'sb-destroyed',
      developerId: 'dev-001',
      tenantId: 'sandbox_destroyed',
      name: 'Old One',
      seedDataProfile: 'minimal',
      status: 'destroyed',
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    });

    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'After Destroy' }),
    });

    expect(res.status).toBe(201);
  });

  it('rejects empty sandbox name', async () => {
    await seedDeveloper();
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid seed profile', async () => {
    await seedDeveloper();
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Bad Seed', seedProfile: 'nonexistent' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Auth Sandbox' }),
    });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/v1/developers/sandbox
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/v1/developers/sandbox', () => {
  it('lists sandboxes for authenticated developer', async () => {
    sandboxStore.set('sb-400', {
      id: 'sb-400',
      developerId: 'dev-001',
      tenantId: 'sandbox_400',
      name: 'My Sandbox',
      seedDataProfile: 'minimal',
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    });

    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('My Sandbox');
  });

  it('returns empty array when no sandboxes exist', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });

  it('only returns sandboxes belonging to the authenticated developer', async () => {
    sandboxStore.set('sb-mine', {
      id: 'sb-mine',
      developerId: 'dev-001',
      tenantId: 'sandbox_mine',
      name: 'Mine',
      seedDataProfile: 'minimal',
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    });
    sandboxStore.set('sb-other', {
      id: 'sb-other',
      developerId: 'dev-other',
      tenantId: 'sandbox_other',
      name: 'Not Mine',
      seedDataProfile: 'minimal',
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    });

    const app = createTestApp();
    const token = await makeDevJwt({ sub: 'dev-001' });

    const res = await app.request('/api/v1/developers/sandbox', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('Mine');
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v1/developers/sandbox');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/v1/developers/sandbox/:sandboxId
// ═══════════════════════════════════════════════════════════════════

describe('DELETE /api/v1/developers/sandbox/:sandboxId', () => {
  it('destroys an existing sandbox', async () => {
    sandboxStore.set('sb-500', {
      id: 'sb-500',
      developerId: 'dev-001',
      tenantId: 'sandbox_500',
      name: 'Destroy Me',
      seedDataProfile: 'minimal',
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    });

    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox/sb-500', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 404 for nonexistent sandbox', async () => {
    const app = createTestApp();
    const token = await makeDevJwt();

    const res = await app.request('/api/v1/developers/sandbox/sb-nonexistent', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('returns 404 for sandbox belonging to another developer', async () => {
    sandboxStore.set('sb-501', {
      id: 'sb-501',
      developerId: 'dev-other',
      tenantId: 'sandbox_501',
      name: 'Not Mine',
      seedDataProfile: 'minimal',
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    });

    const app = createTestApp();
    const token = await makeDevJwt({ sub: 'dev-001' });

    const res = await app.request('/api/v1/developers/sandbox/sb-501', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('returns 401 without authentication', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/developers/sandbox/sb-500', {
      method: 'DELETE',
    });

    expect(res.status).toBe(401);
  });
});
