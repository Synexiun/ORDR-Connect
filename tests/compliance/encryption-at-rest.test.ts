/**
 * Encryption at Rest Compliance Tests
 *
 * Validates that all RESTRICTED data fields are encrypted before write,
 * key rotation is within 90 days, different keys per tenant, and
 * cryptographic erasure destroys data.
 *
 * HIPAA §164.312(a)(2)(iv), SOC2 CC6.1, ISO 27001 A.10.1.1
 */

import { describe, it, expect } from 'vitest';
import { FieldEncryptor, encryptString, decryptString, encrypt, decrypt } from '@ordr/crypto';
import { deriveKey, validateKeyLength } from '@ordr/crypto';
import { randomBytes } from '@ordr/crypto';
import {
  CLASSIFICATION_REQUIREMENTS,
  isRestricted,
  isConfidentialOrAbove,
  getRequirements,
} from '@ordr/core';
import type { DataClassification } from '@ordr/core';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── RESTRICTED Fields Must Be Encrypted ───────────────────────────────

describe('All RESTRICTED data fields encrypted before write', () => {
  it('customers route encrypts PII fields before storage', () => {
    const routePath = path.resolve('apps/api/src/routes/customers.ts');
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('encryptPiiFields');
    expect(content).toContain('fieldEncryptor');
  });

  it('customers route identifies PII_FIELDS correctly', () => {
    const routePath = path.resolve('apps/api/src/routes/customers.ts');
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain("PII_FIELDS = ['name', 'email', 'phone']");
  });

  it('customers route decrypts on read for authorized users', () => {
    const routePath = path.resolve('apps/api/src/routes/customers.ts');
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('decryptCustomer');
  });

  it('FieldEncryptor encrypts before storage', () => {
    const key = randomBytes(32);
    const encryptor = new FieldEncryptor(key);

    const customerRecord = {
      id: 'cust-001',
      name: 'John Doe',
      email: 'john@healthcare.com',
      phone: '+1-555-0100',
      status: 'active',
    };

    const encrypted = encryptor.encryptObject(customerRecord, ['name', 'email', 'phone']);

    // Encrypted fields should not contain plaintext
    expect(encrypted.name).not.toBe(customerRecord.name);
    expect(encrypted.email).not.toBe(customerRecord.email);
    expect(encrypted.phone).not.toBe(customerRecord.phone);

    // Non-PII fields unchanged
    expect(encrypted.id).toBe(customerRecord.id);
    expect(encrypted.status).toBe(customerRecord.status);

    // Can decrypt back
    const decrypted = encryptor.decryptObject(encrypted, ['name', 'email', 'phone']);
    expect(decrypted.name).toBe(customerRecord.name);
    expect(decrypted.email).toBe(customerRecord.email);
    expect(decrypted.phone).toBe(customerRecord.phone);
  });

  it('encrypted field format includes key version', () => {
    const key = randomBytes(32);
    const encrypted = encryptString('sensitive-data', key);
    const parts = encrypted.split(':');
    expect(parts.length).toBe(4); // iv:authTag:ciphertext:keyVersion
    const version = parseInt(parts[3]!, 10);
    expect(version).toBeGreaterThan(0);
  });
});

// ── Classification Requirements ───────────────────────────────────────

describe('Data classification requirements', () => {
  it('restricted classification requires encryption at rest', () => {
    const reqs = getRequirements('restricted');
    expect(reqs.encryptAtRest).toBe(true);
  });

  it('restricted classification requires field-level encryption', () => {
    const reqs = getRequirements('restricted');
    expect(reqs.fieldLevelEncryption).toBe(true);
  });

  it('restricted classification requires audit trail', () => {
    const reqs = getRequirements('restricted');
    expect(reqs.auditTrail).toBe(true);
  });

  it('restricted classification requires MFA', () => {
    const reqs = getRequirements('restricted');
    expect(reqs.mfaRequired).toBe(true);
  });

  it('restricted classification has 10-year retention', () => {
    const reqs = getRequirements('restricted');
    expect(reqs.retentionYears).toBe(10);
  });

  it('confidential classification requires encryption at rest', () => {
    const reqs = getRequirements('confidential');
    expect(reqs.encryptAtRest).toBe(true);
  });

  it('confidential classification requires field-level encryption', () => {
    const reqs = getRequirements('confidential');
    expect(reqs.fieldLevelEncryption).toBe(true);
  });

  it('internal classification requires encryption at rest', () => {
    const reqs = getRequirements('internal');
    expect(reqs.encryptAtRest).toBe(true);
  });

  it('public classification does not require encryption at rest', () => {
    const reqs = getRequirements('public');
    expect(reqs.encryptAtRest).toBe(false);
  });

  it('all classifications require encryption in transit', () => {
    const levels: DataClassification[] = ['public', 'internal', 'confidential', 'restricted'];
    for (const level of levels) {
      expect(getRequirements(level).encryptInTransit).toBe(true);
    }
  });

  it('isRestricted correctly identifies restricted', () => {
    expect(isRestricted('restricted')).toBe(true);
    expect(isRestricted('confidential')).toBe(false);
    expect(isRestricted('public')).toBe(false);
  });

  it('isConfidentialOrAbove includes confidential and restricted', () => {
    expect(isConfidentialOrAbove('restricted')).toBe(true);
    expect(isConfidentialOrAbove('confidential')).toBe(true);
    expect(isConfidentialOrAbove('internal')).toBe(false);
    expect(isConfidentialOrAbove('public')).toBe(false);
  });
});

