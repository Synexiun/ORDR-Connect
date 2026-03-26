/**
 * @ordr/search — In-Memory Search Store (Testing)
 *
 * In-memory implementation of both SearchIndexStore and SearchStore interfaces.
 * Used for unit testing without a PostgreSQL dependency.
 *
 * In production, these interfaces are backed by PostgreSQL with:
 * - tsvector/GIN for full-text search
 * - pg_trgm for fuzzy matching
 * - ts_rank for scoring
 * - ts_headline for highlighting
 * - RLS for tenant isolation
 */

import type { SearchIndexStore, IndexUpsertInput } from './indexer.js';
import type {
  SearchStore,
  SearchStoreParams,
  SearchStoreResult,
  SearchStoreRow,
  SuggestStoreParams,
  FacetedSearchStoreParams,
  FacetedSearchStoreResult,
} from './engine.js';
import type {
  SearchableEntityType,
  SearchIndexEntry,
  SearchSuggestion,
  FacetResult,
  FacetBucket,
  SearchFilter,
} from './types.js';

// ─── Composite Key ───────────────────────────────────────────────

function makeKey(tenantId: string, entityType: string, entityId: string): string {
  return `${tenantId}::${entityType}::${entityId}`;
}

// ─── In-Memory Implementation ────────────────────────────────────

export class InMemorySearchStore implements SearchIndexStore, SearchStore {
  private entries: Map<string, SearchIndexEntry> = new Map();
  private idCounter = 0;

  // ── SearchIndexStore ─────────────────────────────────────────

  async upsert(input: IndexUpsertInput): Promise<SearchIndexEntry> {
    const key = makeKey(input.tenantId, input.entityType, input.entityId);
    const existing = this.entries.get(key);
    const now = new Date();

    const entry: SearchIndexEntry = {
      id: existing?.id ?? `idx-${++this.idCounter}`,
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      contentVector: input.contentVector,
      displayTitle: input.displayTitle,
      displaySubtitle: input.displaySubtitle,
      metadata: input.metadata,
      indexedAt: existing?.indexedAt ?? now,
      updatedAt: now,
    };

    this.entries.set(key, entry);
    return entry;
  }

  async remove(
    tenantId: string,
    entityType: SearchableEntityType,
    entityId: string,
  ): Promise<boolean> {
    const key = makeKey(tenantId, entityType, entityId);
    return this.entries.delete(key);
  }

