/**
 * NonceStore tests
 *
 * Verifies:
 * - InMemoryNonceStore: mark+check, replay detection, expiry, purge
 * - RedisNonceStore: checkAndMark atomicity contract (mock Redis)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryNonceStore, RedisNonceStore } from '../nonce-store.js';
import type { RedisLikeNonceClient } from '../nonce-store.js';

// ─── InMemoryNonceStore ───────────────────────────────────────────────────────

describe('InMemoryNonceStore', () => {
  let store: InMemoryNonceStore;

  beforeEach(() => {
    store = new InMemoryNonceStore(0); // disable auto-purge in tests
  });

  afterEach(() => {
    store.stopAutoPurge();
  });

  it('returns false for a JTI that has never been seen', async () => {
    await expect(store.hasBeenUsed('jti-new-001')).resolves.toBe(false);
  });

  it('returns true after markUsed is called', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await store.markUsed('jti-abc', expiresAt);
    await expect(store.hasBeenUsed('jti-abc')).resolves.toBe(true);
  });

  it('detects replay: same JTI marked twice returns true on second hasBeenUsed', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await store.markUsed('jti-replay', expiresAt);
    // Second check: should detect it was already seen
    await expect(store.hasBeenUsed('jti-replay')).resolves.toBe(true);
  });

  it('returns false for JTI after expiry', async () => {
    const expiresAt = new Date(Date.now() - 1); // already expired
    await store.markUsed('jti-expired', expiresAt);
    await expect(store.hasBeenUsed('jti-expired')).resolves.toBe(false);
  });

  it('purgeExpired removes expired entries', async () => {
    const expired = new Date(Date.now() - 1000);
    const valid = new Date(Date.now() + 60_000);

    await store.markUsed('jti-old', expired);
    await store.markUsed('jti-new', valid);

    await store.purgeExpired();

    expect(store.size).toBe(1);
    await expect(store.hasBeenUsed('jti-old')).resolves.toBe(false);
    await expect(store.hasBeenUsed('jti-new')).resolves.toBe(true);
  });

  it('different JTIs are independent', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await store.markUsed('jti-x', expiresAt);

    await expect(store.hasBeenUsed('jti-x')).resolves.toBe(true);
    await expect(store.hasBeenUsed('jti-y')).resolves.toBe(false);
    await expect(store.hasBeenUsed('jti-z')).resolves.toBe(false);
  });

  it('size reflects stored entries', async () => {
    expect(store.size).toBe(0);
    await store.markUsed('jti-1', new Date(Date.now() + 60_000));
    await store.markUsed('jti-2', new Date(Date.now() + 60_000));
    expect(store.size).toBe(2);
  });

  it('stopAutoPurge does not throw', () => {
    const s = new InMemoryNonceStore(5000);
    expect(() => s.stopAutoPurge()).not.toThrow();
    s.stopAutoPurge(); // double-stop is safe
  });
});

// ─── RedisNonceStore ──────────────────────────────────────────────────────────

describe('RedisNonceStore', () => {
  function makeMockRedis(initialSeen = false): RedisLikeNonceClient {
    const seen = new Set<string>();
    if (initialSeen) seen.add('ordr:nonce:jti-pre');
    return {
      async set(key, _value, _expiryMode, _ttl, setMode) {
        if (setMode === 'NX') {
          if (seen.has(key)) return null; // already exists
          seen.add(key);
          return 'OK';
        }
        seen.add(key);
        return 'OK';
      },
    };
  }

  it('checkAndMark returns false (not a replay) for new JTI', async () => {
    const redis = makeMockRedis();
    const store = new RedisNonceStore(redis);
    const expiresAt = new Date(Date.now() + 900_000);
    await expect(store.checkAndMark('jti-new', expiresAt)).resolves.toBe(false);
  });

  it('checkAndMark returns true (replay) for already-used JTI', async () => {
    const redis = makeMockRedis();
    const store = new RedisNonceStore(redis);
    const expiresAt = new Date(Date.now() + 900_000);

    await store.checkAndMark('jti-dup', expiresAt);
    // Second call: Redis SET NX returns null → replay
    await expect(store.checkAndMark('jti-dup', expiresAt)).resolves.toBe(true);
  });

  it('markUsed does not throw', async () => {
    const redis = makeMockRedis();
    const store = new RedisNonceStore(redis);
    const expiresAt = new Date(Date.now() + 60_000);
    await expect(store.markUsed('jti-mark', expiresAt)).resolves.toBeUndefined();
  });

  it('purgeExpired resolves without error', async () => {
    const redis = makeMockRedis();
    const store = new RedisNonceStore(redis);
    await expect(store.purgeExpired()).resolves.toBeUndefined();
  });

  it('uses custom key prefix', async () => {
    let capturedKey = '';
    const redis: RedisLikeNonceClient = {
      async set(key, _v, _e, _t, _m) {
        capturedKey = key;
        return 'OK';
      },
    };
    const store = new RedisNonceStore(redis, 'custom:prefix:');
    await store.markUsed('jti-abc', new Date(Date.now() + 60_000));
    expect(capturedKey).toBe('custom:prefix:jti-abc');
  });
});
