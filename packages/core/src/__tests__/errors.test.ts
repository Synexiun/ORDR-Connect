import { describe, it, expect } from 'vitest';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  ConflictError,
  RateLimitError,
  ComplianceViolationError,
  InternalError,
  ERROR_CODES,
  isAppError,
  isOperationalError,
} from '../errors.js';

// ─── AppError Base ────────────────────────────────────────────────

describe('AppError', () => {
  it('creates an error with all required fields', () => {
    const error = new AppError('test error', ERROR_CODES.INTERNAL_ERROR, 500, true, 'corr-123');
    expect(error.message).toBe('test error');
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.isOperational).toBe(true);
    expect(error.correlationId).toBe('corr-123');
    expect(error.name).toBe('AppError');
  });

  it('defaults isOperational to true', () => {
    const error = new AppError('test', ERROR_CODES.NOT_FOUND, 404);
    expect(error.isOperational).toBe(true);
  });

  it('extends Error', () => {
    const error = new AppError('test', ERROR_CODES.NOT_FOUND, 404);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
  });

  it('has a stack trace', () => {
    const error = new AppError('test', ERROR_CODES.NOT_FOUND, 404);
    expect(error.stack).toBeDefined();
  });
});

// ─── toSafeResponse — SECURITY ───────────────────────────────────

describe('toSafeResponse()', () => {
  it('returns code, message, statusCode, correlationId', () => {
    const error = new AppError('Not found', ERROR_CODES.NOT_FOUND, 404, true, 'corr-456');
    const safe = error.toSafeResponse();

    expect(safe.error.code).toBe('NOT_FOUND');
    expect(safe.error.message).toBe('Not found');
    expect(safe.error.statusCode).toBe(404);
    expect(safe.error.correlationId).toBe('corr-456');
  });

  it('NEVER exposes stack traces', () => {
    const error = new AppError('test', ERROR_CODES.INTERNAL_ERROR, 500);
    const safe = error.toSafeResponse();
    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain('at ');
    expect(serialized).not.toContain('.ts');
    expect(serialized).not.toContain('.js');
    expect(serialized).not.toContain('node_modules');
    expect(serialized).not.toContain('stack');
  });

  it('hides message for non-operational errors', () => {
    const error = new AppError(
      'database connection leaked secret info',
      ERROR_CODES.INTERNAL_ERROR,
      500,
      false,
    );
    const safe = error.toSafeResponse();

    expect(safe.error.message).toBe('An internal error occurred');
    expect(safe.error.message).not.toContain('database');
    expect(safe.error.message).not.toContain('secret');
  });
});

// ─── Specific Error Classes ───────────────────────────────────────

describe('AuthenticationError', () => {
  it('defaults to 401 and AUTH_FAILED', () => {
    const error = new AuthenticationError();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.isOperational).toBe(true);
    expect(error.name).toBe('AuthenticationError');
  });

  it('accepts custom message and correlationId', () => {
    const error = new AuthenticationError('Token expired', 'corr-789');
    expect(error.message).toBe('Token expired');
    expect(error.correlationId).toBe('corr-789');
  });

  it('extends AppError', () => {
    expect(new AuthenticationError()).toBeInstanceOf(AppError);
  });
});

describe('AuthorizationError', () => {
  it('defaults to 403 and FORBIDDEN', () => {
    const error = new AuthorizationError();
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.isOperational).toBe(true);
    expect(error.name).toBe('AuthorizationError');
  });
});

describe('NotFoundError', () => {
  it('defaults to 404 and NOT_FOUND', () => {
    const error = new NotFoundError();
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.name).toBe('NotFoundError');
  });
});

describe('ValidationError', () => {
  it('defaults to 400 and VALIDATION_FAILED', () => {
    const error = new ValidationError();
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.name).toBe('ValidationError');
  });

  it('includes field errors in safe response', () => {
    const error = new ValidationError('Invalid input', {
      email: ['Invalid email format'],
      name: ['Name is required', 'Name too short'],
    });
    const safe = error.toSafeResponse();

    expect(safe.error.fields).toBeDefined();
    expect(safe.error.fields?.email).toEqual(['Invalid email format']);
    expect(safe.error.fields?.name).toHaveLength(2);
  });

  it('omits fields key when no field errors', () => {
    const error = new ValidationError('Bad input');
    const safe = error.toSafeResponse();

    expect(safe.error.fields).toBeUndefined();
  });

  it('safe response NEVER exposes stack even with field errors', () => {
    const error = new ValidationError('fail', { email: ['bad'] });
    const serialized = JSON.stringify(error.toSafeResponse());

    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('at ');
  });
});

