/**
 * Safety validation — pre-flight and post-response safety checks
 *
 * SECURITY (CLAUDE.md Rules 4, 6, 9):
 * - Detects PII/PHI patterns before sending to LLM (HIPAA §164.312)
 * - Validates output for hallucinated PII
 * - Checks for prompt injection attacks
 * - Every check is logged via metadata only — NEVER log actual content
 */

import type { LLMMessage, SafetyCheckResult, SafetyViolation } from './types.js';

// ─── PII Pattern Definitions ─────────────────────────────────────

/**
 * Regex patterns for detecting PII/PHI in text.
 * Each pattern is named for audit trail clarity.
 */
export const PII_PATTERNS = {
  /** US Social Security Number: XXX-XX-XXXX or XXXXXXXXX */
  SSN: /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/,

  /** Credit card numbers: 13-19 digits with optional spaces/dashes */
  CREDIT_CARD: /\b(?:\d[ -]*?){13,19}\b/,

  /** US phone numbers: various formats */
  PHONE: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/,

  /** Email addresses */
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,

  /** US Medicare/Medicaid numbers */
  MEDICARE: /\b[1-9][A-Za-z][A-Za-z0-9]\d{4}[A-Za-z]\d{2}\b/,

  /** Medical Record Numbers (common 6-10 digit pattern) */
  MRN: /\bMRN[:\s]?\d{6,10}\b/i,

  /** Date of birth patterns */
  DOB: /\b(?:DOB|date\s+of\s+birth)[:\s]+\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b/i,

  /** US Driver's license (generic state pattern) */
  DRIVERS_LICENSE: /\b[A-Z]\d{3,8}\b/,
} as const;

// ─── Prompt Injection Patterns ───────────────────────────────────

/**
 * Patterns that indicate prompt injection attempts.
 * These are checked on user-provided content only (not system prompts).
 */
export const INJECTION_PATTERNS = {
  /** Direct instruction override attempts */
  IGNORE_INSTRUCTIONS: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,

  /** Role hijacking */
  ROLE_HIJACK: /you\s+are\s+now\s+(a|an|the)\s+(?!customer|client)/i,

  /** System prompt extraction */
  SYSTEM_PROMPT_EXTRACTION: /(?:reveal|show|display|print|output)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions|rules)/i,

  /** Jailbreak patterns */
  JAILBREAK: /(?:DAN|do\s+anything\s+now|developer\s+mode|unrestricted\s+mode)/i,

  /** Encoding bypass attempts */
  ENCODING_BYPASS: /(?:base64|hex|rot13|unicode)\s*(?:decode|encode|convert)/i,
} as const;

// ─── Message Length Limits ───────────────────────────────────────

export const MESSAGE_LIMITS = {
  /** Maximum characters per individual message */
  MAX_MESSAGE_LENGTH: 100_000,
  /** Maximum total characters across all messages */
  MAX_TOTAL_LENGTH: 500_000,
  /** Maximum number of messages in a request */
  MAX_MESSAGE_COUNT: 100,
} as const;

// ─── Input Validation ────────────────────────────────────────────

/**
 * Pre-flight safety check on LLM request messages.
 *
 * Checks:
 * 1. PII/PHI patterns in system prompts (critical — blocks request)
 * 2. Message length limits
 * 3. Prompt injection patterns in user messages
 *
 * SECURITY: This function NEVER logs message content.
 * It returns violation metadata only.
 */
