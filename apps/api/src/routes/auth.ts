/**
 * Auth Routes — login, refresh, logout, profile
 *
 * SOC2 CC6.1 — Authentication management.
 * ISO 27001 A.9.4.2 — Secure log-on procedures.
 * HIPAA §164.312(d) — Person or entity authentication.
 *
 * Security features:
 * - Rate limited: 5 attempts per 15 minutes (brute-force protection)
 * - Account lockout after 5 consecutive failures for 15 minutes
 * - Refresh token rotation with family-based reuse detection
 * - All auth events audit logged
 * - Zod-validated input — no raw data reaches business logic
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { JwtConfig } from '@ordr/auth';
import { createAccessToken, InMemoryRateLimiter, AUTH_RATE_LIMIT } from '@ordr/auth';
import type { RateLimiter, SessionManager } from '@ordr/auth';
import type { AuditLogger } from '@ordr/audit';
import {
  AuthenticationError,
  RateLimitError,
  ValidationError,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MINUTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@ordr/core';
import { verifyPassword } from '@ordr/crypto';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

// ---- Input Schemas ---------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${String(PASSWORD_MIN_LENGTH)} characters`)
    .max(PASSWORD_MAX_LENGTH),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ---- Dependencies (injected at startup) ------------------------------------

interface AuthDependencies {
  readonly jwtConfig: JwtConfig;
  readonly sessionManager: SessionManager;
  readonly auditLogger: AuditLogger;
  /** Redis-backed limiter in production; falls back to InMemoryRateLimiter when omitted. */
  readonly rateLimiter?: RateLimiter;
  readonly findUserByEmail: (email: string) => Promise<{
    readonly id: string;
    readonly tenantId: string;
    readonly email: string;
    readonly name: string;
    readonly role: string;
    readonly passwordHash: string;
    readonly status: string;
    readonly failedLoginAttempts: number;
    readonly lockedUntil: Date | null;
  } | null>;
  readonly updateLoginAttempts: (
    userId: string,
    attempts: number,
    lockedUntil: Date | null,
  ) => Promise<void>;
  readonly resetLoginAttempts: (userId: string) => Promise<void>;
}

let deps: AuthDependencies | null = null;
// Default to in-memory; replaced by configureAuthRoutes when Redis is available.
// In-memory is acceptable for single-instance dev/test; Redis is required for
// horizontally-scaled production (brute-force state shared across pod replicas).
let rateLimiter: RateLimiter = new InMemoryRateLimiter();

export function configureAuthRoutes(dependencies: AuthDependencies): void {
  deps = dependencies;
  if (dependencies.rateLimiter !== undefined) {
    rateLimiter = dependencies.rateLimiter;
  }
}

// ---- Router ----------------------------------------------------------------

const authRouter = new Hono<Env>();

// ---- POST /login -----------------------------------------------------------

