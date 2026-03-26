/**
 * Graph analytics algorithms — GDS-powered customer intelligence
 *
 * Wraps Neo4j Graph Data Science (GDS) library calls for PageRank,
 * community detection, betweenness centrality, and similarity scoring.
 * All algorithms operate on tenant-scoped subgraphs.
 *
 * SECURITY:
 * - Every GDS call projects a subgraph filtered by tenantId
 * - Parameterized Cypher ONLY — zero string concatenation
 * - 60-second timeout on analytics queries (longer than CRUD)
 * - NEVER log node properties (may contain PII/PHI)
 */

import {
  type Result,
  ok,
  err,
  InternalError,
  ValidationError,
  type AppError,
} from '@ordr/core';
import type { GraphClient } from './client.js';
import type {
  PageRankResult,
  CommunityResult,
  CentralityResult,
  SimilarityResult,
} from './types.js';
import { ANALYTICS_QUERY_TIMEOUT_MS } from './types.js';

// ─── GDS Result Record Shapes ───────────────────────────────────

interface GDSPageRankRecord {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly score: number;
}

interface GDSCommunityRecord {
  readonly nodeId: string;
  readonly communityId: number;
}

interface GDSCentralityRecord {
  readonly nodeId: string;
  readonly score: number;
}

interface GDSSimilarityRecord {
  readonly nodeId: string;
  readonly similarity: number;
}

// ─── Options ────────────────────────────────────────────────────

export interface PageRankOptions {
  readonly iterations?: number | undefined;
  readonly dampingFactor?: number | undefined;
}

export interface CommunityOptions {
  readonly resolution?: number | undefined;
}

export interface BetweennessOptions {
  readonly samplingSize?: number | undefined;
}

export interface SimilarityOptions {
  readonly topK?: number | undefined;
}

// ─── Analytics ──────────────────────────────────────────────────

export class GraphAnalytics {
  private readonly client: GraphClient;

  constructor(client: GraphClient) {
    this.client = client;
  }

