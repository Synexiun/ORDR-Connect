/**
 * @ordr/search — PHI Sanitizer for Search Indexing
 *
 * HIPAA §164.312 — PHI MUST be masked/stripped before entering the search index.
 * ISO 27001 A.8.2.3 — Data classification enforced at indexing boundary.
 *
 * This module ensures that NO plaintext PHI enters the search index.
 * Search results contain only masked previews; full entity data requires
 * a separate authorized API call with proper audit logging.
 *
 * Mapping:
 * - Full name  → "J. D." (initials with periods)
 * - Email      → "*@domain.com" (only domain visible)
 * - Phone      → "***-1234" (only last 4 digits)
 * - SSN        → NEVER indexed (returns empty string)
 * - Address    → City + state only (street stripped)
 * - DOB        → Year only
 */

// ─── PHI Field Patterns ─────────────────────────────────────────

const SSN_PATTERN = /^\d{3}-?\d{2}-?\d{4}$/;
const PHONE_PATTERN = /[\d\s\-().+]+/;
const EMAIL_PATTERN = /^[^@]+@(.+)$/;

// ─── Core Sanitization Functions ────────────────────────────────

/**
 * Sanitize a full name to initials only.
 * "John Doe" → "J. D."
 * "Mary Jane Watson" → "M. J. W."
 */
export function sanitizeName(name: string): string {
  if (!name || name.trim().length === 0) {
    return '';
  }

  const parts = name.trim().split(/\s+/);
  const initials = parts
    .map((part) => {
      const firstChar = part[0];
      return firstChar ? `${firstChar.toUpperCase()}.` : '';
    })
    .filter((initial) => initial.length > 0);

  return initials.join(' ');
}

/**
 * Sanitize an email to show only the domain.
 * "john.doe@example.com" → "*@example.com"
 */
export function sanitizeEmail(email: string): string {
  if (!email || email.trim().length === 0) {
    return '';
  }

  const match = EMAIL_PATTERN.exec(email.trim());
  if (!match?.[1]) {
    return '';
  }

  return `*@${match[1]}`;
}

/**
 * Sanitize a phone number to show only the last 4 digits.
 * "+1 (555) 123-4567" → "***-4567"
 * "5551234567" → "***-4567"
 */
export function sanitizePhone(phone: string): string {
  if (!phone || phone.trim().length === 0) {
    return '';
  }

  // Extract only digits
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) {
    return '***-****';
  }

  const lastFour = digits.slice(-4);
  return `***-${lastFour}`;
}

/**
 * SSN is NEVER indexed. Always returns empty string.
 */
export function sanitizeSsn(_ssn: string): string {
  return '';
}

/**
 * Sanitize an address to city + state only.
 * "123 Main St, Springfield, IL 62701" → "Springfield, IL"
 */
export function sanitizeAddress(address: string): string {
  if (!address || address.trim().length === 0) {
    return '';
  }

  // Try to extract city + state from comma-separated parts
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length >= 3) {
    // Assume format: street, city, state zip
    const city = parts[1];
    const stateZip = parts[2];
    // Remove zip code (digits at end)
    const state = stateZip ? stateZip.replace(/\s*\d{5}(-\d{4})?\s*$/, '').trim() : '';
    if (city && state) {
      return `${city}, ${state}`;
    }
  }

  // If we can't parse, return generic location indicator
  return '[location]';
}

/**
 * Sanitize a date of birth to year only.
 * "1990-05-15" → "1990"
 * "May 15, 1990" → "1990"
 */
export function sanitizeDob(dob: string): string {
  if (!dob || dob.trim().length === 0) {
    return '';
  }

  // Try to parse as date
  const date = new Date(dob);
  if (!isNaN(date.getTime())) {
    return String(date.getFullYear());
  }

  // Try to extract 4-digit year
  const yearMatch = /\b(19|20)\d{2}\b/.exec(dob);
  if (yearMatch?.[0]) {
    return yearMatch[0];
  }

  return '';
}

// ─── Detect & Sanitize ──────────────────────────────────────────

/**
 * Known PHI field name patterns and their sanitizers.
 */
const PHI_FIELD_SANITIZERS: Record<string, (value: string) => string> = {
  name: sanitizeName,
  full_name: sanitizeName,
  fullName: sanitizeName,
  first_name: sanitizeName,
  firstName: sanitizeName,
  last_name: sanitizeName,
  lastName: sanitizeName,
  display_name: sanitizeName,
  displayName: sanitizeName,
  email: sanitizeEmail,
  email_address: sanitizeEmail,
  emailAddress: sanitizeEmail,
  phone: sanitizePhone,
  phone_number: sanitizePhone,
  phoneNumber: sanitizePhone,
  mobile: sanitizePhone,
  ssn: sanitizeSsn,
  social_security: sanitizeSsn,
  socialSecurity: sanitizeSsn,
  tax_id: sanitizeSsn,
  taxId: sanitizeSsn,
  address: sanitizeAddress,
  street_address: sanitizeAddress,
  streetAddress: sanitizeAddress,
  dob: sanitizeDob,
  date_of_birth: sanitizeDob,
  dateOfBirth: sanitizeDob,
  birth_date: sanitizeDob,
  birthDate: sanitizeDob,
};

/**
 * Detect if a value looks like an SSN regardless of field name.
 */
export function isLikelySsn(value: string): boolean {
  return SSN_PATTERN.test(value.trim());
}

/**
 * Detect if a value looks like a phone number regardless of field name.
 */
export function isLikelyPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && PHONE_PATTERN.test(value);
}

/**
 * Detect if a value looks like an email regardless of field name.
 */
export function isLikelyEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * Sanitize a PHI field value based on the field name.
 * If the field name is recognized, uses the corresponding sanitizer.
 * If the field is marked as PHI but unrecognized, applies content-based detection.
 */
export function sanitizePhiField(fieldName: string, value: string): string {
  if (!value || value.trim().length === 0) {
    return '';
  }

  // Check known field names first
  const sanitizer = PHI_FIELD_SANITIZERS[fieldName];
  if (sanitizer) {
    return sanitizer(value);
  }

  // Content-based detection for unknown field names marked as PHI
  if (isLikelySsn(value)) {
    return sanitizeSsn(value);
  }
  if (isLikelyEmail(value)) {
    return sanitizeEmail(value);
  }
  if (isLikelyPhone(value)) {
    return sanitizePhone(value);
  }

  // For unrecognized PHI fields, redact entirely
  return '[redacted]';
}

/**
 * Sanitize a record of fields, applying PHI sanitization to any field
 * that is flagged as containing PHI.
 */
export function sanitizeFieldMap(
  fields: Record<string, { readonly value: string; readonly isPhi: boolean }>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [fieldName, field] of Object.entries(fields)) {
    if (field.isPhi) {
      sanitized[fieldName] = sanitizePhiField(fieldName, field.value);
    } else {
      sanitized[fieldName] = field.value;
    }
  }

  return sanitized;
}
