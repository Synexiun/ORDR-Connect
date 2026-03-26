/**
 * Encryption Validation Security Tests
 *
 * Validates that all RESTRICTED fields are encrypted, correct algorithms
 * are used, key derivation follows HKDF-SHA256, and password hashing
 * uses Argon2id.
 *
 * HIPAA §164.312(a)(2)(iv), SOC2 CC6.1, ISO 27001 A.10.1.1
 */

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, encryptString, decryptString } from '@ordr/crypto';
import { FieldEncryptor } from '@ordr/crypto';
import { deriveKey, generateKeyPair, validateKeyLength } from '@ordr/crypto';
import { hashPassword, verifyPassword, validatePasswordStrength } from '@ordr/crypto';
import { sha256, hashApiKey, timingSafeEqual } from '@ordr/crypto';
import { randomBytes, randomToken, randomHex, randomUUID, generateApiKey } from '@ordr/crypto';

// ── AES-256-GCM Encryption ────────────────────────────────────────────

describe('AES-256-GCM encryption', () => {
  const key = randomBytes(32);

  it('encrypts and decrypts a string correctly', () => {
    const plaintext = 'patient-name: John Doe';
    const result = encrypt(plaintext, key);

    expect(result.ciphertext).toBeInstanceOf(Buffer);
    expect(result.iv).toBeInstanceOf(Buffer);
    expect(result.authTag).toBeInstanceOf(Buffer);
    expect(result.iv.length).toBe(12);
    expect(result.authTag.length).toBe(16);

    const decrypted = decrypt(result.ciphertext, key, result.iv, result.authTag);
    expect(decrypted.toString('utf8')).toBe(plaintext);
  });

  it('generates unique IV per encryption call', () => {
    const ivs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const result = encrypt('same plaintext', key);
      ivs.add(result.iv.toString('hex'));
    }
    // All IVs should be unique
    expect(ivs.size).toBe(100);
  });

  it('rejects wrong key for decryption', () => {
    const result = encrypt('secret data', key);
    const wrongKey = randomBytes(32);

    expect(() => {
      decrypt(result.ciphertext, wrongKey, result.iv, result.authTag);
    }).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const result = encrypt('sensitive data', key);
    const tampered = Buffer.from(result.ciphertext);
    tampered[0] = (tampered[0]! + 1) % 256;

    expect(() => {
      decrypt(tampered, key, result.iv, result.authTag);
    }).toThrow();
  });

  it('rejects tampered auth tag', () => {
    const result = encrypt('protected data', key);
    const tamperedTag = Buffer.from(result.authTag);
    tamperedTag[0] = (tamperedTag[0]! + 1) % 256;

    expect(() => {
      decrypt(result.ciphertext, key, result.iv, tamperedTag);
    }).toThrow();
  });

  it('rejects key shorter than 32 bytes', () => {
    expect(() => encrypt('test', randomBytes(16))).toThrow(/32-byte key/);
  });

  it('rejects key longer than 32 bytes', () => {
    expect(() => encrypt('test', randomBytes(48))).toThrow(/32-byte key/);
  });

  it('string encrypt/decrypt round-trips', () => {
    const plaintext = 'john.doe@example.com';
    const encrypted = encryptString(plaintext, key);
    const decrypted = decryptString(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypted string format is iv:authTag:ciphertext:keyVersion', () => {
    const encrypted = encryptString('test', key);
    const parts = encrypted.split(':');
    expect(parts.length).toBe(4);
    // Version should be a number
    expect(parseInt(parts[3]!, 10)).toBeGreaterThan(0);
  });
});

// ── Field-Level Encryption ────────────────────────────────────────────

describe('Field-level encryption with HKDF', () => {
  const masterKey = randomBytes(32);
  const encryptor = new FieldEncryptor(masterKey);

  it('encrypts and decrypts a field correctly', () => {
    const value = 'john.doe@healthcare.com';
    const encrypted = encryptor.encryptField('email', value);
    const decrypted = encryptor.decryptField('email', encrypted);
    expect(decrypted).toBe(value);
  });

  it('uses different derived keys for different fields', () => {
    const value = 'same-value';
    const emailEncrypted = encryptor.encryptField('email', value);
    const phoneEncrypted = encryptor.encryptField('phone', value);
    // Different fields produce different ciphertexts
    expect(emailEncrypted).not.toBe(phoneEncrypted);
  });

  it('cannot decrypt field with wrong field name', () => {
    const encrypted = encryptor.encryptField('email', 'test@test.com');
    expect(() => {
      encryptor.decryptField('phone', encrypted);
    }).toThrow();
  });

  it('encrypts object with specified fields', () => {
    const obj = {
      id: 'cust-001',
      name: 'John Doe',
      email: 'john@test.com',
      phone: '+1234567890',
      status: 'active',
    };
    const encrypted = encryptor.encryptObject(obj, ['name', 'email', 'phone']);

    // ID and status should be unchanged
    expect(encrypted.id).toBe(obj.id);
    expect(encrypted.status).toBe(obj.status);

    // PII fields should be encrypted (different from plaintext)
    expect(encrypted.name).not.toBe(obj.name);
    expect(encrypted.email).not.toBe(obj.email);
    expect(encrypted.phone).not.toBe(obj.phone);
  });

  it('decrypts object with specified fields', () => {
    const obj = { name: 'Test User', email: 'test@test.com', id: '123' };
    const encrypted = encryptor.encryptObject(obj, ['name', 'email']);
    const decrypted = encryptor.decryptObject(encrypted, ['name', 'email']);

    expect(decrypted.name).toBe(obj.name);
    expect(decrypted.email).toBe(obj.email);
    expect(decrypted.id).toBe(obj.id);
  });

  it('rejects empty master key', () => {
    expect(() => new FieldEncryptor(Buffer.alloc(0))).toThrow();
  });

  it('clears key cache on clearCache()', () => {
    const enc = new FieldEncryptor(masterKey);
    enc.encryptField('email', 'test'); // Populates cache
    enc.clearCache(); // Should not throw
    // Should still work after clearing cache (re-derives)
    const encrypted = enc.encryptField('email', 'test2');
    const decrypted = enc.decryptField('email', encrypted);
    expect(decrypted).toBe('test2');
  });
});

