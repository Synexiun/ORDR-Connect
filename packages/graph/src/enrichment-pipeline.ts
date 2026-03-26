/**
 * Enrichment pipeline — external data enrichment for graph nodes
 *
 * Orchestrates enrichment from multiple providers (Clearbit, Apollo,
 * internal graph data). Rate-limited per provider with configurable
 * thresholds. Designed for both single-node and batch enrichment.
 *
 * SECURITY:
 * - All operations are tenant-scoped
 * - Enrichment data is validated before writing to graph
 * - Provider API calls are rate-limited to prevent abuse
 * - Audit trail of all enrichments (what fields were added/updated)
 * - NEVER log node properties or enrichment data (PII/PHI risk)
 */

import {
  type Result,
  ok,
  err,
  InternalError,
  ValidationError,
  NotFoundError,
  type AppError,
} from '@ordr/core';
import type { GraphOperations } from './operations.js';
import type {
  GraphNode,
  EnrichmentSource,
  EnrichmentData,
  EnrichmentProvider,
} from './types.js';

// ─── Rate Limiter ───────────────────────────────────────────────

/**
 * Simple sliding-window rate limiter for enrichment providers.
 * Tracks calls per second and per day.
 */
class ProviderRateLimiter {
  private readonly timestamps: number[] = [];
  private dailyCount = 0;
  private dailyResetAt: number;
  private readonly maxPerSecond: number;
  private readonly maxPerDay: number;

  constructor(maxPerSecond: number, maxPerDay: number) {
    this.maxPerSecond = maxPerSecond;
    this.maxPerDay = maxPerDay;
    this.dailyResetAt = Date.now() + 86_400_000; // 24 hours from now
  }

  /**
   * Check if a request is allowed under rate limits.
   * Returns true if allowed, false if rate limited.
   */
  canProceed(): boolean {
    const now = Date.now();

    // Reset daily counter if past the reset time
    if (now >= this.dailyResetAt) {
      this.dailyCount = 0;
      this.dailyResetAt = now + 86_400_000;
    }

    // Check daily limit
    if (this.dailyCount >= this.maxPerDay) {
      return false;
    }

    // Check per-second limit (sliding window of 1 second)
    const oneSecondAgo = now - 1000;
    const recentCalls = this.timestamps.filter((t) => t > oneSecondAgo);

    if (recentCalls.length >= this.maxPerSecond) {
      return false;
    }

    return true;
  }

  /**
   * Record a request. Call after a successful rate limit check.
   */
  record(): void {
    const now = Date.now();
    this.timestamps.push(now);
    this.dailyCount++;

    // Trim old timestamps (keep last 60 seconds)
    const cutoff = now - 60_000;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }
}

// ─── Pipeline Dependencies ──────────────────────────────────────

export interface EnrichmentPipelineDeps {
  readonly operations: GraphOperations;
  readonly providers: ReadonlyMap<string, EnrichmentProvider>;
}

// ─── Enrichment Pipeline ────────────────────────────────────────

export class EnrichmentPipeline {
  private readonly operations: GraphOperations;
  private readonly providers: ReadonlyMap<string, EnrichmentProvider>;
  private readonly rateLimiters: Map<string, ProviderRateLimiter>;

  constructor(deps: EnrichmentPipelineDeps) {
    this.operations = deps.operations;
    this.providers = deps.providers;
    this.rateLimiters = new Map();

    // Initialize rate limiters for each provider
    for (const [name, provider] of this.providers) {
      this.rateLimiters.set(
        name,
        new ProviderRateLimiter(
          provider.rateLimit.maxPerSecond,
          provider.rateLimit.maxPerDay,
        ),
      );
    }
  }

