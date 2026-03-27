/**
 * HTTP response helpers for Hono route handlers.
 *
 * Centralizes the statusCode cast that Hono requires:
 * AppError.statusCode is typed as `number` but c.json() requires
 * `ContentfulStatusCode`. These helpers encapsulate that cast once.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppError } from '@ordr/core';

/**
 * Return a JSON error response from an AppError.
 * Casts statusCode to ContentfulStatusCode so Hono's overloads resolve.
 */
export function jsonErr(c: Context, error: AppError): Response {
  return c.json(error.toSafeResponse(), error.statusCode as ContentfulStatusCode);
}
