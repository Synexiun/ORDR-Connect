/**
 * KeyRotationTracker — checks key age and orchestrates Vault version rotation
 *
 * Used by the worker re-wrap pipeline to:
 * 1. Determine when a KEK needs rotation (isApproachingExpiry)
 * 2. Generate and store a new KEK version in Vault (requestNewVersion)
 * 3. Retrieve an old KEK version for re-wrap (getVersion)
 * 4. Mark the old version as soft-deleted (markVersionInactive)
 *
 * Rule 1 — 90-day max key cycle; automated rotation triggered at 80 days.
 * Rule 3 — Old versions retained (soft-delete) for 7-year audit compliance.
 */

import { randomBytes } from 'node:crypto';
import type { VaultClient } from './client.js';

export class KeyRotationTracker {
  /**
   * Returns true if the current version of `key` was created >= thresholdDays ago.
   * Always returns false when client is disabled (dev/test mode).
   */
  async isApproachingExpiry(
    client: VaultClient,
    key: string,
    thresholdDays: number,
  ): Promise<boolean> {
    if (!client.isEnabled) return false;
    const meta = await client.getMetadata(key);
    const ageMs = Date.now() - meta.createdTime.getTime();
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    return ageMs >= thresholdMs;
  }

  /**
   * Generates a fresh 256-bit (32-byte) random KEK, stores it in Vault as
   * the next version, and returns the version number and hex-encoded value.
   */
  async requestNewVersion(
    client: VaultClient,
    key: string,
  ): Promise<{ version: number; value: string }> {
    const newValue = randomBytes(32).toString('hex');
    await client.put(key, newValue);
    const meta = await client.getMetadata(key);
    return { version: meta.version, value: newValue };
  }

  /** Retrieve a specific historical version of a secret. */
  async getVersion(client: VaultClient, key: string, version: number): Promise<string> {
    return client.getVersion(key, version);
  }

  /**
   * Soft-delete the specified version in Vault KV v2.
   * Data is NOT destroyed — retained for 7-year audit compliance (Rule 3).
   */
  async markVersionInactive(client: VaultClient, key: string, version: number): Promise<void> {
    if (!client.isEnabled) return;
    await client.softDeleteVersion(key, version);
  }
}
