/**
 * EnvelopeEncryption tests
 *
 * Verifies:
 * - encrypt() returns all required envelope fields
 * - decrypt() round-trips correctly (Buffer and string variants)
 * - Each encrypt() call produces a unique IV and ciphertext
 * - Constructor rejects keys that are not exactly 32 bytes
 * - decrypt() throws on authentication tag mismatch (tampered ciphertext)
 * - decrypt() throws on tampered wrapped DEK
 * - rewrap() produces decryptable envelope with new KEK
 * - rewrap() does NOT change ciphertext (only re-wraps DEK)
 * - keyVersion propagates through rewrap
 * - algorithm field is always 'AES-256-GCM-ENVELOPE'
 * - Empty string round-trips
 * - Binary data round-trips
 */

import { describe, it, expect } from 'vitest';
import { EnvelopeEncryption } from '../envelope.js';

// 32-byte (256-bit) test KEKs
const KEK_V1 = Buffer.alloc(32, 0xaa);
const KEK_V2 = Buffer.alloc(32, 0xbb);

describe('EnvelopeEncryption — constructor', () => {
  it('accepts a 32-byte Buffer KEK', () => {
    expect(() => new EnvelopeEncryption(KEK_V1)).not.toThrow();
  });

  it('accepts a 64-char hex string KEK', () => {
    const hexKey = 'aa'.repeat(32);
    expect(() => new EnvelopeEncryption(hexKey)).not.toThrow();
  });

  it('throws when KEK is shorter than 32 bytes', () => {
    expect(() => new EnvelopeEncryption(Buffer.alloc(16))).toThrow('32');
  });

  it('throws when KEK is longer than 32 bytes', () => {
    expect(() => new EnvelopeEncryption(Buffer.alloc(64))).toThrow('32');
  });
});

describe('EnvelopeEncryption — encrypt()', () => {
  const enc = new EnvelopeEncryption(KEK_V1, 'v1');

  it('returns all required envelope fields', () => {
    const envelope = enc.encrypt('hello world');
    expect(envelope).toHaveProperty('wrappedDek');
    expect(envelope).toHaveProperty('ciphertext');
    expect(envelope).toHaveProperty('iv');
    expect(envelope).toHaveProperty('authTag');
    expect(envelope).toHaveProperty('dekIv');
    expect(envelope).toHaveProperty('dekAuthTag');
    expect(envelope).toHaveProperty('keyVersion');
    expect(envelope).toHaveProperty('algorithm');
  });

  it('algorithm is always AES-256-GCM-ENVELOPE', () => {
    const envelope = enc.encrypt('test');
    expect(envelope.algorithm).toBe('AES-256-GCM-ENVELOPE');
  });

  it('keyVersion matches constructor argument', () => {
    const envelope = enc.encrypt('test');
    expect(envelope.keyVersion).toBe('v1');
  });

  it('uses default keyVersion "v1" when not specified', () => {
    const enc2 = new EnvelopeEncryption(KEK_V1);
    const envelope = enc2.encrypt('test');
    expect(envelope.keyVersion).toBe('v1');
  });

  it('successive calls produce different IVs', () => {
    const e1 = enc.encrypt('same plaintext');
    const e2 = enc.encrypt('same plaintext');
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.dekIv).not.toBe(e2.dekIv);
  });

  it('successive calls produce different ciphertexts', () => {
    const e1 = enc.encrypt('same plaintext');
    const e2 = enc.encrypt('same plaintext');
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
  });

  it('iv, dekIv, authTag, dekAuthTag are valid base64', () => {
    const envelope = enc.encrypt('test');
    for (const field of ['iv', 'dekIv', 'authTag', 'dekAuthTag', 'wrappedDek', 'ciphertext']) {
      const value = (envelope as Record<string, string>)[field];
      expect(() => Buffer.from(value!, 'base64')).not.toThrow();
    }
  });
});

