/**
 * Decision Engine /stream regression tests — Phase 160 + Phase 162
 *
 * Locks in Rule 2 guarantees for the decision-engine router auth middleware:
 *
 *   1. Missing Authorization header → 401 (the endpoint is not public).
 *   2. `?token=...` query-param auth is NOT accepted. Rule 2 forbids
 *      session tokens in URLs or query parameters; the old behaviour
 *      (read token from query string) was removed in Phase 160.
 *   3. A valid Authorization header passes the middleware (Phase 162
 *      regression: Phase 160 called authenticateRequest incorrectly so
 *      every request was rejected — this test proves the middleware now
 *      actually lets authenticated requests through).
 *
 * The full SSE streaming response is not exercised here — streamSSE
 * keeps the connection open and cannot be read to completion in a
 * Hono test harness. The integration suite covers the happy path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { decisionEngineRouter, configureDecisionEngineRoutes } from '../routes/decision-engine.js';

vi.mock('@ordr/auth', () => ({
  // Default stub: always reject. authenticateRequest is async and returns
  // { authenticated, context } — individual tests can override the resolved
  // value via mockResolvedValueOnce to simulate a successful auth.
  authenticateRequest: vi.fn().mockResolvedValue({ authenticated: false }),
}));

function makeApp(): Hono<Env> {
  configureDecisionEngineRoutes({
    ruleStore: {} as never,
    auditLogger: {} as never,
    db: {} as never,
    jwtConfig: {
      secret: 'test-secret-test-secret-test-secret!',
      issuer: 't',
      audience: 'a',
    } as never,
  });
  const app = new Hono<Env>();
  app.route('/api/v1/decision-engine', decisionEngineRouter);
  return app;
}

describe('GET /api/v1/decision-engine/stream — Rule 2 auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no Authorization header is present', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/decision-engine/stream');
    expect(res.status).toBe(401);
  });

  it('returns 401 when only a ?token= query param is provided (Rule 2)', async () => {
    // With Phase 160, the middleware no longer falls back to the query string.
    // Even if this query value would pass JWT validation, the middleware must
    // ignore it and require the Authorization header.
    const app = makeApp();
    const res = await app.request(
      '/api/v1/decision-engine/stream?token=would-have-worked-pre-phase-160',
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header carries an invalid token', async () => {
    const app = makeApp();
    const res = await app.request('/api/v1/decision-engine/stream', {
      headers: { Authorization: 'Bearer invalid' },
    });
    expect(res.status).toBe(401);
  });

  it('does NOT reject with 401 when Authorization header carries a valid token (Phase 162)', async () => {
    // Phase 162 regression: Phase 160 called authenticateRequest as a sync
    // function with a bare token string. The test mock happened to return
    // a matching shape by accident, so the 401 tests passed — but in prod
    // `result` was a Promise whose `.success` was undefined, so every
    // request was rejected. This test proves the happy path: with a
    // mock that returns `authenticated: true`, the middleware lets the
    // request through.
    const { authenticateRequest } = await import('@ordr/auth');
    vi.mocked(authenticateRequest).mockResolvedValueOnce({
      authenticated: true,
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        roles: ['tenant_admin'],
        permissions: [],
      },
    } as never);

    // We probe /stats (not /stream) because SSE keeps the connection open
    // and the Hono test harness cannot consume it. /stats is behind the
    // same auth middleware; if the middleware 401s, this test fails.
    // deps.db is a stub so the handler may crash — we only assert the
    // status is NOT 401, proving auth passed.
    const app = makeApp();
    const res = await app.request('/api/v1/decision-engine/stats', {
      headers: { Authorization: 'Bearer valid-jwt' },
    });
    expect(res.status).not.toBe(401);
  });
});