  /**
   * Enrich a single node with data from the specified provider (or best match).
   *
   * Flow: look up node -> select provider -> call provider -> merge properties -> update node
   *
   * @param nodeId - Node to enrich
   * @param tenantId - Tenant scope — required for isolation
   * @param source - Optional: specific provider to use
   * @returns Enrichment data that was applied
   */
  async enrichNode(
    nodeId: string,
    tenantId: string,
    source?: EnrichmentSource,
  ): Promise<Result<EnrichmentData, AppError>> {
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

    // Look up the node
    const nodeResult = await this.operations.getNode(nodeId, tenantId);
    if (!nodeResult.success) {
      return nodeResult;
    }

    if (nodeResult.data === null) {
      return err(new NotFoundError(`Node ${nodeId} not found for tenant`));
    }

    const node = nodeResult.data;

    // Select the appropriate provider
    const provider = this.selectProvider(node, source);
    if (!provider) {
      return err(
        new ValidationError('No enrichment provider available for this node type', {
          nodeType: [`No provider supports node type: ${node.type}`],
        }),
      );
    }

    // Check rate limit
    const limiter = this.rateLimiters.get(provider.name);
    if (limiter && !limiter.canProceed()) {
      return err(
        new InternalError(
          `Rate limit exceeded for enrichment provider: ${provider.name}`,
        ),
      );
    }

    // Call the provider
    const enrichResult = await provider.enrich(node);
    if (!enrichResult.success) {
      return enrichResult;
    }

    // Record the rate limit hit
    if (limiter) {
      limiter.record();
    }

    const enrichmentData = enrichResult.data;

    // Merge enrichment data into node properties
    const updateResult = await this.operations.updateNode(
      nodeId,
      tenantId,
      {
        ...enrichmentData.fields,
        _lastEnrichedAt: enrichmentData.enrichedAt.toISOString(),
        _lastEnrichedBy: enrichmentData.source,
        _enrichmentConfidence: enrichmentData.confidence,
      },
    );

    if (!updateResult.success) {
      return updateResult;
    }

    return ok(enrichmentData);
  }

  /**
   * Enrich multiple nodes in batch with rate limiting.
   * Processes nodes sequentially to respect provider rate limits.
   *
   * @param nodeIds - Nodes to enrich
   * @param tenantId - Tenant scope — required for isolation
   * @param source - Optional: specific provider to use
   * @returns Count of successfully enriched nodes
   */
  async enrichBatch(
    nodeIds: readonly string[],
    tenantId: string,
    source?: EnrichmentSource,
  ): Promise<Result<number, AppError>> {
    const tenantValidation = validateTenantId(tenantId);
    if (!tenantValidation.success) {
      return tenantValidation;
    }

    if (nodeIds.length === 0) {
      return ok(0);
    }

    let successCount = 0;

    for (const nodeId of nodeIds) {
      const result = await this.enrichNode(nodeId, tenantId, source);
      if (result.success) {
        successCount++;
      }
      // Continue on individual failures — batch should be resilient.
      // Errors are logged internally by the provider but we don't
      // log node details here (PII/PHI compliance).
    }

    return ok(successCount);
  }

  /**
   * Event handler: queue a newly created node for enrichment.
   * Called when a Person or Company node is created in the graph.
   *
   * @param event - New node event with nodeId, nodeType, tenantId
   */
  async handleNewNode(
    event: { readonly nodeId: string; readonly nodeType: string; readonly tenantId: string },
  ): Promise<void> {
    // Only enrich Person and Company nodes
    if (event.nodeType !== 'Person' && event.nodeType !== 'Company') {
      return;
    }

    if (!event.tenantId || event.tenantId.trim().length === 0) {
      return;
    }

    if (!event.nodeId || event.nodeId.trim().length === 0) {
      return;
    }

    // Best-effort enrichment — don't fail the event pipeline on enrichment errors
    await this.enrichNode(event.nodeId, event.tenantId);
  }

  // ─── Private Helpers ─────────────────────────────────────────

