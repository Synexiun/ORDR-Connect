/**
 * SecretStore — in-memory secret snapshot with polling-based hot-reload
 *
 * `initSecretStore()` reads all tracked keys from Vault at startup.
 * A background interval polls Vault for version changes and fires
 * `onRotate` callbacks when new versions are detected.
 *
 * When VAULT_ADDR is absent (dev/test), all values come from process.env.
 * This makes the store safe to use in tests without any Vault setup.
 *
 * Rule 5 — Automated rotation; zero-downtime secret refresh.
 */

import type { VaultClient } from './client.js';

type RotateCallback = (newValue: string) => void;

interface SecretSnapshot {
  value: string;
  version: number;
}

class SecretStoreImpl {
  private readonly snapshots = new Map<string, SecretSnapshot>();
  private readonly callbacks = new Map<string, RotateCallback[]>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private client: VaultClient | null = null;
  private trackedKeys: string[] = [];

  async init(client: VaultClient, keys: string[]): Promise<void> {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.client = client;
    this.trackedKeys = keys;

    for (const key of keys) {
      if (client.isEnabled) {
        const vaultValue = await client.get(key);
        const meta = await client.getMetadata(key).catch(() => ({ version: 0 }));
        this.snapshots.set(key, {
          value: vaultValue ?? process.env[key] ?? '',
          version: meta.version,
        });
      } else {
        this.snapshots.set(key, { value: process.env[key] ?? '', version: 0 });
      }
    }

    if (client.isEnabled) {
      const intervalMs = parseInt(process.env['VAULT_POLL_INTERVAL_MS'] ?? '60000', 10);
      this.pollTimer = setInterval(() => void this.poll(), intervalMs);
    }
  }

  private async poll(): Promise<void> {
    if (this.client === null) return;
    for (const key of this.trackedKeys) {
      try {
        const meta = await this.client.getMetadata(key);
        const current = this.snapshots.get(key);
        if (current !== undefined && meta.version > current.version) {
          const newValue = await this.client.get(key);
          if (newValue !== undefined) {
            this.snapshots.set(key, { value: newValue, version: meta.version });
            const cbs = this.callbacks.get(key) ?? [];
            for (const cb of cbs) cb(newValue);
          }
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            component: 'vault-secret-store',
            event: 'poll_error',
            key,
            error: err instanceof Error ? err.message : 'unknown',
          }),
        );
      }
    }
  }

  /** Synchronous read — always fast, never async. */
  get(key: string): string {
    return this.snapshots.get(key)?.value ?? process.env[key] ?? '';
  }

  /** Register a callback that fires whenever `key` is updated during polling. */
  onRotate(key: string, cb: RotateCallback): void {
    const existing = this.callbacks.get(key) ?? [];
    this.callbacks.set(key, [...existing, cb]);
  }

  /** Stop the polling interval. Call on process shutdown. */
  destroy(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export const secretStore = new SecretStoreImpl();

export async function initSecretStore(client: VaultClient, keys: string[]): Promise<void> {
  await secretStore.init(client, keys);
}
