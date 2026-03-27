/**
 * Auth Middleware for Hono — JWT + API key authentication with RBAC
 *
 * SOC2 CC6.1 — Request-level authentication enforcement.
 * ISO 27001 A.9.4.1 — Information access restriction.
 * HIPAA §164.312(d) — Person or entity authentication.
 *
 * Adapts the framework-agnostic @ordr/auth functions to Hono middleware.
 * Three layers:
 * 1. `requireAuth()` — blocks unauthenticated requests (sets tenantContext)
 * 2. `requireRole(role)` — checks minimum role in hierarchy
 * 3. `requirePermission(resource, action)` — checks specific RBAC permission
 */

import { createMiddleware } from 'hono/factory';
import type { UserRole } from '@ordr/core';
import { AuthenticationError, AuthorizationError } from '@ordr/core';
import {
  authenticateRequest,
  requireRole as authRequireRole,
  requirePermission as authRequirePermission,
} from '@ordr/auth';
import type { JwtConfig, ApiKeyVerifier } from '@ordr/auth';
import type { Env } from '../types.js';

// ---- Module-level config (set once at startup via `configureAuth`) --------

let jwtConfig: JwtConfig | null = null;
let apiKeyVerifier: ApiKeyVerifier | undefined;

/**
 * Call once at startup to provide the JWT config and optional API key verifier.
 * Middleware will throw if this has not been called.
 */
export function configureAuth(jwt: JwtConfig, verifier?: ApiKeyVerifier): void {
  jwtConfig = jwt;
  apiKeyVerifier = verifier;
}

// ---- Middleware factories --------------------------------------------------

/**
 * Middleware that rejects unauthenticated requests with 401.
 * On success, sets `tenantContext` on the Hono context.
 */
export function requireAuth() {
  return createMiddleware<Env>(async (c, next) => {
    if (!jwtConfig) {
      const requestId = c.get('requestId');
      const err = new AuthenticationError('Authentication service unavailable', requestId);
      return c.json(err.toSafeResponse(), 401);
    }

    const authorizationHeader = c.req.header('authorization');
    const xApiKeyHeader = c.req.header('x-api-key');
    const result = await authenticateRequest(
      {
        ...(authorizationHeader !== undefined ? { authorization: authorizationHeader } : {}),
        ...(xApiKeyHeader !== undefined ? { 'x-api-key': xApiKeyHeader } : {}),
      },
      jwtConfig,
      apiKeyVerifier,
    );

    if (!result.authenticated) {
      const requestId = c.get('requestId');
      const err = new AuthenticationError('Authentication required', requestId);
      return c.json(err.toSafeResponse(), 401);
    }

    c.set('tenantContext', result.context);
    await next();
  });
}

/**
 * Middleware factory that requires a minimum role.
 * MUST be placed after `requireAuth()`.
 */
export function requireRoleMiddleware(role: UserRole) {
  return createMiddleware<Env>(async (c, next) => {
    const ctx = c.get('tenantContext');
    if (!ctx) {
      const requestId = c.get('requestId');
      return c.json(
        new AuthenticationError('Authentication required', requestId).toSafeResponse(),
        401,
      );
    }

    try {
      authRequireRole(ctx, role);
    } catch (error: unknown) {
      if (error instanceof AuthorizationError) {
        return c.json(error.toSafeResponse(), 403);
      }
      throw error;
    }

    await next();
  });
}

/**
 * Middleware factory that requires a specific permission (resource + action).
 * MUST be placed after `requireAuth()`.
 */
export function requirePermissionMiddleware(resource: string, action: string) {
  return createMiddleware<Env>(async (c, next) => {
    const ctx = c.get('tenantContext');
    if (!ctx) {
      const requestId = c.get('requestId');
      return c.json(
        new AuthenticationError('Authentication required', requestId).toSafeResponse(),
        401,
      );
    }

    try {
      authRequirePermission(ctx, resource, action);
    } catch (error: unknown) {
      if (error instanceof AuthorizationError) {
        return c.json(error.toSafeResponse(), 403);
      }
      throw error;
    }

    await next();
  });
}
