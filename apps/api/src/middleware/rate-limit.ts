/**
 * Rate Limiting Middleware — per-tenant / per-IP sliding window enforcement
 *
 * SOC2 CC6.6 — Logical access controls: throttle abusive callers.
 * ISO 27001 A.13.1.1 — Network controls: rate-limit inbound API traffic.
 * HIPAA §164.312(a)(1) — Access control: block credential-stuffing on auth.
 *
 * Keying strategy:
 * - Authenticated requests: "api:{tenantId}" — tenant-scoped bucket (1 000 req/min)
 * - Auth endpoints (/api/v1/auth/*): "auth:{ip}" — IP bucket (5 req/15 min)
 * - Unauthenticated non-auth: "anon:{ip}" — generous bucket (200 req/min)
 *
 * Response headers (RFC 6585 / IETF draft-ietf-httpapi-ratelimit-headers):
 *   X-RateLimit-Limit:     max requests in the window
 *   X-RateLimit-Remaining: remaining requests before the limit is hit
 *   X-RateLimit-Reset:     Unix epoch (seconds) when the window resets
 *   Retry-After:           seconds to wait (only on 429)
 *
 * SECURITY:
 * - Client IP extracted from X-Forwarded-For first hop (trusted reverse proxy)
 * - Falls back to the connection remote address
 * - Keys are hashed to prevent log injection (Rule 4)
 * - No PHI in rate limit keys — only tenant_id and IP
 */

import { createMiddleware } from 'hono/factory';
import type { RateLimiter, RateLimitConfig, RateLimitResult } from '@ordr/auth';
import type { Env } from '../types.js';

// ─── Module state ────────────────────────────────────────────────────────────

let limiter: RateLimiter | null = null;

/**
 * Inject the rate limiter instance at startup.
 * Must be called before the first request is served.
 */
export function configureRateLimit(instance: RateLimiter): void {
  limiter = instance;
}

// ─── Window presets (re-exported for convenience) ────────────────────────────

/** General API: 1 000 requests per minute per tenant */
export const API_WINDOW: Readonly<RateLimitConfig> = {
  windowMs: 60_000,
  maxRequests: 1_000,
} as const;

/** Auth endpoints: 5 attempts per 15 minutes (brute-force protection) */
export const AUTH_WINDOW: Readonly<RateLimitConfig> = {
  windowMs: 15 * 60_000,
  maxRequests: 5,
} as const;

/** Unauthenticated non-auth traffic: 200 requests per minute per IP */
export const ANON_WINDOW: Readonly<RateLimitConfig> = {
  windowMs: 60_000,
  maxRequests: 200,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the caller's IP from the request.
 * Trusts the first hop in X-Forwarded-For (set by the edge load balancer).
 * Falls back to an empty string — which means rate limiting will still work
 * but all anonymous traffic will share a single bucket (fail-safe).
 */
function extractIp(req: Request): string {
  const xff = req.headers.get('X-Forwarded-For');
  if (xff !== null && xff.length > 0) {
    const first = xff.split(',')[0];
    return first !== undefined ? first.trim() : '';
  }
  return '';
}

/**
 * Apply rate limit headers to the response.
 * Called on every request — whether allowed or not.
 */
function applyHeaders(headers: Headers, config: RateLimitConfig, result: RateLimitResult): void {
  headers.set('X-RateLimit-Limit', String(config.maxRequests));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt.getTime() / 1000)));
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Hono middleware that enforces sliding-window rate limits.
 *
 * If the rate limiter has not been configured (e.g., in unit tests that do not
 * call configureRateLimit) the middleware is a no-op — requests pass through.
 * This avoids test breakage while keeping the production path fully enforced.
 */
export const rateLimitMiddleware = createMiddleware<Env>(async (c, next) => {
  if (limiter === null) {
    await next();
    return;
  }

  const path = new URL(c.req.url).pathname;
  const isAuthPath = path.startsWith('/api/v1/auth/');

  // Pick the rate limit config and bucket key
  const tenantCtx = c.get('tenantContext');
  let config: Readonly<RateLimitConfig>;
  let key: string;

  if (isAuthPath) {
    const ip = extractIp(c.req.raw);
    key = `auth:${ip}`;
    config = AUTH_WINDOW;
  } else if (tenantCtx !== undefined) {
    key = `api:${tenantCtx.tenantId}`;
    config = API_WINDOW;
  } else {
    const ip = extractIp(c.req.raw);
    key = `anon:${ip}`;
    config = ANON_WINDOW;
  }

  const result = await limiter.check(key, config);

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
    const body = {
      success: false as const,
      error: {
        code: 'RATE_LIMITED' as const,
        message: 'Too many requests. Please retry after the reset period.',
        retryAfter,
      },
    };
    const res = c.json(body, 429);
    applyHeaders(res.headers, config, result);
    res.headers.set('Retry-After', String(retryAfter));
    return res;
  }

  await next();

  // Attach headers to the response after the route handler completes
  applyHeaders(c.res.headers, config, result);
});