describe('ConflictError', () => {
  it('defaults to 409 and CONFLICT', () => {
    const error = new ConflictError();
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.name).toBe('ConflictError');
  });
});

describe('RateLimitError', () => {
  it('defaults to 429 and RATE_LIMIT', () => {
    const error = new RateLimitError();
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.name).toBe('RateLimitError');
  });

  it('accepts custom retryAfterSeconds', () => {
    const error = new RateLimitError('Slow down', 120);
    expect(error.retryAfterSeconds).toBe(120);
  });
});

describe('ComplianceViolationError', () => {
  it('defaults to 451 and COMPLIANCE_VIOLATION', () => {
    const error = new ComplianceViolationError();
    expect(error.statusCode).toBe(451);
    expect(error.code).toBe('COMPLIANCE_VIOLATION');
    expect(error.regulation).toBe('unspecified');
    expect(error.name).toBe('ComplianceViolationError');
  });

  it('carries regulation name', () => {
    const error = new ComplianceViolationError('PHI violation', 'HIPAA');
    expect(error.regulation).toBe('HIPAA');
  });
});

describe('InternalError', () => {
  it('defaults to 500 with isOperational false', () => {
    const error = new InternalError();
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.isOperational).toBe(false);
    expect(error.name).toBe('InternalError');
  });

  it('ALWAYS hides real message in safe response', () => {
    const error = new InternalError('database password: hunter2');
    const safe = error.toSafeResponse();

    expect(safe.error.message).toBe('An internal error occurred');
    expect(safe.error.message).not.toContain('hunter2');
    expect(safe.error.message).not.toContain('database');
  });

  it('safe response preserves correlationId', () => {
    const error = new InternalError('crash', 'corr-abc');
    const safe = error.toSafeResponse();

    expect(safe.error.correlationId).toBe('corr-abc');
  });
});

// ─── Type Guards ──────────────────────────────────────────────────

describe('isAppError()', () => {
  it('returns true for AppError instances', () => {
    expect(isAppError(new AppError('x', ERROR_CODES.NOT_FOUND, 404))).toBe(true);
    expect(isAppError(new NotFoundError())).toBe(true);
    expect(isAppError(new InternalError())).toBe(true);
  });

  it('returns false for non-AppError values', () => {
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError(42)).toBe(false);
  });
});

describe('isOperationalError()', () => {
  it('returns true for operational AppErrors', () => {
    expect(isOperationalError(new NotFoundError())).toBe(true);
    expect(isOperationalError(new AuthenticationError())).toBe(true);
  });

  it('returns false for non-operational AppErrors', () => {
    expect(isOperationalError(new InternalError())).toBe(false);
  });

  it('returns false for non-AppError values', () => {
    expect(isOperationalError(new Error('plain'))).toBe(false);
    expect(isOperationalError(null)).toBe(false);
  });
});

// ─── Error Codes Enum ─────────────────────────────────────────────

describe('ERROR_CODES', () => {
  it('contains all expected codes', () => {
    expect(ERROR_CODES.AUTH_FAILED).toBe('AUTH_FAILED');
    expect(ERROR_CODES.AUTH_EXPIRED).toBe('AUTH_EXPIRED');
    expect(ERROR_CODES.FORBIDDEN).toBe('FORBIDDEN');
    expect(ERROR_CODES.TENANT_MISMATCH).toBe('TENANT_MISMATCH');
    expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    expect(ERROR_CODES.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
    expect(ERROR_CODES.CONFLICT).toBe('CONFLICT');
    expect(ERROR_CODES.RATE_LIMIT).toBe('RATE_LIMIT');
    expect(ERROR_CODES.COMPLIANCE_VIOLATION).toBe('COMPLIANCE_VIOLATION');
    expect(ERROR_CODES.PHI_ACCESS_DENIED).toBe('PHI_ACCESS_DENIED');
    expect(ERROR_CODES.AGENT_SAFETY_BLOCK).toBe('AGENT_SAFETY_BLOCK');
    expect(ERROR_CODES.AUDIT_CHAIN_BROKEN).toBe('AUDIT_CHAIN_BROKEN');
    expect(ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});
