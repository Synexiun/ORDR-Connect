/**
 * API Key Authentication Middleware — Developer Portal
 *
 * SOC2 CC6.1 — Access control: all developer requests authenticated via API key.
 * ISO 27001 A.9.4.1 — Information access restriction.
 * HIPAA §164.312(d) — Person or entity authentication.
 *
 * SECURITY:
 * - Reads `X-API-Key` header, SHA-256 hashes it, looks up in developer_accounts
 * - If valid: sets developer context on request, updates last_active_at
 * - If invalid/missing: returns 401
 * - Rate limiting per developer based on their tier's rate_limit_rpm
 * - API keys are NEVER logged or stored in plaintext (Rule 2, Rule 5)
 */

import { createHash } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { Env, DeveloperContext } from '../types.js';

// ---- Types ------------------------------------------------------------------

interface DeveloperRecord {
  readonly id: string;
  readonly email: string;
  readonly tier: 'free' | 'pro' | 'enterprise';
  readonly rateLimitRpm: number;
  readonly status: 'active' | 'suspended' | 'revoked';
}

export interface DeveloperLookup {
  /** Look up a developer by API key hash. Returns null if not found. */
  findByKeyHash(keyHash: string): Promise<DeveloperRecord | null>;
  /** Update last_active_at timestamp for a developer. */
  updateLastActive(developerId: string): Promise<void>;
}

// ---- Rate limiter -----------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(developerId: string, limitRpm: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(developerId);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(developerId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= limitRpm) {
    return false;
  }

  entry.count += 1;
  return true;
}

/** Clear rate limit store — used for testing only */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

// ---- Module-level config ----------------------------------------------------

let lookup: DeveloperLookup | null = null;

/**
 * Call once at startup to provide the developer lookup implementation.
 */
export function configureApiKeyAuth(developerLookup: DeveloperLookup): void {
  lookup = developerLookup;
}

// ---- Middleware --------------------------------------------------------------

/**
 * Hash an API key using SHA-256 (Rule 2: API keys SHA-256 hashed before storage).
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Middleware that authenticates requests via the X-API-Key header.
 * Sets `developerContext` on the Hono context for downstream handlers.
 */
export function requireApiKey() {
  return createMiddleware<Env>(async (c, next) => {
    const requestId = c.get('requestId') ?? 'unknown';

    if (!lookup) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'AUTH_FAILED' as const,
            message: 'Developer authentication service unavailable',
            correlationId: requestId,
          },
        },
        401,
      );
    }

    // Read API key from header
    const rawApiKey = c.req.header('x-api-key');
    if (!rawApiKey || rawApiKey.length === 0) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'AUTH_FAILED' as const,
            message: 'API key required. Provide via X-API-Key header.',
            correlationId: requestId,
          },
        },
        401,
      );
    }

    // SHA-256 hash the key and look up
    const keyHash = hashApiKey(rawApiKey);
    const developer = await lookup.findByKeyHash(keyHash);

    if (!developer) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'AUTH_FAILED' as const,
            message: 'Invalid API key',
            correlationId: requestId,
          },
        },
        401,
      );
    }

    // Check developer status
    if (developer.status !== 'active') {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'AUTH_FAILED' as const,
            message: `Developer account is ${developer.status}`,
            correlationId: requestId,
          },
        },
        401,
      );
    }

    // Rate limiting
    if (!checkRateLimit(developer.id, developer.rateLimitRpm)) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'RATE_LIMIT' as const,
            message: 'Rate limit exceeded. Try again later.',
            correlationId: requestId,
          },
        },
        429,
      );
    }

    // Set developer context
    const devContext: DeveloperContext = {
      developerId: developer.id,
      email: developer.email,
      tier: developer.tier,
      rateLimitRpm: developer.rateLimitRpm,
      status: developer.status,
    };

    c.set('developerContext', devContext);

    // Fire-and-forget last_active update
    lookup.updateLastActive(developer.id).catch(() => {
      // Never fail the request for last_active tracking
    });

    await next();
  });
}
