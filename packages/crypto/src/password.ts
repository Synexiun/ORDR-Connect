/**
 * Password Hashing — Argon2id
 *
 * OWASP Password Storage Cheat Sheet — Argon2id is the recommended algorithm.
 * HIPAA §164.312(d) — Person or entity authentication.
 * SOC2 CC6.1 — Logical access security.
 *
 * Configuration follows OWASP minimum recommendations:
 * - Argon2id variant (hybrid of Argon2i and Argon2d)
 * - 64 MB memory cost (memoryCost = 65536 KiB)
 * - 3 iterations (timeCost)
 * - 4 parallel threads
 *
 * NEVER use bcrypt or scrypt — Argon2id is the current standard.
 */

import argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

const MIN_PASSWORD_LENGTH = 12;
const SPECIAL_CHARS = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

export interface PasswordStrengthResult {
  valid: boolean;
  errors: string[];
}

/**
 * Hashes a password using Argon2id with OWASP-recommended parameters.
 *
 * @param password - Plaintext password to hash
 * @returns Argon2id hash string (includes algorithm, params, salt, and hash)
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 *
 * Uses Argon2's built-in timing-safe comparison to prevent timing attacks.
 *
 * @param password - Plaintext password to verify
 * @param hash - Argon2id hash to verify against
 * @returns true if password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // If the hash format is invalid or verification fails unexpectedly,
    // return false rather than throwing — prevents information leakage
    return false;
  }
}

/**
 * Validates password strength against enterprise security requirements.
 *
 * Requirements:
 * - Minimum 12 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character
 *
 * @param password - Password to validate
 * @returns Validation result with specific error messages
 */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const errors: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one digit');
  }

  if (!SPECIAL_CHARS.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