describe('EnvelopeEncryption — decrypt()', () => {
  const enc = new EnvelopeEncryption(KEK_V1, 'v1');

  it('round-trips a UTF-8 string', () => {
    const plaintext = 'Hello, ORDR-Connect!';
    const envelope = enc.encrypt(plaintext);
    expect(enc.decryptString(envelope)).toBe(plaintext);
  });

  it('round-trips an empty string', () => {
    const envelope = enc.encrypt('');
    expect(enc.decryptString(envelope)).toBe('');
  });

  it('round-trips a long string', () => {
    const plaintext = 'x'.repeat(10_000);
    const envelope = enc.encrypt(plaintext);
    expect(enc.decryptString(envelope)).toBe(plaintext);
  });

  it('round-trips binary data as Buffer', () => {
    const original = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x01, 0xfe]);
    const envelope = enc.encrypt(original);
    const decrypted = enc.decrypt(envelope);
    expect(decrypted.equals(original)).toBe(true);
  });

  it('round-trips JSON payload', () => {
    const payload = JSON.stringify({ ssn: '123-45-6789', dob: '1990-01-01', mrn: 'MRN-00123' });
    const envelope = enc.encrypt(payload);
    expect(enc.decryptString(envelope)).toBe(payload);
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const envelope = enc.encrypt('sensitive data');
    const tamperedCiphertext = Buffer.from(envelope.ciphertext, 'base64');
    tamperedCiphertext[0] ^= 0xff; // flip bits
    const tampered = { ...envelope, ciphertext: tamperedCiphertext.toString('base64') };
    expect(() => enc.decrypt(tampered)).toThrow();
  });

  it('throws on tampered auth tag', () => {
    const envelope = enc.encrypt('sensitive data');
    const tamperedAuthTag = Buffer.from(envelope.authTag, 'base64');
    tamperedAuthTag[0] ^= 0x01;
    const tampered = { ...envelope, authTag: tamperedAuthTag.toString('base64') };
    expect(() => enc.decrypt(tampered)).toThrow();
  });

  it('throws on tampered wrapped DEK', () => {
    const envelope = enc.encrypt('sensitive data');
    const tamperedDek = Buffer.from(envelope.wrappedDek, 'base64');
    tamperedDek[0] ^= 0xff;
    const tampered = { ...envelope, wrappedDek: tamperedDek.toString('base64') };
    expect(() => enc.decrypt(tampered)).toThrow();
  });

  it('throws on unknown algorithm', () => {
    const envelope = { ...enc.encrypt('x'), algorithm: 'UNKNOWN' as never };
    expect(() => enc.decrypt(envelope)).toThrow('unknown algorithm');
  });

  it('throws when decrypted with wrong KEK', () => {
    const envelope = enc.encrypt('secret');
    const wrongKekEnc = new EnvelopeEncryption(KEK_V2);
    expect(() => wrongKekEnc.decrypt(envelope)).toThrow();
  });
});

describe('EnvelopeEncryption — rewrap()', () => {
  it('rewrapped envelope decrypts correctly with new KEK', () => {
    const enc = new EnvelopeEncryption(KEK_V1, 'v1');
    const plaintext = 'PHI data: patient record 42';
    const original = enc.encrypt(plaintext);

    const rewrapped = enc.rewrap(original, KEK_V2, 'v2');
    const enc2 = new EnvelopeEncryption(KEK_V2, 'v2');
    expect(enc2.decryptString(rewrapped)).toBe(plaintext);
  });

  it('rewrapped envelope has updated keyVersion', () => {
    const enc = new EnvelopeEncryption(KEK_V1, 'v1');
    const rewrapped = enc.rewrap(enc.encrypt('data'), KEK_V2, 'v2');
    expect(rewrapped.keyVersion).toBe('v2');
  });

  it('rewrapped envelope has different dekIv from original', () => {
    const enc = new EnvelopeEncryption(KEK_V1, 'v1');
    const original = enc.encrypt('data');
    const rewrapped = enc.rewrap(original, KEK_V2, 'v2');
    expect(rewrapped.dekIv).not.toBe(original.dekIv);
  });

  it('rewrapped envelope preserves original ciphertext (data not re-encrypted)', () => {
    const enc = new EnvelopeEncryption(KEK_V1, 'v1');
    const original = enc.encrypt('data');
    const rewrapped = enc.rewrap(original, KEK_V2, 'v2');
    // The actual data ciphertext and its IV/authTag must be unchanged
    expect(rewrapped.ciphertext).toBe(original.ciphertext);
    expect(rewrapped.iv).toBe(original.iv);
    expect(rewrapped.authTag).toBe(original.authTag);
  });

  it('original KEK can no longer decrypt after rewrap', () => {
    const enc = new EnvelopeEncryption(KEK_V1, 'v1');
    const original = enc.encrypt('data');
    const rewrapped = enc.rewrap(original, KEK_V2, 'v2');
    // rewrapped uses new KEK — old KEK should fail
    expect(() => enc.decrypt(rewrapped)).toThrow();
  });
});
