/**
 * @ordr/search — Search Engine
 *
 * Full-text search with ts_rank scoring, phrase matching, prefix matching,
 * fuzzy search (pg_trgm), boolean operators, and faceted aggregation.
 *
 * SOC2 CC6.1 — Every query is tenant-scoped (WHERE tenant_id = $1).
 * HIPAA §164.312 — Search results contain ONLY masked previews.
 * ISO 27001 A.8.2.3 — Full entity data requires separate authorized API call.
 *
 * Search queries are NOT audit-logged (performance), but admin reindex
 * operations ARE audit-logged.
 */

import type {
  SearchableEntityType,
  SearchResult,
  SearchSuggestion,
  SearchOptions,
  SearchFilter,
  SearchFacet,
  FacetResult,
  FacetBucket,
  AggregatedResults,
  Highlight,
  SearchSort,
} from './types.js';
import {
  DEFAULT_SEARCH_OPTIONS,
  MAX_SEARCH_LIMIT,
  MAX_SUGGESTION_LIMIT,
  SEARCHABLE_ENTITY_TYPES,
} from './types.js';

// ─── Search Store Interface ──────────────────────────────────────

/**
 * Pluggable search backend interface.
 * In production: PostgreSQL with tsvector/GIN.
 * In tests: in-memory implementation.
 */
export interface SearchStore {
  /**
   * Execute a full-text search query.
   */
  search(params: SearchStoreParams): Promise<SearchStoreResult>;

  /**
   * Get autocomplete suggestions for a prefix.
   */
  suggest(params: SuggestStoreParams): Promise<readonly SearchSuggestion[]>;

  /**
   * Execute a search with facet aggregations.
   */
  facetedSearch(params: FacetedSearchStoreParams): Promise<FacetedSearchStoreResult>;
}

export interface SearchStoreParams {
  readonly tenantId: string;
  readonly queryText: string;
  readonly entityType?: SearchableEntityType;
  readonly filters: readonly SearchFilter[];
  readonly sort: SearchSort;
  readonly limit: number;
  readonly offset: number;
  readonly cursor?: string;
  readonly fuzzy: boolean;
}

export interface SearchStoreResult {
  readonly results: readonly SearchStoreRow[];
  readonly total: number;
}

export interface SearchStoreRow {
  readonly id: string;
  readonly entityType: SearchableEntityType;
  readonly entityId: string;
  readonly displayTitle: string;
  readonly displaySubtitle: string;
  readonly score: number;
  readonly contentVector: string;
  readonly metadata: Record<string, unknown>;
  readonly indexedAt: Date;
}

export interface SuggestStoreParams {
  readonly tenantId: string;
  readonly prefix: string;
  readonly entityType?: SearchableEntityType;
  readonly limit: number;
}

export interface FacetedSearchStoreParams {
  readonly tenantId: string;
  readonly queryText: string;
  readonly filters: readonly SearchFilter[];
  readonly facets: readonly SearchFacet[];
  readonly limit: number;
  readonly offset: number;
}

export interface FacetedSearchStoreResult {
  readonly results: readonly SearchStoreRow[];
  readonly total: number;
  readonly facets: readonly FacetResult[];
}

// ─── SearchEngine ────────────────────────────────────────────────

export class SearchEngine {
  private readonly store: SearchStore;

  constructor(store: SearchStore) {
    this.store = store;
  }

  /**
   * Full-text search with ranking, filtering, and pagination.
   *
   * @param query - Search query text
   * @param options - Search options (limit, offset, sort, fuzzy, filters)
   * @param tenantId - Tenant ID for isolation (REQUIRED)
   * @returns Aggregated search results with pagination info
   */
  async search(
    query: string,
    options: Partial<SearchOptions>,
    tenantId: string,
  ): Promise<AggregatedResults> {
    this.validateTenantId(tenantId);

    const startTime = Date.now();

    const mergedOptions = this.mergeOptions(options);
    const sanitizedQuery = this.sanitizeQueryText(query);

    if (sanitizedQuery.length === 0) {
      return {
        results: [],
        total: 0,
        facets: [],
        took: Date.now() - startTime,
      };
    }

    const storeResult = await this.store.search({
      tenantId,
      queryText: sanitizedQuery,
      entityType: this.extractEntityTypeFilter(mergedOptions.filters),
      filters: mergedOptions.filters,
      sort: mergedOptions.sort,
      limit: mergedOptions.limit,
      offset: mergedOptions.offset,
      cursor: mergedOptions.cursor,
      fuzzy: mergedOptions.fuzzy,
    });

    const results = storeResult.results.map((row) =>
      this.mapRowToResult(row, sanitizedQuery),
    );

    const took = Date.now() - startTime;

    // Build cursor for next page (cursor-based pagination)
    const lastResult = results[results.length - 1];
    const nextCursor =
      mergedOptions.paginationMode === 'cursor' && lastResult && results.length === mergedOptions.limit
        ? Buffer.from(lastResult.id).toString('base64')
        : undefined;

    return {
      results,
      total: storeResult.total,
      facets: [],
      nextCursor,
      took,
    };
  }

