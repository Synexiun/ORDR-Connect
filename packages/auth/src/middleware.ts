/**
 * Auth Middleware Types — framework-agnostic authentication/authorization
 *
 * SOC2 CC6.1 — Request-level authentication enforcement.
 * ISO 27001 A.9.4.1 — Information access restriction.
 * HIPAA §164.312(d) — Person or entity authentication.
 *
 * This module defines the authentication and authorization logic as pure
 * functions. The actual HTTP middleware adapter lives in apps/api (Hono).
 *
 * Supports two authentication methods:
 * 1. Bearer token (JWT) — `Authorization: Bearer <token>`
 * 2. API key — `X-Api-Key: ordr_<key>`
 */

import type { TenantContext, UserRole, Permission } from '@ordr/core';
import {
  AuthenticationError,
  AuthorizationError,
  AppError,
  ERROR_CODES,
  createTenantId,
} from '@ordr/core';
import type { JwtConfig, AccessTokenPayload } from './jwt.js';
import { verifyAccessToken } from './jwt.js';
import { hasRole, hasPermission, ROLE_PERMISSIONS } from './rbac.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface AuthSuccess {
  readonly authenticated: true;
  readonly context: TenantContext;
}

export interface AuthFailure {
  readonly authenticated: false;
  readonly error: AppError;
}

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Headers expected from the HTTP request. Framework adapters
 * map their native headers to this interface.
 */
export interface AuthHeaders {
  readonly authorization?: string;
  readonly 'x-api-key'?: string;
}

/**
 * Optional callback for API key verification. The middleware calls this
 * to look up the key in the database and return the associated context.
 * If not provided, API key auth is disabled.
 */
export type ApiKeyVerifier = (apiKey: string) => Promise<TenantContext | null>;

// ─── Authentication ────────────────────────────────────────────────

/**
 * Authenticates an incoming request using either Bearer JWT or API key.
 *
 * Order of precedence:
 * 1. Bearer token in Authorization header
 * 2. API key in X-Api-Key header
 *
 * If neither is present, returns an AuthFailure.
 *
 * @param headers - HTTP headers from the request
 * @param jwtConfig - JWT configuration (keys, issuer, audience)
 * @param apiKeyVerifier - Optional callback for API key lookup
 * @returns AuthResult — either success with TenantContext or failure with error
 */
export async function authenticateRequest(
  headers: AuthHeaders,
  jwtConfig: JwtConfig,
  apiKeyVerifier?: ApiKeyVerifier,
): Promise<AuthResult> {
  // Try Bearer token first
  const authHeader = headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token.length === 0) {
      return {
        authenticated: false,
        error: new AuthenticationError('Empty bearer token'),
      };
    }

    try {
      const payload = await verifyAccessToken(jwtConfig, token);
      return {
        authenticated: true,
        context: payloadToContext(payload),
      };
    } catch {
      return {
        authenticated: false,
        error: new AuthenticationError('Invalid or expired access token'),
      };
    }
  }

  // Try API key
  const apiKey = headers['x-api-key'];
  if (apiKey) {
    if (!apiKeyVerifier) {
      return {
        authenticated: false,
        error: new AuthenticationError('API key authentication not configured'),
      };
    }

    const context = await apiKeyVerifier(apiKey);
    if (!context) {
      return {
        authenticated: false,
        error: new AuthenticationError('Invalid API key'),
      };
    }

    return { authenticated: true, context };
  }

  // No credentials provided
  return {
    authenticated: false,
    error: new AuthenticationError('No authentication credentials provided'),
  };
}

// ─── Authorization Guards ──────────────────────────────────────────

/**
 * Requires the authenticated user to have at least the specified role.
 *
 * @throws AuthorizationError if the user's role is insufficient
 */
export function requireRole(context: TenantContext, role: UserRole): void {
  const userRole = (context.roles[0] ?? 'viewer') as UserRole;

  if (!hasRole(userRole, role)) {
    throw new AuthorizationError(
      `Requires role '${role}' or higher, user has '${userRole}'`,
    );
  }
}

/**
 * Requires the authenticated user to have a specific permission
 * (resource + action combination).
 *
 * @throws AuthorizationError if the permission is not held
 */
export function requirePermission(
  context: TenantContext,
  resource: string,
  action: string,
): void {
  const userRole = (context.roles[0] ?? 'viewer') as UserRole;
  const roleDefaults = ROLE_PERMISSIONS[userRole] ?? [];

  // Parse context permissions
  const contextPermissions: Permission[] = context.permissions.map((p) => {
    if (typeof p === 'string') {
      const parts = p.split(':');
      return {
        resource: parts[0] ?? '',
        action: (parts[1] ?? 'read') as Permission['action'],
        scope: (parts[2] ?? 'own') as Permission['scope'],
      };
    }
    return p as unknown as Permission;
  });

  const allPermissions = [...roleDefaults, ...contextPermissions];

  // Check all scope levels — if they have the permission at any scope, it's granted
  const required: Permission = {
    resource,
    action: action as Permission['action'],
    scope: 'own', // Check at minimum scope; hasPermission handles scope hierarchy
  };

  if (!hasPermission(allPermissions, required)) {
    throw new AuthorizationError(
      `Missing permission: ${resource}:${action}`,
    );
  }
}

/**
 * Enforces tenant isolation — ensures the authenticated user belongs
 * to the tenant they are trying to access.
 *
 * Super admins bypass this check (global scope).
 *
 * @throws AppError with TENANT_MISMATCH code if tenant IDs don't match
 */
export function requireTenant(context: TenantContext, tenantId: string): void {
  const userRole = (context.roles[0] ?? 'viewer') as UserRole;

  // Super admins have global scope
  if (userRole === 'super_admin') {
    return;
  }

  if (context.tenantId !== tenantId) {
    throw new AppError(
      'Cross-tenant access denied',
      ERROR_CODES.TENANT_MISMATCH,
      403,
      true,
    );
  }
}

// ─── Internal Helpers ──────────────────────────────────────────────

/**
 * Converts a verified JWT payload to a TenantContext.
 */
function payloadToContext(payload: AccessTokenPayload): TenantContext {
  return {
    tenantId: createTenantId(payload.tid),
    userId: payload.sub,
    roles: [payload.role],
    permissions: payload.permissions.map(
      (p) => `${p.resource}:${p.action}:${p.scope}`,
    ),
  };
}