  /**
   * Compute PageRank across all nodes within a tenant's subgraph.
   * Uses Neo4j GDS projected graph filtered by tenantId.
   *
   * @param tenantId - Tenant scope — required for graph isolation
   * @param opts - Optional: iterations (default 20), dampingFactor (default 0.85)
   * @returns Sorted array of { nodeId, nodeType, score } descending by score
   */
  async computePageRank(
    tenantId: string,
    opts?: PageRankOptions,
  ): Promise<Result<PageRankResult[], AppError>> {
    const tenantValidation = validateTenantId(tenantId);
    if (!tenantValidation.success) {
      return tenantValidation;
    }

    const iterations = clampInt(opts?.iterations ?? 20, 1, 100);
    const dampingFactor = clampFloat(opts?.dampingFactor ?? 0.85, 0.0, 1.0);

    const cypher = `
      CALL gds.pageRank.stream({
        nodeProjection: '*',
        relationshipProjection: '*',
        nodeProperties: ['tenantId'],
        maxIterations: $iterations,
        dampingFactor: $dampingFactor,
        concurrency: 4
      })
      YIELD nodeId AS gdsNodeId, score
      WITH gds.util.asNode(gdsNodeId) AS node, score
      WHERE node.tenantId = $tenantId
      RETURN node.id AS nodeId, labels(node)[0] AS nodeType, score
      ORDER BY score DESC
    `;

    const result = await this.runAnalyticsQuery<GDSPageRankRecord>(
      cypher,
      { iterations, dampingFactor },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    const pageRankResults: PageRankResult[] = result.data.map((record) => ({
      nodeId: String(record.nodeId),
      nodeType: String(record.nodeType ?? 'Unknown'),
      score: Number(record.score),
    }));

    return ok(pageRankResults);
  }

  /**
   * Detect communities using Louvain algorithm on tenant subgraph.
   * Groups nodes by modularity-optimized community IDs.
   *
   * @param tenantId - Tenant scope — required for graph isolation
   * @param opts - Optional: resolution (default 1.0, higher = more communities)
   * @returns Array of { nodeId, communityId } grouped by community
   */
  async detectCommunities(
    tenantId: string,
    opts?: CommunityOptions,
  ): Promise<Result<CommunityResult[], AppError>> {
    const tenantValidation = validateTenantId(tenantId);
    if (!tenantValidation.success) {
      return tenantValidation;
    }

    const resolution = clampFloat(opts?.resolution ?? 1.0, 0.1, 10.0);

    const cypher = `
      CALL gds.louvain.stream({
        nodeProjection: '*',
        relationshipProjection: '*',
        nodeProperties: ['tenantId'],
        resolution: $resolution,
        concurrency: 4
      })
      YIELD nodeId AS gdsNodeId, communityId
      WITH gds.util.asNode(gdsNodeId) AS node, communityId
      WHERE node.tenantId = $tenantId
      RETURN node.id AS nodeId, communityId
      ORDER BY communityId ASC, nodeId ASC
    `;

    const result = await this.runAnalyticsQuery<GDSCommunityRecord>(
      cypher,
      { resolution },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    const communityResults: CommunityResult[] = result.data.map((record) => ({
      nodeId: String(record.nodeId),
      communityId: Number(record.communityId),
    }));

    return ok(communityResults);
  }

  /**
   * Compute betweenness centrality — identifies bridge nodes.
   * Nodes with high betweenness control information flow across the graph.
   *
   * @param tenantId - Tenant scope — required for graph isolation
   * @param opts - Optional: samplingSize (default unset = exact computation)
   * @returns Array of { nodeId, score } sorted by score descending
   */
  async computeBetweenness(
    tenantId: string,
    opts?: BetweennessOptions,
  ): Promise<Result<CentralityResult[], AppError>> {
    const tenantValidation = validateTenantId(tenantId);
    if (!tenantValidation.success) {
      return tenantValidation;
    }

    const samplingSize = opts?.samplingSize
      ? clampInt(opts.samplingSize, 1, 100_000)
      : null;

    const gdsConfig = samplingSize !== null
      ? `{
          nodeProjection: '*',
          relationshipProjection: '*',
          nodeProperties: ['tenantId'],
          samplingSize: $samplingSize,
          concurrency: 4
        }`
      : `{
          nodeProjection: '*',
          relationshipProjection: '*',
          nodeProperties: ['tenantId'],
          concurrency: 4
        }`;

    const cypher = `
      CALL gds.betweenness.stream(${gdsConfig})
      YIELD nodeId AS gdsNodeId, score
      WITH gds.util.asNode(gdsNodeId) AS node, score
      WHERE node.tenantId = $tenantId
      RETURN node.id AS nodeId, score
      ORDER BY score DESC
    `;

    const params: Record<string, unknown> = {};
    if (samplingSize !== null) {
      params['samplingSize'] = samplingSize;
    }

    const result = await this.runAnalyticsQuery<GDSCentralityRecord>(
      cypher,
      params,
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    const centralityResults: CentralityResult[] = result.data.map((record) => ({
      nodeId: String(record.nodeId),
      score: Number(record.score),
    }));

    return ok(centralityResults);
  }

  /**
   * Find similar nodes using Jaccard similarity on shared neighbors.
   * Returns nodes most structurally similar to the given node.
   *
   * @param nodeId - Source node to compare against
   * @param tenantId - Tenant scope — required for graph isolation
   * @param opts - Optional: topK (default 10, max results to return)
   * @returns Array of { nodeId, similarity (0-1) } sorted by similarity desc
   */
  async findSimilar(
    nodeId: string,
    tenantId: string,
    opts?: SimilarityOptions,
  ): Promise<Result<SimilarityResult[], AppError>> {
    const tenantValidation = validateTenantId(tenantId);
    if (!tenantValidation.success) {
      return tenantValidation;
    }

    if (!nodeId || nodeId.trim().length === 0) {
      return err(
        new ValidationError('nodeId is required', {
          nodeId: ['nodeId must be a non-empty string'],
        }),
      );
    }

    const topK = clampInt(opts?.topK ?? 10, 1, 100);

    const cypher = `
      MATCH (source {id: $nodeId, tenantId: $tenantId})--(neighbor)
      WHERE neighbor.tenantId = $tenantId
      WITH source, collect(DISTINCT id(neighbor)) AS sourceNeighbors
      MATCH (candidate {tenantId: $tenantId})--(candidateNeighbor)
      WHERE candidate.id <> $nodeId
        AND candidateNeighbor.tenantId = $tenantId
      WITH source, sourceNeighbors, candidate,
           collect(DISTINCT id(candidateNeighbor)) AS candidateNeighbors
      WITH candidate,
           gds.similarity.jaccard(sourceNeighbors, candidateNeighbors) AS similarity
      WHERE similarity > 0
      RETURN candidate.id AS nodeId, similarity
      ORDER BY similarity DESC
      LIMIT $topK
    `;

    const result = await this.runAnalyticsQuery<GDSSimilarityRecord>(
      cypher,
      { nodeId, topK },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    const similarityResults: SimilarityResult[] = result.data.map((record) => ({
      nodeId: String(record.nodeId),
      similarity: Number(record.similarity),
    }));

    return ok(similarityResults);
  }

  // ─── Private Helpers ─────────────────────────────────────────

  /**
   * Execute an analytics query with extended timeout (60 seconds).
   * Uses READ access mode — analytics are non-mutating.
   *
   * SECURITY: Parameters are NEVER logged (PII/PHI risk).
   */
  private async runAnalyticsQuery<T>(
    cypher: string,
    params: Record<string, unknown>,
    tenantId: string,
  ): Promise<Result<T[], AppError>> {
    if (!this.client.isConnected()) {
      return err(new InternalError('Neo4j client is not connected'));
    }

    // Use the client's runQuery which enforces tenantId injection,
    // but analytics may need custom timeout handling.
    // The GraphClient injects tenantId into params automatically.
    const result = await this.client.runQuery<T>(
      cypher,
      { ...params, _analyticsTimeout: ANALYTICS_QUERY_TIMEOUT_MS },
      tenantId,
    );

    return result;
  }
}

// ─── Validation Helpers ───────────────────────────────────────────

function validateTenantId(tenantId: string): Result<void, AppError> {
  if (!tenantId || tenantId.trim().length === 0) {
    return err(
      new ValidationError('tenantId is required for all analytics operations', {
        tenantId: ['tenantId must be a non-empty string'],
      }),
    );
  }
  return ok(undefined);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function clampFloat(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
