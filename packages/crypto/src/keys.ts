/**
 * Key Management Utilities
 *
 * SOC2 CC6.1 — Encryption key lifecycle management.
 * ISO 27001 A.10.1.2 — Key management policy.
 * HIPAA §164.312(a)(2)(iv) — Encryption key controls.
 *
 * Provides HKDF key derivation, RSA key pair generation,
 * and key validation utilities.
 */

import {
  hkdfSync,
  generateKeyPairSync,
} from 'node:crypto';

const HKDF_HASH = 'sha256';
const HKDF_SALT = Buffer.alloc(32, 0); // Zero salt — info parameter provides domain separation
const DEFAULT_DERIVED_KEY_LENGTH = 32; // 256 bits
const RSA_MODULUS_LENGTH = 4096;

/**
 * Derives a cryptographic key from a master key using HKDF-SHA256.
 *
 * Uses the `info` parameter for domain separation, ensuring different
 * contexts produce different derived keys from the same master.
 *
 * @param masterKey - Master key material
 * @param info - Context/purpose string for domain separation (e.g., "field:email", "session:signing")
 * @param length - Desired output key length in bytes (default: 32)
 * @returns Derived key as a Buffer
 */
export function deriveKey(
  masterKey: Buffer,
  info: string,
  length: number = DEFAULT_DERIVED_KEY_LENGTH,
): Buffer {
  if (masterKey.length === 0) {
    throw new Error('Master key must not be empty');
  }
  if (length <= 0 || length > 255 * 32) {
    throw new Error(`Derived key length must be between 1 and ${255 * 32} bytes`);
  }

  const derived = hkdfSync(
    HKDF_HASH,
    masterKey,
    HKDF_SALT,
    info,
    length,
  );

  return Buffer.from(derived);
}

/**
 * Generates an RSA 4096-bit key pair for JWT signing or asymmetric encryption.
 *
 * Keys are returned in PEM format:
 * - privateKey: PKCS#8 PEM
 * - publicKey: SPKI PEM
 *
 * @returns Object containing PEM-encoded private and public keys
 */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: RSA_MODULUS_LENGTH,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return { privateKey, publicKey };
}

/**
 * Validates that a key buffer is exactly the expected length.
 *
 * @param key - Key buffer to validate
 * @param expectedLength - Required byte length
 * @throws Error if key length does not match
 */
export function validateKeyLength(key: Buffer, expectedLength: number): void {
  if (key.length !== expectedLength) {
    throw new Error(
      `Expected key length of ${expectedLength} bytes, received ${key.length} bytes`,
    );
  }
}
