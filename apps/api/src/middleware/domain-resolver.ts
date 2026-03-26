/**
 * Custom Domain Resolution Middleware — resolves custom domains to tenant IDs
 *
 * SOC2 CC6.1 — Access control: domain-based tenant identification.
 * ISO 27001 A.14.1.2 — Securing application services on public networks.
 * HIPAA §164.312(e)(1) — Transmission security (TLS 1.3 on custom domains).
 *
 * When a request arrives with a Host header matching a registered custom domain,
 * this middleware sets the tenantId in the request context BEFORE auth middleware.
 *
 * SECURITY:
 * - tenant_id is NEVER taken from client input (Rule 2)
 * - Domain-to-tenant mapping is resolved server-side from the database
 * - In-memory cache with 5-minute TTL prevents excessive DB lookups
 * - Falls through to normal auth flow if no custom domain match
 * - No sensitive data logged — only domain and resolved tenant_id
 */

import { createMiddleware } from 'hono/factory';
import type { Env } from '../types.js';

// ─── Cache ──────────────────────────────────────────────────────

interface CacheEntry {
  readonly tenantId: string;
  readonly expiresAt: number;
}

/** TTL for domain→tenant cache entries: 5 minutes */
const CACHE_TTL_MS = 5 * 60 * 1000;

const domainCache = new Map<string, CacheEntry>();

/**
 * Clear the domain cache. Exposed for testing.
 */
export function clearDomainCache(): void {
  domainCache.clear();
}

/**
 * Get current cache size. Exposed for testing.
 */
export function getDomainCacheSize(): number {
  return domainCache.size;
}

// ─── Domain Lookup ──────────────────────────────────────────────

/**
 * Function signature for looking up a tenant by custom domain.
 * Injected at startup to avoid direct DB dependency in middleware.
 */
export type DomainLookupFn = (domain: string) => Promise<string | null>;

let lookupFn: DomainLookupFn | null = null;

/**
 * Configure the domain resolver with a lookup function.
 * Must be called once at startup.
 */
export function configureDomainResolver(fn: DomainLookupFn): void {
  lookupFn = fn;
}

// ─── Middleware ──────────────────────────────────────────────────

/**
 * Domain resolution middleware.
 *
 * Checks the Host header against registered custom domains.
 * If a match is found, sets `resolvedTenantId` in context for downstream use.
 * Falls through silently if no custom domain match — normal auth takes over.
 */
export const domainResolver = createMiddleware<Env>(async (c, next) => {
  if (!lookupFn) {
    // Domain resolver not configured — skip silently
    await next();
    return;
  }

  const host = c.req.header('host');
  if (!host) {
    await next();
    return;
  }

  // Strip port number if present (e.g., "app.example.com:443" → "app.example.com")
  const domain = host.split(':')[0]?.toLowerCase();
  if (!domain) {
    await next();
    return;
  }

  // Skip known default domains (localhost, internal)
  if (domain === 'localhost' || domain.endsWith('.internal') || domain.match(/^\d+\.\d+\.\d+\.\d+$/)) {
    await next();
    return;
  }

  // Check cache first
  const now = Date.now();
  const cached = domainCache.get(domain);
  if (cached && cached.expiresAt > now) {
    // Cache hit — set resolved tenant ID
    c.set('tenantContext', {
      tenantId: cached.tenantId,
      userId: '',
      roles: [],
      permissions: [],
    } as unknown as import('@ordr/core').TenantContext);
    await next();
    return;
  }

  // Cache miss or expired — look up in database
  const tenantId = await lookupFn(domain);

  if (tenantId) {
    // Store in cache
    domainCache.set(domain, {
      tenantId,
      expiresAt: now + CACHE_TTL_MS,
    });

    // Evict expired entries periodically (when cache grows beyond 1000)
    if (domainCache.size > 1000) {
      for (const [key, entry] of domainCache.entries()) {
        if (entry.expiresAt <= now) {
          domainCache.delete(key);
        }
      }
    }

    // Set resolved tenant context — auth middleware will augment with user info
    c.set('tenantContext', {
      tenantId,
      userId: '',
      roles: [],
      permissions: [],
    } as unknown as import('@ordr/core').TenantContext);
  }

  await next();
});
