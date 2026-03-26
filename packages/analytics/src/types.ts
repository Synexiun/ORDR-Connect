/**
 * Analytics types — OLAP metrics, queries, and dashboard models for ORDR-Connect
 *
 * SECURITY:
 * - All query types enforce tenantId for tenant isolation (SOC2 CC6.1)
 * - No PII/PHI types defined here — analytics operates on aggregated metrics only
 * - Dimensions use string identifiers, never raw customer data
 *
 * ISO 27001 A.8.2.1 — Classification of information: all metric data is INTERNAL.
 * HIPAA §164.312(a)(1) — Access control: tenantId required on every query.
 */

// ─── Time Range ──────────────────────────────────────────────────

export const GRANULARITIES = ['minute', 'hour', 'day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export interface TimeRange {
  readonly from: Date;
  readonly to: Date;
  readonly granularity: Granularity;
}

// ─── Metric Names ────────────────────────────────────────────────

export const METRIC_NAMES = [
  'messages_sent',
  'messages_delivered',
  'messages_failed',
  'agent_sessions',
  'agent_resolutions',
  'compliance_violations',
  'response_rate',
  'avg_response_time',
  'revenue_collected',
  'cost_per_interaction',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

// ─── Metric Values ───────────────────────────────────────────────

export interface MetricValue {
  readonly metric: MetricName;
  readonly value: number;
  readonly timestamp: Date;
  readonly dimensions: Record<string, string>;
}

// ─── Analytics Query ─────────────────────────────────────────────

export interface AnalyticsQuery {
  readonly tenantId: string;
  readonly metrics: readonly MetricName[];
  readonly timeRange: TimeRange;
  readonly dimensions?: readonly string[] | undefined;
  readonly filters?: Readonly<Record<string, string>> | undefined;
}

// ─── Analytics Result ────────────────────────────────────────────

export interface AnalyticsResult {
  readonly query: AnalyticsQuery;
  readonly data: readonly MetricValue[];
  readonly computedAt: Date;
}

// ─── Channel Metrics ─────────────────────────────────────────────

export interface ChannelMetrics {
  readonly channel: string;
  readonly sent: number;
  readonly delivered: number;
  readonly failed: number;
  readonly deliveryRate: number;
  readonly avgCost: number;
}

// ─── Agent Metrics ───────────────────────────────────────────────

export interface AgentMetrics {
  readonly agentRole: string;
  readonly sessions: number;
  readonly resolutions: number;
  readonly resolutionRate: number;
  readonly avgConfidence: number;
  readonly avgSteps: number;
  readonly avgCostCents: number;
  readonly avgDurationMs: number;
}

// ─── Compliance Metrics ──────────────────────────────────────────

export interface ComplianceMetrics {
  readonly regulation: string;
  readonly checks: number;
  readonly violations: number;
  readonly complianceRate: number;
}

// ─── Cohort Types ────────────────────────────────────────────────

export const COHORT_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'between',
  'contains',
] as const;

export type CohortOperator = (typeof COHORT_OPERATORS)[number];

export interface CohortCriteria {
  readonly field: string;
  readonly operator: CohortOperator;
  readonly value: string | number | readonly string[] | readonly number[];
}

export interface CohortDefinition {
  readonly name: string;
  readonly tenantId: string;
  readonly criteria: readonly CohortCriteria[];
}

export interface StoredCohort {
  readonly id: string;
  readonly definition: CohortDefinition;
  readonly createdAt: Date;
}

// ─── Dashboard Summary ───────────────────────────────────────────

export interface DashboardSummary {
  readonly totalCustomers: number;
  readonly activeAgents: number;
  readonly complianceScore: number;
  readonly revenueCollected: number;
  readonly channelMetrics: readonly ChannelMetrics[];
  readonly agentMetrics: readonly AgentMetrics[];
  readonly complianceMetrics: readonly ComplianceMetrics[];
}

// ─── Counter Store Interface ─────────────────────────────────────

export interface CounterStore {
  increment(key: string, amount?: number): Promise<void>;
  get(key: string): Promise<number>;
  getMultiple(keys: readonly string[]): Promise<ReadonlyMap<string, number>>;
  reset(keyPattern: string): Promise<void>;
}

// ─── Analytics Client Config ─────────────────────────────────────

export interface AnalyticsClientConfig {
  readonly url: string;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly tls: boolean;
}

// ─── Constants ───────────────────────────────────────────────────

/** Query timeout in milliseconds — prevents resource exhaustion */
export const QUERY_TIMEOUT_MS = 30_000;

/** Batch flush interval for event sink */
export const BATCH_FLUSH_INTERVAL_MS = 5_000;

/** Batch size threshold for event sink flush */
export const BATCH_FLUSH_SIZE = 100;

/** Counter key TTL in seconds (48 hours) */
export const COUNTER_TTL_SECONDS = 48 * 60 * 60;

/** Counter key namespace prefix */
export const COUNTER_KEY_PREFIX = 'ordr:counters' as const;