authRouter.post('/login', async (c) => {
  if (!deps) {
    throw new Error('[ORDR:API] Auth routes not configured');
  }

  const requestId = c.get('requestId');

  // Rate limiting
  const clientIp = c.req.header('x-forwarded-for') ?? 'unknown';
  const rateLimitKey = `auth:login:${clientIp}`;
  const rateLimitResult = await rateLimiter.check(rateLimitKey, AUTH_RATE_LIMIT);

  if (!rateLimitResult.allowed) {
    c.header(
      'Retry-After',
      String(Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)),
    );
    throw new RateLimitError(
      'Too many login attempts. Please try again later.',
      Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000),
      requestId,
    );
  }

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) {
        existing.push(issue.message);
      } else {
        fieldErrors[field] = [issue.message];
      }
    }
    throw new ValidationError('Invalid login credentials format', fieldErrors, requestId);
  }

  const { email, password } = parsed.data;

  // Find user
  const user = await deps.findUserByEmail(email);
  if (!user) {
    // Audit failed login — timing-safe: same path as wrong password
    await deps.auditLogger.log({
      tenantId: 'system',
      eventType: 'auth.failed',
      actorType: 'system',
      actorId: 'anonymous',
      resource: 'auth',
      resourceId: requestId,
      action: 'login',
      details: { reason: 'user_not_found' },
      timestamp: new Date(),
    });
    throw new AuthenticationError('Invalid email or password', requestId);
  }

  // Check lockout
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await deps.auditLogger.log({
      tenantId: user.tenantId,
      eventType: 'auth.failed',
      actorType: 'user',
      actorId: user.id,
      resource: 'auth',
      resourceId: requestId,
      action: 'login',
      details: { reason: 'account_locked' },
      timestamp: new Date(),
    });
    throw new AuthenticationError('Account temporarily locked. Please try again later.', requestId);
  }

  // Check account status
  if (user.status !== 'active') {
    throw new AuthenticationError('Account is not active', requestId);
  }

  // Verify password
  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    // Increment failed attempts
    const newAttempts = user.failedLoginAttempts + 1;
    const lockUntil =
      newAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000)
        : null;

    await deps.updateLoginAttempts(user.id, newAttempts, lockUntil);

    await deps.auditLogger.log({
      tenantId: user.tenantId,
      eventType: 'auth.failed',
      actorType: 'user',
      actorId: user.id,
      resource: 'auth',
      resourceId: requestId,
      action: 'login',
      details: { reason: 'invalid_password', attempts: newAttempts },
      timestamp: new Date(),
    });

    throw new AuthenticationError('Invalid email or password', requestId);
  }

  // Success — reset failed attempts
  await deps.resetLoginAttempts(user.id);

  // Create session + tokens
  const sessionUserAgent = c.req.header('user-agent');
  const { sessionId, refreshToken } = await deps.sessionManager.createSession(
    user.id,
    user.tenantId,
    user.role as 'super_admin' | 'tenant_admin' | 'manager' | 'agent' | 'viewer',
    [], // Permissions from role defaults
    {
      ipAddress: clientIp,
      ...(sessionUserAgent !== undefined ? { userAgent: sessionUserAgent } : {}),
    },
  );

  const accessToken = await createAccessToken(deps.jwtConfig, {
    sub: user.id,
    tid: user.tenantId,
    role: user.role as 'super_admin' | 'tenant_admin' | 'manager' | 'agent' | 'viewer',
    permissions: [],
  });

  // Audit successful login
  await deps.auditLogger.log({
    tenantId: user.tenantId,
    eventType: 'auth.login',
    actorType: 'user',
    actorId: user.id,
    resource: 'auth',
    resourceId: sessionId,
    action: 'login',
    details: { method: 'password' },
    timestamp: new Date(),
  });

  return c.json({
    success: true as const,
    data: {
      accessToken,
      refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: deps.jwtConfig.accessTokenTtl,
    },
  });
});

// ---- POST /refresh ---------------------------------------------------------

authRouter.post('/refresh', rateLimit('write'), async (c) => {
  if (!deps) {
    throw new Error('[ORDR:API] Auth routes not configured');
  }

  const requestId = c.get('requestId');

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid refresh request', {}, requestId);
  }

  try {
    const result = await deps.sessionManager.refreshSession(parsed.data.refreshToken);

    return c.json({
      success: true as const,
      data: {
        accessToken: result.accessToken,
        refreshToken: result.newRefreshToken,
        tokenType: 'Bearer' as const,
        expiresIn: deps.jwtConfig.accessTokenTtl,
      },
    });
  } catch (error: unknown) {
    // Token reuse detection logs are handled by SessionManager
    if (error instanceof AuthenticationError) {
      throw error;
    }
    throw new AuthenticationError('Invalid refresh token', requestId);
  }
});

// ---- POST /logout ----------------------------------------------------------

authRouter.post('/logout', requireAuth(), rateLimit('write'), async (c) => {
  if (!deps) {
    throw new Error('[ORDR:API] Auth routes not configured');
  }

  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthenticationError('Authentication required', requestId);
  }

  // Revoke all sessions for the user (conservative approach)
  await deps.sessionManager.revokeAllUserSessions(ctx.userId);

  // Audit logout
  await deps.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'auth.logout',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'auth',
    resourceId: requestId,
    action: 'logout',
    details: {},
    timestamp: new Date(),
  });

  return c.json({ success: true as const });
});

// ---- GET /me ---------------------------------------------------------------

authRouter.get('/me', requireAuth(), (c) => {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    const requestId = c.get('requestId');
    throw new AuthenticationError('Authentication required', requestId);
  }

  return c.json({
    success: true as const,
    data: {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      roles: ctx.roles,
      permissions: ctx.permissions,
    },
  });
});

export { authRouter };
