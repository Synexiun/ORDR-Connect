/**
 * Global Error Handler — safe, structured error responses
 *
 * SOC2 CC7.2 — Monitoring: log all errors with correlation IDs.
 * ISO 27001 A.14.1.2 — Prevent information leakage via error messages.
 * HIPAA §164.312(b) — Audit controls for system failures.
 *
 * SECURITY INVARIANTS:
 * - NEVER exposes stack traces to the client
 * - NEVER exposes internal paths or technology details
 * - ALWAYS returns a correlation ID for support/debugging
 * - ALWAYS logs the full error internally with stack trace
 * - AppErrors use their safe response; unknown errors become 500
 */

import type { ErrorHandler } from 'hono';
import { AppError, InternalError, isAppError } from '@ordr/core';
import type { Env } from '../types.js';

/**
 * Hono error handler. Mounted via `app.onError()`.
 *
 * Returns: `{ success: false, error: { code, message, correlationId } }`
 */
export const globalErrorHandler: ErrorHandler<Env> = (error, c) => {
  const requestId = c.get('requestId');

  // ---- Classify the error ---------------------------------------------------

  let appError: AppError;

  if (isAppError(error)) {
    appError = error;
    // Attach correlation ID if not already set
    if (appError.correlationId === undefined || appError.correlationId.length === 0) {
      appError = new AppError(
        appError.message,
        appError.code,
        appError.statusCode,
        appError.isOperational,
        requestId,
      );
    }
  } else {
    // Unknown / unexpected error — wrap as InternalError
    appError = new InternalError(
      error instanceof Error ? error.message : 'Unknown error',
      requestId,
    );
  }

  // ---- Log full error internally (with stack trace) -------------------------

  const logPayload = {
    correlationId: requestId,
    code: appError.code,
    statusCode: appError.statusCode,
    message: appError.message,
    isOperational: appError.isOperational,
    stack: error instanceof Error ? error.stack : undefined,
  };

  if (appError.isOperational) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        component: 'error-handler',
        event: 'operational_error',
        ...logPayload,
      }),
    );
  } else {
    // Non-operational = unexpected / programmer error — critical log
    console.error(
      JSON.stringify({
        level: 'error',
        component: 'error-handler',
        event: 'unexpected_error',
        ...logPayload,
      }),
    );
  }

  // ---- Return safe response to client ---------------------------------------

  const safeResponse = appError.toSafeResponse();

  return c.json(
    {
      success: false as const,
      error: {
        code: safeResponse.error.code,
        message: safeResponse.error.message,
        correlationId: requestId,
      },
    },
    appError.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 451 | 500,
  );
};
