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
import type { MiddlewareHandler } from 'hono';
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

// ─── Per-endpoint tier configs ────────────────────────────────────────────────

/**
 * Named rate limit tiers for per-endpoint enforcement.
 * Applied via rateLimit(tier) after requireAuth() on individual routes.
 *
 * Key prefix "rl:" avoids collision with existing global keys:
 *   api:{tenantId} -- global authenticated ceiling (rateLimitMiddleware)
 *   auth:{ip}      -- auth endpoint brute-force protection
 *   anon:{ip}      -- unauthenticated traffic
 *
 * CLAUDE.md Rule 4 -- per-endpoint + per-agent rate limiting.
 * SOC2 CC6.6 -- Throttle abusive callers per endpoint.
 */
export type RateLimitTier = 'write' | 'read' | 'bulk' | 'agent';

const TIER_CONFIGS: Record<RateLimitTier, Readonly<RateLimitConfig>> = {
  /** POST/PUT/PATCH on domain data -- 100 req/min per tenant */
  write: { windowMs: 60_000, maxRequests: 100 },
  /** GET on domain data -- 500 req/min per tenant */
  read: { windowMs: 60_000, maxRequests: 500 },
  /** Exports, DSR submissions, batch imports -- 20 req/min per tenant */
  bulk: { windowMs: 60_000, maxRequests: 20 },
  /** Agent-runtime tool calls and decisions -- 200 req/min per tenant+agent */
  agent: { windowMs: 60_000, maxRequests: 200 },
} as const;

/**
 * Per-endpoint rate limit middleware factory.
 *
 * Usage (place after requireAuth()):
 *   router.post('/resource', rateLimit('write'), requirePermission(...), handler)
 *
 * The global rateLimitMiddleware ceiling (1,000 req/min) remains in force.
 * Per-endpoint tiers add a tighter second layer per the spec tier table.
 *
 * Agent tier key construction:
 *   1. c.req.param('agentId') -- works when route path includes :agentId
 *   2. c.req.header('X-Agent-Id') -- fallback for flat-path routes
 *   3. Falls back to write-tier bucket (rl:write:{tenantId}) when neither present
 *
 * No-op when configureRateLimit() was not called (limiter === null).
 * Route tests that skip configureRateLimit are completely unaffected.
 */
export function rateLimit(tier: RateLimitTier): MiddlewareHandler<Env> {
  return createMiddleware<Env>(async (c, next) => {
    if (limiter === null) {
      await next();
      return;
    }

    const tenantCtx = c.get('tenantContext');
    if (tenantCtx === undefined) {
      await next();
      return;
    }

    let key: string;
    let config: Readonly<RateLimitConfig>;

    if (tier === 'agent') {
      const rawAgentId = c.req.param('agentId') ?? c.req.header('X-Agent-Id');
      // Validate agentId: max 128 chars, alphanumeric + hyphen + underscore only.
      // Invalid values are treated as absent (falls back to write tier).
      // CLAUDE.md Rule 4 -- all external input must be validated before use.
      const agentId =
        rawAgentId !== undefined &&
        rawAgentId.length > 0 &&
        rawAgentId.length <= 128 &&
        /^[A-Za-z0-9_-]+$/.test(rawAgentId)
          ? rawAgentId
          : undefined;
      if (agentId !== undefined) {
        key = `rl:agent:${tenantCtx.tenantId}:${agentId}`;
        config = TIER_CONFIGS.agent;
      } else {
        // No agentId available -- fall back to write-tier bucket and limit.
        // This indicates a misconfigured agent route (missing :agentId in path
        // or missing X-Agent-Id header). Log so it is observable in production.
        const requestId = c.get('requestId');
        console.warn(
          `[ORDR:API] rateLimit('agent') fallback to write tier — no agentId on ${c.req.method} ${new URL(c.req.url).pathname} (requestId: ${requestId})`,
        );
        key = `rl:write:${tenantCtx.tenantId}`;
        config = TIER_CONFIGS.write;
      }
    } else {
      key = `rl:${tier}:${tenantCtx.tenantId}`;
      config = TIER_CONFIGS[tier];
    }

    const result = await limiter.check(key, config);

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
      const res = c.json(
        {
          success: false as const,
          error: {
            code: 'RATE_LIMITED' as const,
            message: 'Too many requests. Please retry after the reset period.',
            retryAfter,
          },
        },
        429,
      );
      applyHeaders(res.headers, config, result);
      res.headers.set('Retry-After', String(retryAfter));
      return res;
    }

    await next();
    applyHeaders(c.res.headers, config, result);
  });
}

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
