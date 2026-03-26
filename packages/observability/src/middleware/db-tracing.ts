/**
 * Database Query Tracing — Drizzle ORM instrumentation wrapper
 *
 * SOC2 CC7.2 — Monitoring: database operation tracing.
 * ISO 27001 A.8.15 — Logging: query performance monitoring.
 *
 * SECURITY (Rule 6 — PHI Safety):
 * - NEVER logs query content (queries may reference PHI columns)
 * - Only records: operation type, table name, duration
 * - No bind parameters in spans
 * - No result data in spans
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';

// ─── Types ───────────────────────────────────────────────────────

export type DbOperation = 'select' | 'insert' | 'update' | 'delete';

export interface DbTraceOptions {
  readonly operation: DbOperation;
  readonly table: string;
}

export interface DbTracingConfig {
  readonly serviceName: string;
}

// ─── DB Tracing Wrapper ──────────────────────────────────────────

/**
 * Creates a database tracing wrapper for Drizzle ORM queries.
 *
 * Usage:
 *   const dbTrace = createDbTracing({ serviceName: 'api' });
 *   const result = await dbTrace.trace(
 *     { operation: 'select', table: 'customers' },
 *     () => db.select().from(customers).where(...)
 *   );
 */
export function createDbTracing(config: DbTracingConfig) {
  const tracer = trace.getTracer(`${config.serviceName}-db`);

  return {
    /**
     * Wrap a database query with tracing instrumentation.
     * Records operation type, table name, and duration.
     * NEVER records query content or parameters (PHI safety).
     */
    async trace<T>(
      options: DbTraceOptions,
      queryFn: () => Promise<T>,
    ): Promise<T> {
      const span = tracer.startSpan(`db.${options.operation}`, {
        attributes: {
          'db.operation': options.operation,
          'db.table': options.table,
          'db.system': 'postgresql',
        },
      });

      const startTime = performance.now();

      try {
        const result = await queryFn();
        const durationSec = (performance.now() - startTime) / 1000;

        span.setAttribute('db.duration_seconds', durationSec);
        span.setStatus({ code: SpanStatusCode.OK });

        return result;
      } catch (error: unknown) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          // SECURITY: Only record error type, NEVER the full message
          // (may contain table/column names that hint at data structure)
          message: error instanceof Error ? error.constructor.name : 'QueryError',
        });
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      } finally {
        span.end();
      }
    },
  };
}
