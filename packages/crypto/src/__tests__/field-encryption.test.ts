import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { FieldEncryptor } from '../field-encryption.js';

function makeMasterKey(): Buffer {
  return randomBytes(32);
}

describe('FieldEncryptor', () => {
  describe('construction', () => {
    it('should create an instance with a valid master key', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      expect(encryptor).toBeInstanceOf(FieldEncryptor);
    });

    it('should throw if master key is empty', () => {
      expect(() => new FieldEncryptor(Buffer.alloc(0))).toThrow('must not be empty');
    });
  });

  describe('encryptField / decryptField', () => {
    it('should roundtrip a field value', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const original = 'patient@hospital.org';

      const encrypted = encryptor.encryptField('email', original);
      const decrypted = encryptor.decryptField('email', encrypted);

      expect(decrypted).toBe(original);
    });

    it('should produce different ciphertexts for different field names (different derived keys)', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const value = 'same-value';

      const encryptedEmail = encryptor.encryptField('email', value);
      const encryptedPhone = encryptor.encryptField('phone', value);

      // Extract the ciphertext portion (3rd part) — different derived keys produce different results
      // Even if by chance IVs collide, different keys ensure different ciphertexts
      expect(encryptedEmail).not.toBe(encryptedPhone);
    });

    it('should fail to decrypt with wrong field name', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const encrypted = encryptor.encryptField('email', 'user@example.com');

      // Decrypting with a different field name uses a different derived key — should fail
      expect(() => {
        encryptor.decryptField('phone', encrypted);
      }).toThrow();
    });

    it('should handle empty string values', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const encrypted = encryptor.encryptField('notes', '');
      const decrypted = encryptor.decryptField('notes', encrypted);

      expect(decrypted).toBe('');
    });

    it('should handle long values', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const longValue = 'A'.repeat(10_000);

      const encrypted = encryptor.encryptField('medical_notes', longValue);
      const decrypted = encryptor.decryptField('medical_notes', encrypted);

      expect(decrypted).toBe(longValue);
    });

    it('should produce different ciphertexts for same field and value (unique IVs)', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const enc1 = encryptor.encryptField('ssn', '123-45-6789');
      const enc2 = encryptor.encryptField('ssn', '123-45-6789');

      expect(enc1).not.toBe(enc2);
    });
  });

  describe('encryptObject / decryptObject', () => {
    it('should encrypt only specified fields and leave others untouched', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const patient = {
        id: 'patient-001',
        email: 'jane@example.com',
        phone: '555-0123',
        age: 34,
      };

      const encrypted = encryptor.encryptObject(patient, ['email', 'phone'] as const);

      // Unencrypted fields remain unchanged
      expect(encrypted.id).toBe('patient-001');
      expect(encrypted.age).toBe(34);

      // Encrypted fields are transformed
      expect(encrypted.email).not.toBe('jane@example.com');
      expect(encrypted.phone).not.toBe('555-0123');

      // Encrypted fields should be colon-separated strings
      expect((encrypted.email as string).split(':')).toHaveLength(4);
      expect((encrypted.phone as string).split(':')).toHaveLength(4);
    });

    it('should roundtrip an object through encrypt and decrypt', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const original = {
        id: 'record-42',
        name: 'John Doe',
        ssn: '123-45-6789',
        email: 'john@example.com',
        status: 'active',
      };

      const fieldsToEncrypt = ['ssn', 'email'] as const;
      const encrypted = encryptor.encryptObject(original, fieldsToEncrypt);
      const decrypted = encryptor.decryptObject(encrypted, fieldsToEncrypt);

      expect(decrypted).toEqual(original);
    });

    it('should not modify the original object', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const original = {
        email: 'original@test.com',
        name: 'Test User',
      };

      const originalEmail = original.email;
      encryptor.encryptObject(original, ['email'] as const);

      expect(original.email).toBe(originalEmail);
    });

    it('should skip non-string fields gracefully', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());
      const obj = {
        count: 42,
        label: 'test',
      };

      // Specifying a numeric field should not throw or modify it
      const result = encryptor.encryptObject(obj, ['count', 'label'] as const);
      expect(result.count).toBe(42);
      expect(result.label).not.toBe('test'); // label is a string, should be encrypted
    });
  });

  describe('key cache', () => {
    it('should produce consistent results with cached keys', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());

      // Encrypt twice to use cached key on second call
      const enc1 = encryptor.encryptField('email', 'test@test.com');
      const dec1 = encryptor.decryptField('email', enc1);

      const enc2 = encryptor.encryptField('email', 'test2@test.com');
      const dec2 = encryptor.decryptField('email', enc2);

      expect(dec1).toBe('test@test.com');
      expect(dec2).toBe('test2@test.com');
    });

    it('clearCache should not break functionality', () => {
      const encryptor = new FieldEncryptor(makeMasterKey());

      const encrypted = encryptor.encryptField('email', 'cached@test.com');
      encryptor.clearCache();
      const decrypted = encryptor.decryptField('email', encrypted);

      expect(decrypted).toBe('cached@test.com');
    });
  });
});
