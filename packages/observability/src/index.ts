/**
 * @ordr/observability — Full instrumentation and monitoring layer
 *
 * SOC2 CC7.1–CC7.3 — Monitoring: tracing, metrics, logging, alerting.
 * ISO 27001 A.8.15–A.8.16 — Logging and monitoring activities.
 * HIPAA §164.312(b) — Audit controls: operational telemetry.
 *
 * Single entry point for the observability package. All services
 * import tracing, metrics, logging, health, and alerting from here.
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  TraceContext,
  SpanAttributes,
  TracerConfig,
  MetricDefinition,
  MetricType,
  AlertRule,
  AlertSeverity,
  AlertChannel,
  HealthStatus,
  HealthCheckResult,
  HealthResponse,
  LogLevel,
} from './types.js';

export { LOG_LEVELS } from './types.js';

// ─── Tracer ───────────────────────────────────────────────────────
export {
  initTracer,
  createSpan,
  withSpan,
  getActiveTraceContext,
  shutdownTracer,
} from './tracer.js';

// ─── Metrics ──────────────────────────────────────────────────────
export { MetricsRegistry, PREDEFINED_METRICS } from './metrics.js';

// ─── Logger ───────────────────────────────────────────────────────
export type { LogEntry, LoggerConfig, LogContext } from './logger.js';
export { StructuredLogger, scrubPhi } from './logger.js';

// ─── Health ───────────────────────────────────────────────────────
export type { HealthCheckFn } from './health.js';
export { HealthChecker } from './health.js';

// ─── Alerts ───────────────────────────────────────────────────────
export type { AlertEvent, WebhookConfig } from './alerts.js';
export {
  AlertManager,
  WebhookNotifier,
  PREDEFINED_ALERTS,
  SEVERITY_ROUTING,
} from './alerts.js';

// ─── Middleware ───────────────────────────────────────────────────
export type { TracingMiddlewareConfig } from './middleware/hono-tracing.js';
export { createTracingMiddleware, normalizePath } from './middleware/hono-tracing.js';

export type { DbOperation, DbTraceOptions, DbTracingConfig } from './middleware/db-tracing.js';
export { createDbTracing } from './middleware/db-tracing.js';
