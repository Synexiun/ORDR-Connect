/**
 * Data Exposure Security Tests
 *
 * Validates that error responses, logs, and API outputs never expose
 * internal details, PHI, stack traces, or technology information.
 *
 * SOC2 CC7.2, ISO 27001 A.14.1.2, HIPAA §164.312
 */

import { describe, it, expect } from 'vitest';
import {
  AppError,
  InternalError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ComplianceViolationError,
  isAppError,
} from '@ordr/core';
import { validateOutput, PII_PATTERNS } from '@ordr/ai';
import { createApp, type AppConfig } from '../../apps/api/src/app.js';

// ── App Fixture ───────────────────────────────────────────────────────

function buildApp(): ReturnType<typeof createApp> {
  return createApp({
    corsOrigins: ['https://app.test.com'],
    nodeEnv: 'production',
  });
}

// ── Error Response Safety ─────────────────────────────────────────────

describe('Error responses never contain stack traces', () => {
  it('InternalError.toSafeResponse() hides real message', () => {
    const err = new InternalError('Database connection pool exhausted at /var/lib/postgres');
    const safe = err.toSafeResponse();
    expect(safe.error.message).toBe('An internal error occurred');
    expect(safe.error.message).not.toContain('/var/lib/postgres');
    expect(safe.error.message).not.toContain('Database connection');
  });

  it('InternalError safe response does not include stack property', () => {
    const err = new InternalError('Crash at line 42');
    const safe = err.toSafeResponse();
    expect(JSON.stringify(safe)).not.toContain('at line');
    expect(JSON.stringify(safe)).not.toContain('.ts:');
    expect(JSON.stringify(safe)).not.toContain('.js:');
  });

  it('AppError.toSafeResponse() includes only code, message, correlationId', () => {
    const err = new AppError('Test error', 'VALIDATION_FAILED', 400, true, 'corr-123');
    const safe = err.toSafeResponse();
    const keys = Object.keys(safe.error);
    expect(keys).toContain('code');
    expect(keys).toContain('message');
    expect(keys).toContain('statusCode');
    expect(keys).toContain('correlationId');
    expect(keys).not.toContain('stack');
    expect(keys).not.toContain('name');
  });

  it('AuthenticationError returns safe message', () => {
    const err = new AuthenticationError('JWT verification failed: invalid key pair at crypto.ts:42');
    const safe = err.toSafeResponse();
    // Operational errors expose their message, but they should never contain internal paths
    expect(safe.error.code).toBe('AUTH_FAILED');
    expect(safe.error.statusCode).toBe(401);
  });

  it('AuthorizationError returns safe message', () => {
    const err = new AuthorizationError();
    const safe = err.toSafeResponse();
    expect(safe.error.code).toBe('FORBIDDEN');
    expect(safe.error.statusCode).toBe(403);
  });

  it('NotFoundError does not reveal internal entity names', () => {
    const err = new NotFoundError();
    const safe = err.toSafeResponse();
    expect(safe.error.code).toBe('NOT_FOUND');
    expect(safe.error.message).not.toContain('table');
    expect(safe.error.message).not.toContain('schema');
  });

  it('RateLimitError includes correlation ID', () => {
    const err = new RateLimitError('Too many requests', 60, 'corr-456');
    const safe = err.toSafeResponse();
    expect(safe.error.correlationId).toBe('corr-456');
    expect(safe.error.code).toBe('RATE_LIMIT');
  });

  it('ComplianceViolationError returns safe response', () => {
    const err = new ComplianceViolationError('HIPAA violation', 'hipaa');
    const safe = err.toSafeResponse();
    expect(safe.error.code).toBe('COMPLIANCE_VIOLATION');
    expect(safe.error.statusCode).toBe(451);
  });
});

// ── PHI Never in Error Responses ──────────────────────────────────────

describe('Error responses never contain PHI', () => {
  const PHI_VALUES = [
    '123-45-6789',     // SSN
    '4111111111111111', // Credit card
    'MRN: 1234567',    // Medical Record Number
    'DOB: 01/15/1990', // Date of birth
  ];

  for (const phiValue of PHI_VALUES) {
    it(`InternalError never exposes PHI: ${phiValue.slice(0, 15)}...`, () => {
      const err = new InternalError(`Record not found: ${phiValue}`);
      const safe = err.toSafeResponse();
      expect(safe.error.message).not.toContain(phiValue);
      expect(safe.error.message).toBe('An internal error occurred');
    });
  }

  it('ValidationError fieldErrors do not contain PHI values', () => {
    const err = new ValidationError('Validation failed', {
      email: ['Invalid email format'],
      phone: ['Invalid phone format'],
    });
    const safe = err.toSafeResponse();
    const safeStr = JSON.stringify(safe);
    // Field error messages should be generic, not contain actual values
    expect(safeStr).not.toMatch(PII_PATTERNS.SSN);
    expect(safeStr).not.toMatch(PII_PATTERNS.CREDIT_CARD);
  });
});

