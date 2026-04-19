/**
 * Decision Engine /stream regression tests — Phase 160
 *
 * Locks in two Rule 2 guarantees for the live-decision SSE endpoint:
 *
 *   1. Missing Authorization header → 401 (the endpoint is not public).
 *   2. `?token=...` query-param auth is NOT accepted. Rule 2 forbids
 *      session tokens in URLs or query parameters; the old behaviour
 *      (read token from query string) was removed in Phase 160.
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
  // Default stub: always reject — individual tests can override via
  // mockResolvedValueOnce / mockReturnValueOnce.
  authenticateRequest: vi.fn().mockReturnValue({ success: false }),
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
});
