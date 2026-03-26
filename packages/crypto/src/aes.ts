/**
 * AES-256-GCM Encryption
 *
 * HIPAA §164.312(a)(2)(iv) — Encryption and decryption of ePHI.
 * SOC2 CC6.1 — Logical access security over encryption keys.
 *
 * - 256-bit key (32 bytes) REQUIRED
 * - 12-byte IV generated fresh per encryption (NIST SP 800-38D)
 * - 128-bit authentication tag for integrity verification
 * - NEVER reuses IVs — each call to encrypt generates a new random IV
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const AES_ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;
const CURRENT_KEY_VERSION = 1;

export interface EncryptResult {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

/**
 * Validates that an encryption key is exactly 32 bytes (256 bits).
 * @throws Error if key length is invalid
 */
function assertKeyLength(key: Buffer): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `AES-256-GCM requires a ${KEY_LENGTH}-byte key, received ${key.length} bytes`,
    );
  }
}

/**
 * Encrypts plaintext using AES-256-GCM with a fresh random 12-byte IV.
 *
 * @param plaintext - Data to encrypt
 * @param key - 32-byte (256-bit) encryption key
 * @returns Ciphertext, IV, authentication tag, and key version
 */
export function encrypt(
  plaintext: string | Buffer,
  key: Buffer,
): EncryptResult {
  assertKeyLength(key);

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const input = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv,
    authTag,
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * Decrypts AES-256-GCM ciphertext and verifies the authentication tag.
 *
 * @param ciphertext - Encrypted data
 * @param key - 32-byte (256-bit) encryption key (must match encryption key)
 * @param iv - 12-byte initialization vector used during encryption
 * @param authTag - Authentication tag for integrity verification
 * @returns Decrypted plaintext as a Buffer
 * @throws Error if authentication fails (tampered data or wrong key)
 */
export function decrypt(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
): Buffer {
  assertKeyLength(key);

  const decipher = createDecipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypts a string and returns a base64-encoded storage format.
 *
 * Output format: `iv:authTag:ciphertext:keyVersion` (all base64-encoded except version)
 * Suitable for direct storage in database text/varchar columns.
 *
 * @param plaintext - String to encrypt
 * @param key - 32-byte encryption key
 * @returns Base64-encoded string in `iv:authTag:ciphertext:keyVersion` format
 */
export function encryptString(plaintext: string, key: Buffer): string {
  const result = encrypt(plaintext, key);
  const ivB64 = result.iv.toString('base64');
  const authTagB64 = result.authTag.toString('base64');
  const ciphertextB64 = result.ciphertext.toString('base64');
  return `${ivB64}:${authTagB64}:${ciphertextB64}:${result.keyVersion}`;
}

/**
 * Decrypts a string produced by `encryptString`.
 *
 * @param encrypted - Base64-encoded `iv:authTag:ciphertext:keyVersion` string
 * @param key - 32-byte encryption key (must match the key used for encryption)
 * @returns Decrypted plaintext string
 * @throws Error if format is invalid or authentication fails
 */
export function decryptString(encrypted: string, key: Buffer): string {
  const parts = encrypted.split(':');
  if (parts.length !== 4) {
    throw new Error(
      `Invalid encrypted string format: expected 4 colon-separated parts, got ${parts.length}`,
    );
  }

  const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  return decrypt(ciphertext, key, iv, authTag).toString('utf8');
}
