/**
 * Prometheus Metrics Endpoint — GET /metrics
 *
 * SOC2 CC7.1 — Monitoring: real-time operational metrics available for scraping.
 * ISO 27001 A.8.16 — Monitoring activities: quantitative system telemetry.
 * HIPAA §164.312(b) — Audit controls: system performance telemetry.
 *
 * SECURITY:
 * - Endpoint is INTERNAL only — must be network-restricted in production
 *   (not behind public load balancer; accessible only from monitoring VPC)
 * - No PHI/PII in any metric labels (Rule 6)
 * - tenant_id is an opaque identifier — safe for labels
 * - Error messages are never surfaced in metric label values
 *
 * Access pattern: Prometheus scraper polls this endpoint every 15s.
 * The response Content-Type header tells Prometheus which parser to use.
 */

import { Hono } from 'hono';
import type { Env } from '../types.js';
import type { MetricsRegistry } from '@ordr/observability';

// ─── Route Factory ────────────────────────────────────────────────

/**
 * Creates the /metrics route with the provided registry.
 * Separated into a factory so it can be injected from server.ts
 * (where the MetricsRegistry singleton lives).
 */
export function createMetricsRouter(registry: MetricsRegistry): Hono<Env> {
  const router = new Hono<Env>();

  /**
   * GET /metrics
   *
   * Returns Prometheus text exposition format for all registered metrics.
   * No authentication — access must be restricted at the network layer
   * (VPC / firewall rule / internal-only ingress annotation).
   */
  router.get('/', async (c) => {
    const body = await registry.getMetricsEndpoint();
    const contentType = registry.getContentType();
    return c.body(body, 200, { 'Content-Type': contentType });
  });

  return router;
}
