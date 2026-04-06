/**
 * WorkOS Directory Sync Webhook Route Tests
 *
 * Verifies:
 * - HMAC-SHA256 signature validation (timing-safe)
 * - Idempotency guard (duplicate workos_id → 200 skipped)
 * - Tenant resolution via directory_id
 * - Event dispatch to SCIMHandler via normaliseWorkOSEvent
 *
 * SECURITY: Webhook routes do NOT use JWT auth — they use HMAC-SHA256 signature validation.
 */

import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
import { Hono } from 'hono';
import { createWorkOSWebhookRouter } from '../routes/webhooks-workos.js';

const WEBHOOK_SECRET = 'test-webhook-secret-32-bytes-padded';

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

// ─── Mock factory ─────────────────────────────────────────────────

function makeFreshDb(overrides?: { existingRows?: unknown[] }) {
  const rows = overrides?.existingRows ?? [];
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
  } as never;
}

function makeTokenStore(tenantId: string | null = 'tenant-001') {
  return {
    findByToken: vi.fn().mockResolvedValue(null),
    findByDirectoryId: vi.fn().mockResolvedValue(tenantId !== null ? { tenantId } : null),
  } as never;
}

function makeHandler() {
  return {
    createUser: vi.fn().mockResolvedValue({
      id: 'u1',
      userName: 'alice@example.com',
      displayName: 'Alice',
      emails: [],
      active: true,
      externalId: null,
      externalSource: null,
      tenantId: 'tenant-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getUserByExternalId: vi.fn().mockResolvedValue(null),
    getUserByUserName: vi.fn().mockResolvedValue(null),
    updateUser: vi.fn().mockResolvedValue(null),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    createGroup: vi.fn().mockResolvedValue({
      id: 'g1',
      displayName: 'Eng',
      members: [],
      memberCount: 0,
      externalId: null,
      externalSource: null,
      tenantId: 'tenant-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getGroupByExternalId: vi.fn().mockResolvedValue(null),
    patchGroup: vi.fn().mockResolvedValue(null),
    deleteGroup: vi.fn().mockResolvedValue(undefined),
  } as never;
}

function makeApp(db = makeFreshDb(), tokenStore = makeTokenStore(), handler = makeHandler()) {
  const app = new Hono();
  app.route(
    '/',
    createWorkOSWebhookRouter({ webhookSecret: WEBHOOK_SECRET, handler, tokenStore, db }),
  );
  return app;
}

// ─── Test payloads ────────────────────────────────────────────────

const userCreatedBody = JSON.stringify({
  id: 'evt_1',
  event: 'dsync.user.created',
  directory_id: 'dir_123',
  data: { id: 'wu1', username: 'alice@example.com', emails: [], state: 'active' },
});

const missingDirBody = JSON.stringify({
  id: 'evt_no_dir',
  event: 'dsync.user.created',
  data: { id: 'wu2' },
});

// ─── Tests ────────────────────────────────────────────────────────

describe('POST /webhooks/workos — HMAC auth', () => {
  it('returns 401 when x-workos-signature header is missing', async () => {
    const app = makeApp();
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: userCreatedBody,
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Missing signature');
  });

  it('returns 401 when signature is wrong hex', async () => {
    const app = makeApp();
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workos-signature': 'not-hex-at-all!@#$',
      },
      body: userCreatedBody,
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is invalid (correct hex format, wrong value)', async () => {
    const app = makeApp();
    const wrongSig = 'a'.repeat(64); // valid 64-char hex, wrong value
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workos-signature': wrongSig,
      },
      body: userCreatedBody,
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Invalid signature');
  });

  it('returns 200 with valid signature (dsync.user.created event)', async () => {
    const app = makeApp();
    const sig = sign(userCreatedBody);
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workos-signature': sig,
      },
      body: userCreatedBody,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });
});

describe('POST /webhooks/workos — idempotency', () => {
  it('returns 200 with {skipped: "duplicate"} when workos_id already in DB', async () => {
    const db = makeFreshDb({ existingRows: [{ workosId: 'evt_1' }] });
    const app = makeApp(db);
    const sig = sign(userCreatedBody);
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workos-signature': sig,
      },
      body: userCreatedBody,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skipped: string };
    expect(json.skipped).toBe('duplicate');
  });
});

describe('POST /webhooks/workos — tenant resolution', () => {
  it('returns 422 when directory_id is missing from event', async () => {
    const app = makeApp();
    const sig = sign(missingDirBody);
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workos-signature': sig,
      },
      body: missingDirBody,
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Unknown directory');
  });

  it('returns 422 when directory_id does not resolve to a tenant', async () => {
    const tokenStore = makeTokenStore(null); // no tenant found
    const app = makeApp(makeFreshDb(), tokenStore);
    const sig = sign(userCreatedBody);
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workos-signature': sig,
      },
      body: userCreatedBody,
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Unknown directory');
  });
});

describe('POST /webhooks/workos — event dispatch', () => {
  it('dispatches dsync.user.created to handler.createUser', async () => {
    const createUser = vi.fn().mockResolvedValue({
      id: 'u1',
      userName: 'alice@example.com',
      displayName: 'Alice',
      emails: [],
      active: true,
      externalId: null,
      externalSource: null,
      tenantId: 'tenant-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const handler = {
      createUser,
      getUserByExternalId: vi.fn().mockResolvedValue(null),
      getUserByUserName: vi.fn().mockResolvedValue(null),
      updateUser: vi.fn().mockResolvedValue(null),
      deleteUser: vi.fn().mockResolvedValue(undefined),
      createGroup: vi.fn().mockResolvedValue(null),
      getGroupByExternalId: vi.fn().mockResolvedValue(null),
      patchGroup: vi.fn().mockResolvedValue(null),
      deleteGroup: vi.fn().mockResolvedValue(undefined),
    } as never;
    const app = makeApp(makeFreshDb(), makeTokenStore(), handler);
    const sig = sign(userCreatedBody);
    const res = await app.request('/webhooks/workos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workos-signature': sig,
      },
      body: userCreatedBody,
    });
    expect(res.status).toBe(200);
    expect(createUser).toHaveBeenCalledOnce();
    const [calledTenantId] = createUser.mock.calls[0] as [string, ...unknown[]];
    expect(calledTenantId).toBe('tenant-001');
  });
});
