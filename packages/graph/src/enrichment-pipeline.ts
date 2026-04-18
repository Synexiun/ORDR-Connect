/**
 * Enrichment pipeline — external data enrichment for graph nodes
 *
 * Orchestrates enrichment from Clearbit and internal graph data.
 * Rate-limited per provider with configurable thresholds. Designed
 * for both single-node and batch enrichment.
 *
 * Person-level scraping enrichment (Apollo et al.) is deliberately
 * NOT included — GDPR Art. 6 lawful-basis concerns around upstream
 * data sourcing make those providers a poor fit regardless of
 * tenant consent on our side.
 *
 * SECURITY:
 * - All operations are tenant-scoped
 * - Enrichment data is validated before writing to graph
 * - Provider API calls are rate-limited to prevent abuse
 * - Audit trail of all enrichments (what fields were added/updated)
 * - NEVER log node properties or enrichment data (PII/PHI risk)
 */

import { type Result, ok, err, InternalError, ValidationError, NotFoundError } from '@ordr/core';
import type { GraphOperations } from './operations.js';
import type { GraphNode, EnrichmentSource, EnrichmentData, EnrichmentProvider } from './types.js';

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
    while (this.timestamps.length > 0) {
      const head = this.timestamps[0];
      if (head === undefined || head >= cutoff) break;
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
        new ProviderRateLimiter(provider.rateLimit.maxPerSecond, provider.rateLimit.maxPerDay),
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
  ): Promise<Result<EnrichmentData>> {
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
        new InternalError(`Rate limit exceeded for enrichment provider: ${provider.name}`),
      );
    }

    // Call the provider. Record the rate-limit tick BEFORE we inspect the
    // result: the limiter is protecting the provider's external quota,
    // which is consumed whether the call returns 200, 404, 429, or 5xx.
    // Only recording on success meant a burst of 429s never incremented the
    // local counter, so the limiter never throttled even though Clearbit had
    // already exhausted the daily quota.
    const enrichResult = await provider.enrich(node);
    if (limiter) {
      limiter.record();
    }
    if (!enrichResult.success) {
      return enrichResult;
    }

    const enrichmentData = enrichResult.data;

    // Merge enrichment data into node properties
    const updateResult = await this.operations.updateNode(nodeId, tenantId, {
      ...enrichmentData.fields,
      _lastEnrichedAt: enrichmentData.enrichedAt.toISOString(),
      _lastEnrichedBy: enrichmentData.source,
      _enrichmentConfidence: enrichmentData.confidence,
    });

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
  ): Promise<Result<number>> {
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
  async handleNewNode(event: {
    readonly nodeId: string;
    readonly nodeType: string;
    readonly tenantId: string;
  }): Promise<void> {
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
  private selectProvider(node: GraphNode, source?: EnrichmentSource): EnrichmentProvider | null {
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
 * Clearbit provider — company enrichment data.
 *
 * Dual-mode by apiKey presence:
 * - No apiKey → synthetic firmographic data (dev, tests, and hermetic
 *   environments where reaching Clearbit is not desirable).
 * - apiKey present → real `https://company.clearbit.com/v2/companies/find`
 *   lookup with bearer auth.
 *
 * Failure semantics: errors from the real API are surfaced as typed
 * `AppError` values (NotFoundError for 404, InternalError for 401/429/5xx
 * or network errors), so the pipeline can decide whether to retry, skip,
 * or escalate per-call rather than silently masking data quality issues.
 */
export interface ClearbitProviderOptions {
  /** Clearbit API key. If absent, the provider returns synthetic data. */
  readonly apiKey?: string;
  /** HTTP timeout in ms. Default: 10 s. */
  readonly timeoutMs?: number;
  /** API base URL. Defaults to the Clearbit production endpoint. */
  readonly baseUrl?: string;
}

interface ClearbitApiCompany {
  readonly name?: string;
  readonly legalName?: string;
  readonly description?: string;
  readonly foundedYear?: number;
  readonly category?: {
    readonly industry?: string;
    readonly sector?: string;
  };
  readonly metrics?: {
    readonly employees?: number;
    readonly annualRevenue?: number;
  };
  readonly tech?: readonly string[];
  readonly geo?: {
    readonly city?: string;
    readonly state?: string;
    readonly country?: string;
  };
}

export class ClearbitProvider implements EnrichmentProvider {
  readonly name = 'clearbit' as const;
  readonly supportedNodeTypes = ['Company'] as const;
  readonly rateLimit = { maxPerSecond: 10, maxPerDay: 10_000 } as const;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(opts: ClearbitProviderOptions = {}) {
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.baseUrl = opts.baseUrl ?? 'https://company.clearbit.com';
  }

  async enrich(node: GraphNode): Promise<Result<EnrichmentData>> {
    const domain = extractDomain(readStringProp(node, 'domain', 'email'));
    const apiKey = this.apiKey;

    // No key configured → return synthetic data so local dev and tests
    // work without reaching the upstream.
    if (apiKey === undefined || apiKey.length === 0) {
      return ok(buildSyntheticClearbitData(domain));
    }

    if (domain.length === 0) {
      return err(
        new ValidationError('Clearbit enrichment requires a domain or email property', {
          domain: ['Company node has no domain or email property'],
        }),
      );
    }

    return this.fetchLive(apiKey, domain);
  }

  private async fetchLive(apiKey: string, domain: string): Promise<Result<EnrichmentData>> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/v2/companies/find?domain=${encodeURIComponent(domain)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        },
      );
    } catch (fetchError) {
      clearTimeout(timer);
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      return err(new InternalError(`Clearbit fetch failed: ${message}`));
    }
    clearTimeout(timer);

    if (response.status === 404 || response.status === 422) {
      return err(new NotFoundError(`Clearbit has no record for domain: ${domain}`));
    }
    if (response.status === 401 || response.status === 403) {
      return err(
        new InternalError(
          `Clearbit auth rejected (HTTP ${response.status.toString()}) — check CLEARBIT_API_KEY`,
        ),
      );
    }
    if (response.status === 429) {
      return err(new InternalError('Clearbit rate limited (HTTP 429)'));
    }
    if (!response.ok) {
      return err(new InternalError(`Clearbit fetch failed: HTTP ${response.status.toString()}`));
    }

    let body: ClearbitApiCompany;
    try {
      body = (await response.json()) as ClearbitApiCompany;
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      return err(new InternalError(`Clearbit response parse failed: ${message}`));
    }

    return ok(mapClearbitCompany(body, domain));
  }
}

