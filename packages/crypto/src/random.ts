/**
 * Secure Random Generation
 *
 * SOC2 CC6.1 — Cryptographically secure random values for tokens and keys.
 * ISO 27001 A.10.1.1 — Cryptographic controls.
 *
 * All random generation uses Node.js native `crypto` module backed by
 * the operating system's CSPRNG (e.g., /dev/urandom on Linux, CryptGenRandom on Windows).
 */

import {
  randomBytes as nodeRandomBytes,
  randomUUID as nodeRandomUUID,
} from 'node:crypto';

const API_KEY_PREFIX = 'ordr_';
const DEFAULT_TOKEN_BYTES = 32; // 256 bits

/**
 * Generates cryptographically secure random bytes.
 *
 * @param length - Number of bytes to generate
 * @returns Buffer of random bytes
 */
export function randomBytes(length: number): Buffer {
  if (length <= 0) {
    throw new Error(`Random byte length must be positive, received ${length}`);
  }
  return nodeRandomBytes(length);
}

/**
 * Generates a hex-encoded cryptographically secure random string.
 *
 * The output will be `length * 2` characters long (2 hex chars per byte).
 *
 * @param length - Number of random bytes (output hex string is 2x this length)
 * @returns Hex-encoded random string
 */
export function randomHex(length: number): string {
  return randomBytes(length).toString('hex');
}

/**
 * Generates a UUID v4 using the native crypto implementation.
 *
 * @returns UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function randomUUID(): string {
  return nodeRandomUUID();
}

/**
 * Generates a base64url-encoded cryptographically secure token.
 *
 * Default length is 32 bytes (256 bits), suitable for session tokens
 * and other security-critical random values.
 *
 * @param length - Number of random bytes (default: 32)
 * @returns Base64url-encoded token string
 */
export function randomToken(length: number = DEFAULT_TOKEN_BYTES): string {
  return randomBytes(length).toString('base64url');
}

/**
 * Generates a prefixed API key for external integrations.
 *
 * Format: `ordr_` + 32-byte base64url-encoded random value
 * The prefix enables quick identification in logs and revocation systems.
 *
 * @returns API key string with `ordr_` prefix
 */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomToken(DEFAULT_TOKEN_BYTES)}`;
}
