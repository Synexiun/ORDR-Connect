/**
 * OpenAPI Route Tests — /api/v1/openapi.json endpoint
 *
 * Tests the HTTP route that serves the static OpenAPI 3.1 spec.
 * Validates JSON structure, security schemes, endpoint coverage,
 * headers, and public accessibility (no auth required).
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { openapiRouter, OPENAPI_SPEC } from '../routes/openapi.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';

// ─── Setup ──────────────────────────────────────────────────────────

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/openapi.json', openapiRouter);
  return app;
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/v1/openapi.json — HTTP endpoint tests
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/v1/openapi.json', () => {
  it('returns valid JSON with 200 status', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/openapi.json');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('has correct OpenAPI version (3.1.0)', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/openapi.json');
    const body = await res.json();

    expect(body.openapi).toBe('3.1.0');
  });

  it('has info section with title and version', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/openapi.json');
    const body = await res.json();

    expect(body.info).toBeDefined();
    expect(body.info.title).toBe('ORDR-Connect API');
    expect(body.info.version).toBe('1.0.0');
  });

  it('includes security schemes (bearerAuth and apiKeyAuth)', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/openapi.json');
    const body = await res.json();

    expect(body.components).toBeDefined();
    expect(body.components.securitySchemes).toBeDefined();
    expect(body.components.securitySchemes.bearerAuth).toBeDefined();
    expect(body.components.securitySchemes.apiKeyAuth).toBeDefined();
    expect(body.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(body.components.securitySchemes.bearerAuth.bearerFormat).toBe('JWT');
  });

  it('lists all public endpoints', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/openapi.json');
    const body = await res.json();

    const paths = Object.keys(body.paths);
    expect(paths.length).toBeGreaterThan(0);

    // Auth endpoints
    expect(body.paths['/api/v1/auth/login']).toBeDefined();
    expect(body.paths['/api/v1/auth/me']).toBeDefined();

    // Customer endpoints
    expect(body.paths['/api/v1/customers']).toBeDefined();
    expect(body.paths['/api/v1/customers/{id}']).toBeDefined();

    // Developer portal endpoints
    expect(body.paths['/api/v1/developers/register']).toBeDefined();
    expect(body.paths['/api/v1/developers/login']).toBeDefined();
    expect(body.paths['/api/v1/developers/me']).toBeDefined();
    expect(body.paths['/api/v1/developers/keys']).toBeDefined();
    expect(body.paths['/api/v1/developers/sandbox']).toBeDefined();
  });

  it('sets content-type to application/json', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/openapi.json');

    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('application/json');
  });

  it('does not require authentication', async () => {
    const app = createTestApp();

    // No Authorization header sent
    const res = await app.request('/api/v1/openapi.json');

    expect(res.status).toBe(200);
  });

  it('includes server URLs', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/openapi.json');
    const body = await res.json();

    expect(body.servers).toBeDefined();
    expect(body.servers.length).toBeGreaterThan(0);
    expect(body.servers[0].url).toBeDefined();
  });

  it('includes tags for grouping endpoints', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/openapi.json');
    const body = await res.json();

    expect(body.tags).toBeDefined();
    expect(body.tags.length).toBeGreaterThan(0);

    const tagNames = body.tags.map((t: { name: string }) => t.name);
    expect(tagNames).toContain('Authentication');
    expect(tagNames).toContain('Customers');
    expect(tagNames).toContain('Developer Portal');
  });

  it('sets Cache-Control header for caching', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/openapi.json');

    const cacheControl = res.headers.get('cache-control');
    expect(cacheControl).toContain('public');
    expect(cacheControl).toContain('max-age');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Static spec object validation
// ═══════════════════════════════════════════════════════════════════

describe('OPENAPI_SPEC structure', () => {
  it('every path has at least one HTTP method', () => {
    const paths = OPENAPI_SPEC.paths;
    for (const [_path, methods] of Object.entries(paths)) {
      const methodKeys = Object.keys(methods);
      expect(methodKeys.length).toBeGreaterThan(0);
    }
  });

  it('every endpoint has a summary', () => {
    const paths = OPENAPI_SPEC.paths;
    for (const [_path, methods] of Object.entries(paths)) {
      for (const [_method, config] of Object.entries(methods)) {
        const typedConfig = config as { summary?: string };
        expect(typedConfig.summary).toBeDefined();
        expect(typedConfig.summary!.length).toBeGreaterThan(0);
      }
    }
  });

  it('every endpoint has responses defined', () => {
    const paths = OPENAPI_SPEC.paths;
    for (const [_path, methods] of Object.entries(paths)) {
      for (const [_method, config] of Object.entries(methods)) {
        const typedConfig = config as { responses?: Record<string, unknown> };
        expect(typedConfig.responses).toBeDefined();
        expect(Object.keys(typedConfig.responses!).length).toBeGreaterThan(0);
      }
    }
  });

  it('is JSON-serializable', () => {
    const serialized = JSON.stringify(OPENAPI_SPEC);
    expect(serialized).toBeDefined();
    const parsed = JSON.parse(serialized);
    expect(parsed.openapi).toBe('3.1.0');
  });
});
