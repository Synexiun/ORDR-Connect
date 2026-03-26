/**
 * Field-Level Encryption for PHI/PII Columns
 *
 * HIPAA §164.312(a)(2)(iv) — Encryption of ePHI at rest.
 * SOC2 CC6.1 — Granular encryption controls per data field.
 * ISO 27001 A.10.1.1 — Cryptographic controls for sensitive data.
 *
 * Uses HKDF to derive per-field keys from a master field encryption key,
 * ensuring that different database columns use different derived keys.
 * This limits the blast radius if a single derived key is compromised.
 */

import { encryptString, decryptString } from './aes.js';
import { deriveKey } from './keys.js';

const FIELD_KEY_LENGTH = 32; // 256 bits for AES-256-GCM
const FIELD_KEY_PREFIX = 'field-encryption:';

/**
 * Field-level encryption engine for database PHI/PII columns.
 *
 * Each field name produces a unique derived key via HKDF, so encrypting
 * the same value under different field names yields different ciphertexts.
 *
 * @example
 * ```ts
 * const encryptor = new FieldEncryptor(masterKey);
 * const encrypted = encryptor.encryptField('email', 'user@example.com');
 * const decrypted = encryptor.decryptField('email', encrypted);
 * ```
 */
export class FieldEncryptor {
  private readonly masterKey: Buffer;
  private readonly keyCache: Map<string, Buffer>;

  /**
   * Creates a new FieldEncryptor.
   *
   * @param masterKey - Master field encryption key (minimum 32 bytes recommended)
   * @throws Error if master key is empty
   */
  constructor(masterKey: Buffer) {
    if (masterKey.length === 0) {
      throw new Error('Master field encryption key must not be empty');
    }
    this.masterKey = masterKey;
    this.keyCache = new Map();
  }

  /**
   * Derives or retrieves from cache a field-specific encryption key.
   *
   * @param fieldName - Database column/field name
   * @returns 32-byte derived key specific to this field
   */
  private getFieldKey(fieldName: string): Buffer {
    const cached = this.keyCache.get(fieldName);
    if (cached !== undefined) {
      return cached;
    }

    const info = `${FIELD_KEY_PREFIX}${fieldName}`;
    const fieldKey = deriveKey(this.masterKey, info, FIELD_KEY_LENGTH);
    this.keyCache.set(fieldName, fieldKey);
    return fieldKey;
  }

  /**
   * Encrypts a single field value.
   *
   * @param fieldName - Name of the database field (used for key derivation)
   * @param value - Plaintext value to encrypt
   * @returns Encrypted string in `iv:authTag:ciphertext:keyVersion` format
   */
  encryptField(fieldName: string, value: string): string {
    const fieldKey = this.getFieldKey(fieldName);
    return encryptString(value, fieldKey);
  }

  /**
   * Decrypts a single field value.
   *
   * @param fieldName - Name of the database field (must match encryption field name)
   * @param encrypted - Encrypted string produced by `encryptField`
   * @returns Decrypted plaintext value
   * @throws Error if field name doesn't match or data is tampered
   */
  decryptField(fieldName: string, encrypted: string): string {
    const fieldKey = this.getFieldKey(fieldName);
    return decryptString(encrypted, fieldKey);
  }

  /**
   * Encrypts specified fields in an object, leaving other fields untouched.
   *
   * @param obj - Source object
   * @param fields - Array of field names to encrypt
   * @returns New object with specified fields encrypted
   */
  encryptObject<T extends Record<string, unknown>>(
    obj: T,
    fields: readonly (keyof T)[],
  ): T {
    const result = { ...obj };

    for (const field of fields) {
      const value = result[field];
      if (typeof value === 'string') {
        (result as Record<string, unknown>)[field as string] = this.encryptField(
          field as string,
          value,
        );
      }
    }

    return result;
  }

  /**
   * Decrypts specified fields in an object, leaving other fields untouched.
   *
   * @param obj - Source object with encrypted fields
   * @param fields - Array of field names to decrypt
   * @returns New object with specified fields decrypted
   */
  decryptObject<T extends Record<string, unknown>>(
    obj: T,
    fields: readonly (keyof T)[],
  ): T {
    const result = { ...obj };

    for (const field of fields) {
      const value = result[field];
      if (typeof value === 'string') {
        (result as Record<string, unknown>)[field as string] = this.decryptField(
          field as string,
          value,
        );
      }
    }

    return result;
  }

  /**
   * Clears the derived key cache.
   * Call this when rotating the master key.
   */
  clearCache(): void {
    this.keyCache.clear();
  }
}
