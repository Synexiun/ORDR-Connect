import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, encryptString, decryptString } from '../aes.js';

function makeKey(): Buffer {
  return randomBytes(32);
}

describe('AES-256-GCM', () => {
  describe('encrypt / decrypt', () => {
    it('should encrypt then decrypt to the original plaintext', () => {
      const key = makeKey();
      const plaintext = 'Sensitive patient health information — HIPAA protected';

      const result = encrypt(plaintext, key);
      const decrypted = decrypt(result.ciphertext, key, result.iv, result.authTag);

      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('should encrypt and decrypt Buffer input', () => {
      const key = makeKey();
      const plaintext = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);

      const result = encrypt(plaintext, key);
      const decrypted = decrypt(result.ciphertext, key, result.iv, result.authTag);

      expect(decrypted).toEqual(plaintext);
    });

    it('should produce different IVs for each encryption call', () => {
      const key = makeKey();
      const plaintext = 'same plaintext';

      const result1 = encrypt(plaintext, key);
      const result2 = encrypt(plaintext, key);

      expect(result1.iv).not.toEqual(result2.iv);
    });

    it('should produce different ciphertexts for same plaintext due to unique IVs', () => {
      const key = makeKey();
      const plaintext = 'identical input';

      const result1 = encrypt(plaintext, key);
      const result2 = encrypt(plaintext, key);

      expect(result1.ciphertext).not.toEqual(result2.ciphertext);
    });

    it('should fail to decrypt with the wrong key', () => {
      const key1 = makeKey();
      const key2 = makeKey();
      const plaintext = 'secret data';

      const result = encrypt(plaintext, key1);

      expect(() => {
        decrypt(result.ciphertext, key2, result.iv, result.authTag);
      }).toThrow();
    });

    it('should fail authentication when ciphertext is tampered', () => {
      const key = makeKey();
      const plaintext = 'integrity-protected data';

      const result = encrypt(plaintext, key);

      // Flip a bit in the ciphertext
      const tampered = Buffer.from(result.ciphertext);
      tampered[0] = tampered[0]! ^ 0x01;

      expect(() => {
        decrypt(tampered, key, result.iv, result.authTag);
      }).toThrow();
    });

    it('should fail authentication when authTag is tampered', () => {
      const key = makeKey();
      const plaintext = 'tagged data';

      const result = encrypt(plaintext, key);

      // Flip a bit in the auth tag
      const tamperedTag = Buffer.from(result.authTag);
      tamperedTag[0] = tamperedTag[0]! ^ 0x01;

      expect(() => {
        decrypt(result.ciphertext, key, result.iv, tamperedTag);
      }).toThrow();
    });

    it('should include keyVersion in the result', () => {
      const key = makeKey();
      const result = encrypt('data', key);
      expect(result.keyVersion).toBe(1);
    });

    it('should generate a 12-byte IV', () => {
      const key = makeKey();
      const result = encrypt('data', key);
      expect(result.iv.length).toBe(12);
    });

    it('should generate a 16-byte auth tag', () => {
      const key = makeKey();
      const result = encrypt('data', key);
      expect(result.authTag.length).toBe(16);
    });
  });

  describe('key validation', () => {
    it('should throw if key is less than 32 bytes', () => {
      const shortKey = randomBytes(16);
      expect(() => encrypt('data', shortKey)).toThrow('32-byte key');
    });

    it('should throw if key is more than 32 bytes', () => {
      const longKey = randomBytes(64);
      expect(() => encrypt('data', longKey)).toThrow('32-byte key');
    });

    it('should throw on decrypt with wrong key length', () => {
      const key = makeKey();
      const result = encrypt('data', key);
      const badKey = randomBytes(16);

      expect(() => {
        decrypt(result.ciphertext, badKey, result.iv, result.authTag);
      }).toThrow('32-byte key');
    });
  });

  describe('encryptString / decryptString', () => {
    it('should roundtrip a string through encrypt and decrypt', () => {
      const key = makeKey();
      const plaintext = 'user@example.com';

      const encrypted = encryptString(plaintext, key);
      const decrypted = decryptString(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce a colon-separated format with 4 parts', () => {
      const key = makeKey();
      const encrypted = encryptString('test', key);
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(4);
    });

    it('should include key version as the 4th part', () => {
      const key = makeKey();
      const encrypted = encryptString('test', key);
      const parts = encrypted.split(':');

      expect(parts[3]).toBe('1');
    });

    it('should handle empty string encryption', () => {
      const key = makeKey();
      const plaintext = '';

      const encrypted = encryptString(plaintext, key);
      const decrypted = decryptString(encrypted, key);

      expect(decrypted).toBe('');
    });

    it('should handle unicode strings', () => {
      const key = makeKey();
      const plaintext = 'Nombre del paciente: Jose Garcia-Martinez';

      const encrypted = encryptString(plaintext, key);
      const decrypted = decryptString(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw on malformed encrypted string', () => {
      const key = makeKey();

      expect(() => decryptString('not:valid', key)).toThrow('4 colon-separated parts');
      expect(() => decryptString('only-one-part', key)).toThrow('4 colon-separated parts');
    });

    it('should fail with wrong key on decryptString', () => {
      const key1 = makeKey();
      const key2 = makeKey();

      const encrypted = encryptString('secret', key1);

      expect(() => decryptString(encrypted, key2)).toThrow();
    });
  });
});
