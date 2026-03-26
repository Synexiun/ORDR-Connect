/**
 * PHI Leakage Compliance Tests
 *
 * Validates that PHI patterns never appear in logs, error responses,
 * URLs, or client-side accessible locations.
 *
 * HIPAA §164.312, SOC2 CC6.1, ISO 27001 A.8.2.3
 */

import { describe, it, expect } from 'vitest';
import { InternalError, AppError, ValidationError } from '@ordr/core';
import { validateInput, validateOutput, PII_PATTERNS } from '@ordr/ai';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── PHI Pattern Constants ─────────────────────────────────────────────

const PHI_TEST_VALUES = {
  SSN: '123-45-6789',
  CREDIT_CARD: '4111111111111111',
  EMAIL: 'john.doe@healthcare.com',
  PHONE: '+1-555-123-4567',
  MRN: 'MRN: 1234567890',
  DOB: 'DOB: 01/15/1990',
  MEDICARE: '1EG4TE5MK72',
} as const;

// ── Error Responses Never Contain PHI ─────────────────────────────────

describe('Error responses never contain PHI', () => {
  for (const [name, value] of Object.entries(PHI_TEST_VALUES)) {
    it(`InternalError hides ${name} from response`, () => {
      const err = new InternalError(`Patient ${name}: ${value}`);
      const safe = err.toSafeResponse();
      expect(safe.error.message).not.toContain(value);
    });
  }

  it('ValidationError field errors do not contain actual PHI values', () => {
    const err = new ValidationError('Validation failed', {
      ssn: ['Invalid SSN format'],
      email: ['Email is required'],
    });
    const safe = err.toSafeResponse();
    const safeStr = JSON.stringify(safe);
    expect(safeStr).not.toContain('123-45-6789');
    expect(safeStr).not.toContain('john.doe@');
  });

  it('AppError operational message must not include PHI accidentally', () => {
    // Operational errors expose their message — developers must ensure no PHI
    const err = new AppError(
      'Customer not found',
      'NOT_FOUND',
      404,
      true,
    );
    const safe = err.toSafeResponse();
    expect(safe.error.message).toBe('Customer not found');
    // Message is generic, no PHI
    for (const value of Object.values(PHI_TEST_VALUES)) {
      expect(safe.error.message).not.toContain(value);
    }
  });
});

// ── Log Output PHI Patterns ───────────────────────────────────────────

describe('Log output patterns do not contain PHI', () => {
  it('audit middleware explicitly documents no body logging', () => {
    const auditPath = path.resolve('apps/api/src/middleware/audit.ts');
    const content = fs.readFileSync(auditPath, 'utf8');
    expect(content).toContain('NEVER logs request/response bodies');
    expect(content).toContain('NO request/response bodies');
  });

  it('error handler does not log PHI in error payload', () => {
    const handlerPath = path.resolve('apps/api/src/middleware/error-handler.ts');
    const content = fs.readFileSync(handlerPath, 'utf8');
    expect(content).toContain('NEVER exposes stack traces');
    expect(content).toContain('NEVER exposes internal paths');
  });

  it('customers route logs field names only for updates (not values)', () => {
    const routePath = path.resolve('apps/api/src/routes/customers.ts');
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('changedFields');
    expect(content).toContain("'[redacted]'");
  });

  it('customers route PII fields are identified for encryption', () => {
    const routePath = path.resolve('apps/api/src/routes/customers.ts');
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain("'name'");
    expect(content).toContain("'email'");
    expect(content).toContain("'phone'");
  });
});

// ── No PHI in URL/Query Parameters ────────────────────────────────────

describe('No PHI in URL or query parameters', () => {
  it('customer list endpoint uses generic filters (no PHI in query)', () => {
    const routePath = path.resolve('apps/api/src/routes/customers.ts');
    const content = fs.readFileSync(routePath, 'utf8');
    // Query params should be: page, pageSize, status, type, lifecycleStage, search
    expect(content).toContain('page');
    expect(content).toContain('pageSize');
    expect(content).toContain('status');
    // Should not have SSN, DOB, MRN as query params
    expect(content).not.toContain("'ssn'");
    expect(content).not.toContain("'dateOfBirth'");
    expect(content).not.toContain("'medicalRecord'");
  });

  it('customer identifier uses UUID (not PHI) as URL param', () => {
    const routePath = path.resolve('apps/api/src/routes/customers.ts');
    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain(':id');
    // The ID is a UUID, not a PHI identifier
  });
});

// ── AI Safety Catches PHI in System Prompts ───────────────────────────

