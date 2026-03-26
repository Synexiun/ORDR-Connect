/**
 * Password Policy — compliance-grade password validation
 *
 * SOC2 CC6.1 — Logical access security through strong credentials.
 * ISO 27001 A.9.3.1 — Use of secret authentication information.
 * HIPAA §164.312(a)(2)(i) — Unique user identification.
 * NIST SP 800-63B — Digital identity guidelines for memorized secrets.
 *
 * Defaults exceed OWASP minimum recommendations:
 * - 12-character minimum (OWASP recommends >= 8)
 * - Complexity requirements: uppercase, lowercase, digit, special
 * - 90-day maximum age (configurable)
 * - 5-generation history to prevent reuse
 */

import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@ordr/core';

// ─── Policy Configuration ──────────────────────────────────────────

export interface PasswordPolicy {
  /** Minimum password length (default: 12, absolute minimum: 8) */
  readonly minLength: number;
  /** Maximum password length (default: 128) */
  readonly maxLength: number;
  /** Require at least one uppercase letter */
  readonly requireUppercase: boolean;
  /** Require at least one lowercase letter */
  readonly requireLowercase: boolean;
  /** Require at least one digit */
  readonly requireDigit: boolean;
  /** Require at least one special character */
  readonly requireSpecial: boolean;
  /** Maximum password age in days (0 = no expiration) */
  readonly maxAgeDays: number;
  /** Number of previous passwords to remember (prevents reuse) */
  readonly historyCount: number;
}

/**
 * Default password policy — exceeds OWASP and NIST recommendations.
 * SOC2/ISO27001/HIPAA compliant out of the box.
 */
export const DEFAULT_PASSWORD_POLICY: Readonly<PasswordPolicy> = {
  minLength: PASSWORD_MIN_LENGTH,
  maxLength: PASSWORD_MAX_LENGTH,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: true,
  maxAgeDays: 90,
  historyCount: 5,
} as const;

// ─── Validation Result ─────────────────────────────────────────────

export interface PasswordValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

// ─── Validation ────────────────────────────────────────────────────

/**
 * Validates a password against the given policy.
 *
 * Checks length, character class requirements, and common weak patterns.
 * Returns all validation errors at once (not just the first failure).
 *
 * @param password - The password to validate
 * @param policy - Password policy to apply (defaults to DEFAULT_PASSWORD_POLICY)
 * @returns Validation result with all errors
 */
export function validatePassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): PasswordValidationResult {
  const errors: string[] = [];

  // Length checks
  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters long`);
  }

  if (password.length > policy.maxLength) {
    errors.push(`Password must be at most ${policy.maxLength} characters long`);
  }

  // Character class checks
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (policy.requireDigit && !/\d/.test(password)) {
    errors.push('Password must contain at least one digit');
  }

  if (policy.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Common pattern checks
  if (/(.)\1{2,}/.test(password)) {
    errors.push('Password must not contain three or more consecutive identical characters');
  }

  if (/^(012|123|234|345|456|567|678|789|890|abc|bcd|cde|def)/i.test(password)) {
    errors.push('Password must not start with a common sequential pattern');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Checks whether a password has exceeded its maximum age.
 *
 * Used to enforce periodic password rotation per compliance requirements.
 *
 * @param lastChanged - Date the password was last changed
 * @param maxAgeDays - Maximum allowed age in days
 * @returns true if the password is expired and must be changed
 */
export function isPasswordExpired(lastChanged: Date, maxAgeDays: number): boolean {
  if (maxAgeDays <= 0) {
    return false; // No expiration
  }

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const elapsed = Date.now() - lastChanged.getTime();
  return elapsed > maxAgeMs;
}
