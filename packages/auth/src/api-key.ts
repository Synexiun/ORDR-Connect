/**
 * API Key Authentication — prefixed, hashed, time-bounded keys
 *
 * SOC2 CC6.1 — API key management and lifecycle.
 * ISO 27001 A.9.4.2 — Secure access control for system integrations.
 *
 * Key format: `ordr_` + 32-byte base64url random value
 * Storage: SHA-256 hash only — raw key shown once at creation, never stored.
 * Lookup: First 12 characters serve as a non-secret prefix for efficient DB queries.
 */

import type { Permission } from '@ordr/core';
import { hashApiKey, timingSafeEqual, generateApiKey, randomUUID } from '@ordr/crypto';

// ─── Constants ─────────────────────────────────────────────────────

const KEY_PREFIX_LENGTH = 12;

// ─── Types ─────────────────────────────────────────────────────────

export interface ApiKeyCreateResult {
  /** Full API key — shown once to the user, never stored */
  readonly key: string;
  /** SHA-256 hash of the full key — stored in the database */
  readonly keyHash: string;
  /** First 12 characters of the key — stored for efficient lookup */
  readonly keyPrefix: string;
  /** Unique identifier for this API key record */
  readonly keyId: string;
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly permissions: readonly Permission[];
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

// ─── API Key Operations ────────────────────────────────────────────

/**
 * Creates a new API key with the `ordr_` prefix.
 *
 * The raw key is returned once and must be displayed to the user immediately.
 * Only the SHA-256 hash and prefix are stored for verification and lookup.
 *
 * @param tenantId - Owning tenant
 * @param userId - User who created the key
 * @param name - Human-readable key name (e.g., "Production Webhook")
 * @param permissions - Scoped permissions granted to this key
 * @param expiresAt - Optional expiration date (null = no expiration)
 * @returns Full key (show once), hash (store), prefix (for lookup)
 */
export function createApiKey(
  _tenantId: string,
  _userId: string,
  _name: string,
  _permissions: readonly Permission[],
  _expiresAt?: Date | null,
): ApiKeyCreateResult {
  const key = generateApiKey();
  const keyHash = hashApiKey(key);
  const keyPrefix = extractApiKeyPrefix(key);
  const keyId = randomUUID();

  return { key, keyHash, keyPrefix, keyId };
}

/**
 * Verifies an API key against its stored SHA-256 hash.
 *
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param key - Raw API key from the request header
 * @param storedHash - SHA-256 hash from the database
 * @returns true if the key matches the stored hash
 */
export function verifyApiKey(key: string, storedHash: string): boolean {
  const computedHash = hashApiKey(key);
  return timingSafeEqual(computedHash, storedHash);
}

/**
 * Extracts the lookup prefix from an API key.
 *
 * The prefix is the first 12 characters (e.g., "ordr_abc123d") and is
 * stored alongside the hash to enable efficient database lookups without
 * scanning all key hashes.
 *
 * @param key - Full API key string
 * @returns First 12 characters of the key
 */
export function extractApiKeyPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX_LENGTH);
}

/**
 * Checks whether an API key has expired.
 *
 * Keys with a null expiresAt never expire. Otherwise, the key is expired
 * if the current time is past the expiration date.
 *
 * @param expiresAt - Expiration date or null (no expiration)
 * @returns true if the key is expired
 */
export function isApiKeyExpired(expiresAt: Date | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  return Date.now() > expiresAt.getTime();
}
