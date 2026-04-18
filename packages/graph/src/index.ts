/**
 * @ordr/graph — Customer relationship graph for ORDR-Connect
 *
 * Neo4j-backed graph layer providing customer intelligence,
 * relationship traversals, health scoring, event-driven enrichment,
 * graph analytics (PageRank, Louvain, betweenness), enrichment
 * pipeline, and scheduled analytics jobs.
 *
 * Every operation is tenant-isolated by design.
 */

// ─── Types ───────────────────────────────────────────────────────
export type {
  NodeType,
  EdgeType,
  GraphNode,
  GraphEdge,
  GraphQuery,
  TraversalResult,
  HealthScoreFactors,
  HealthClassification,
  CustomerCreatedEvent,
  InteractionLoggedEvent,
  AgentActionEvent,
  PageRankResult,
  CommunityResult,
  CentralityResult,
  SimilarityResult,
  EnrichmentSource,
  EnrichmentData,
  EnrichmentProvider,
  JobStatus,
  ScheduledJob,
  JobRunResult,
} from './types.js';

export {
  NODE_TYPES,
  EDGE_TYPES,
  ENRICHMENT_SOURCES,
  JOB_STATUSES,
  MAX_TRAVERSAL_DEPTH,
  QUERY_TIMEOUT_MS,
  ANALYTICS_QUERY_TIMEOUT_MS,
  BATCH_SIZE,
  DEFAULT_QUERY_LIMIT,
  graphNodeSchema,
  graphEdgeSchema,
} from './types.js';

// ─── Client ──────────────────────────────────────────────────────
export type { GraphClientConfig } from './client.js';

export { GraphClient } from './client.js';

// ─── Operations ──────────────────────────────────────────────────
export { GraphOperations } from './operations.js';

// ─── Traversals ──────────────────────────────────────────────────
export { GraphTraversals } from './traversals.js';

// ─── Health Scoring ──────────────────────────────────────────────
export { HealthScoreCalculator, HEALTH_WEIGHTS, HEALTH_THRESHOLDS } from './health-score.js';

// ─── Enrichment (legacy event handlers) ─────────────────────────
export { GraphEnricher } from './enrichment.js';

// ─── Analytics ───────────────────────────────────────────────────
export { GraphAnalytics } from './analytics.js';
export type {
  PageRankOptions,
  CommunityOptions,
  BetweennessOptions,
  SimilarityOptions,
} from './analytics.js';

// ─── Computed Properties ─────────────────────────────────────────
export { ComputedPropertyUpdater } from './computed-properties.js';

// ─── Enrichment Pipeline ─────────────────────────────────────────
export { EnrichmentPipeline, ClearbitProvider, InternalProvider } from './enrichment-pipeline.js';
export type { EnrichmentPipelineDeps } from './enrichment-pipeline.js';

// ─── Scheduler ───────────────────────────────────────────────────
export { GraphScheduler } from './scheduler.js';
