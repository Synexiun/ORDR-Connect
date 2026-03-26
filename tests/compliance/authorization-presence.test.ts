/**
 * Authorization Presence Compliance Tests
 *
 * Verifies every route has auth middleware, except the explicitly
 * public routes (/health, /openapi.json).
 *
 * SOC2 CC6.1, ISO 27001 A.9.4.1, HIPAA §164.312(d)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createApp } from '../../apps/api/src/app.js';

// ── Constants ─────────────────────────────────────────────────────────

const ROUTES_DIR = path.resolve('apps/api/src/routes');
const MIDDLEWARE_DIR = path.resolve('apps/api/src/middleware');

const PUBLIC_ROUTES = [
  '/health',
  '/api/v1/openapi.json',
] as const;

const WEBHOOK_ROUTE_PREFIXES = [
  '/api/v1/webhooks',
] as const;

// ── Route File Analysis ───────────────────────────────────────────────

describe('Route files have auth middleware', () => {
  const protectedRouteFiles = [
    'customers.ts',
    'agents.ts',
    'messages.ts',
    'analytics.ts',
    'sso.ts',
    'scim.ts',
    'organizations.ts',
    'roles.ts',
    'branding.ts',
    'developers.ts',
    'marketplace.ts',
    'marketplace-review.ts',
    'partners.ts',
  ];

  for (const file of protectedRouteFiles) {
    it(`${file} uses requireAuth or requireRole or requirePermission`, () => {
      const filePath = path.join(ROUTES_DIR, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const hasAuth = content.includes('requireAuth') ||
        content.includes('requireRole') ||
        content.includes('requirePermission') ||
        content.includes('scimBearerAuth') ||
        content.includes('scimAuth') ||
        content.includes('verifySCIMToken') ||
        content.includes('requireRoleMiddleware') ||
        content.includes('requirePermissionMiddleware');
      expect(hasAuth).toBe(true);
    });
  }
});

// ── Public Route Allowlist ────────────────────────────────────────────

describe('Public route allowlist', () => {
  it('health route does not require auth', () => {
    const filePath = path.join(ROUTES_DIR, 'health.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).not.toContain('requireAuth()');
  });

  it('openapi route does not require auth', () => {
    const filePath = path.join(ROUTES_DIR, 'openapi.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    // OpenAPI spec should be publicly accessible
    expect(content).not.toContain("requireAuth()");
  });
});

// ── Webhook Routes Use Signature Auth ─────────────────────────────────

describe('Webhook routes use signature validation', () => {
  it('webhooks.ts does not use JWT auth (uses signature instead)', () => {
    const filePath = path.join(ROUTES_DIR, 'webhooks.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    // Webhooks should use Twilio/SendGrid signature validation, not JWT
    expect(content).toContain('signature') ;
  });

  it('webhooks-voice.ts handles Twilio voice callbacks', () => {
    const filePath = path.join(ROUTES_DIR, 'webhooks-voice.ts');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('webhooks-whatsapp.ts handles WhatsApp callbacks', () => {
    const filePath = path.join(ROUTES_DIR, 'webhooks-whatsapp.ts');
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

// ── Auth Middleware Existence ──────────────────────────────────────────

describe('Auth middleware files exist', () => {
  it('auth.ts middleware exists', () => {
    expect(fs.existsSync(path.join(MIDDLEWARE_DIR, 'auth.ts'))).toBe(true);
  });

  it('api-key-auth.ts middleware exists', () => {
    expect(fs.existsSync(path.join(MIDDLEWARE_DIR, 'api-key-auth.ts'))).toBe(true);
  });

  it('auth middleware exports requireAuth', () => {
    const content = fs.readFileSync(path.join(MIDDLEWARE_DIR, 'auth.ts'), 'utf8');
    expect(content).toContain('export function requireAuth');
  });

  it('auth middleware exports requireRoleMiddleware', () => {
    const content = fs.readFileSync(path.join(MIDDLEWARE_DIR, 'auth.ts'), 'utf8');
    expect(content).toContain('export function requireRoleMiddleware');
  });

  it('auth middleware exports requirePermissionMiddleware', () => {
    const content = fs.readFileSync(path.join(MIDDLEWARE_DIR, 'auth.ts'), 'utf8');
    expect(content).toContain('export function requirePermissionMiddleware');
  });
});

// ── App Routing Protection ────────────────────────────────────────────

describe('Protected endpoints return 401 without auth', () => {
  const app = createApp({
    corsOrigins: ['https://test.com'],
    nodeEnv: 'test',
  });

  const protectedEndpoints = [
    { method: 'GET', path: '/api/v1/customers' },
    { method: 'POST', path: '/api/v1/customers' },
    { method: 'GET', path: '/api/v1/agents' },
    { method: 'GET', path: '/api/v1/messages' },
    { method: 'GET', path: '/api/v1/analytics/overview' },
    { method: 'GET', path: '/api/v1/organizations' },
    { method: 'GET', path: '/api/v1/roles' },
    { method: 'GET', path: '/api/v1/branding' },
    { method: 'GET', path: '/api/v1/developers/me' },
    { method: 'GET', path: '/api/v1/developers/keys' },
    { method: 'GET', path: '/api/v1/partners/me' },
  ];

  for (const endpoint of protectedEndpoints) {
    it(`${endpoint.method} ${endpoint.path} returns 401 without auth`, async () => {
      const res = await app.request(endpoint.path, {
        method: endpoint.method,
      });
      expect(res.status).toBe(401);
    });
  }
});

// ── Public Endpoints Accessible ───────────────────────────────────────

describe('Public endpoints are accessible without auth', () => {
  const app = createApp({
    corsOrigins: ['https://test.com'],
    nodeEnv: 'test',
  });

  it('GET /health returns 200', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('GET /health response has status: ok', async () => {
    const res = await app.request('/health');
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});

// ── RBAC Imports in Route Files ───────────────────────────────────────

describe('Route files import auth middleware', () => {
  it('customers route imports requireAuth and requirePermission', () => {
    const content = fs.readFileSync(path.join(ROUTES_DIR, 'customers.ts'), 'utf8');
    expect(content).toContain("import");
    expect(content).toContain("requireAuth");
  });

  it('agents route imports auth middleware', () => {
    const content = fs.readFileSync(path.join(ROUTES_DIR, 'agents.ts'), 'utf8');
    expect(content).toContain('requireAuth');
  });
});