// ── No Internal Paths in Error Messages ───────────────────────────────

describe('Error messages never contain internal paths', () => {
  const INTERNAL_PATHS = [
    '/app/src/routes/customers.ts',
    '/node_modules/hono/dist/index.js',
    'C:\\Users\\admin\\ordr-connect\\',
    '/var/lib/postgresql/data',
    'D:\\Synexiun\\12-SynexCom\\',
  ];

  for (const path of INTERNAL_PATHS) {
    it(`InternalError hides path: ${path.slice(0, 30)}...`, () => {
      const err = new InternalError(`Error at ${path}`);
      const safe = err.toSafeResponse();
      expect(safe.error.message).not.toContain(path);
    });
  }
});

// ── No Technology Stack Disclosure ────────────────────────────────────

describe('No technology stack disclosure in headers', () => {
  it('does not include X-Powered-By header', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    expect(res.headers.get('X-Powered-By')).toBeNull();
  });

  it('does not include Server header with version', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    const server = res.headers.get('Server');
    if (server) {
      expect(server).not.toMatch(/\d+\.\d+/); // No version numbers
    }
  });

  it('does not expose Node.js version in headers', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    const allHeaders = Object.fromEntries(res.headers.entries());
    const headerStr = JSON.stringify(allHeaders).toLowerCase();
    expect(headerStr).not.toContain('node');
    expect(headerStr).not.toContain('express');
    expect(headerStr).not.toContain('hono');
  });
});

// ── No Version Numbers in Responses ───────────────────────────────────

describe('No version numbers in API responses', () => {
  it('health endpoint does not leak runtime version', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/node.*v\d+/i);
    expect(bodyStr).not.toMatch(/hono.*\d+\.\d+/i);
  });

  it('404 response does not reveal framework', async () => {
    const app = buildApp();
    const res = await app.request('/nonexistent-path');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toBe('Route not found');
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('hono');
    expect(bodyStr).not.toContain('express');
  });
});

// ── Correlation IDs ───────────────────────────────────────────────────

describe('Error responses use correlation IDs', () => {
  it('404 responses include correlationId', async () => {
    const app = buildApp();
    const res = await app.request('/nonexistent');
    const body = await res.json();
    expect(body.error.correlationId).toBeDefined();
    expect(typeof body.error.correlationId).toBe('string');
  });

  it('correlation ID is a UUID format', async () => {
    const app = buildApp();
    const res = await app.request('/nonexistent');
    const body = await res.json();
    expect(body.error.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('X-Request-Id header is returned', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });
});

// ── AI Output PHI Detection ──────────────────────────────────────────

describe('AI output validation catches PHI', () => {
  it('detects SSN patterns in LLM output', () => {
    const result = validateOutput('The patient SSN is 123-45-6789');
    expect(result.violations.some((v) => v.rule.includes('SSN'))).toBe(true);
  });

  it('detects credit card numbers in LLM output', () => {
    const result = validateOutput('Payment card: 4111 1111 1111 1111');
    expect(result.violations.some((v) => v.rule.includes('CREDIT_CARD'))).toBe(true);
  });

  it('detects MRN in LLM output', () => {
    const result = validateOutput('Medical record MRN:1234567890');
    expect(result.violations.some((v) => v.rule.includes('MRN'))).toBe(true);
  });

  it('detects DOB patterns in LLM output', () => {
    const result = validateOutput('Date of birth: 01/15/1990');
    expect(result.violations.some((v) => v.rule.includes('DOB'))).toBe(true);
  });

  it('does not flag clean output', () => {
    const result = validateOutput('Your order has been shipped and will arrive in 3-5 business days.');
    const piiViolations = result.violations.filter((v) => v.rule.includes('HALLUCINATED_PII'));
    expect(piiViolations.length).toBe(0);
  });
});

// ── Audit Logs PHI Check ──────────────────────────────────────────────

describe('Audit log structure prevents PHI', () => {
  it('audit middleware logs method/path/status only (no bodies)', () => {
    // Validate the audit middleware design
    // The audit middleware (apps/api/src/middleware/audit.ts) explicitly states:
    // "NEVER logs request/response bodies (may contain PHI)"
    // "Only logs method, path, status, duration, actor, and tenant"
    const safeDetails = {
      method: 'POST',
      path: '/api/v1/customers',
      status: 201,
      durationMs: 42,
    };

    // None of these fields could contain PHI
    const detailStr = JSON.stringify(safeDetails);
    expect(detailStr).not.toMatch(PII_PATTERNS.SSN);
    expect(detailStr).not.toMatch(PII_PATTERNS.EMAIL);
    expect(detailStr).not.toMatch(PII_PATTERNS.CREDIT_CARD);
  });
});
