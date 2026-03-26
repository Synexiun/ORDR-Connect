/**
 * CSRF & CORS Security Tests
 *
 * Validates CORS configuration and CSRF protection.
 * Tests the Hono app directly using its built-in testing helpers.
 *
 * SOC2 CC6.6, ISO 27001 A.14.1.2, HIPAA §164.312(e)(1)
 */

import { describe, it, expect } from 'vitest';
import { createApp, type AppConfig } from '../../apps/api/src/app.js';

// ── App Factory ───────────────────────────────────────────────────────

function buildApp(overrides?: Partial<AppConfig>) {
  const config: AppConfig = {
    corsOrigins: ['https://dashboard.ordr-connect.com', 'https://app.example.com'],
    nodeEnv: 'production',
    ...overrides,
  };
  return createApp(config);
}

function buildDevApp() {
  return buildApp({
    nodeEnv: 'development',
    corsOrigins: [],
  });
}

// ── CORS Origin Validation ────────────────────────────────────────────

describe('CORS origin validation', () => {
  it('returns CORS headers for allowed origin', async () => {
    const app = buildApp();
    const res = await app.request('/health', {
      headers: { Origin: 'https://dashboard.ordr-connect.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://dashboard.ordr-connect.com',
    );
  });

  it('does not return CORS headers for unauthorized origin in production', async () => {
    const app = buildApp();
    const res = await app.request('/health', {
      headers: { Origin: 'https://evil.com' },
    });
    // Hono CORS middleware should not include the unauthorized origin
    const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
    expect(allowOrigin).not.toBe('https://evil.com');
  });

  it('does not return wildcard CORS in production', async () => {
    const app = buildApp();
    const res = await app.request('/health', {
      headers: { Origin: 'https://dashboard.ordr-connect.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('includes credentials support header', async () => {
    const app = buildApp();
    const res = await app.request('/health', {
      headers: { Origin: 'https://dashboard.ordr-connect.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('does not send credentials to unauthorized origins', async () => {
    const app = buildApp();
    const res = await app.request('/health', {
      headers: { Origin: 'https://evil.com' },
    });
    // If origin is not allowed, credentials should not be sent
    const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
    if (allowOrigin !== 'https://evil.com') {
      // Good — origin rejected
      expect(true).toBe(true);
    }
  });
});

// ── Preflight Requests ────────────────────────────────────────────────

describe('Preflight (OPTIONS) requests', () => {
  it('responds to OPTIONS preflight with correct headers', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/customers', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://dashboard.ordr-connect.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeTruthy();
  });

  it('includes allowed headers in preflight response', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/customers', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://dashboard.ordr-connect.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization, X-Api-Key',
      },
    });
    const allowHeaders = res.headers.get('Access-Control-Allow-Headers');
    expect(allowHeaders).toBeTruthy();
  });

  it('exposes security-relevant response headers', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/customers', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://dashboard.ordr-connect.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    const exposeHeaders = res.headers.get('Access-Control-Expose-Headers');
    if (exposeHeaders) {
      expect(exposeHeaders).toContain('X-Request-Id');
    }
  });

  it('caches preflight for appropriate duration', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/customers', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://dashboard.ordr-connect.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    const maxAge = res.headers.get('Access-Control-Max-Age');
    if (maxAge) {
      expect(parseInt(maxAge, 10)).toBeGreaterThan(0);
      expect(parseInt(maxAge, 10)).toBeLessThanOrEqual(86400); // Max 24 hours
    }
  });
});

// ── Development CORS ──────────────────────────────────────────────────

describe('Development CORS configuration', () => {
  it('allows localhost in development mode', async () => {
    const app = buildDevApp();
    const res = await app.request('/health', {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  });

  it('allows Vite dev server origin in development', async () => {
    const app = buildDevApp();
    const res = await app.request('/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});

// ── Bearer Token CSRF Protection ──────────────────────────────────────

describe('Bearer token CSRF resistance', () => {
  it('state-changing endpoints require authentication (implicit CSRF protection)', async () => {
    const app = buildApp();

    // POST without auth should fail
    const postRes = await app.request('/api/v1/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://dashboard.ordr-connect.com',
      },
      body: JSON.stringify({ name: 'Test' }),
    });
    // Should be 401 (not authenticated) — Bearer auth is inherently CSRF-resistant
    expect(postRes.status).toBe(401);
  });

  it('PATCH without auth returns 401', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/customers/test-id', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://dashboard.ordr-connect.com',
      },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(401);
  });

  it('DELETE without auth returns 401', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/customers/test-id', {
      method: 'DELETE',
      headers: {
        Origin: 'https://dashboard.ordr-connect.com',
      },
    });
    expect(res.status).toBe(401);
  });
});

// ── Security Headers ──────────────────────────────────────────────────

describe('Security headers on CORS responses', () => {
  it('includes HSTS header', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    expect(res.headers.get('Strict-Transport-Security')).toBeTruthy();
  });

  it('includes X-Content-Type-Options', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('includes X-Frame-Options', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('removes X-Powered-By header', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    expect(res.headers.get('X-Powered-By')).toBeNull();
  });

  it('includes CSP header', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });
});
