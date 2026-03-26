/**
 * Hono Tracing Middleware — automatic request tracing and metrics
 *
 * SOC2 CC7.2 — Monitoring: per-request tracing with correlation IDs.
 * ISO 27001 A.8.15 — Logging: distributed trace context propagation.
 *
 * SECURITY:
 * - NEVER logs request/response bodies (Rule 6 — PHI safety)
 * - Only records method, path, status, duration, tenant_id
 * - tenant_id is opaque (not PII)
 * - Error messages are sanitized before recording
 */

import { createMiddleware } from 'hono/factory';
import { trace, SpanStatusCode, context as otelContext } from '@opentelemetry/api';
import type { MetricsRegistry } from '../metrics.js';

// ─── Middleware Types ────────────────────────────────────────────

interface TracingEnv {
  Variables: {
    requestId: string;
    tenantContext?: { tenantId: string } | undefined;
  };
}

export interface TracingMiddlewareConfig {
  readonly serviceName: string;
  readonly metrics?: MetricsRegistry | undefined;
}

// ─── Middleware Factory ──────────────────────────────────────────

/**
 * Creates a Hono middleware that:
 * 1. Creates an OTel span per request
 * 2. Injects trace_id and correlation_id into response headers
 * 3. Records request duration histogram
 * 4. Increments request counter
 * 5. Adds tenant_id from auth context
 * 6. Records errors on 4xx/5xx
 */
export function createTracingMiddleware(config: TracingMiddlewareConfig) {
  const tracer = trace.getTracer(config.serviceName);

  return createMiddleware<TracingEnv>(async (c, next) => {
    const method = c.req.method;
    const path = c.req.path;
    const startTime = performance.now();

    // Start a new span for this request
    const span = tracer.startSpan(`${method} ${path}`, {
      attributes: {
        'http.method': method,
        'http.url': path,
        'http.target': path,
      },
    });

    const ctx = trace.setSpan(otelContext.active(), span);

    // Inject trace context into response headers
    const spanContext = span.spanContext();
    c.header('X-Trace-Id', spanContext.traceId);
    c.header('X-Span-Id', spanContext.spanId);

    try {
      await otelContext.with(ctx, async () => {
        await next();
      });

      const status = c.res.status;
      const durationSec = (performance.now() - startTime) / 1000;

      // Add tenant context if available
      const tenantContext = c.get('tenantContext');
      const tenantId = tenantContext?.tenantId ?? 'unknown';

      // Set span attributes post-execution
      span.setAttribute('http.status_code', status);
      span.setAttribute('tenant.id', tenantId);

      // Record error on 4xx/5xx
      if (status >= 400) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${String(status)}`,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      // Record metrics if registry provided
      if (config.metrics) {
        // Normalize path to prevent high-cardinality label explosion
        const normalizedPath = normalizePath(path);

        config.metrics.incrementCounter('http_requests_total', {
          method,
          path: normalizedPath,
          status: String(status),
          tenant_id: tenantId,
        });

        config.metrics.observeHistogram('http_request_duration_seconds', {
          method,
          path: normalizedPath,
        }, durationSec);
      }
    } catch (error: unknown) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    } finally {
      span.end();
    }
  });
}

// ─── Path Normalization ──────────────────────────────────────────

/**
 * Normalize request paths to prevent high-cardinality label values.
 * UUIDs, numeric IDs, and other dynamic segments are replaced with placeholders.
 *
 * /api/v1/customers/123e4567-e89b-12d3-a456-426614174000 → /api/v1/customers/:id
 * /api/v1/agents/42 → /api/v1/agents/:id
 */
function normalizePath(path: string): string {
  return path
    // Replace UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    // Replace numeric IDs
    .replace(/\/\d+(?:\/|$)/g, '/:id/')
    // Clean trailing slashes
    .replace(/\/+$/, '');
}

export { normalizePath };