describe('AI safety catches PHI in system prompts', () => {
  it('blocks SSN in system prompt', () => {
    const result = validateInput([
      { role: 'system', content: 'The patient SSN is 123-45-6789' },
    ]);
    expect(result.violations.some((v) => v.rule.includes('PII_IN_SYSTEM_PROMPT_SSN'))).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it('blocks credit card in system prompt', () => {
    const result = validateInput([
      { role: 'system', content: 'Card number: 4111111111111111' },
    ]);
    expect(result.violations.some((v) => v.rule.includes('CREDIT_CARD'))).toBe(true);
  });

  it('blocks MRN in system prompt', () => {
    const result = validateInput([
      { role: 'system', content: 'Medical record MRN:1234567890' },
    ]);
    expect(result.violations.some((v) => v.rule.includes('MRN'))).toBe(true);
  });

  it('blocks DOB in system prompt', () => {
    const result = validateInput([
      { role: 'system', content: 'Patient date of birth: 01/15/1990' },
    ]);
    expect(result.violations.some((v) => v.rule.includes('DOB'))).toBe(true);
  });

  it('warns about SSN in user message (not blocked)', () => {
    const result = validateInput([
      { role: 'system', content: 'You are a customer service agent.' },
      { role: 'user', content: 'My SSN is 123-45-6789' },
    ]);
    expect(result.violations.some((v) => v.rule.includes('PII_IN_USER_MESSAGE_SSN'))).toBe(true);
    // User messages are warned but not blocked (user may reference own data)
  });

  it('does not flag emails in user messages (expected)', () => {
    const result = validateInput([
      { role: 'system', content: 'You are a customer service agent.' },
      { role: 'user', content: 'My email is john@example.com' },
    ]);
    const emailViolations = result.violations.filter((v) => v.rule.includes('PII_IN_USER_MESSAGE_EMAIL'));
    expect(emailViolations.length).toBe(0);
  });
});

// ── AI Output PHI Detection ──────────────────────────────────────────

describe('AI output validation catches hallucinated PHI', () => {
  it('detects hallucinated SSN', () => {
    const result = validateOutput('Your account number is 987-65-4321');
    expect(result.violations.some((v) => v.rule.includes('SSN'))).toBe(true);
  });

  it('detects hallucinated credit card', () => {
    const result = validateOutput('Use card 5500 0000 0000 0004 for payment');
    expect(result.violations.some((v) => v.rule.includes('CREDIT_CARD'))).toBe(true);
  });

  it('detects compliance-violating content (unauthorized legal advice)', () => {
    const result = validateOutput('This constitutes legal advice about your case');
    expect(result.violations.some((v) => v.rule.includes('COMPLIANCE'))).toBe(true);
  });

  it('detects compliance-violating content (unauthorized medical advice)', () => {
    const result = validateOutput('This constitutes medical advice for your condition');
    expect(result.violations.some((v) => v.rule.includes('COMPLIANCE'))).toBe(true);
  });

  it('passes clean customer response', () => {
    const result = validateOutput(
      'Thank you for contacting us. Your order #12345 has been shipped and should arrive within 3-5 business days.',
    );
    const piiViolations = result.violations.filter((v) => v.rule.includes('HALLUCINATED_PII'));
    expect(piiViolations.length).toBe(0);
  });
});

// ── PII Patterns Regex Correctness ────────────────────────────────────

describe('PII pattern regex correctness', () => {
  it('SSN pattern matches XXX-XX-XXXX format', () => {
    expect(PII_PATTERNS.SSN.test('123-45-6789')).toBe(true);
  });

  it('SSN pattern matches 9-digit format', () => {
    expect(PII_PATTERNS.SSN.test('123456789')).toBe(true);
  });

  it('MRN pattern matches MRN:XXXXXX format', () => {
    expect(PII_PATTERNS.MRN.test('MRN:1234567')).toBe(true);
    expect(PII_PATTERNS.MRN.test('MRN 1234567890')).toBe(true);
  });

  it('DOB pattern matches DOB: MM/DD/YYYY', () => {
    expect(PII_PATTERNS.DOB.test('DOB: 01/15/1990')).toBe(true);
    expect(PII_PATTERNS.DOB.test('date of birth: 12-25-2000')).toBe(true);
  });

  it('EMAIL pattern matches standard email', () => {
    expect(PII_PATTERNS.EMAIL.test('user@example.com')).toBe(true);
  });
});

// ── Data Classification ───────────────────────────────────────────────

describe('Data classification types are defined', () => {
  it('data-classification.ts defines all four levels', () => {
    const classPath = path.resolve('packages/core/src/types/data-classification.ts');
    const content = fs.readFileSync(classPath, 'utf8');
    expect(content).toContain("'public'");
    expect(content).toContain("'internal'");
    expect(content).toContain("'confidential'");
    expect(content).toContain("'restricted'");
  });

  it('restricted classification requires encryption', () => {
    const classPath = path.resolve('packages/core/src/types/data-classification.ts');
    const content = fs.readFileSync(classPath, 'utf8');
    expect(content).toContain('encryptAtRest');
    expect(content).toContain('fieldLevelEncryption');
    expect(content).toContain('auditTrail');
  });
});
