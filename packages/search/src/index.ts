/**
 * @ordr/search — Full-Text Search Engine
 *
 * Provides multi-entity full-text search with PHI sanitization,
 * fuzzy matching, faceted aggregation, and autocomplete.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - All queries tenant-scoped (CC6.1)
 * - PHI stripped before indexing (§164.312)
 * - Data classification enforced at boundary (A.8.2.3)
 *
 * Usage:
 *   import { SearchEngine, SearchIndexer, InMemorySearchStore } from '@ordr/search';
 *
 *   const store = new InMemorySearchStore();
 *   const engine = new SearchEngine(store);
 *   const indexer = new SearchIndexer(store);
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  SearchableEntityType,
  SearchQuery,
  SearchFilter,
  SearchFilterOperator,
  SearchOptions,
  SearchSort,
  SearchSortField,
  SearchSortDirection,
  PaginationMode,
  Highlight,
  SearchResult,
  SearchFacet,
  SearchFacetType,
  FacetBucket,
  FacetResult,
  AggregatedResults,
  SearchIndexEntry,
  SearchSuggestion,
  IndexEntityInput,
  IndexFieldMap,
  IndexFieldValue,
} from './types.js';

export {
  SEARCHABLE_ENTITY_TYPES,
  DEFAULT_SEARCH_OPTIONS,
  MAX_SEARCH_LIMIT,
  MAX_SUGGESTION_LIMIT,
} from './types.js';

// ─── Engine ───────────────────────────────────────────────────────
export { SearchEngine } from './engine.js';

export type {
  SearchStore,
  SearchStoreParams,
  SearchStoreResult,
  SearchStoreRow,
  SuggestStoreParams,
  FacetedSearchStoreParams,
  FacetedSearchStoreResult,
} from './engine.js';

// ─── Indexer ──────────────────────────────────────────────────────
export { SearchIndexer } from './indexer.js';

export type {
  SearchIndexStore,
  IndexUpsertInput,
  EntityLoader,
} from './indexer.js';

// ─── In-Memory Store ──────────────────────────────────────────────
export { InMemorySearchStore } from './in-memory-store.js';

// ─── Sanitizer ────────────────────────────────────────────────────
export {
  sanitizeName,
  sanitizeEmail,
  sanitizePhone,
  sanitizeSsn,
  sanitizeAddress,
  sanitizeDob,
  sanitizePhiField,
  sanitizeFieldMap,
  isLikelySsn,
  isLikelyEmail,
  isLikelyPhone,
} from './sanitizer.js';
