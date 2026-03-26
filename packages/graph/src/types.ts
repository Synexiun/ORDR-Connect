/**
 * Graph types — Customer relationship graph model for ORDR-Connect
 *
 * Defines the node/edge schema for the Neo4j-backed customer graph.
 * Every entity is tenant-scoped. Cross-tenant access is structurally
 * prevented by requiring tenantId on every type.
 */

import { z } from 'zod';

// ─── Node Types ──────────────────────────────────────────────────

export const NODE_TYPES = [
  'Person',
  'Company',
  'Deal',
  'Interaction',
  'Agent',
  'Campaign',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

// ─── Edge Types ──────────────────────────────────────────────────

export const EDGE_TYPES = [
  'WORKS_AT',
  'OWNS',
  'CONTACTED',
  'PARTICIPATED_IN',
  'ASSIGNED_TO',
  'RELATED_TO',
  'INFLUENCED_BY',
  'PART_OF',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

// ─── Graph Node ──────────────────────────────────────────────────

export interface GraphNode {
  readonly id: string;
  readonly type: NodeType;
  readonly tenantId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Graph Edge ──────────────────────────────────────────────────

export interface GraphEdge {
  readonly id: string;
  readonly type: EdgeType;
  readonly sourceId: string;
  readonly targetId: string;
  readonly tenantId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly weight: number;
  readonly createdAt: Date;
}

// ─── Query Types ─────────────────────────────────────────────────

export interface GraphQuery {
  readonly nodeType?: NodeType | undefined;
  readonly filters?: Readonly<Record<string, unknown>> | undefined;
  readonly depth?: number | undefined;
  readonly limit?: number | undefined;
}

// ─── Traversal Result ────────────────────────────────────────────

export interface TraversalResult {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly paths: readonly ReadonlyArray<string>[];
}

// ─── Health Score ────────────────────────────────────────────────

export interface HealthScoreFactors {
  /** Number of interactions in the last 30 days */
  readonly interactionFrequency: number;
  /** Percentage of outbound messages that received a reply (0.0–1.0) */
  readonly responseRate: number;
  /** Average sentiment score (-1.0 to 1.0) */
  readonly sentimentTrend: number;
  /** Deal value in dollars */
  readonly dealValue: number;
  /** Days since last interaction */
  readonly recency: number;
}

export type HealthClassification = 'healthy' | 'at_risk' | 'churning' | 'critical';

// ─── Event Payloads ──────────────────────────────────────────────

export interface CustomerCreatedEvent {
  readonly customerId: string;
  readonly name: string;
  readonly email: string;
  readonly type: 'person' | 'company';
  readonly tenantId: string;
}

export interface InteractionLoggedEvent {
  readonly interactionId: string;
  readonly customerId: string;
  readonly channel: string;
  readonly direction: 'inbound' | 'outbound';
  readonly tenantId: string;
}

export interface AgentActionEvent {
  readonly actionId: string;
  readonly agentId: string;
  readonly customerId: string;
  readonly actionType: string;
  readonly tenantId: string;
}

// ─── Zod Schemas ─────────────────────────────────────────────────

export const graphNodeSchema = z.object({
  type: z.enum(NODE_TYPES),
  tenantId: z.string().min(1),
  properties: z.record(z.unknown()),
});

export const graphEdgeSchema = z.object({
  type: z.enum(EDGE_TYPES),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  tenantId: z.string().min(1),
  properties: z.record(z.unknown()).default({}),
  weight: z.number().min(0).max(1).default(1),
});

// ─── Analytics Result Types ──────────────────────────────────────

export interface PageRankResult {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly score: number;
}

export interface CommunityResult {
  readonly nodeId: string;
  readonly communityId: number;
}

export interface CentralityResult {
  readonly nodeId: string;
  readonly score: number;
}

export interface SimilarityResult {
  readonly nodeId: string;
  readonly similarity: number;
}

// ─── Enrichment Types ───────────────────────────────────────────

export const ENRICHMENT_SOURCES = [
  'clearbit',
  'apollo',
  'manual',
  'internal',
] as const;

export type EnrichmentSource = (typeof ENRICHMENT_SOURCES)[number];

export interface EnrichmentData {
  readonly source: EnrichmentSource;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly enrichedAt: Date;
  readonly confidence: number;
}

// ─── Scheduler Types ────────────────────────────────────────────

export const JOB_STATUSES = [
  'idle',
  'running',
  'completed',
  'failed',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface ScheduledJob {
  readonly name: string;
  readonly tenantId: string;
  readonly schedule: string;
  readonly lastRun: Date | null;
  readonly nextRun: Date | null;
  readonly status: JobStatus;
}

export interface JobRunResult {
  readonly jobName: string;
  readonly tenantId: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly nodesProcessed: number;
  readonly status: 'completed' | 'failed';
  readonly error?: string | undefined;
}

// ─── Enrichment Provider Interface ──────────────────────────────

export interface EnrichmentProvider {
  readonly name: string;
  readonly supportedNodeTypes: readonly string[];
  readonly rateLimit: { readonly maxPerSecond: number; readonly maxPerDay: number };
  enrich(node: GraphNode): Promise<import('@ordr/core').Result<EnrichmentData, import('@ordr/core').AppError>>;
}

// ─── Constants ───────────────────────────────────────────────────

/** Maximum traversal depth to prevent expensive graph queries */
export const MAX_TRAVERSAL_DEPTH = 5 as const;

/** Query timeout in milliseconds */
export const QUERY_TIMEOUT_MS = 10_000 as const;

/** Analytics query timeout — longer than CRUD (60 seconds) */
export const ANALYTICS_QUERY_TIMEOUT_MS = 60_000 as const;

/** Batch size for bulk graph updates */
export const BATCH_SIZE = 100 as const;

/** Default results limit */
export const DEFAULT_QUERY_LIMIT = 100 as const;
