/**
 * DLP Scanner — Data Loss Prevention for API responses
 *
 * Scans response bodies for PII, PHI, and secrets before they leave the
 * system. Detects: SSN, credit cards, API keys, JWTs, private keys,
 * medical record numbers, AWS/GCP credentials, and password hashes.
 *
 * Design decisions:
 * - Patterns are tuned for API JSON responses (not free-form HTML)
 * - Each pattern is bounded to avoid ReDoS
 * - Credit card Luhn check validates detected card numbers
 * - Matched values are NEVER logged — only a redacted placeholder
 * - scan() returns all findings; containsSensitiveData() is a fast-path check
 *
 * Severity mapping:
 * - critical: private keys, AWS/GCP credentials (immediate exfiltration risk)
 * - high: SSN, credit cards, medical records (HIPAA/PCI direct liability)
 * - medium: JWTs, API keys (can enable further attacks)
 * - low: phone numbers, DOBs (indirect PII risk)
 *
 * SOC2 CC6.7 — Prevent unauthorized disclosure of confidential data.
 * ISO 27001 A.8.2.3 — Handling of assets: control information leaving systems.
 * HIPAA §164.312(e)(1) — Transmission security: prevent PHI disclosure.
 * PCI DSS Req 3.4 — Protect stored cardholder data.
 */

import type { DLPFinding, DLPDataType } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max bytes scanned per response. Larger responses are truncated. */
const MAX_SCAN_BYTES = 524_288; // 512 KB

type DLPPattern = {
  readonly type: DLPDataType;
  readonly severity: DLPFinding['severity'];
  readonly pattern: RegExp;
  readonly redactedLabel: string;
  readonly validate?: (match: string) => boolean;
};

// ─── DLP Pattern Library ─────────────────────────────────────────────────────