  async removeAll(tenantId: string, entityType: SearchableEntityType): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.tenantId === tenantId && entry.entityType === entityType) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async findEntry(
    tenantId: string,
    entityType: SearchableEntityType,
    entityId: string,
  ): Promise<SearchIndexEntry | null> {
    const key = makeKey(tenantId, entityType, entityId);
    return this.entries.get(key) ?? null;
  }

  async countEntries(tenantId: string, entityType: SearchableEntityType): Promise<number> {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.tenantId === tenantId && entry.entityType === entityType) {
        count++;
      }
    }
    return count;
  }

  // ── SearchStore ──────────────────────────────────────────────

  async search(params: SearchStoreParams): Promise<SearchStoreResult> {
    const tenantEntries = this.getFilteredEntries(params.tenantId, params.entityType);
    const queryTerms = params.queryText.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

    // Score and filter entries
    let scored = tenantEntries
      .map((entry) => ({
        entry,
        score: this.computeScore(entry, queryTerms, params.fuzzy),
      }))
      .filter((item) => item.score > 0);

    // Apply additional filters
    scored = this.applyFilters(scored, params.filters);

    // Sort
    scored = this.applySorting(scored, params.sort);

    const total = scored.length;

    // Paginate
    const paged = scored.slice(params.offset, params.offset + params.limit);

    const results: SearchStoreRow[] = paged.map((item) => ({
      id: item.entry.id,
      entityType: item.entry.entityType,
      entityId: item.entry.entityId,
      displayTitle: item.entry.displayTitle,
      displaySubtitle: item.entry.displaySubtitle,
      score: item.score,
      contentVector: item.entry.contentVector,
      metadata: item.entry.metadata,
      indexedAt: item.entry.indexedAt,
    }));

    return { results, total };
  }

  async suggest(params: SuggestStoreParams): Promise<readonly SearchSuggestion[]> {
    const tenantEntries = this.getFilteredEntries(params.tenantId, params.entityType);
    const prefixLower = params.prefix.toLowerCase();

    const matches = tenantEntries
      .map((entry) => {
        let score = 0;
        if (entry.displayTitle.toLowerCase().startsWith(prefixLower)) {
          score = 2.0;
        } else if (entry.displayTitle.toLowerCase().includes(prefixLower)) {
          score = 1.0;
        } else if (entry.contentVector.toLowerCase().includes(prefixLower)) {
          score = 0.5;
        }
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit);

    return matches.map((item) => ({
      entityType: item.entry.entityType,
      entityId: item.entry.entityId,
      displayTitle: item.entry.displayTitle,
      displaySubtitle: item.entry.displaySubtitle,
      score: item.score,
    }));
  }

  async facetedSearch(params: FacetedSearchStoreParams): Promise<FacetedSearchStoreResult> {
    const tenantEntries = this.getFilteredEntries(params.tenantId, undefined);
    const queryTerms = params.queryText.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

    // Score and filter entries
    let scored = tenantEntries
      .map((entry) => ({
        entry,
        score: this.computeScore(entry, queryTerms, false),
      }))
      .filter((item) => item.score > 0);

    scored = this.applyFilters(scored, params.filters);

    // Compute facets from the full result set (before pagination)
    const facets = this.computeFacets(
      scored.map((s) => s.entry),
      params.facets,
    );

    const total = scored.length;

    // Sort by score desc and paginate
    scored.sort((a, b) => b.score - a.score);
    const paged = scored.slice(params.offset, params.offset + params.limit);

    const results: SearchStoreRow[] = paged.map((item) => ({
      id: item.entry.id,
      entityType: item.entry.entityType,
      entityId: item.entry.entityId,
      displayTitle: item.entry.displayTitle,
      displaySubtitle: item.entry.displaySubtitle,
      score: item.score,
      contentVector: item.entry.contentVector,
      metadata: item.entry.metadata,
      indexedAt: item.entry.indexedAt,
    }));

    return { results, total, facets };
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Get all entries for a tenant, optionally filtered by entity type.
   * CRITICAL: Always filters by tenantId first (tenant isolation).
   */
  private getFilteredEntries(
    tenantId: string,
    entityType?: SearchableEntityType,
  ): SearchIndexEntry[] {
    const entries: SearchIndexEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.tenantId !== tenantId) continue;
      if (entityType && entry.entityType !== entityType) continue;
      entries.push(entry);
    }
    return entries;
  }

  /**
   * Compute a relevance score for an entry against query terms.
   * Simulates ts_rank behavior with weight multipliers.
   */
  private computeScore(
    entry: SearchIndexEntry,
    queryTerms: readonly string[],
    fuzzy: boolean,
  ): number {
    let score = 0;

    const content = entry.contentVector.toLowerCase();
    const title = entry.displayTitle.toLowerCase();
    const subtitle = entry.displaySubtitle.toLowerCase();

    for (const term of queryTerms) {
      // Exact match in title (highest weight)
      if (title.includes(term)) {
        score += 4.0;
      }

      // Exact match in subtitle
      if (subtitle.includes(term)) {
        score += 2.0;
      }

      // Match in content vector
      if (content.includes(term)) {
        score += 1.0;
      }

      // Fuzzy matching (trigram similarity simulation)
      if (fuzzy && score === 0) {
        const similarity = this.trigramSimilarity(term, title) +
          this.trigramSimilarity(term, content);
        if (similarity > 0.3) {
          score += similarity;
        }
      }
    }

    return score;
  }

  /**
   * Simple trigram similarity for fuzzy matching.
   * In production, PostgreSQL pg_trgm handles this.
   */
  private trigramSimilarity(a: string, b: string): number {
    if (a.length < 3 || b.length < 3) return 0;

    const trigramsA = new Set<string>();
    for (let i = 0; i <= a.length - 3; i++) {
      trigramsA.add(a.slice(i, i + 3));
    }

    const trigramsB = new Set<string>();
    for (let i = 0; i <= b.length - 3; i++) {
      trigramsB.add(b.slice(i, i + 3));
    }

    let intersection = 0;
    for (const trig of trigramsA) {
      if (trigramsB.has(trig)) {
        intersection++;
      }
    }

    const union = trigramsA.size + trigramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Apply filter predicates to scored entries.
   */
  private applyFilters(
    scored: { entry: SearchIndexEntry; score: number }[],
    filters: readonly SearchFilter[],
  ): { entry: SearchIndexEntry; score: number }[] {
    let result = scored;

    for (const filter of filters) {
      if (filter.field === 'entity_type') {
        result = result.filter((item) => {
          if (filter.operator === 'eq') return item.entry.entityType === filter.value;
          if (filter.operator === 'neq') return item.entry.entityType !== filter.value;
          if (filter.operator === 'in' && Array.isArray(filter.value)) {
            return (filter.value as readonly string[]).includes(item.entry.entityType);
          }
          return true;
        });
      }

      if (filter.field === 'indexed_at') {
        result = result.filter((item) => {
          const indexedAt = item.entry.indexedAt.getTime();
          if (filter.operator === 'gte' && typeof filter.value === 'string') {
            return indexedAt >= new Date(filter.value).getTime();
          }
          if (filter.operator === 'lte' && typeof filter.value === 'string') {
            return indexedAt <= new Date(filter.value).getTime();
          }
          return true;
        });
      }
    }

    return result;
  }

  /**
   * Sort scored entries by the specified field.
   */
  private applySorting(
    scored: { entry: SearchIndexEntry; score: number }[],
    sort: { field: string; direction: string },
  ): { entry: SearchIndexEntry; score: number }[] {
    const dir = sort.direction === 'asc' ? 1 : -1;

    return [...scored].sort((a, b) => {
      switch (sort.field) {
        case 'relevance':
          return (b.score - a.score) * dir;
        case 'indexed_at':
          return (a.entry.indexedAt.getTime() - b.entry.indexedAt.getTime()) * dir;
        case 'updated_at':
          return (a.entry.updatedAt.getTime() - b.entry.updatedAt.getTime()) * dir;
        default:
          return (b.score - a.score) * dir;
      }
    });
  }

  /**
   * Compute facet aggregations from a set of entries.
   */
  private computeFacets(
    entries: readonly SearchIndexEntry[],
    facets: readonly SearchFacet[],
  ): FacetResult[] {
    return facets.map((facet) => {
      const buckets: FacetBucket[] = [];

      if (facet.type === 'entity_type') {
        const counts = new Map<string, number>();
        for (const entry of entries) {
          const current = counts.get(entry.entityType) ?? 0;
          counts.set(entry.entityType, current + 1);
        }
        for (const [key, count] of counts) {
          buckets.push({ key, count });
        }
      }

      if (facet.type === 'status') {
        const counts = new Map<string, number>();
        for (const entry of entries) {
          const status = (entry.metadata['status'] as string) ?? 'unknown';
          const current = counts.get(status) ?? 0;
          counts.set(status, current + 1);
        }
        for (const [key, count] of counts) {
          buckets.push({ key, count });
        }
      }

      if (facet.type === 'date_range') {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        let last24h = 0;
        let last7d = 0;
        let last30d = 0;
        let older = 0;

        for (const entry of entries) {
          const age = now - entry.indexedAt.getTime();
          if (age <= day) last24h++;
          else if (age <= 7 * day) last7d++;
          else if (age <= 30 * day) last30d++;
          else older++;
        }

        if (last24h > 0) buckets.push({ key: 'last_24h', count: last24h });
        if (last7d > 0) buckets.push({ key: 'last_7d', count: last7d });
        if (last30d > 0) buckets.push({ key: 'last_30d', count: last30d });
        if (older > 0) buckets.push({ key: 'older', count: older });
      }

      // Sort buckets by count descending
      buckets.sort((a, b) => b.count - a.count);

      return {
        type: facet.type,
        field: facet.field,
        buckets,
      };
    });
  }

  // ── Test Utilities ───────────────────────────────────────────

  /** Clear all entries (for test cleanup) */
  clear(): void {
    this.entries.clear();
    this.idCounter = 0;
  }

  /** Get the total number of entries */
  get size(): number {
    return this.entries.size;
  }
}
