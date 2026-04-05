/**
 * SecretStore Unit Tests
 *
 * Tests:
 * - init() populates from Vault when client is enabled
 * - init() falls back to process.env when Vault returns undefined
 * - get() returns in-memory value synchronously
 * - onRotate() callback fires when polling detects new version
 * - Polling does NOT fire callback when version is unchanged
 * - No-op polling when client is disabled
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reset module registry between tests so the singleton starts fresh
beforeEach(async () => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env['VAULT_POLL_INTERVAL_MS'];
  delete process.env['MY_KEY'];
});

function makeMockClient(enabled: boolean, values: Record<string, string> = {}) {
  return {
    isEnabled: enabled,
    get: vi.fn(async (path: string) => values[path]),
    getMetadata: vi.fn(async (_path: string) => ({
      version: 1,
      createdTime: new Date(),
    })),
  };
}

describe('initSecretStore + get()', () => {
  it('populates from Vault when client is enabled', async () => {
    const { initSecretStore, secretStore } = await import('../secret-store.js');
    const client = makeMockClient(true, { MY_KEY: 'vault-value' });

    await initSecretStore(client as never, ['MY_KEY']);
    secretStore.destroy();

    expect(secretStore.get('MY_KEY')).toBe('vault-value');
  });

  it('falls back to process.env when Vault returns undefined', async () => {
    process.env['MY_KEY'] = 'env-value';
    const { initSecretStore, secretStore } = await import('../secret-store.js');
    const client = makeMockClient(true, {}); // Vault returns undefined

    await initSecretStore(client as never, ['MY_KEY']);
    secretStore.destroy();

    expect(secretStore.get('MY_KEY')).toBe('env-value');
  });

  it('falls back to process.env when client is disabled', async () => {
    process.env['MY_KEY'] = 'env-only';
    const { initSecretStore, secretStore } = await import('../secret-store.js');
    const client = makeMockClient(false);

    await initSecretStore(client as never, ['MY_KEY']);
    secretStore.destroy();

    expect(secretStore.get('MY_KEY')).toBe('env-only');
  });

  it('does not start polling when client is disabled', async () => {
    const { initSecretStore, secretStore } = await import('../secret-store.js');
    const client = makeMockClient(false);

    await initSecretStore(client as never, ['MY_KEY']);
    secretStore.destroy();

    // getMetadata should not be called after init (no poll scheduled)
    expect(client.getMetadata).not.toHaveBeenCalled();
  });
});

describe('onRotate()', () => {
  it('fires callback when polling detects new version', async () => {
    vi.useFakeTimers();
    process.env['VAULT_POLL_INTERVAL_MS'] = '1000';

    const { initSecretStore, secretStore } = await import('../secret-store.js');

    // First call: version=1, second call: version=2 (simulates rotation)
    const mockClient = {
      isEnabled: true,
      get: vi.fn().mockResolvedValueOnce('old-val').mockResolvedValue('new-val'),
      getMetadata: vi
        .fn()
        .mockResolvedValueOnce({ version: 1, createdTime: new Date() })
        .mockResolvedValue({ version: 2, createdTime: new Date() }),
    };

    await initSecretStore(mockClient as never, ['MY_KEY']);

    const cb = vi.fn();
    secretStore.onRotate('MY_KEY', cb);

    // Advance timer to trigger one poll cycle
    await vi.advanceTimersByTimeAsync(1001);

    secretStore.destroy();
    vi.useRealTimers();

    expect(cb).toHaveBeenCalledWith('new-val');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire callback when version is unchanged', async () => {
    vi.useFakeTimers();
    process.env['VAULT_POLL_INTERVAL_MS'] = '1000';

    const { initSecretStore, secretStore } = await import('../secret-store.js');

    const mockClient = {
      isEnabled: true,
      get: vi.fn().mockResolvedValue('same-val'),
      getMetadata: vi.fn().mockResolvedValue({ version: 1, createdTime: new Date() }),
    };

    await initSecretStore(mockClient as never, ['MY_KEY']);

    const cb = vi.fn();
    secretStore.onRotate('MY_KEY', cb);

    await vi.advanceTimersByTimeAsync(2001); // Two poll cycles

    secretStore.destroy();
    vi.useRealTimers();

    expect(cb).not.toHaveBeenCalled();
  });
});
