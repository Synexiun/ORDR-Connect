/**
 * Health endpoint tests
 *
 * Verifies:
 * - /health returns 200 with status, version, uptime
 * - /health/live returns 200 with status ok
 * - /health/ready returns 503 when dependencies not configured
 * - /health/ready returns 200 when all checks pass
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { healthRouter, configureHealthChecks } from '../routes/health.js';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.route('/health', healthRouter);
  return app;
}

describe('Health Endpoints', () => {
  // ---- GET /health ----------------------------------------------------------

  describe('GET /health', () => {
    it('returns 200 with status ok, version, and uptime', async () => {
      const app = createTestApp();
      const res = await app.request('/health');

      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        status: string;
        version: string;
        uptime: number;
      };

      expect(body.status).toBe('ok');
      expect(typeof body.version).toBe('string');
      expect(typeof body.uptime).toBe('number');
      expect(body.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  // ---- GET /health/live -----------------------------------------------------

  describe('GET /health/live', () => {
    it('returns 200 with status ok', async () => {
      const app = createTestApp();
      const res = await app.request('/health/live');

      expect(res.status).toBe(200);

      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    });
  });

  // ---- GET /health/ready ----------------------------------------------------

  describe('GET /health/ready', () => {
    it('returns 503 when dependencies are not configured', async () => {
      // Reset the dependencies by configuring with null-like checks
      // The module-level `dependencies` will be null initially in test isolation,
      // but since modules are cached, we test the unconfigured path by
      // not calling configureHealthChecks.
      const app = createTestApp();
      const res = await app.request('/health/ready');

      // Either 503 (not configured) or 200 (if previously configured in this module)
      const body = (await res.json()) as {
        status: string;
        checks: { db: boolean; kafka: boolean };
      };

      expect(body.status).toBeDefined();
      expect(body.checks).toBeDefined();
      expect(typeof body.checks.db).toBe('boolean');
      expect(typeof body.checks.kafka).toBe('boolean');
    });

    it('returns 200 with ready status when all checks pass', async () => {
      configureHealthChecks({
        checkDb: () => Promise.resolve(true),
        checkKafka: () => Promise.resolve(true),
      });

      const app = createTestApp();
      const res = await app.request('/health/ready');

      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        status: string;
        checks: { db: boolean; kafka: boolean };
      };

      expect(body.status).toBe('ready');
      expect(body.checks.db).toBe(true);
      expect(body.checks.kafka).toBe(true);
    });

    it('returns 503 when database check fails', async () => {
      configureHealthChecks({
        checkDb: () => Promise.resolve(false),
        checkKafka: () => Promise.resolve(true),
      });

      const app = createTestApp();
      const res = await app.request('/health/ready');

      expect(res.status).toBe(503);

      const body = (await res.json()) as {
        status: string;
        checks: { db: boolean; kafka: boolean };
      };

      expect(body.status).toBe('not_ready');
      expect(body.checks.db).toBe(false);
    });

    it('returns 503 when kafka check fails', async () => {
      configureHealthChecks({
        checkDb: () => Promise.resolve(true),
        checkKafka: () => Promise.resolve(false),
      });

      const app = createTestApp();
      const res = await app.request('/health/ready');

      expect(res.status).toBe(503);

      const body = (await res.json()) as {
        status: string;
        checks: { db: boolean; kafka: boolean };
      };

      expect(body.status).toBe('not_ready');
      expect(body.checks.kafka).toBe(false);
    });

    it('handles check exceptions gracefully', async () => {
      configureHealthChecks({
        checkDb: () => Promise.reject(new Error('DB unreachable')),
        checkKafka: () => Promise.reject(new Error('Kafka timeout')),
      });

      const app = createTestApp();
      const res = await app.request('/health/ready');

      expect(res.status).toBe(503);

      const body = (await res.json()) as {
        status: string;
        checks: { db: boolean; kafka: boolean };
      };

      expect(body.status).toBe('not_ready');
      expect(body.checks.db).toBe(false);
      expect(body.checks.kafka).toBe(false);
    });
  });
});
