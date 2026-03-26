/**
 * Health Check Routes — liveness, readiness, and version probes
 *
 * SOC2 CC7.1 — Monitoring: detect system availability issues.
 * ISO 27001 A.17.1.1 — Planning information security continuity.
 *
 * These routes are NOT authenticated — they must be accessible to
 * load balancers, Kubernetes probes, and uptime monitors.
 *
 * - GET /health       — version + uptime (always 200)
 * - GET /health/live  — liveness probe (always 200)
 * - GET /health/ready — readiness check (DB, Kafka connectivity)
 */

import { Hono } from 'hono';
import type { Env } from '../types.js';

const healthRouter = new Hono<Env>();

const startTime = Date.now();
const VERSION = process.env['npm_package_version'] ?? '0.1.0';

// ---- GET /health — basic health + version ----------------------------------

healthRouter.get('/', (c) => {
  const uptimeMs = Date.now() - startTime;
  return c.json({
    status: 'ok' as const,
    version: VERSION,
    uptime: uptimeMs,
  });
});

// ---- GET /health/live — Kubernetes liveness probe --------------------------

healthRouter.get('/live', (c) => {
  return c.json({ status: 'ok' as const }, 200);
});

// ---- GET /health/ready — readiness check with dependency probes ------------

/**
 * Dependency check callbacks. Set via `configureHealthChecks()` at startup
 * after database and Kafka are initialized.
 */
interface HealthDependencies {
  checkDb: () => Promise<boolean>;
  checkKafka: () => Promise<boolean>;
}

let dependencies: HealthDependencies | null = null;

export function configureHealthChecks(deps: HealthDependencies): void {
  dependencies = deps;
}

healthRouter.get('/ready', async (c) => {
  if (!dependencies) {
    return c.json(
      {
        status: 'not_ready' as const,
        checks: {
          db: false,
          kafka: false,
        },
      },
      503,
    );
  }

  const [dbOk, kafkaOk] = await Promise.all([
    dependencies.checkDb().catch(() => false),
    dependencies.checkKafka().catch(() => false),
  ]);

  const allReady = dbOk && kafkaOk;

  return c.json(
    {
      status: allReady ? ('ready' as const) : ('not_ready' as const),
      checks: {
        db: dbOk,
        kafka: kafkaOk,
      },
    },
    allReady ? 200 : 503,
  );
});

export { healthRouter };