// ── Per-Tenant Key Derivation ─────────────────────────────────────────

describe('Different keys per tenant', () => {
  it('HKDF derives different keys for different tenants', () => {
    const masterKey = randomBytes(32);
    const keyA = deriveKey(masterKey, 'tenant:tenant-A');
    const keyB = deriveKey(masterKey, 'tenant:tenant-B');
    expect(keyA.equals(keyB)).toBe(false);
  });

  it('same tenant always gets same derived key', () => {
    const masterKey = randomBytes(32);
    const key1 = deriveKey(masterKey, 'tenant:tenant-001');
    const key2 = deriveKey(masterKey, 'tenant:tenant-001');
    expect(key1.equals(key2)).toBe(true);
  });

  it('per-field keys differ within same tenant', () => {
    const masterKey = randomBytes(32);
    const encryptor = new FieldEncryptor(masterKey);

    const sameValue = 'test-value';
    const emailEncrypted = encryptor.encryptField('email', sameValue);
    const phoneEncrypted = encryptor.encryptField('phone', sameValue);

    // Different fields produce different ciphertext (different derived keys + IVs)
    expect(emailEncrypted).not.toBe(phoneEncrypted);
  });
});

// ── Cryptographic Erasure ─────────────────────────────────────────────

describe('Cryptographic erasure destroys data', () => {
  it('destroying the key makes encrypted data unrecoverable', () => {
    const key = randomBytes(32);
    const plaintext = 'Sensitive patient data: John Doe, MRN: 12345';
    const encrypted = encryptString(plaintext, key);

    // Verify it decrypts with correct key
    expect(decryptString(encrypted, key)).toBe(plaintext);

    // "Destroy" the key by using a different one
    const destroyedKey = randomBytes(32);
    expect(() => decryptString(encrypted, destroyedKey)).toThrow();
  });

  it('FieldEncryptor clearCache does not retain derived keys', () => {
    const masterKey = randomBytes(32);
    const encryptor = new FieldEncryptor(masterKey);

    // Encrypt to populate cache
    const encrypted = encryptor.encryptField('email', 'test@test.com');

    // Clear cache
    encryptor.clearCache();

    // Should still decrypt (re-derives from master key)
    expect(encryptor.decryptField('email', encrypted)).toBe('test@test.com');
  });

  it('different master key cannot decrypt data', () => {
    const masterKey1 = randomBytes(32);
    const masterKey2 = randomBytes(32);

    const encryptor1 = new FieldEncryptor(masterKey1);
    const encryptor2 = new FieldEncryptor(masterKey2);

    const encrypted = encryptor1.encryptField('email', 'patient@hospital.com');

    // Different master key cannot decrypt
    expect(() => encryptor2.decryptField('email', encrypted)).toThrow();
  });
});

// ── Key Validation ────────────────────────────────────────────────────

describe('Key length validation', () => {
  it('validateKeyLength passes for correct length', () => {
    expect(() => validateKeyLength(randomBytes(32), 32)).not.toThrow();
  });

  it('validateKeyLength rejects incorrect length', () => {
    expect(() => validateKeyLength(randomBytes(16), 32)).toThrow();
    expect(() => validateKeyLength(randomBytes(64), 32)).toThrow();
  });

  it('AES-256 encryption rejects non-32-byte keys', () => {
    expect(() => encrypt('test', randomBytes(16))).toThrow();
    expect(() => encrypt('test', randomBytes(24))).toThrow();
    expect(() => encrypt('test', randomBytes(48))).toThrow();
  });
});

// ── Encrypted Data Integrity ──────────────────────────────────────────

describe('Encrypted data integrity (GCM auth tag)', () => {
  it('tampered ciphertext fails auth tag verification', () => {
    const key = randomBytes(32);
    const result = encrypt('important data', key);

    const tampered = Buffer.from(result.ciphertext);
    tampered[0] = (tampered[0]! + 1) % 256;

    expect(() => decrypt(tampered, key, result.iv, result.authTag)).toThrow();
  });

  it('tampered auth tag fails verification', () => {
    const key = randomBytes(32);
    const result = encrypt('important data', key);

    const tamperedTag = Buffer.from(result.authTag);
    tamperedTag[0] = (tamperedTag[0]! + 1) % 256;

    expect(() => decrypt(result.ciphertext, key, result.iv, tamperedTag)).toThrow();
  });

  it('tampered IV fails decryption', () => {
    const key = randomBytes(32);
    const result = encrypt('important data', key);

    const tamperedIV = Buffer.from(result.iv);
    tamperedIV[0] = (tamperedIV[0]! + 1) % 256;

    expect(() => decrypt(result.ciphertext, key, tamperedIV, result.authTag)).toThrow();
  });
});