function readStringProp(node: GraphNode, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = node.properties[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function extractDomain(raw: string): string {
  if (raw.length === 0) return '';
  // If it's an email, take the part after the '@'.
  const at = raw.indexOf('@');
  return (at >= 0 ? raw.substring(at + 1) : raw).trim().toLowerCase();
}

function buildSyntheticClearbitData(domain: string): EnrichmentData {
  return {
    source: 'clearbit',
    fields: {
      industry: 'Technology',
      employeeCount: 150,
      annualRevenue: 25_000_000,
      techStack: ['React', 'Node.js', 'PostgreSQL'],
      founded: 2018,
      location: 'San Francisco, CA',
      _enrichmentDomain: domain,
      _enrichmentMode: 'synthetic',
    },
    enrichedAt: new Date(),
    confidence: 0.85,
  };
}

function mapClearbitCompany(body: ClearbitApiCompany, domain: string): EnrichmentData {
  const fields: Record<string, unknown> = {
    _enrichmentDomain: domain,
    _enrichmentMode: 'clearbit-api',
  };

  if (body.category?.industry !== undefined) {
    fields['industry'] = body.category.industry;
  }
  if (body.category?.sector !== undefined) {
    fields['sector'] = body.category.sector;
  }
  if (body.metrics?.employees !== undefined) {
    fields['employeeCount'] = body.metrics.employees;
  }
  if (body.metrics?.annualRevenue !== undefined) {
    fields['annualRevenue'] = body.metrics.annualRevenue;
  }
  if (body.tech && body.tech.length > 0) {
    fields['techStack'] = [...body.tech];
  }
  if (body.foundedYear !== undefined) {
    fields['founded'] = body.foundedYear;
  }
  if (body.name !== undefined) {
    fields['companyName'] = body.name;
  }
  if (body.legalName !== undefined) {
    fields['legalName'] = body.legalName;
  }

  const city = body.geo?.city;
  const state = body.geo?.state;
  const country = body.geo?.country;
  const parts = [city, state, country].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  if (parts.length > 0) {
    fields['location'] = parts.join(', ');
  }

  return {
    source: 'clearbit',
    fields,
    enrichedAt: new Date(),
    // Real upstream data rates higher than synthetic.
    confidence: 0.92,
  };
}

/**
 * Internal provider — enriches from existing graph relationships.
 * No external API calls. Uses computed scores and relationship data.
 */
export class InternalProvider implements EnrichmentProvider {
  readonly name = 'internal' as const;
  readonly supportedNodeTypes = ['Person', 'Company', 'Deal'] as const;
  readonly rateLimit = { maxPerSecond: 100, maxPerDay: 1_000_000 } as const;

  enrich(node: GraphNode): Promise<Result<EnrichmentData>> {
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

    return Promise.resolve(ok(enrichmentData));
  }
}

// ─── Validation Helpers ───────────────────────────────────────────

function validateTenantId(tenantId: string): Result<void> {
  if (!tenantId || tenantId.trim().length === 0) {
    return err(
      new ValidationError('tenantId is required for enrichment operations', {
        tenantId: ['tenantId must be a non-empty string'],
      }),
    );
  }
  return ok(undefined);
}
