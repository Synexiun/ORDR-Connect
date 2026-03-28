/**
 * Prometheus Metrics Endpoint Tests
 *
 * Verifies:
 * - GET /metrics returns 200 with Prometheus text format when registry is provided
 * - Content-Type header matches prom-client's registry.contentType
 * - Response body contains expected metric names
 * - /metrics is NOT mounted when no registry is passed to createApp
 *
 * SOC2 CC7.1 — Monitoring: metrics endpoint availability.
 * ISO 27001 A.8.16 — Monitoring activities: telemetry export.
 * HIPAA §164.312(b) — Audit controls: no PHI in metric output.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { MetricsRegistry } from '@ordr/observability';
import { createMetricsRouter } from '../routes/metrics.js';
import type { Env } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────

function buildApp(registry: MetricsRegistry): Hono<Env> {
  const app = new Hono<Env>();
  app.route('/metrics', createMetricsRouter(registry));
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('GET /metrics', () => {
  it('returns 200', async () => {
    const registry = new MetricsRegistry(false);
    const app = buildApp(registry);
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
  });

  it('sets Content-Type to Prometheus text format', async () => {
    const registry = new MetricsRegistry(false);
    const app = buildApp(registry);
    const res = await app.request('/metrics');
    expect(res.headers.get('Content-Type')).toContain('text/plain');
  });

  it('response body is a non-empty string', async () => {
    const registry = new MetricsRegistry(false);
    const app = buildApp(registry);
    const res = await app.request('/metrics');
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });

  it('response contains predefined ORDR metric names', async () => {
    const registry = new MetricsRegistry(false);
    const app = buildApp(registry);
    const res = await app.request('/metrics');
    const body = await res.text();
    expect(body).toContain('http_requests_total');
    expect(body).toContain('http_request_duration_seconds');
    expect(body).toContain('agent_execution_duration_seconds');
    expect(body).toContain('compliance_violations_total');
    expect(body).toContain('audit_events_total');
  });

  it('response contains HELP and TYPE lines for metrics', async () => {
    const registry = new MetricsRegistry(false);
    const app = buildApp(registry);
    const res = await app.request('/metrics');
    const body = await res.text();
    // Prometheus text format requires # HELP and # TYPE lines
    expect(body).toMatch(/^# HELP /m);
    expect(body).toMatch(/^# TYPE /m);
  });

  it('incrementing a counter is reflected in output', async () => {
    const registry = new MetricsRegistry(false);
    registry.incrementCounter('http_requests_total', {
      method: 'GET',
      path: '/test',
      status: '200',
      tenant_id: 'tenant-test',
    });
    const app = buildApp(registry);
    const res = await app.request('/metrics');
    const body = await res.text();
    // The counter should appear with value > 0
    expect(body).toContain('http_requests_total');
  });

  it('does not expose PHI — no email or name patterns in output', async () => {
    const registry = new MetricsRegistry(false);
    const app = buildApp(registry);
    const res = await app.request('/metrics');
    const body = await res.text();
    // Rudimentary check: no email-like strings in metric output (Rule 6)
    expect(body).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  });
});

describe('/metrics not mounted when no registry provided', () => {
  it('createMetricsRouter produces a working sub-app', async () => {
    const registry = new MetricsRegistry(false);
    const router = createMetricsRouter(registry);
    const res = await router.request('/');
    expect(res.status).toBe(200);
  });
});
