import { describe, it, expect, beforeEach } from 'vitest';
import { HealthChecker } from '../health.js';
import type { HealthCheckResult } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────

function healthyCheck(name: string): () => Promise<HealthCheckResult> {
  return async () => ({
    name,
    status: 'healthy',
    message: `${name} is reachable`,
    durationMs: 1,
  });
}

function unhealthyCheck(name: string): () => Promise<HealthCheckResult> {
  return async () => ({
    name,
    status: 'unhealthy',
    message: `${name} connection refused`,
    durationMs: 100,
  });
}

function degradedCheck(name: string): () => Promise<HealthCheckResult> {
  return async () => ({
    name,
    status: 'degraded',
    message: `${name} slow but responding`,
    durationMs: 50,
  });
}

function throwingCheck(name: string): () => Promise<HealthCheckResult> {
  return async () => {
    throw new Error(`${name} check threw an exception`);
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('HealthChecker', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker();
  });

  describe('liveness()', () => {
    it('always returns healthy status', async () => {
      const result = await checker.liveness();
      expect(result.status).toBe('healthy');
    });

    it('returns empty checks array', async () => {
      const result = await checker.liveness();
      expect(result.checks).toEqual([]);
    });

    it('includes uptime in seconds', async () => {
      const result = await checker.liveness();
      expect(typeof result.uptimeSeconds).toBe('number');
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('readiness()', () => {
    it('returns healthy when all checks pass', async () => {
      checker.addCheck('postgres', healthyCheck('postgres'));
      checker.addCheck('redis', healthyCheck('redis'));
      checker.addCheck('kafka', healthyCheck('kafka'));

      const result = await checker.readiness();
      expect(result.status).toBe('healthy');
      expect(result.checks).toHaveLength(3);
    });

    it('returns unhealthy when any check fails', async () => {
      checker.addCheck('postgres', healthyCheck('postgres'));
      checker.addCheck('redis', unhealthyCheck('redis'));
      checker.addCheck('kafka', healthyCheck('kafka'));

      const result = await checker.readiness();
      expect(result.status).toBe('unhealthy');
    });

    it('returns degraded when a check is degraded but none unhealthy', async () => {
      checker.addCheck('postgres', healthyCheck('postgres'));
      checker.addCheck('redis', degradedCheck('redis'));

      const result = await checker.readiness();
      expect(result.status).toBe('degraded');
    });

    it('returns unhealthy over degraded when both present', async () => {
      checker.addCheck('postgres', unhealthyCheck('postgres'));
      checker.addCheck('redis', degradedCheck('redis'));

      const result = await checker.readiness();
      expect(result.status).toBe('unhealthy');
    });

    it('returns healthy when no checks registered', async () => {
      const result = await checker.readiness();
      expect(result.status).toBe('healthy');
      expect(result.checks).toHaveLength(0);
    });

    it('handles checks that throw exceptions', async () => {
      checker.addCheck('postgres', throwingCheck('postgres'));

      const result = await checker.readiness();
      expect(result.status).toBe('unhealthy');
      expect(result.checks[0]!.status).toBe('unhealthy');
      expect(result.checks[0]!.message).toContain('threw an exception');
    });

    it('includes check names in results', async () => {
      checker.addCheck('postgres', healthyCheck('postgres'));
      checker.addCheck('redis', healthyCheck('redis'));

      const result = await checker.readiness();
      const names = result.checks.map((c) => c.name);
      expect(names).toContain('postgres');
      expect(names).toContain('redis');
    });

    it('includes uptime in response', async () => {
      const result = await checker.readiness();
      expect(typeof result.uptimeSeconds).toBe('number');
    });
  });

  describe('startup()', () => {
    it('returns unhealthy before markReady() is called', async () => {
      const result = await checker.startup();
      expect(result.status).toBe('unhealthy');
    });

    it('returns healthy after markReady() is called', async () => {
      checker.markReady();
      const result = await checker.startup();
      expect(result.status).toBe('healthy');
    });

    it('includes initialization check in response', async () => {
      const result = await checker.startup();
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0]!.name).toBe('initialization');
    });

    it('includes uptime in response', async () => {
      const result = await checker.startup();
      expect(typeof result.uptimeSeconds).toBe('number');
    });
  });

  describe('addCheck()', () => {
    it('registers a check that is included in readiness', async () => {
      checker.addCheck('neo4j', healthyCheck('neo4j'));

      const result = await checker.readiness();
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0]!.name).toBe('neo4j');
    });

    it('tracks check count', () => {
      checker.addCheck('db', healthyCheck('db'));
      checker.addCheck('cache', healthyCheck('cache'));

      expect(checker.getCheckCount()).toBe(2);
    });

    it('tracks check names', () => {
      checker.addCheck('db', healthyCheck('db'));
      checker.addCheck('cache', healthyCheck('cache'));

      expect(checker.getCheckNames()).toEqual(['db', 'cache']);
    });
  });
});
