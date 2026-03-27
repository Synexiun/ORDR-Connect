/**
 * API Key Authentication Middleware — Developer Portal key verification
 *
 * SOC2 CC6.1 — API key-based access control for developer integrations.
 * ISO 27001 A.9.4.2 — Secure access control for system integrations.
 * HIPAA §164.312(d) — Entity authentication via hashed API keys.
 *
 * Flow:
 * 1. Extract key from Authorization: Bearer ordr_xxx header
 * 2. SHA-256 hash the raw key (Rule 2 — never store/compare plaintext)
 * 3. Look up by prefix for efficient DB query, verify hash
 * 4. Check expiration and revocation status
 * 5. Check rate limits per developer
 * 6. Attach developer context to request
 *
 * SECURITY:
 * - Raw API key is NEVER logged or stored (Rule 5)
 * - Timing-safe comparison via @ordr/auth verifyApiKey (Rule 2)
 * - Rate limiting per developer account (Rule 4)
 */

import { createMiddleware } from 'hono/factory';
import { extractApiKeyPrefix, verifyApiKey, isApiKeyExpired } from '@ordr/auth';
import type { RateLimiter, RateLimitConfig } from '@ordr/auth';
import { AuthenticationError, RateLimitError, API_KEY_PREFIX } from '@ordr/core';
import type { Env } from '../types.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface DeveloperContext {
  readonly developerId: string;
  readonly email: string;
  readonly tier: 'free' | 'pro' | 'enterprise';
  readonly rateLimitRpm: number;
}

export interface DeveloperKeyRecord {
  readonly id: string;
  readonly developerId: string;
  readonly email: string;
  readonly keyHash: string;
  readonly keyPrefix: string;
  readonly tier: 'free' | 'pro' | 'enterprise';
  readonly rateLimitRpm: number;
  readonly status: 'active' | 'suspended' | 'revoked';
  readonly expiresAt: Date | null;
}

export interface ApiKeyAuthDependencies {
  readonly findKeyByPrefix: (prefix: string) => Promise<DeveloperKeyRecord | null>;
  readonly rateLimiter: RateLimiter;
  readonly updateLastActive: (developerId: string) => Promise<void>;
}

// ─── Module State ───────────────────────────────────────────────────

let deps: ApiKeyAuthDependencies | null = null;

export function configureApiKeyAuth(dependencies: ApiKeyAuthDependencies): void {
  deps = dependencies;
}

// ─── Middleware ──────────────────────────────────────────────────────

export function requireApiKeyAuth() {
  return createMiddleware<Env>(async (c, next) => {
    if (!deps) {
      throw new Error('[ORDR:API] API key auth middleware not configured');
    }

    const requestId = c.get('requestId');

    // 1. Extract API key from Authorization header
    const authHeader = c.req.header('authorization');
    if (authHeader === undefined || authHeader.length === 0) {
      throw new AuthenticationError('API key required', requestId);
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new AuthenticationError('Invalid authorization format', requestId);
    }

    const rawKey = parts[1];
    if (rawKey === undefined || rawKey.length === 0 || !rawKey.startsWith(API_KEY_PREFIX)) {
      throw new AuthenticationError('Invalid API key format', requestId);
    }

    // 2. Extract prefix for efficient DB lookup
    const prefix = extractApiKeyPrefix(rawKey);

    // 3. Look up key record by prefix
    const keyRecord = await deps.findKeyByPrefix(prefix);
    if (!keyRecord) {
      throw new AuthenticationError('Invalid API key', requestId);
    }

    // 4. Verify hash (timing-safe comparison)
    const valid = verifyApiKey(rawKey, keyRecord.keyHash);
    if (!valid) {
      throw new AuthenticationError('Invalid API key', requestId);
    }

    // 5. Check revocation
    if (keyRecord.status !== 'active') {
      throw new AuthenticationError('API key has been revoked', requestId);
    }

    // 6. Check expiration
    if (isApiKeyExpired(keyRecord.expiresAt)) {
      throw new AuthenticationError('API key has expired', requestId);
    }

    // 7. Rate limiting per developer
    const rateLimitConfig: RateLimitConfig = {
      windowMs: 60_000,
      maxRequests: keyRecord.rateLimitRpm,
    };

    const rateLimitResult = await deps.rateLimiter.check(
      `developer:${keyRecord.developerId}`,
      rateLimitConfig,
    );

    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000);
      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', rateLimitResult.resetAt.toISOString());
      throw new RateLimitError('Rate limit exceeded', retryAfter, requestId);
    }

    // 8. Set rate limit headers
    c.header('X-RateLimit-Remaining', String(rateLimitResult.remaining));
    c.header('X-RateLimit-Reset', rateLimitResult.resetAt.toISOString());

    // 9. Update last active timestamp (fire-and-forget)
    deps.updateLastActive(keyRecord.developerId).catch(() => {
      // Non-critical — do not fail the request
    });

    await next();
  });
}
