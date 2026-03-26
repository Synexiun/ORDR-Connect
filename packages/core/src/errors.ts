/**
 * Error hierarchy — structured, safe error handling for ORDR-Connect
 *
 * SECURITY: toSafeResponse() NEVER exposes stack traces, internal paths,
 * or implementation details. All errors carry correlation IDs for tracing.
 */

// ─── Error Codes ──────────────────────────────────────────────────

export const ERROR_CODES = {
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT: 'RATE_LIMIT',
  COMPLIANCE_VIOLATION: 'COMPLIANCE_VIOLATION',
  PHI_ACCESS_DENIED: 'PHI_ACCESS_DENIED',
  AGENT_SAFETY_BLOCK: 'AGENT_SAFETY_BLOCK',
  AUDIT_CHAIN_BROKEN: 'AUDIT_CHAIN_BROKEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ─── Safe Response Type ───────────────────────────────────────────

export interface SafeErrorResponse {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly statusCode: number;
    readonly correlationId: string | undefined;
  };
}

// ─── Base Error ───────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly correlationId: string | undefined;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number,
    isOperational: boolean = true,
    correlationId?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.correlationId = correlationId;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Returns a safe response object for external consumers.
   * NEVER includes stack traces, internal paths, or debug info.
   */
  toSafeResponse(): SafeErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.isOperational ? this.message : 'An internal error occurred',
        statusCode: this.statusCode,
        correlationId: this.correlationId,
      },
    };
  }
}

// ─── Specific Error Classes ───────────────────────────────────────

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed', correlationId?: string) {
    super(message, ERROR_CODES.AUTH_FAILED, 401, true, correlationId);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', correlationId?: string) {
    super(message, ERROR_CODES.FORBIDDEN, 403, true, correlationId);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', correlationId?: string) {
    super(message, ERROR_CODES.NOT_FOUND, 404, true, correlationId);
  }
}

export class ValidationError extends AppError {
  public readonly fieldErrors: Record<string, string[]>;

  constructor(
    message: string = 'Validation failed',
    fieldErrors: Record<string, string[]> = {},
    correlationId?: string,
  ) {
    super(message, ERROR_CODES.VALIDATION_FAILED, 400, true, correlationId);
    this.fieldErrors = fieldErrors;
  }

  override toSafeResponse(): SafeErrorResponse & { error: { fields?: Record<string, string[]> | undefined } } {
    const hasFields = Object.keys(this.fieldErrors).length > 0;
    const base = {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      correlationId: this.correlationId,
    } as const;

    if (hasFields) {
      return { error: { ...base, fields: this.fieldErrors } };
    }
    return { error: base };
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict', correlationId?: string) {
    super(message, ERROR_CODES.CONFLICT, 409, true, correlationId);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfterSeconds: number;

  constructor(
    message: string = 'Rate limit exceeded',
    retryAfterSeconds: number = 60,
    correlationId?: string,
  ) {
    super(message, ERROR_CODES.RATE_LIMIT, 429, true, correlationId);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ComplianceViolationError extends AppError {
  public readonly regulation: string;

  constructor(
    message: string = 'Compliance violation',
    regulation: string = 'unspecified',
    correlationId?: string,
  ) {
    super(message, ERROR_CODES.COMPLIANCE_VIOLATION, 451, true, correlationId);
    this.regulation = regulation;
  }
}

export class InternalError extends AppError {
  constructor(message: string = 'Internal server error', correlationId?: string) {
    // isOperational = false — these are unexpected failures
    super(message, ERROR_CODES.INTERNAL_ERROR, 500, false, correlationId);
  }

  /**
   * Internal errors NEVER expose their real message externally.
   */
  override toSafeResponse(): SafeErrorResponse {
    return {
      error: {
        code: this.code,
        message: 'An internal error occurred',
        statusCode: this.statusCode,
        correlationId: this.correlationId,
      },
    };
  }
}

// ─── Type Guards ──────────────────────────────────────────────────

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isOperationalError(error: unknown): boolean {
  return isAppError(error) && error.isOperational;
}