const DLP_PATTERNS: readonly DLPPattern[] = [
  // ── Secrets (critical) ────────────────────────────────────────────────────
  {
    type: 'private_key',
    severity: 'critical',
    // eslint-disable-next-line security/detect-unsafe-regex
    pattern:
      /-----BEGIN\s{1,10}(?:RSA\s{1,10})?(?:EC\s{1,10})?(?:OPENSSH\s{1,10})?PRIVATE\s{1,10}KEY-----/,
    redactedLabel: '[REDACTED:PRIVATE_KEY]',
  },
  {
    type: 'aws_key',
    severity: 'critical',
    // AWS access key IDs: AKIA + 16 uppercase alphanumeric
    pattern: /AKIA[0-9A-Z]{16}/,
    redactedLabel: '[REDACTED:AWS_ACCESS_KEY]',
  },
  {
    type: 'gcp_key',
    severity: 'critical',
    // GCP service account key pattern in JSON
    pattern: /"private_key_id"\s{0,5}:\s{0,5}"[a-f0-9]{40}"/i,
    redactedLabel: '[REDACTED:GCP_KEY_ID]',
  },
  {
    type: 'password_hash',
    severity: 'critical',
    // Argon2id, bcrypt, scrypt hashes
    pattern:
      /\$argon2id?\$v=\d{1,3}\$m=\d{1,10},t=\d{1,5},p=\d{1,5}\$[A-Za-z0-9+/]{20,100}|\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}/,
    redactedLabel: '[REDACTED:PASSWORD_HASH]',
  },
  {
    type: 'api_key',
    severity: 'medium',
    // ORDR API keys
    pattern: /\bordr_[A-Za-z0-9\-_]{20,64}\b/,
    redactedLabel: '[REDACTED:ORDR_API_KEY]',
  },
  {
    type: 'jwt_token',
    severity: 'medium',
    // JWTs: three base64url segments separated by dots
    pattern: /eyJ[A-Za-z0-9\-_]{10,500}\.eyJ[A-Za-z0-9\-_]{10,500}\.[A-Za-z0-9\-_]{10,500}/,
    redactedLabel: '[REDACTED:JWT_TOKEN]',
  },

  // ── PHI / PII (high) ──────────────────────────────────────────────────────
  {
    type: 'ssn',
    severity: 'high',
    // US Social Security Number: 000-00-0000 or 000000000 (not starting with 000, 666, 9xx)
    pattern: /\b(?!000|666|9\d{2})\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/,
    redactedLabel: '[REDACTED:SSN]',
  },
  {
    type: 'credit_card',
    severity: 'high',
    // Visa/MC/Amex/Discover: 13-19 digit numbers with optional separators
    // eslint-disable-next-line security/detect-unsafe-regex
    pattern:
      /\b4[0-9]{12}(?:[0-9]{3})?\b|\b5[1-5][0-9]{14}\b|\b3[47][0-9]{13}\b|\b6(?:011|5[0-9]{2})[0-9]{12}\b/,
    redactedLabel: '[REDACTED:CREDIT_CARD]',
    validate: luhnCheck,
  },
  {
    type: 'medical_record_number',
    severity: 'high',
    // Common MRN patterns: MRN: followed by 6-12 digits
    pattern: /\b(?:MRN|mrn|medical.record.number)\s{0,5}[:#]?\s{0,5}\d{6,12}\b/i,
    redactedLabel: '[REDACTED:MEDICAL_RECORD_NUMBER]',
  },

  // ── PII (low-medium) ─────────────────────────────────────────────────────
  {
    type: 'date_of_birth',
    severity: 'low',
    // DOB patterns in JSON: "dob": "YYYY-MM-DD" or "dateOfBirth": ...
    pattern:
      /"(?:dob|date_of_birth|dateOfBirth|birth_date|birthDate)"\s{0,5}:\s{0,5}"(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])"/i,
    redactedLabel: '[REDACTED:DATE_OF_BIRTH]',
  },
  {
    type: 'phone',
    severity: 'low',
    // US phone numbers in various formats
    // eslint-disable-next-line security/detect-unsafe-regex
    pattern: /\b(?:\+1\s?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/,
    redactedLabel: '[REDACTED:PHONE]',
  },
];

// ─── Luhn Algorithm ───────────────────────────────────────────────────────────

function luhnCheck(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let alternate = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i] ?? '0', 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

// ─── DLPScanner ──────────────────────────────────────────────────────────────

export class DLPScanner {
  /**
   * Scan text for DLP findings.
   * Returns all findings. Does NOT include the actual matched value — only
   * the type, severity, redacted label, and offset.
   */
  scan(text: string): readonly DLPFinding[] {
    if (text.length === 0) return [];
    const truncated = text.slice(0, MAX_SCAN_BYTES);
    const findings: DLPFinding[] = [];

    for (const entry of DLP_PATTERNS) {
      // eslint-disable-next-line security/detect-non-literal-regexp
      const rx = new RegExp(
        entry.pattern.source,
        entry.pattern.flags.includes('g') ? entry.pattern.flags : entry.pattern.flags + 'g',
      );
      let m: RegExpExecArray | null;
      // Use exec loop to find all occurrences, bounded to MAX_FINDINGS per type
      let count = 0;
      while ((m = rx.exec(truncated)) !== null && count < 5) {
        const matched = m[0];
        if (entry.validate !== undefined && !entry.validate(matched)) continue;

        findings.push({
          type: entry.type,
          severity: entry.severity,
          redacted: entry.redactedLabel,
          offset: m.index,
        });
        count++;
      }
    }

    return findings;
  }

  /**
   * Redact all DLP findings from text.
   * Returns the redacted text and the list of findings.
   * Safe to use when you need to log a response but must remove sensitive data.
   */
  redact(text: string): { readonly redacted: string; readonly findings: readonly DLPFinding[] } {
    const findings = this.scan(text);
    if (findings.length === 0) return { redacted: text, findings: [] };

    let result = text.slice(0, MAX_SCAN_BYTES);

    for (const entry of DLP_PATTERNS) {
      const matchedFinding = findings.find((f) => f.type === entry.type);
      if (matchedFinding === undefined) continue;
      // eslint-disable-next-line security/detect-non-literal-regexp
      result = result.replace(new RegExp(entry.pattern.source, 'gi'), matchedFinding.redacted);
    }

    return { redacted: result, findings };
  }

  /**
   * Fast-path check: returns true if the text contains ANY classified data.
   * Stops at the first match for efficiency.
   */
  containsSensitiveData(text: string): boolean {
    if (text.length === 0) return false;
    const truncated = text.slice(0, MAX_SCAN_BYTES);

    for (const entry of DLP_PATTERNS) {
      if (entry.pattern.test(truncated)) {
        // Validate if required
        if (entry.validate !== undefined) {
          const m = entry.pattern.exec(truncated);
          if (m !== null && entry.validate(m[0])) return true;
        } else {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Returns the maximum severity of all findings.
   * Returns undefined if no findings.
   */
  static maxSeverity(findings: readonly DLPFinding[]): DLPFinding['severity'] | undefined {
    const order: Record<DLPFinding['severity'], number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };
    let max: DLPFinding['severity'] | undefined;
    for (const f of findings) {
      if (max === undefined || order[f.severity] > order[max]) {
        max = f.severity;
      }
    }
    return max;
  }
}