// ── Key Derivation ────────────────────────────────────────────────────

describe('HKDF-SHA256 key derivation', () => {
  const masterKey = randomBytes(32);

  it('derives 32-byte keys by default', () => {
    const derived = deriveKey(masterKey, 'test-context');
    expect(derived.length).toBe(32);
  });

  it('produces different keys for different info strings', () => {
    const key1 = deriveKey(masterKey, 'field:email');
    const key2 = deriveKey(masterKey, 'field:phone');
    expect(key1.equals(key2)).toBe(false);
  });

  it('produces same key for same inputs (deterministic)', () => {
    const key1 = deriveKey(masterKey, 'field:email');
    const key2 = deriveKey(masterKey, 'field:email');
    expect(key1.equals(key2)).toBe(true);
  });

  it('rejects empty master key', () => {
    expect(() => deriveKey(Buffer.alloc(0), 'test')).toThrow();
  });

  it('supports custom key lengths', () => {
    const key16 = deriveKey(masterKey, 'test', 16);
    expect(key16.length).toBe(16);
    const key64 = deriveKey(masterKey, 'test', 64);
    expect(key64.length).toBe(64);
  });
});

// ── RSA Key Generation ────────────────────────────────────────────────

describe('RSA key pair generation', () => {
  it('generates PEM-format key pair', () => {
    const keys = generateKeyPair();
    expect(keys.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
    expect(keys.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
  });
});

// ── Password Hashing ──────────────────────────────────────────────────

describe('Password hashing uses Argon2id', () => {
  it('hashes with Argon2id algorithm', async () => {
    const hash = await hashPassword('SecureP@ssw0rd!');
    expect(hash).toContain('$argon2id$');
  });

  it('includes correct parameters in hash', async () => {
    const hash = await hashPassword('TestP@ssword123!');
    // Argon2id hash format: $argon2id$v=19$m=65536,t=3,p=4$...
    expect(hash).toContain('m=65536'); // 64MB memory
    expect(hash).toContain('t=3');     // 3 iterations
    expect(hash).toContain('p=4');     // 4 parallelism
  });

  it('verifies correct password', async () => {
    const password = 'CorrectH0rse!Battery';
    const hash = await hashPassword(password);
    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it('rejects incorrect password', async () => {
    const hash = await hashPassword('Correct#Password1');
    const valid = await verifyPassword('WrongPassword!2', hash);
    expect(valid).toBe(false);
  });

  it('returns false for invalid hash format (no throw)', async () => {
    const valid = await verifyPassword('test', 'not-a-valid-hash');
    expect(valid).toBe(false);
  });

  it('generates different hashes for same password (salt)', async () => {
    const pw = 'S@mePassword123!';
    const hash1 = await hashPassword(pw);
    const hash2 = await hashPassword(pw);
    expect(hash1).not.toBe(hash2);
  });
});

// ── Password Strength Validation ──────────────────────────────────────

describe('Password strength validation', () => {
  it('rejects password shorter than 12 characters', () => {
    const result = validatePasswordStrength('Short1!');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects password without uppercase', () => {
    const result = validatePasswordStrength('lowercase1234!');
    expect(result.valid).toBe(false);
  });

  it('rejects password without lowercase', () => {
    const result = validatePasswordStrength('UPPERCASE1234!');
    expect(result.valid).toBe(false);
  });

  it('rejects password without digit', () => {
    const result = validatePasswordStrength('NoDigitsHere!@#');
    expect(result.valid).toBe(false);
  });

  it('rejects password without special character', () => {
    const result = validatePasswordStrength('NoSpecialChar123');
    expect(result.valid).toBe(false);
  });

  it('accepts strong password', () => {
    const result = validatePasswordStrength('Str0ng!P@ssword');
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});

// ── API Key Hashing ───────────────────────────────────────────────────

describe('API key storage hashing', () => {
  it('hashes API key with SHA-256', () => {
    const apiKey = 'ordr_test-api-key-value';
    const hash = hashApiKey(apiKey);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces consistent hash for same key', () => {
    const key = 'ordr_consistent-key';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it('produces different hash for different keys', () => {
    expect(hashApiKey('ordr_key-a')).not.toBe(hashApiKey('ordr_key-b'));
  });
});

// ── Session Token Entropy ─────────────────────────────────────────────

describe('Session token entropy', () => {
  it('generates 256-bit (32-byte) tokens by default', () => {
    const token = randomToken();
    // base64url of 32 bytes = 43 characters
    expect(token.length).toBe(43);
  });

  it('generates cryptographically unique tokens', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tokens.add(randomToken());
    }
    expect(tokens.size).toBe(1000);
  });

  it('API key has ordr_ prefix', () => {
    const key = generateApiKey();
    expect(key.startsWith('ordr_')).toBe(true);
  });

  it('UUID v4 format is correct', () => {
    const uuid = randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// ── Constant-Time Comparison ──────────────────────────────────────────

describe('Timing-safe comparison', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeEqual('abc', 'def')).toBe(false);
  });

  it('returns false for different length strings', () => {
    expect(timingSafeEqual('short', 'longer-string')).toBe(false);
  });
});