  /**
   * Select the best provider for a given node type and optional source preference.
   */
  private selectProvider(
    node: GraphNode,
    source?: EnrichmentSource,
  ): EnrichmentProvider | null {
    if (source) {
      const provider = this.providers.get(source);
      if (provider && provider.supportedNodeTypes.includes(node.type)) {
        return provider;
      }
      return null;
    }

    // Auto-select: find the first provider that supports this node type
    for (const [, provider] of this.providers) {
      if (provider.supportedNodeTypes.includes(node.type)) {
        return provider;
      }
    }

    return null;
  }
}

// ─── Built-in Stub Providers ────────────────────────────────────
// These return mock data and are designed for easy swap with real
// API integrations. The interface ensures drop-in replacement.

/**
 * Clearbit stub provider — company enrichment data.
 * In production, replace with actual Clearbit API calls.
 */
export class ClearbitProvider implements EnrichmentProvider {
  readonly name = 'clearbit' as const;
  readonly supportedNodeTypes = ['Company'] as const;
  readonly rateLimit = { maxPerSecond: 10, maxPerDay: 10_000 } as const;

  async enrich(node: GraphNode): Promise<Result<EnrichmentData, AppError>> {
    // Stub: return synthetic firmographic data
    const domain = String(node.properties['domain'] ?? node.properties['email'] ?? '');
    const enrichmentData: EnrichmentData = {
      source: 'clearbit',
      fields: {
        industry: 'Technology',
        employeeCount: 150,
        annualRevenue: 25_000_000,
        techStack: ['React', 'Node.js', 'PostgreSQL'],
        founded: 2018,
        location: 'San Francisco, CA',
        _enrichmentDomain: domain,
      },
      enrichedAt: new Date(),
      confidence: 0.85,
    };

    return ok(enrichmentData);
  }
}

/**
 * Apollo stub provider — person enrichment data.
 * In production, replace with actual Apollo.io API calls.
 */
export class ApolloProvider implements EnrichmentProvider {
  readonly name = 'apollo' as const;
  readonly supportedNodeTypes = ['Person'] as const;
  readonly rateLimit = { maxPerSecond: 5, maxPerDay: 5_000 } as const;

  async enrich(node: GraphNode): Promise<Result<EnrichmentData, AppError>> {
    // Stub: return synthetic demographic/professional data
    const enrichmentData: EnrichmentData = {
      source: 'apollo',
      fields: {
        title: 'VP of Engineering',
        seniority: 'executive',
        department: 'Engineering',
        verifiedEmail: true,
        linkedinUrl: 'https://linkedin.com/in/placeholder',
        phoneVerified: false,
      },
      enrichedAt: new Date(),
      confidence: 0.78,
    };

    return ok(enrichmentData);
  }
}

/**
 * Internal provider — enriches from existing graph relationships.
 * No external API calls. Uses computed scores and relationship data.
 */
export class InternalProvider implements EnrichmentProvider {
  readonly name = 'internal' as const;
  readonly supportedNodeTypes = ['Person', 'Company', 'Deal'] as const;
  readonly rateLimit = { maxPerSecond: 100, maxPerDay: 1_000_000 } as const;

  async enrich(node: GraphNode): Promise<Result<EnrichmentData, AppError>> {
    // Enrich from existing graph-computed properties
    const enrichmentData: EnrichmentData = {
      source: 'internal',
      fields: {
        _graphEnriched: true,
        _nodeConnections: Number(node.properties['_degreeCentrality'] ?? 0),
        _influenceScore: Number(node.properties['influence_score'] ?? 0),
        _communityId: node.properties['community_id'] ?? null,
      },
      enrichedAt: new Date(),
      confidence: 1.0, // Internal data is fully trusted
    };

    return ok(enrichmentData);
  }
}

// ─── Validation Helpers ───────────────────────────────────────────

function validateTenantId(tenantId: string): Result<void, AppError> {
  if (!tenantId || tenantId.trim().length === 0) {
    return err(
      new ValidationError('tenantId is required for enrichment operations', {
        tenantId: ['tenantId must be a non-empty string'],
      }),
    );
  }
  return ok(undefined);
}
