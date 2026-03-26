/**
 * Hashing Utilities
 *
 * SOC2 CC6.1 — Integrity verification via cryptographic hashing.
 * ISO 27001 A.10.1.1 — Cryptographic controls policy.
 *
 * All functions use Node.js native `crypto` module.
 * - SHA-256 for general-purpose hashing
 * - HMAC-SHA256 for keyed message authentication
 * - Constant-time comparison to prevent timing attacks
 */

import { createHash, createHmac, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/**
 * Computes a SHA-256 hash and returns it as a hex string.
 *
 * @param data - Input data to hash
 * @returns Hex-encoded SHA-256 digest
 */
export function sha256(data: string | Buffer): string {
  return sha256Buffer(data).toString('hex');
}

/**
 * Computes a SHA-256 hash and returns the raw Buffer.
 *
 * @param data - Input data to hash
 * @returns Raw SHA-256 digest as a Buffer
 */
export function sha256Buffer(data: string | Buffer): Buffer {
  const input = typeof data === 'string' ? data : data;
  return createHash('sha256').update(input).digest();
}

/**
 * Computes an HMAC-SHA256 and returns it as a hex string.
 *
 * @param data - Input data
 * @param key - HMAC key
 * @returns Hex-encoded HMAC-SHA256
 */
export function hmacSha256(data: string | Buffer, key: Buffer): string {
  return hmacSha256Buffer(data, key).toString('hex');
}

/**
 * Computes an HMAC-SHA256 and returns the raw Buffer.
 *
 * @param data - Input data
 * @param key - HMAC key
 * @returns Raw HMAC-SHA256 as a Buffer
 */
export function hmacSha256Buffer(data: string | Buffer, key: Buffer): Buffer {
  const input = typeof data === 'string' ? data : data;
  return createHmac('sha256', key).update(input).digest();
}

/**
 * Hashes an API key for secure storage.
 *
 * API keys are hashed with SHA-256 before storage so that a database
 * breach does not expose raw keys. The original key cannot be recovered.
 *
 * @param apiKey - Raw API key string
 * @returns Hex-encoded SHA-256 hash
 */
export function hashApiKey(apiKey: string): string {
  return sha256(apiKey);
}

/**
 * Performs a constant-time string comparison to prevent timing attacks.
 *
 * Both strings are converted to UTF-8 buffers and padded/compared at
 * fixed time regardless of where they differ. Returns false for
 * different-length strings without leaking length via timing.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are identical, false otherwise
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // For different-length strings, compare against self to maintain constant time
  // but always return false
  if (bufA.length !== bufB.length) {
    // Still perform the comparison to avoid timing leak on length check
    nodeTimingSafeEqual(bufA, bufA);
    return false;
  }

  return nodeTimingSafeEqual(bufA, bufB);
}
