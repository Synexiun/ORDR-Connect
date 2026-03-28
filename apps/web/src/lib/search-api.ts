/**
 * Search API Service
 *
 * Typed wrappers over /api/v1/search endpoints.
 *
 * SOC2 CC6.1 — All search requests are tenant-scoped server-side.
 * HIPAA §164.312 — No PHI in query strings; queries are opaque strings.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type SearchableEntityType = 'contact' | 'deal' | 'ticket' | 'activity';
export type SearchWeight = 'A' | 'B' | 'C' | 'D';
export type FacetType = 'entity_type' | 'date_range' | 'term';

export interface SearchResult {
  readonly id: string;
  readonly entityType: SearchableEntityType;
  readonly entityId: string;
  readonly score: number;
  readonly displayTitle: string;
  readonly displaySubtitle?: string;
  readonly metadata: Record<string, unknown>;
}

export interface FacetBucket {
  readonly value: string;
  readonly count: number;
}

export interface Facet {
  readonly field: string;
  readonly buckets: FacetBucket[];
}

export interface SearchResults {
  readonly results: SearchResult[];
  readonly total: number;
  readonly facets: Facet[];
  readonly took: number;
}

export interface Suggestion {
  readonly id: string;
  readonly label: string;
  readonly entityType: SearchableEntityType;
  readonly entityId?: string;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  entityTypes?: SearchableEntityType[];
  filters?: Record<string, unknown>;
}

export interface FacetFilter {
  readonly type: FacetType;
  readonly field: string;
  readonly values?: string[];
  readonly from?: string;
  readonly to?: string;
}

export interface FacetedSearchParams {
  facets: FacetFilter[];
  query?: string;
  limit?: number;
  offset?: number;
}

export interface IndexField {
  readonly value: string;
  readonly weight: SearchWeight;
  readonly isPhi: boolean;
}

export interface IndexEntityParams {
  entityType: SearchableEntityType;
  entityId: string;
  fields: Record<string, IndexField>;
}

// ── API ────────────────────────────────────────────────────────────

export const searchApi = {
  /**
   * Full-text search across all indexed entities.
   * Results are tenant-scoped server-side.
   */
  search(query: string, options: SearchOptions = {}): Promise<SearchResults> {
    return apiClient.post<SearchResults>('/v1/search', { query, ...options });
  },

  /**
   * Type-ahead suggestions for a given prefix.
   */
  suggest(prefix: string, entityType?: SearchableEntityType): Promise<Suggestion[]> {
    const params = new URLSearchParams({ q: prefix });
    if (entityType !== undefined) {
      params.set('entityType', entityType);
    }
    return apiClient
      .get<{ success: boolean; data: Suggestion[] }>(`/v1/search/suggest?${params.toString()}`)
      .then((r) => r.data);
  },

  /**
   * Faceted search with aggregation buckets.
   */
  faceted(params: FacetedSearchParams): Promise<SearchResults> {
    return apiClient.post<SearchResults>('/v1/search/faceted', params);
  },

  /**
   * Index a single entity (admin only).
   */
  indexEntity(params: IndexEntityParams): Promise<{ id: string; indexedAt: string }> {
    return apiClient
      .post<{
        success: boolean;
        data: { id: string; indexedAt: string };
      }>('/v1/search/index', params)
      .then((r) => r.data);
  },

  /**
   * Remove entity from index (admin only).
   */
  removeEntity(entityType: SearchableEntityType, entityId: string): Promise<void> {
    return apiClient.delete(`/v1/search/index/${entityType}/${entityId}`);
  },

  /**
   * Trigger full reindex for an entity type (admin only).
   */
  reindex(entityType: SearchableEntityType): Promise<{ reindexed: number }> {
    return apiClient
      .post<{ success: boolean; data: { reindexed: number } }>(`/v1/search/reindex/${entityType}`)
      .then((r) => r.data);
  },
};
