/**
 * @ordr/search — Type definitions for full-text search
 *
 * SOC2 CC6.1 — All search queries are tenant-scoped.
 * HIPAA §164.312 — PHI is NEVER stored in the search index.
 * ISO 27001 A.8.2.3 — Data classification enforced before indexing.
 */

// ─── Entity Types ────────────────────────────────────────────────

export const SEARCHABLE_ENTITY_TYPES = [
  'customer',
  'interaction',
  'agent-session',
  'workflow',
  'marketplace-agent',
] as const;

export type SearchableEntityType = (typeof SEARCHABLE_ENTITY_TYPES)[number];

// ─── Search Query ────────────────────────────────────────────────

export interface SearchQuery {
  /** Full-text search query string */
  readonly text: string;
  /** Optional entity type filter */
  readonly entityType?: SearchableEntityType;
  /** Filters to narrow results */
  readonly filters?: readonly SearchFilter[];
}

// ─── Search Filter ───────────────────────────────────────────────

export type SearchFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'between';

export interface SearchFilter {
  readonly field: string;
  readonly operator: SearchFilterOperator;
  readonly value: string | number | readonly string[] | readonly number[];
}

// ─── Search Options ──────────────────────────────────────────────

export type SearchSortField = 'relevance' | 'indexed_at' | 'updated_at';
export type SearchSortDirection = 'asc' | 'desc';

export interface SearchSort {
  readonly field: SearchSortField;
  readonly direction: SearchSortDirection;
}

export type PaginationMode = 'offset' | 'cursor';

export interface SearchOptions {
  /** Max results to return (default 20, max 100) */
  readonly limit: number;
  /** Offset for offset-based pagination */
  readonly offset: number;
  /** Cursor for cursor-based pagination (base64-encoded id) */
  readonly cursor?: string;
  /** Pagination mode */
  readonly paginationMode: PaginationMode;
  /** Sort configuration */
  readonly sort: SearchSort;
  /** Enable fuzzy matching via pg_trgm (default false) */
  readonly fuzzy: boolean;
  /** Filters to apply */
  readonly filters: readonly SearchFilter[];
}

// ─── Highlight ───────────────────────────────────────────────────

export interface Highlight {
  /** Field that was matched */
  readonly field: string;
  /** Highlighted text fragment with <mark> tags */
  readonly fragment: string;
}

// ─── Search Result ───────────────────────────────────────────────

export interface SearchResult {
  /** Search index entry ID */
  readonly id: string;
  /** Entity type */
  readonly entityType: SearchableEntityType;
  /** Original entity ID (for follow-up authorized fetch) */
  readonly entityId: string;
  /** Display-safe title (PHI-masked) */
  readonly displayTitle: string;
  /** Display-safe subtitle (PHI-masked) */
  readonly displaySubtitle: string;
  /** Relevance score from ts_rank */
  readonly score: number;
  /** Highlighted fragments */
  readonly highlights: readonly Highlight[];
  /** Non-sensitive metadata (JSONB) */
  readonly metadata: Record<string, unknown>;
  /** When the entry was last indexed */
  readonly indexedAt: Date;
}

// ─── Search Facet ────────────────────────────────────────────────

export type SearchFacetType = 'entity_type' | 'date_range' | 'status';

export interface SearchFacet {
  readonly type: SearchFacetType;
  /** Field to aggregate on */
  readonly field: string;
}

export interface FacetBucket {
  readonly key: string;
  readonly count: number;
}

export interface FacetResult {
  readonly type: SearchFacetType;
  readonly field: string;
  readonly buckets: readonly FacetBucket[];
}

// ─── Aggregated Results ──────────────────────────────────────────

export interface AggregatedResults {
  readonly results: readonly SearchResult[];
  readonly total: number;
  readonly facets: readonly FacetResult[];
  /** Cursor for next page (cursor-based pagination) */
  readonly nextCursor?: string;
  /** Query execution time in milliseconds */
  readonly took: number;
}

// ─── Search Index Entry ──────────────────────────────────────────

export interface SearchIndexEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly entityType: SearchableEntityType;
  readonly entityId: string;
  /** tsvector content — assembled from sanitized fields */
  readonly contentVector: string;
  /** Display title (PHI-masked) */
  readonly displayTitle: string;
  /** Display subtitle (PHI-masked) */
  readonly displaySubtitle: string;
  /** Non-sensitive metadata */
  readonly metadata: Record<string, unknown>;
  readonly indexedAt: Date;
  readonly updatedAt: Date;
}

// ─── Suggestion ──────────────────────────────────────────────────

export interface SearchSuggestion {
  readonly entityType: SearchableEntityType;
  readonly entityId: string;
  readonly displayTitle: string;
  readonly displaySubtitle: string;
  readonly score: number;
}

// ─── Indexer Input ───────────────────────────────────────────────

export interface IndexEntityInput {
  readonly entityType: SearchableEntityType;
  readonly entityId: string;
  readonly tenantId: string;
  readonly fields: IndexFieldMap;
  /** Optional display title override */
  readonly displayTitle?: string;
  /** Optional display subtitle override */
  readonly displaySubtitle?: string;
  /** Optional metadata to store alongside the index entry */
  readonly metadata?: Record<string, unknown>;
}

export interface IndexFieldMap {
  readonly [fieldName: string]: IndexFieldValue;
}

export interface IndexFieldValue {
  /** Raw field value */
  readonly value: string;
  /** Weight for ranking: A (highest) > B > C > D (lowest) */
  readonly weight: 'A' | 'B' | 'C' | 'D';
  /** Whether this field contains PHI and needs sanitization */
  readonly isPhi: boolean;
}

// ─── Default Options ─────────────────────────────────────────────

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  limit: 20,
  offset: 0,
  paginationMode: 'offset',
  sort: { field: 'relevance', direction: 'desc' },
  fuzzy: false,
  filters: [],
};

export const MAX_SEARCH_LIMIT = 100;
export const MAX_SUGGESTION_LIMIT = 5;
