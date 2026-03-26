/**
 * @ordr/observability — Core types for the observability stack
 *
 * SOC2 CC7.2 — Monitoring: structured telemetry across all services.
 * ISO 27001 A.8.15 — Logging: standardized log and metric definitions.
 * HIPAA §164.312(b) — Audit controls: health and performance monitoring.
 *
 * SECURITY: No PHI/PII types — telemetry MUST NEVER carry restricted data.
 */

// ─── Log Levels ──────────────────────────────────────────────────

export const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

// ─── Trace Context ───────────────────────────────────────────────

/** W3C Trace Context propagation fields. */
export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
  readonly parentSpanId?: string | undefined;
}

/** Attributes attached to a span — string/number/boolean values only. */
export interface SpanAttributes {
  readonly [key: string]: string | number | boolean;
}

// ─── Tracer Config ───────────────────────────────────────────────

export interface TracerConfig {
  /** OTLP endpoint URL (e.g., http://localhost:4318/v1/traces) */
  readonly endpoint?: string | undefined;
  /** Sampling ratio: 0.0 to 1.0 (default: 1.0 in dev, 0.1 in prod) */
  readonly sampleRate?: number | undefined;
  /** Whether to enable the tracer (default: true) */
  readonly enabled?: boolean | undefined;
  /** Environment name (development, staging, production) */
  readonly environment?: string | undefined;
}

// ─── Metrics ─────────────────────────────────────────────────────

export type MetricType = 'counter' | 'histogram' | 'gauge';

export interface MetricDefinition {
  readonly name: string;
  readonly help: string;
  readonly type: MetricType;
  readonly labelNames: readonly string[];
}

// ─── Alerts ──────────────────────────────────────────────────────

export type AlertSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export type AlertChannel = 'pagerduty' | 'slack' | 'email';

export interface AlertRule {
  readonly name: string;
  readonly description: string;
  readonly severity: AlertSeverity;
  readonly condition: string;
  readonly channels: readonly AlertChannel[];
  readonly windowSeconds: number;
  readonly threshold: number;
}

// ─── Health ──────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  readonly name: string;
  readonly status: HealthStatus;
  readonly message?: string | undefined;
  readonly durationMs: number;
}

export interface HealthResponse {
  readonly status: HealthStatus;
  readonly checks: readonly HealthCheckResult[];
  readonly uptimeSeconds: number;
}