  /**
   * Autocomplete suggestions for a query prefix.
   *
   * @param prefix - Partial query string
   * @param entityType - Optional entity type filter
   * @param tenantId - Tenant ID for isolation (REQUIRED)
   * @returns Top suggestions ranked by relevance
   */
  async suggest(
    prefix: string,
    entityType: SearchableEntityType | undefined,
    tenantId: string,
  ): Promise<readonly SearchSuggestion[]> {
    this.validateTenantId(tenantId);

    const sanitizedPrefix = this.sanitizeQueryText(prefix);
    if (sanitizedPrefix.length === 0) {
      return [];
    }

    return this.store.suggest({
      tenantId,
      prefix: sanitizedPrefix,
      entityType,
      limit: MAX_SUGGESTION_LIMIT,
    });
  }

  /**
   * Search with faceted aggregations (by entity type, date range, status).
   *
   * @param query - Search query text
   * @param facets - Facet definitions to aggregate
   * @param tenantId - Tenant ID for isolation (REQUIRED)
   * @returns Search results with facet aggregation counts
   */
  async facetedSearch(
    query: string,
    facets: readonly SearchFacet[],
    options: Partial<SearchOptions>,
    tenantId: string,
  ): Promise<AggregatedResults> {
    this.validateTenantId(tenantId);

    const startTime = Date.now();
    const mergedOptions = this.mergeOptions(options);
    const sanitizedQuery = this.sanitizeQueryText(query);

    if (sanitizedQuery.length === 0) {
      return {
        results: [],
        total: 0,
        facets: facets.map((f) => ({ type: f.type, field: f.field, buckets: [] })),
        took: Date.now() - startTime,
      };
    }

    const storeResult = await this.store.facetedSearch({
      tenantId,
      queryText: sanitizedQuery,
      filters: mergedOptions.filters,
      facets,
      limit: mergedOptions.limit,
      offset: mergedOptions.offset,
    });

    const results = storeResult.results.map((row) =>
      this.mapRowToResult(row, sanitizedQuery),
    );

    const took = Date.now() - startTime;

    return {
      results,
      total: storeResult.total,
      facets: storeResult.facets,
      took,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────

  private validateTenantId(tenantId: string): void {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new Error('[ORDR:Search] tenantId is required for all search operations');
    }
  }

  /**
   * Sanitize and normalize query text.
   * Prevents injection by stripping special PostgreSQL tsquery characters.
   */
  private sanitizeQueryText(query: string): string {
    if (!query) return '';

    return query
      .trim()
      // Remove tsquery special chars that could be used for injection
      .replace(/[!&|():*\\<>]/g, ' ')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Merge partial user options with defaults, enforcing limits.
   */
  private mergeOptions(partial: Partial<SearchOptions>): SearchOptions {
    const limit = Math.min(
      Math.max(partial.limit ?? DEFAULT_SEARCH_OPTIONS.limit, 1),
      MAX_SEARCH_LIMIT,
    );

    const offset = Math.max(partial.offset ?? DEFAULT_SEARCH_OPTIONS.offset, 0);

    return {
      limit,
      offset,
      cursor: partial.cursor,
      paginationMode: partial.paginationMode ?? DEFAULT_SEARCH_OPTIONS.paginationMode,
      sort: partial.sort ?? DEFAULT_SEARCH_OPTIONS.sort,
      fuzzy: partial.fuzzy ?? DEFAULT_SEARCH_OPTIONS.fuzzy,
      filters: partial.filters ?? DEFAULT_SEARCH_OPTIONS.filters,
    };
  }

  /**
   * Extract entity_type filter from the filters array.
   */
  private extractEntityTypeFilter(
    filters: readonly SearchFilter[],
  ): SearchableEntityType | undefined {
    const typeFilter = filters.find((f) => f.field === 'entity_type' && f.operator === 'eq');
    if (typeFilter && typeof typeFilter.value === 'string') {
      const value = typeFilter.value as SearchableEntityType;
      if (SEARCHABLE_ENTITY_TYPES.includes(value)) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Map a store row to a SearchResult with highlights.
   */
  private mapRowToResult(row: SearchStoreRow, query: string): SearchResult {
    const highlights = this.generateHighlights(row, query);

    return {
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      displayTitle: row.displayTitle,
      displaySubtitle: row.displaySubtitle,
      score: row.score,
      highlights,
      metadata: row.metadata,
      indexedAt: row.indexedAt,
    };
  }

  /**
   * Generate highlights for search results.
   * Uses basic text matching for highlighting (in production, uses ts_headline).
   */
  private generateHighlights(row: SearchStoreRow, query: string): readonly Highlight[] {
    const highlights: Highlight[] = [];
    const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

    // Check title for matches
    const titleLower = row.displayTitle.toLowerCase();
    for (const term of queryTerms) {
      if (titleLower.includes(term)) {
        highlights.push({
          field: 'title',
          fragment: this.highlightText(row.displayTitle, term),
        });
        break;
      }
    }

    // Check subtitle for matches
    const subtitleLower = row.displaySubtitle.toLowerCase();
    for (const term of queryTerms) {
      if (subtitleLower.includes(term)) {
        highlights.push({
          field: 'subtitle',
          fragment: this.highlightText(row.displaySubtitle, term),
        });
        break;
      }
    }

    // Check content vector for matches
    const contentLower = row.contentVector.toLowerCase();
    for (const term of queryTerms) {
      if (contentLower.includes(term) && highlights.length < 3) {
        highlights.push({
          field: 'content',
          fragment: this.highlightText(row.contentVector, term),
        });
        break;
      }
    }

    return highlights;
  }

  /**
   * Simple text highlighting — wraps matched terms in <mark> tags.
   * In production, PostgreSQL ts_headline handles this.
   */
  private highlightText(text: string, term: string): string {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }
}
