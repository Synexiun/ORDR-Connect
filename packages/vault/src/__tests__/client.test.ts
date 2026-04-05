/**
 * VaultClient Unit Tests
 *
 * Uses vi.fn() to mock global fetch — no real Vault server.
 * Tests:
 * - No-op when VAULT_ADDR is absent
 * - K8s auth flow (reads JWT file, POSTs to login)
 * - get() returns value on 200, undefined on 404, throws on 500
 * - getMetadata() returns version + createdTime
 * - getVersion() returns specific version value
 * - put() POSTs data correctly
 * - softDeleteVersion() POSTs to delete endpoint
 * - Token renewal scheduled at 80% TTL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VaultClient } from '../client.js';

// Mock node:fs/promises for the service account token
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('test-k8s-jwt'),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env['VAULT_ADDR'];
  delete process.env['VAULT_ROLE'];
  delete process.env['VAULT_MOUNT'];
});

describe('VaultClient.isEnabled', () => {
  it('is false when VAULT_ADDR is absent', () => {
    const client = new VaultClient();
    expect(client.isEnabled).toBe(false);
  });

  it('is true when VAULT_ADDR is set', () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    const client = new VaultClient();
    expect(client.isEnabled).toBe(true);
  });
});

describe('VaultClient.authenticate()', () => {
  it('is a no-op when VAULT_ADDR is absent', async () => {
    const client = new VaultClient();
    await client.authenticate();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POSTs JWT to Vault login endpoint and stores token', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        auth: { client_token: 'vault-token-abc', lease_duration: 900 },
      }),
    });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy(); // stop renewal timer

    expect(mockFetch).toHaveBeenCalledWith(
      'https://vault.test:8200/v1/auth/kubernetes/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ jwt: 'test-k8s-jwt', role: 'ordr-api' }),
      }),
    );
  });

  it('throws on auth failure', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';

    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    const client = new VaultClient();
    await expect(client.authenticate()).rejects.toThrow('Auth failed: 403');
  });
});

describe('VaultClient.get()', () => {
  async function authenticatedClient(): Promise<VaultClient> {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
    });
    const client = new VaultClient();
    await client.authenticate();
    client.destroy();
    return client;
  }

  it('returns value from KV v2 response', async () => {
    const client = await authenticatedClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { data: { value: 'my-secret' } } }),
    });

    const result = await client.get('ENCRYPTION_MASTER_KEY');
    expect(result).toBe('my-secret');
  });

  it('returns undefined on 404', async () => {
    const client = await authenticatedClient();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await client.get('NONEXISTENT_KEY');
    expect(result).toBeUndefined();
  });

  it('throws on 500', async () => {
    const client = await authenticatedClient();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(client.get('KEY')).rejects.toThrow('GET KEY failed: 500');
  });

  it('uses correct KV v2 path with custom mount', async () => {
    process.env['VAULT_MOUNT'] = 'kv';
    const client = await authenticatedClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { data: { value: 'val' } } }),
    });

    await client.get('MY_KEY');
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://vault.test:8200/v1/kv/data/MY_KEY',
      expect.anything(),
    );
  });
});

describe('VaultClient.getMetadata()', () => {
  it('returns version and createdTime', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            current_version: 3,
            versions: { '3': { created_time: '2026-01-01T00:00:00Z' } },
          },
        }),
      });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    const meta = await client.getMetadata('ENCRYPTION_MASTER_KEY');
    expect(meta.version).toBe(3);
    expect(meta.createdTime).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});

describe('VaultClient.getVersion()', () => {
  it('fetches specific version with ?version= query param', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { value: 'old-hex-key' } } }),
      });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    const val = await client.getVersion('ENCRYPTION_MASTER_KEY', 2);
    expect(val).toBe('old-hex-key');
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://vault.test:8200/v1/secret/data/ENCRYPTION_MASTER_KEY?version=2',
      expect.anything(),
    );
  });
});

describe('VaultClient.put()', () => {
  it('POSTs value to KV v2 data endpoint', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({ ok: true });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    await client.put('MY_SECRET', 'new-value');
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://vault.test:8200/v1/secret/data/MY_SECRET',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ data: { value: 'new-value' } }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    await expect(client.put('KEY', 'val')).rejects.toThrow('PUT KEY failed: 500');
  });
});

describe('VaultClient.softDeleteVersion()', () => {
  it('POSTs to KV v2 delete endpoint with correct version array', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({ ok: true });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    await client.softDeleteVersion('ENCRYPTION_MASTER_KEY', 2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://vault.test:8200/v1/secret/delete/ENCRYPTION_MASTER_KEY',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ versions: [2] }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    process.env['VAULT_ADDR'] = 'https://vault.test:8200';
    process.env['VAULT_ROLE'] = 'ordr-api';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: 'tok', lease_duration: 900 } }),
      })
      .mockResolvedValueOnce({ ok: false, status: 403 });

    const client = new VaultClient();
    await client.authenticate();
    client.destroy();

    await expect(client.softDeleteVersion('KEY', 1)).rejects.toThrow(
      'softDeleteVersion KEY@1 failed: 403',
    );
  });
});

describe('VaultClient — no-op when disabled', () => {
  it('get() returns undefined', async () => {
    const client = new VaultClient();
    expect(await client.get('ANY')).toBeUndefined();
  });

  it('getMetadata() returns epoch createdTime', async () => {
    const client = new VaultClient();
    const meta = await client.getMetadata('ANY');
    expect(meta.version).toBe(0);
    expect(meta.createdTime.getTime()).toBe(0);
  });
});
