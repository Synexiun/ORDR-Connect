import { describe, it, expect } from 'vitest';
import { LimbIdentity } from '../identity.js';

const TEST_LIMB_ID = 'test-limb-001';

describe('LimbIdentity', () => {
  describe('generate()', () => {
    it('produces a valid identity and non-empty private key hex', async () => {
      const { identity, privateKeyHex } = await LimbIdentity.generate(TEST_LIMB_ID);
      expect(identity.limbId).toBe(TEST_LIMB_ID);
      expect(privateKeyHex).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(identity.publicKeyHex).toHaveLength(64);
    });

    it('generates a different keypair each time', async () => {
      const { privateKeyHex: k1 } = await LimbIdentity.generate(TEST_LIMB_ID);
      const { privateKeyHex: k2 } = await LimbIdentity.generate(TEST_LIMB_ID);
      expect(k1).not.toBe(k2);
    });
  });

  describe('fromHex()', () => {
    it('round-trips through privateKeyHex', async () => {
      const { identity: original, privateKeyHex } = await LimbIdentity.generate(TEST_LIMB_ID);
      const restored = await LimbIdentity.fromHex(TEST_LIMB_ID, privateKeyHex);
      expect(restored.publicKeyHex).toBe(original.publicKeyHex);
      expect(restored.limbId).toBe(TEST_LIMB_ID);
    });

    it('throws on a key that is too short', async () => {
      await expect(LimbIdentity.fromHex(TEST_LIMB_ID, 'deadbeef')).rejects.toThrow(
        'Invalid Ed25519 private key',
      );
    });

    it('throws on a key that is too long', async () => {
      const tooLong = 'a'.repeat(66);
      await expect(LimbIdentity.fromHex(TEST_LIMB_ID, tooLong)).rejects.toThrow(
        'Invalid Ed25519 private key',
      );
    });
  });

  describe('signRequest()', () => {
    it('returns the three required headers', async () => {
      const { identity } = await LimbIdentity.generate(TEST_LIMB_ID);
      const headers = await identity.signRequest();
      expect(headers['X-Synex-Limb-Id']).toBe(TEST_LIMB_ID);
      expect(headers['X-Synex-Timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(headers['X-Synex-Signature']).toHaveLength(128); // 64 bytes = 128 hex chars
    });

    it('produces different signatures each call (fresh timestamp)', async () => {
      const { identity } = await LimbIdentity.generate(TEST_LIMB_ID);
      const h1 = await identity.signRequest();
      const h2 = await identity.signRequest();
      // Timestamps may collide within the same millisecond in very fast test runs
      // — only assert signature differs if timestamps differ
      if (h1['X-Synex-Timestamp'] !== h2['X-Synex-Timestamp']) {
        expect(h1['X-Synex-Signature']).not.toBe(h2['X-Synex-Signature']);
      }
    });
  });

  describe('verifyCoreSignature()', () => {
    it('verifies a valid signature', async () => {
      const { identity, privateKeyHex } = await LimbIdentity.generate(TEST_LIMB_ID);
      const headers = await identity.signRequest();
      const message = new TextEncoder().encode(`${TEST_LIMB_ID}:${headers['X-Synex-Timestamp']}`);
      const valid = await LimbIdentity.verifyCoreSignature(
        identity.publicKeyHex,
        message,
        headers['X-Synex-Signature'],
      );
      expect(valid).toBe(true);
      // Suppress unused warning — privateKeyHex is generated but we only use publicKeyHex
      expect(privateKeyHex).toHaveLength(64);
    });

    it('rejects a tampered signature', async () => {
      const { identity } = await LimbIdentity.generate(TEST_LIMB_ID);
      const headers = await identity.signRequest();
      const message = new TextEncoder().encode(`${TEST_LIMB_ID}:${headers['X-Synex-Timestamp']}`);
      const tampered = headers['X-Synex-Signature'].replace(/^.{4}/, 'ffff');
      const valid = await LimbIdentity.verifyCoreSignature(
        identity.publicKeyHex,
        message,
        tampered,
      );
      expect(valid).toBe(false);
    });

    it('returns false for wrong key length', async () => {
      const message = new TextEncoder().encode('test');
      const valid = await LimbIdentity.verifyCoreSignature('abcd', message, 'ef'.repeat(64));
      expect(valid).toBe(false);
    });
  });

  describe('isTimestampFresh()', () => {
    it('accepts a timestamp from right now', () => {
      expect(LimbIdentity.isTimestampFresh(new Date().toISOString())).toBe(true);
    });

    it('rejects a timestamp from 10 minutes ago', () => {
      const old = new Date(Date.now() - 10 * 60 * 1_000).toISOString();
      expect(LimbIdentity.isTimestampFresh(old)).toBe(false);
    });

    it('rejects a timestamp 10 minutes in the future', () => {
      const future = new Date(Date.now() + 10 * 60 * 1_000).toISOString();
      expect(LimbIdentity.isTimestampFresh(future)).toBe(false);
    });
  });
});
