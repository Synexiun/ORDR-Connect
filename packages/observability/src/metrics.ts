/**
 * @ordr/observability — Prometheus-compatible metrics registry
 *
 * SOC2 CC7.1 — Monitoring: real-time operational metrics.
 * ISO 27001 A.8.16 — Monitoring activities: system performance tracking.
 * HIPAA §164.312(b) — Audit controls: quantitative system telemetry.
 *
 * SECURITY:
 * - Metric labels MUST NEVER contain PHI/PII (Rule 6)
 * - tenant_id is an opaque identifier, safe for labels
 * - No query content, user names, emails, or health data in labels
 */

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';
import type { MetricDefinition, MetricType } from './types.js';

// ─── Metric Definitions ──────────────────────────────────────────

const PREDEFINED_METRICS: readonly MetricDefinition[] = [
  // HTTP
  { name: 'http_requests_total', help: 'Total HTTP requests', type: 'counter', labelNames: ['method', 'path', 'status', 'tenant_id'] },
  { name: 'http_request_duration_seconds', help: 'HTTP request duration in seconds', type: 'histogram', labelNames: ['method', 'path'] },

  // Database
  { name: 'db_query_duration_seconds', help: 'Database query duration in seconds', type: 'histogram', labelNames: ['operation', 'table'] },

  // Agent
  { name: 'agent_execution_duration_seconds', help: 'Agent execution duration in seconds', type: 'histogram', labelNames: ['agent_role', 'outcome'] },
  { name: 'agent_tool_calls_total', help: 'Total agent tool calls', type: 'counter', labelNames: ['tool_name', 'success'] },
  { name: 'active_agent_sessions', help: 'Currently active agent sessions', type: 'gauge', labelNames: ['agent_role', 'tenant_id'] },

  // LLM
  { name: 'llm_inference_duration_seconds', help: 'LLM inference duration in seconds', type: 'histogram', labelNames: ['model', 'provider'] },
  { name: 'llm_tokens_total', help: 'Total LLM tokens consumed', type: 'counter', labelNames: ['model', 'type'] },

  // Kafka
  { name: 'kafka_consumer_lag', help: 'Kafka consumer lag (messages behind)', type: 'gauge', labelNames: ['topic', 'consumer_group'] },

  // Compliance
  { name: 'compliance_violations_total', help: 'Total compliance violations detected', type: 'counter', labelNames: ['regulation', 'rule', 'severity'] },

  // Audit
  { name: 'audit_events_total', help: 'Total audit events recorded', type: 'counter', labelNames: ['action_type'] },

  // Encryption
  { name: 'encryption_operations_total', help: 'Total encryption operations', type: 'counter', labelNames: ['operation'] },
] as const;

// ─── Metrics Registry ────────────────────────────────────────────

export class MetricsRegistry {
  private readonly registry: Registry;
  private readonly counters: Map<string, Counter>;
  private readonly histograms: Map<string, Histogram>;
  private readonly gauges: Map<string, Gauge>;

  constructor(collectDefaults: boolean = true) {
    this.registry = new Registry();
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();

    // Register Node.js runtime metrics (GC, memory, event loop, etc.)
    if (collectDefaults) {
      collectDefaultMetrics({ register: this.registry });
    }

    // Register all predefined ORDR-Connect metrics
    for (const def of PREDEFINED_METRICS) {
      this.registerMetric(def);
    }
  }

  // ── Registration ─────────────────────────────────────────────

  private registerMetric(def: MetricDefinition): void {
    const labels = [...def.labelNames];

    switch (def.type) {
      case 'counter': {
        const counter = new Counter({
          name: def.name,
          help: def.help,
          labelNames: labels,
          registers: [this.registry],
        });
        this.counters.set(def.name, counter);
        break;
      }
      case 'histogram': {
        const histogram = new Histogram({
          name: def.name,
          help: def.help,
          labelNames: labels,
          registers: [this.registry],
          // Default buckets tuned for API response times
          buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        });
        this.histograms.set(def.name, histogram);
        break;
      }
      case 'gauge': {
        const gauge = new Gauge({
          name: def.name,
          help: def.help,
          labelNames: labels,
          registers: [this.registry],
        });
        this.gauges.set(def.name, gauge);
        break;
      }
    }
  }

  // ── Counter Operations ───────────────────────────────────────

  incrementCounter(name: string, labels: Record<string, string>, value: number = 1): void {
    const counter = this.counters.get(name);
    if (!counter) {
      throw new Error(`Counter not found: ${name}`);
    }
    counter.inc(labels, value);
  }

  // ── Histogram Operations ─────────────────────────────────────

  observeHistogram(name: string, labels: Record<string, string>, value: number): void {
    const histogram = this.histograms.get(name);
    if (!histogram) {
      throw new Error(`Histogram not found: ${name}`);
    }
    histogram.observe(labels, value);
  }

  // ── Gauge Operations ─────────────────────────────────────────

  setGauge(name: string, labels: Record<string, string>, value: number): void {
    const gauge = this.gauges.get(name);
    if (!gauge) {
      throw new Error(`Gauge not found: ${name}`);
    }
    gauge.set(labels, value);
  }

  incrementGauge(name: string, labels: Record<string, string>, value: number = 1): void {
    const gauge = this.gauges.get(name);
    if (!gauge) {
      throw new Error(`Gauge not found: ${name}`);
    }
    gauge.inc(labels, value);
  }

  decrementGauge(name: string, labels: Record<string, string>, value: number = 1): void {
    const gauge = this.gauges.get(name);
    if (!gauge) {
      throw new Error(`Gauge not found: ${name}`);
    }
    gauge.dec(labels, value);
  }

  // ── Prometheus Endpoint ──────────────────────────────────────

  /**
   * Returns Prometheus-formatted metrics text for /metrics endpoint.
   */
  async getMetricsEndpoint(): Promise<string> {
    return await this.registry.metrics();
  }

  /**
   * Returns the content type header for the metrics response.
   */
  getContentType(): string {
    return this.registry.contentType;
  }

  // ── Introspection ────────────────────────────────────────────

  hasCounter(name: string): boolean {
    return this.counters.has(name);
  }

  hasHistogram(name: string): boolean {
    return this.histograms.has(name);
  }

  hasGauge(name: string): boolean {
    return this.gauges.has(name);
  }

  /**
   * List all registered metric definitions.
   */
  getRegisteredMetrics(): readonly MetricDefinition[] {
    return [...PREDEFINED_METRICS];
  }

  /**
   * Reset all metrics — for testing only.
   */
  resetAll(): void {
    this.registry.resetMetrics();
  }
}

/**
 * Predefined metric definitions exported for reference/validation.
 */
export { PREDEFINED_METRICS };