export function validateInput(messages: readonly LLMMessage[]): SafetyCheckResult {
  const violations: SafetyViolation[] = [];

  // ── Check message count ─────────────────────────────
  if (messages.length > MESSAGE_LIMITS.MAX_MESSAGE_COUNT) {
    violations.push({
      rule: 'MAX_MESSAGE_COUNT',
      description: `Message count ${messages.length} exceeds limit of ${MESSAGE_LIMITS.MAX_MESSAGE_COUNT}`,
      severity: 'high',
    });
  }

  if (messages.length === 0) {
    violations.push({
      rule: 'EMPTY_MESSAGES',
      description: 'Request contains no messages',
      severity: 'high',
    });
  }

  // ── Check total length ──────────────────────────────
  let totalLength = 0;
  for (const msg of messages) {
    totalLength += msg.content.length;
  }

  if (totalLength > MESSAGE_LIMITS.MAX_TOTAL_LENGTH) {
    violations.push({
      rule: 'MAX_TOTAL_LENGTH',
      description: `Total message length ${totalLength} exceeds limit of ${MESSAGE_LIMITS.MAX_TOTAL_LENGTH}`,
      severity: 'high',
    });
  }

  // ── Check individual messages ───────────────────────
  for (const msg of messages) {
    // Length check
    if (msg.content.length > MESSAGE_LIMITS.MAX_MESSAGE_LENGTH) {
      violations.push({
        rule: 'MAX_MESSAGE_LENGTH',
        description: `Message with role '${msg.role}' exceeds max length of ${MESSAGE_LIMITS.MAX_MESSAGE_LENGTH}`,
        severity: 'medium',
      });
    }

    // PII in system prompts is critical — these are developer-controlled
    if (msg.role === 'system') {
      for (const [patternName, regex] of Object.entries(PII_PATTERNS)) {
        if (regex.test(msg.content)) {
          violations.push({
            rule: `PII_IN_SYSTEM_PROMPT_${patternName}`,
            description: `System prompt contains potential ${patternName} pattern`,
            severity: 'critical',
          });
        }
      }
    }

    // PII in user messages — warn but do not block (user may be referencing their own data)
    if (msg.role === 'user') {
      for (const [patternName, regex] of Object.entries(PII_PATTERNS)) {
        if (patternName === 'EMAIL') continue; // Emails in user messages are common/expected
        if (regex.test(msg.content)) {
          violations.push({
            rule: `PII_IN_USER_MESSAGE_${patternName}`,
            description: `User message contains potential ${patternName} pattern`,
            severity: 'high',
          });
        }
      }
    }

    // Injection patterns — only in user messages
    if (msg.role === 'user') {
      for (const [patternName, regex] of Object.entries(INJECTION_PATTERNS)) {
        if (regex.test(msg.content)) {
          violations.push({
            rule: `INJECTION_${patternName}`,
            description: `Potential prompt injection detected: ${patternName}`,
            severity: 'critical',
          });
        }
      }
    }
  }

  const hasCritical = violations.some((v) => v.severity === 'critical');
  return {
    passed: violations.length === 0,
    violations,
    blocked: hasCritical,
  };
}

// ─── Output Validation ───────────────────────────────────────────

/**
 * Post-response safety check on LLM output.
 *
 * Checks:
 * 1. Hallucinated PII patterns (SSN, credit card numbers)
 * 2. Compliance-violating content (unauthorized disclosures)
 *
 * SECURITY: This function NEVER logs the response content.
 */
export function validateOutput(response: string): SafetyCheckResult {
  const violations: SafetyViolation[] = [];

  if (response.length === 0) {
    violations.push({
      rule: 'EMPTY_RESPONSE',
      description: 'LLM returned empty response',
      severity: 'low',
    });
    return { passed: false, violations, blocked: false };
  }

  // ── Check for hallucinated PII ──────────────────────
  for (const [patternName, regex] of Object.entries(PII_PATTERNS)) {
    if (patternName === 'EMAIL') continue; // Emails are often legitimate in responses
    if (patternName === 'PHONE') continue; // Business phone numbers are legitimate
    if (regex.test(response)) {
      violations.push({
        rule: `HALLUCINATED_PII_${patternName}`,
        description: `Response contains potential ${patternName} — may be hallucinated`,
        severity: 'high',
      });
    }
  }

  // ── Check for compliance-violating content ──────────
  const compliancePatterns = {
    AI_IDENTITY_EVASION: /I\s+am\s+(?:not\s+)?(?:a\s+)?(?:robot|AI|artificial|bot|machine)/i,
    UNAUTHORIZED_LEGAL_ADVICE: /(?:this\s+(?:is|constitutes)\s+)?legal\s+advice/i,
    UNAUTHORIZED_MEDICAL_ADVICE: /(?:this\s+(?:is|constitutes)\s+)?medical\s+(?:advice|diagnosis)/i,
    FDCPA_VIOLATION: /(?:you\s+(?:will|must)\s+(?:go\s+to\s+)?(?:jail|prison|be\s+arrested))/i,
  } as const;

  for (const [patternName, regex] of Object.entries(compliancePatterns)) {
    if (regex.test(response)) {
      violations.push({
        rule: `COMPLIANCE_${patternName}`,
        description: `Response may contain compliance-violating content: ${patternName}`,
        severity: 'critical',
      });
    }
  }

  const hasCritical = violations.some((v) => v.severity === 'critical');
  return {
    passed: violations.length === 0,
    violations,
    blocked: hasCritical,
  };
}
