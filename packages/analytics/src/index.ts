/**
 * @ordr/analytics — OLAP analytics, real-time counters, and cohort analysis
 *
 * Tenant-isolated analytics for the ORDR-Connect Customer Operations OS.
 * SOC2/ISO27001/HIPAA compliant — all operations enforce tenant boundaries.
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  Granularity,
  TimeRange,
  MetricName,
  MetricValue,
  AnalyticsQuery,
  AnalyticsResult,
  ChannelMetrics,
  AgentMetrics,
  ComplianceMetrics,
  CohortOperator,
  CohortCriteria,
  CohortDefinition,
  StoredCohort,
  DashboardSummary,
  CounterStore,
  AnalyticsClientConfig,
} from './types.js';

export {
  GRANULARITIES,
  METRIC_NAMES,
  COHORT_OPERATORS,
  QUERY_TIMEOUT_MS,
  BATCH_FLUSH_INTERVAL_MS,
  BATCH_FLUSH_SIZE,
  COUNTER_TTL_SECONDS,
  COUNTER_KEY_PREFIX,
} from './types.js';

// ─── Client ──────────────────────────────────────────────────────
export type { AnalyticsStore } from './client.js';

export { AnalyticsClient, InMemoryAnalyticsStore } from './client.js';

// ─── Event Sink ──────────────────────────────────────────────────
export { AnalyticsEventSink } from './event-sink.js';

// ─── Queries ─────────────────────────────────────────────────────
export { AnalyticsQueries } from './queries.js';

// ─── Real-Time Counters ──────────────────────────────────────────
export type { RedisCounterClient } from './real-time-counters.js';

export {
  RealTimeCounters,
  InMemoryCounterStore,
  RedisCounterStore,
  buildCounterKey,
  getTodayDateString,
} from './real-time-counters.js';

// ─── Cohorts ─────────────────────────────────────────────────────
export type { BuiltInCohortField, CohortCustomerRecord, CustomerProvider } from './cohorts.js';

export { CohortAnalyzer, BUILT_IN_COHORT_FIELDS } from './cohorts.js';
