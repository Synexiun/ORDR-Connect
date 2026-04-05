/**
 * KeyRotationTracker Unit Tests
 *
 * Tests:
 * - isApproachingExpiry: true at threshold, false one day before
 * - isApproachingExpiry: always false when client disabled
 * - requestNewVersion: generates 32-byte hex, calls client.put, returns version
 * - getVersion: delegates to client.getVersion
 * - markVersionInactive: calls client.softDeleteVersion
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyRotationTracker } from '../key-rotation-tracker.js';

afterEach(() => vi.clearAllMocks());

function makeMockClient(enabled: boolean) {
  return {
    isEnabled: enabled,
    get: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn(),
    getVersion: vi.fn().mockResolvedValue('old-hex-key'),
    softDeleteVersion: vi.fn().mockResolvedValue(undefined),
  };
}

describe('KeyRotationTracker.isApproachingExpiry()', () => {
  it('returns true when key age >= threshold', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);

    // Created 85 days ago — threshold is 80 days
    const createdTime = new Date(Date.now() - 85 * 24 * 60 * 60 * 1000);
    client.getMetadata.mockResolvedValue({ version: 1, createdTime });

    const result = await tracker.isApproachingExpiry(client as never, 'ENCRYPTION_MASTER_KEY', 80);
    expect(result).toBe(true);
  });

  it('returns false when key age < threshold', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);

    // Created 79 days ago — one day before the 80-day threshold
    const createdTime = new Date(Date.now() - 79 * 24 * 60 * 60 * 1000);
    client.getMetadata.mockResolvedValue({ version: 1, createdTime });

    const result = await tracker.isApproachingExpiry(client as never, 'ENCRYPTION_MASTER_KEY', 80);
    expect(result).toBe(false);
  });

  it('always returns false when client is disabled', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(false);

    const result = await tracker.isApproachingExpiry(client as never, 'ENCRYPTION_MASTER_KEY', 80);
    expect(result).toBe(false);
    expect(client.getMetadata).not.toHaveBeenCalled();
  });
});

describe('KeyRotationTracker.requestNewVersion()', () => {
  it('generates a 64-char hex value, puts it to Vault, returns new version', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);
    client.getMetadata.mockResolvedValue({ version: 2, createdTime: new Date() });

    const result = await tracker.requestNewVersion(client as never, 'ENCRYPTION_MASTER_KEY');

    // 32 bytes = 64 hex chars
    expect(result.value).toMatch(/^[0-9a-f]{64}$/);
    expect(result.version).toBe(2);
    expect(client.put).toHaveBeenCalledWith('ENCRYPTION_MASTER_KEY', result.value);
  });
});

describe('KeyRotationTracker.getVersion()', () => {
  it('delegates to client.getVersion', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);

    const val = await tracker.getVersion(client as never, 'ENCRYPTION_MASTER_KEY', 1);
    expect(val).toBe('old-hex-key');
    expect(client.getVersion).toHaveBeenCalledWith('ENCRYPTION_MASTER_KEY', 1);
  });
});

describe('KeyRotationTracker.markVersionInactive()', () => {
  it('calls client.softDeleteVersion with key and version', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(true);

    await tracker.markVersionInactive(client as never, 'ENCRYPTION_MASTER_KEY', 1);
    expect(client.softDeleteVersion).toHaveBeenCalledWith('ENCRYPTION_MASTER_KEY', 1);
  });

  it('is a no-op when client is disabled', async () => {
    const tracker = new KeyRotationTracker();
    const client = makeMockClient(false);

    await tracker.markVersionInactive(client as never, 'ENCRYPTION_MASTER_KEY', 1);
    expect(client.softDeleteVersion).not.toHaveBeenCalled();
  });
});
