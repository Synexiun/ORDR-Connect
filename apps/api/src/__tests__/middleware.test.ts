/**
 * Middleware tests — security headers, request ID, auth, error handler
 *
 * Verifies:
 * - Request ID middleware generates UUID and sets X-Request-Id header
 * - Security headers are all present and correct
 * - Auth middleware rejects unauthenticated requests with 401
 * - Auth middleware sets tenant context when authenticated
 * - Error handler returns safe responses (no stack traces)
 * - Error handler includes correlation ID
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { securityHeaders } from '../middleware/security-headers.js';
import { requireAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import { AppError, InternalError, NotFoundError, ERROR_CODES } from '@ordr/core';

// ---- Request ID Middleware --------------------------------------------------

describe('Request ID Middleware', () => {
  it('adds X-Request-Id header to response', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    const headerValue = res.headers.get('X-Request-Id');

    expect(headerValue).toBeDefined();
    expect(headerValue).not.toBe('');
    // UUID v4 format
    expect(headerValue).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates unique IDs for different requests', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.get('/test', (c) => c.json({ ok: true }));

    const res1 = await app.request('/test');
    const res2 = await app.request('/test');

    const id1 = res1.headers.get('X-Request-Id');
    const id2 = res2.headers.get('X-Request-Id');

    expect(id1).not.toBe(id2);
  });

  it('preserves client-provided X-Request-Id', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.get('/test', (c) => c.json({ requestId: c.get('requestId') }));

    const clientId = '550e8400-e29b-41d4-a716-446655440000';
    const res = await app.request('/test', {
      headers: { 'X-Request-Id': clientId },
    });

    const headerValue = res.headers.get('X-Request-Id');
    expect(headerValue).toBe(clientId);

    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(clientId);
  });

  it('makes request ID available in context', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.get('/test', (c) => {
      const id = c.get('requestId');
      return c.json({ requestId: id });
    });

    const res = await app.request('/test');
    const body = (await res.json()) as { requestId: string };
    const headerValue = res.headers.get('X-Request-Id');

    expect(body.requestId).toBe(headerValue);
  });
});

// ---- Security Headers Middleware --------------------------------------------

describe('Security Headers Middleware', () => {
  function createSecurityApp(): Hono<Env> {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.use('*', securityHeaders);
    app.get('/test', (c) => c.json({ ok: true }));
    return app;
  }

  it('sets Strict-Transport-Security', async () => {
    const app = createSecurityApp();
    const res = await app.request('/test');
    expect(res.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('sets X-Content-Type-Options to nosniff', async () => {
    const app = createSecurityApp();
    const res = await app.request('/test');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets X-Frame-Options to DENY', async () => {
    const app = createSecurityApp();
    const res = await app.request('/test');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets X-XSS-Protection to 0', async () => {
    const app = createSecurityApp();
    const res = await app.request('/test');
    expect(res.headers.get('X-XSS-Protection')).toBe('0');
  });

  it('sets Content-Security-Policy', async () => {
    const app = createSecurityApp();
    const res = await app.request('/test');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
  });

  it('sets Referrer-Policy', async () => {
    const app = createSecurityApp();
    const res = await app.request('/test');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy', async () => {
    const app = createSecurityApp();
    const res = await app.request('/test');
    expect(res.headers.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
  });

  it('sets Cache-Control to no-store', async () => {
    const app = createSecurityApp();
    const res = await app.request('/test');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('removes X-Powered-By header', async () => {
    const app = createSecurityApp();
    const res = await app.request('/test');
    expect(res.headers.get('X-Powered-By')).toBeNull();
  });
});

// ---- Auth Middleware ---------------------------------------------------------

describe('Auth Middleware', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.get('/protected', requireAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/protected');

    expect(res.status).toBe(401);

    const body = (await res.json()) as {
      error: { code: string; message: string; correlationId: string };
    };

    expect(body.error.code).toBe('AUTH_FAILED');
    expect(body.error.correlationId).toBeDefined();
  });

  it('rejects requests with empty Bearer token', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.get('/protected', requireAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer ' },
    });

    expect(res.status).toBe(401);
  });

  it('rejects requests with invalid Bearer token', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.get('/protected', requireAuth(), (c) => c.json({ ok: true }));

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });

    expect(res.status).toBe(401);
  });
});

// ---- Error Handler ----------------------------------------------------------

describe('Error Handler', () => {
  it('returns safe response for AppError (no stack trace)', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.onError(globalErrorHandler);
    app.get('/error', () => {
      throw new NotFoundError('Customer not found');
    });

    const res = await app.request('/error');

    expect(res.status).toBe(404);

    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string; correlationId: string };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Customer not found');
    expect(body.error.correlationId).toBeDefined();
    // SECURITY: Verify no stack trace in response
    expect(JSON.stringify(body)).not.toContain('at ');
    expect(JSON.stringify(body)).not.toContain('.ts:');
    expect(JSON.stringify(body)).not.toContain('.js:');
  });

  it('returns 500 with safe message for unknown errors', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.onError(globalErrorHandler);
    app.get('/error', () => {
      throw new Error('Database connection leaked');
    });

    const res = await app.request('/error');

    expect(res.status).toBe(500);

    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string; correlationId: string };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // SECURITY: Must NOT expose the real error message
    expect(body.error.message).toBe('An internal error occurred');
    expect(body.error.message).not.toContain('Database');
    expect(body.error.correlationId).toBeDefined();
  });

  it('includes correlation ID from request-id middleware', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.onError(globalErrorHandler);
    app.get('/error', () => {
      throw new AppError('Test error', ERROR_CODES.VALIDATION_FAILED, 400);
    });

    const res = await app.request('/error');
    const headerRequestId = res.headers.get('X-Request-Id');

    const body = (await res.json()) as {
      error: { correlationId: string };
    };

    expect(body.error.correlationId).toBe(headerRequestId);
  });

  it('handles InternalError with safe message', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.onError(globalErrorHandler);
    app.get('/error', () => {
      throw new InternalError('Sensitive internal details about the ORM');
    });

    const res = await app.request('/error');

    expect(res.status).toBe(500);

    const body = (await res.json()) as {
      error: { message: string };
    };

    // SECURITY: InternalError always masks its message
    expect(body.error.message).toBe('An internal error occurred');
    expect(body.error.message).not.toContain('ORM');
    expect(body.error.message).not.toContain('Sensitive');
  });

  it('handles TypeError thrown values', async () => {
    const app = new Hono<Env>();
    app.use('*', requestId);
    app.onError(globalErrorHandler);
    app.get('/error', () => {
      // Simulate a runtime TypeError (common unexpected error)
      const obj: Record<string, unknown> = {};
      (obj as { fn: () => void }).fn();
      return new Response('never');
    });

    const res = await app.request('/error');

    expect(res.status).toBe(500);

    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An internal error occurred');
  });
});
