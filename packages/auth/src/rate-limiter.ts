/**
 * Rate Limiting — per-tenant, per-endpoint sliding window
 *
 * SOC2 CC6.6 — System boundaries and threat mitigation.
 * ISO 27001 A.13.1.1 — Network controls.
 * HIPAA §164.312(a)(1) — Access control through rate limiting.
 *
 * Algorithm: Sliding window counter
 * - Divides time into fixed windows
 * - Interpolates between current and previous window for smooth enforcement
 * - Prevents burst attacks at window boundaries
 *
 * Includes preset configurations for:
 * - AUTH_RATE_LIMIT: 5 attempts per 15 minutes (brute-force protection)
 * - API_RATE_LIMIT: 1000 requests per minute per tenant
 * - PHI_ACCESS_RATE_LIMIT: 100 requests per minute per user (PHI audit trail)
 */

// ─── Configuration ─────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Window duration in milliseconds */
  readonly windowMs: number;
  /** Maximum requests allowed per window */
  readonly maxRequests: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  readonly allowed: boolean;
  /** Number of requests remaining in the current window */
  readonly remaining: number;
  /** When the current window resets */
  readonly resetAt: Date;
}

// ─── Preset Configurations ─────────────────────────────────────────

/** Brute-force protection: 5 attempts per 15 minutes */
export const AUTH_RATE_LIMIT: Readonly<RateLimitConfig> = {
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
} as const;

/** General API: 1000 requests per minute per tenant */
export const API_RATE_LIMIT: Readonly<RateLimitConfig> = {
  windowMs: 60 * 1000,
  maxRequests: 1000,
} as const;

/** PHI access: 100 requests per minute per user (compliance audit trail) */
export const PHI_ACCESS_RATE_LIMIT: Readonly<RateLimitConfig> = {
  windowMs: 60 * 1000,
  maxRequests: 100,
} as const;

// ─── Rate Limiter Interface ────────────────────────────────────────

/**
 * Rate limiter contract — implementations may use in-memory storage,
 * Redis, or any other backend. The key identifies the rate limit bucket
 * (e.g., "auth:tenant-123:login", "api:tenant-456").
 */
export interface RateLimiter {
  check(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

// ─── Sliding Window Entry ──────────────────────────────────────────

interface WindowEntry {
  /** Count for the current window */
  currentCount: number;
  /** Count for the previous window */
  previousCount: number;
  /** Start time of the current window (ms since epoch) */
  windowStart: number;
}

// ─── In-Memory Implementation ──────────────────────────────────────

/**
 * In-memory sliding window rate limiter.
 *
 * Suitable for single-instance deployments and testing.
 * For multi-instance production deployments, use a Redis-backed implementation.
 *
 * The sliding window algorithm:
 * 1. Divide time into fixed windows of `windowMs` duration
 * 2. Track counts for the current and previous windows
 * 3. Estimate the rate by interpolating:
 *    effectiveCount = previousCount * (1 - elapsedRatio) + currentCount
 * 4. Allow if effectiveCount < maxRequests
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, WindowEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodic cleanup of stale entries (every 5 minutes)
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);

    // Allow the timer to be garbage collected
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
    const windowEnd = windowStart + config.windowMs;

    let entry = this.entries.get(key);

    if (!entry) {
      // First request for this key
      entry = {
        currentCount: 0,
        previousCount: 0,
        windowStart,
      };
      this.entries.set(key, entry);
    }

    // Check if we've moved to a new window
    if (windowStart > entry.windowStart) {
      if (windowStart - entry.windowStart >= config.windowMs * 2) {
        // Two or more windows have passed — reset entirely
        entry.previousCount = 0;
        entry.currentCount = 0;
      } else {
        // Moved to the next window — rotate counts
        entry.previousCount = entry.currentCount;
        entry.currentCount = 0;
      }
      entry.windowStart = windowStart;
    }

    // Calculate sliding window count
    const elapsedInWindow = now - windowStart;
    const windowRatio = elapsedInWindow / config.windowMs;
    const effectiveCount =
      entry.previousCount * (1 - windowRatio) + entry.currentCount;

    if (effectiveCount >= config.maxRequests) {
      const remaining = 0;
      return {
        allowed: false,
        remaining,
        resetAt: new Date(windowEnd),
      };
    }

    // Increment and allow
    entry.currentCount += 1;

    const remaining = Math.max(
      0,
      Math.floor(config.maxRequests - (entry.previousCount * (1 - windowRatio) + entry.currentCount)),
    );

    return {
      allowed: true,
      remaining,
      resetAt: new Date(windowEnd),
    };
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
  }

  /**
   * Removes entries that haven't been accessed in over 2 window periods.
   * Called periodically to prevent memory leaks.
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [key, entry] of this.entries) {
      if (now - entry.windowStart > maxAge) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Stops the cleanup timer. Call this when shutting down.
   */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
  }
}
