/**
 * Result type — railway-oriented error handling for ORDR-Connect
 *
 * Use Result<T, E> instead of throwing exceptions in business logic.
 * Keeps the happy path and error path explicit at the type level.
 */

import type { AppError } from './errors.js';

// ─── Core Types ───────────────────────────────────────────────────

export interface Ok<T> {
  readonly success: true;
  readonly data: T;
}

export interface Err<E> {
  readonly success: false;
  readonly error: E;
}

export type Result<T, E = AppError> = Ok<T> | Err<E>;

// ─── Constructors ─────────────────────────────────────────────────

export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

export function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

// ─── Type Guards ──────────────────────────────────────────────────

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.success === true;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.success === false;
}

// ─── Unwrap Helpers ───────────────────────────────────────────────

/**
 * Extract the value from an Ok result, or throw if Err.
 * Use only when you are certain the result is Ok.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.data;
  }
  throw result.error instanceof Error
    ? result.error
    : new Error(String(result.error));
}

/**
 * Extract the value from an Ok result, or return the fallback.
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  if (isOk(result)) {
    return result.data;
  }
  return fallback;
}

// ─── Combinators ──────────────────────────────────────────────────

/**
 * Transform the Ok value, leaving Err untouched.
 */
export function map<T, U, E>(result: Result<T, E>, fn: (data: T) => U): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.data));
  }
  return result;
}

/**
 * Chain a function that returns a Result, flattening the nesting.
 */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (data: T) => Result<U, E>,
): Result<U, E> {
  if (isOk(result)) {
    return fn(result.data);
  }
  return result;
}
