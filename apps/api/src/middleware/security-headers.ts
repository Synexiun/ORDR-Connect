/**
 * Security Headers Middleware — defense-in-depth HTTP headers
 *
 * SOC2 CC6.6 — System boundaries: prevent clickjacking, MIME sniffing, etc.
 * ISO 27001 A.14.1.2 — Securing application services on public networks.
 * HIPAA §164.312(e)(1) — Transmission security.
 *
 * Header rationale:
 * - HSTS: forces HTTPS for 1 year including subdomains
 * - X-Content-Type-Options: prevents MIME-type sniffing
 * - X-Frame-Options: prevents clickjacking (DENY = never embeddable)
 * - X-XSS-Protection: set to 0 because CSP is the modern replacement
 * - CSP: restricts resource loading to same origin
 * - Referrer-Policy: limits referrer data leakage
 * - Permissions-Policy: disables camera, mic, geolocation
 * - Cache-Control: no-store for API responses (prevent caching of PHI)
 * - X-Powered-By: removed to hide technology stack
 */

import { createMiddleware } from 'hono/factory';
import type { Env } from '../types.js';

export const securityHeaders = createMiddleware<Env>(async (c, next) => {
  await next();

  // Transport security
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Content security
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '0');
  c.header('Content-Security-Policy', "default-src 'self'");

  // Privacy & information disclosure
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Cache control — NEVER cache API responses (may contain PHI)
  c.header('Cache-Control', 'no-store');

  // Remove technology fingerprint
  c.res.headers.delete('X-Powered-By');
});
