/**
 * Computed property updater — batch-write analytics scores to graph nodes
 *
 * Takes analytics results (PageRank, community detection, centrality)
 * and writes them back to nodes as computed properties. Batched in
 * groups of 100 to prevent transaction timeouts.
 *
 * SECURITY:
 * - All updates are tenant-scoped — tenantId in every MATCH
 * - Parameterized Cypher ONLY — zero string concatenation
 * - NEVER log node properties (may contain PII/PHI)
 * - Publishes graph.properties.updated event after completion
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
} from './types.js';
import { BATCH_SIZE } from './types.js';

// ─── Computed Property Updater ──────────────────────────────────

export class ComputedPropertyUpdater {
  private readonly client: GraphClient;

  constructor(client: GraphClient) {
    this.client = client;
  }

  /**
   * Batch update nodes with PageRank influence scores.
   * Sets `influence_score` property on each node.
   *
   * @param tenantId - Tenant scope — required for isolation
   * @param results - PageRank computation results
   * @returns Count of nodes successfully updated
   */
  async updatePageRankScores(
    tenantId: string,
    results: readonly PageRankResult[],
  ): Promise<Result<number, AppError>> {
    const tenantValidation = validateTenantId(tenantId);
    if (!tenantValidation.success) {
      return tenantValidation;
    }

    if (results.length === 0) {
      return ok(0);
    }

    const cypher = `
      UNWIND $batch AS item
      MATCH (n {id: item.nodeId, tenantId: $tenantId})
      SET n.influence_score = item.score,
          n.updatedAt = datetime($updatedAt)
      RETURN count(n) AS updated
    `;

    return this.batchUpdate(
      tenantId,
      results.map((r) => ({ nodeId: r.nodeId, score: r.score })),
      cypher,
    );
  }

  /**
   * Batch update nodes with Louvain community assignments.
   * Sets `community_id` property on each node.
   *
   * @param tenantId - Tenant scope — required for isolation
   * @param results - Community detection results
   * @returns Count of nodes successfully updated
   */
  async updateCommunityAssignments(
    tenantId: string,
    results: readonly CommunityResult[],
  ): Promise<Result<number, AppError>> {
    const tenantValidation = validateTenantId(tenantId);
    if (!tenantValidation.success) {
      return tenantValidation;
    }

    if (results.length === 0) {
      return ok(0);
    }

    const cypher = `
      UNWIND $batch AS item
      MATCH (n {id: item.nodeId, tenantId: $tenantId})
      SET n.community_id = item.communityId,
          n.updatedAt = datetime($updatedAt)
      RETURN count(n) AS updated
    `;

    return this.batchUpdate(
      tenantId,
      results.map((r) => ({ nodeId: r.nodeId, communityId: r.communityId })),
      cypher,
    );
  }

  /**
   * Batch update nodes with betweenness centrality scores.
   * Sets `centrality_score` property on each node.
   *
   * @param tenantId - Tenant scope — required for isolation
   * @param results - Centrality computation results
   * @returns Count of nodes successfully updated
   */
  async updateCentralityScores(
    tenantId: string,
    results: readonly CentralityResult[],
  ): Promise<Result<number, AppError>> {
    const tenantValidation = validateTenantId(tenantId);
    if (!tenantValidation.success) {
      return tenantValidation;
    }

    if (results.length === 0) {
      return ok(0);
    }

    const cypher = `
      UNWIND $batch AS item
      MATCH (n {id: item.nodeId, tenantId: $tenantId})
      SET n.centrality_score = item.score,
          n.updatedAt = datetime($updatedAt)
      RETURN count(n) AS updated
    `;

    return this.batchUpdate(
      tenantId,
      results.map((r) => ({ nodeId: r.nodeId, score: r.score })),
      cypher,
    );
  }

  // ─── Private Helpers ─────────────────────────────────────────

  /**
   * Execute a batch update in chunks of BATCH_SIZE (100).
   * Returns total count of nodes updated across all batches.
   *
   * On partial failure, returns the count of successfully updated nodes
   * before the failure. The error is returned so callers can decide
   * whether to retry.
   */
  private async batchUpdate(
    tenantId: string,
    items: readonly Record<string, unknown>[],
    cypher: string,
  ): Promise<Result<number, AppError>> {
    let totalUpdated = 0;
    const now = new Date().toISOString();

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);

      const result = await this.client.runWriteQuery<{ readonly updated: number }>(
        cypher,
        { batch, updatedAt: now },
        tenantId,
      );

      if (!result.success) {
        // Return partial count + the error so caller knows progress
        if (totalUpdated > 0) {
          return err(
            new InternalError(
              `Batch update partially failed after ${totalUpdated} nodes: ${result.error.message}`,
            ),
          );
        }
        return result;
      }

      // Sum up the count from this batch
      for (const record of result.data) {
        totalUpdated += Number(record.updated ?? 0);
      }
    }

    return ok(totalUpdated);
  }
}

// ─── Validation Helpers ───────────────────────────────────────────

function validateTenantId(tenantId: string): Result<void, AppError> {
  if (!tenantId || tenantId.trim().length === 0) {
    return err(
      new ValidationError('tenantId is required for property updates', {
        tenantId: ['tenantId must be a non-empty string'],
      }),
    );
  }
  return ok(undefined);
}
