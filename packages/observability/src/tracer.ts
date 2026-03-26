/**
 * @ordr/observability — Distributed tracing via OpenTelemetry
 *
 * SOC2 CC7.2 — Monitoring: distributed request tracing across services.
 * ISO 27001 A.8.15 — Logging: correlate operations via trace/span IDs.
 *
 * SECURITY:
 * - NEVER attach PHI/PII to span attributes
 * - tenant_id is safe (opaque identifier, not PII)
 * - Request/response bodies MUST NOT appear in spans
 */

import { trace, context, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  BatchSpanProcessor,
  InMemorySpanExporter,
  TraceIdRatioBasedSampler,
  AlwaysOnSampler,
  type SpanExporter,
  type Sampler,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import type { TracerConfig, SpanAttributes } from './types.js';

// ─── Module State ────────────────────────────────────────────────

let globalProvider: BasicTracerProvider | null = null;
let globalTracer: Tracer | null = null;

// ─── Initialization ──────────────────────────────────────────────

/**
 * Initialize the OpenTelemetry tracer for a service.
 * Call once at startup. Returns the configured Tracer instance.
 */
export function initTracer(serviceName: string, config: TracerConfig = {}): Tracer {
  const {
    endpoint,
    sampleRate,
    enabled = true,
    environment = 'development',
  } = config;

  if (!enabled) {
    // Return a no-op tracer when disabled
    globalTracer = trace.getTracer(serviceName);
    return globalTracer;
  }

  // Determine sampling strategy
  const effectiveRate = sampleRate ?? (environment === 'production' ? 0.1 : 1.0);
  const sampler: Sampler = effectiveRate >= 1.0
    ? new AlwaysOnSampler()
    : new TraceIdRatioBasedSampler(effectiveRate);

  // Build resource with service metadata
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: '0.1.0',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
  });

  // Create provider with sampling
  const provider = new BasicTracerProvider({
    resource,
    sampler,
  });

  // Configure exporter
  let exporter: SpanExporter;
  if (endpoint) {
    exporter = new OTLPTraceExporter({ url: endpoint });
    // Use batch processor in production for efficiency
    provider.addSpanProcessor(
      environment === 'production'
        ? new BatchSpanProcessor(exporter)
        : new SimpleSpanProcessor(exporter),
    );
  } else {
    // In-memory exporter for testing/local development
    exporter = new InMemorySpanExporter();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  }

  // Register as global provider with async context propagation
  // AsyncLocalStorageContextManager enables trace.getActiveSpan() to work
  // correctly across async boundaries (required for Node.js)
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  provider.register({ contextManager });

  globalProvider = provider;
  globalTracer = provider.getTracer(serviceName);

  return globalTracer;
}

// ─── Span Operations ─────────────────────────────────────────────

/**
 * Create a new span with optional attributes.
 * Caller is responsible for ending the span.
 */
export function createSpan(name: string, attributes?: SpanAttributes): Span {
  const tracer = globalTracer ?? trace.getTracer('ordr-default');
  const span = tracer.startSpan(name);

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }

  return span;
}

/**
 * Execute an async function within a new span, automatically closing it
 * on success or recording an error on failure.
 *
 * Usage:
 *   const result = await withSpan('db.query', async () => db.query(...));
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: SpanAttributes,
): Promise<T> {
  const tracer = globalTracer ?? trace.getTracer('ordr-default');
  const span = tracer.startSpan(name);

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }

  const ctx = trace.setSpan(context.active(), span);

  try {
    const result = await context.with(ctx, fn);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error: unknown) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Get the current active trace context (trace_id, span_id) for injection
 * into logs, audit events, and response headers.
 */
export function getActiveTraceContext(): { traceId: string; spanId: string } | null {
  const span = trace.getActiveSpan();
  if (!span) return null;

  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

/**
 * Shutdown the tracer provider, flushing all pending spans.
 * Call during graceful shutdown.
 */
export async function shutdownTracer(): Promise<void> {
  if (globalProvider) {
    await globalProvider.shutdown();
    globalProvider = null;
    globalTracer = null;
  }
}
