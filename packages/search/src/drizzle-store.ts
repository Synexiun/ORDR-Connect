/**
 * @ordr/search — Drizzle-backed SearchIndexStore + SearchStore
 *
 * Implements full-text search using PostgreSQL tsvector/GIN indexes.
 * The search() method calls websearch_to_tsquery() for accurate ranked results.
 * The suggest() method uses ILIKE prefix matching for fast autocomplete.
 * The facetedSearch() method returns per-entity-type bucket counts.
 *
 * SOC2 CC6.1 — All queries are tenant-scoped (WHERE tenant_id = $1).
 * HIPAA §164.312 — PHI MUST NOT appear in the index.
 * ISO 27001 A.8.2.3 — Data classification enforced before indexing.
 *
 * SECURITY:
 * - content_vector is assembled and sanitized by the SearchIndexer
 * - display_title / display_subtitle are PHI-masked strings
 * - No full entity data is returned — only display-safe previews
 * - Full entity data requires a separate authorized API call
 */

import { eq, and, ne, sql, inArray, gte, lte, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ordr/db';
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
} from './types.js';

type Db = PostgresJsDatabase<typeof schema>;

// ─── Row mapper ──────────────────────────────────────────────────

function rowToEntry(row: typeof schema.searchIndex.$inferSelect): SearchIndexEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    entityType: row.entityType,
    entityId: row.entityId,
    contentVector: row.contentVector,
    displayTitle: row.displayTitle,
    displaySubtitle: row.displaySubtitle,
    metadata: row.metadata as Record<string, unknown>,
    indexedAt: row.indexedAt,
    updatedAt: row.updatedAt,
  };
}

// ─── DrizzleSearchStore ──────────────────────────────────────────

export class DrizzleSearchStore implements SearchIndexStore, SearchStore {
  constructor(private readonly db: Db) {}

  // ── SearchIndexStore ──────────────────────────────────────────

  async upsert(input: IndexUpsertInput): Promise<SearchIndexEntry> {
    const now = new Date();
    const [row] = await this.db
      .insert(schema.searchIndex)
      .values({
        tenantId: input.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        contentVector: input.contentVector,
        displayTitle: input.displayTitle,
        displaySubtitle: input.displaySubtitle,
        metadata: input.metadata,
        indexedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.searchIndex.tenantId,
          schema.searchIndex.entityType,
          schema.searchIndex.entityId,
        ],
        set: {
          contentVector: input.contentVector,
          displayTitle: input.displayTitle,
          displaySubtitle: input.displaySubtitle,
          metadata: input.metadata,
          updatedAt: now,
        },
      })
      .returning();
    if (row === undefined) throw new Error('Upsert returned no rows');
    return rowToEntry(row);
  }

  async remove(
    tenantId: string,
    entityType: SearchableEntityType,
    entityId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .delete(schema.searchIndex)
      .where(
        and(
          eq(schema.searchIndex.tenantId, tenantId),
          eq(schema.searchIndex.entityType, entityType),
          eq(schema.searchIndex.entityId, entityId),
        ),
      )
      .returning({ id: schema.searchIndex.id });
    return rows.length > 0;
  }

  async removeAll(tenantId: string, entityType: SearchableEntityType): Promise<number> {
    const rows = await this.db
      .delete(schema.searchIndex)
      .where(
        and(
          eq(schema.searchIndex.tenantId, tenantId),
          eq(schema.searchIndex.entityType, entityType),
        ),
      )
      .returning({ id: schema.searchIndex.id });
    return rows.length;
  }

  async findEntry(
    tenantId: string,
    entityType: SearchableEntityType,
    entityId: string,
  ): Promise<SearchIndexEntry | null> {
    const rows = await this.db
      .select()
      .from(schema.searchIndex)
      .where(
        and(
          eq(schema.searchIndex.tenantId, tenantId),
          eq(schema.searchIndex.entityType, entityType),
          eq(schema.searchIndex.entityId, entityId),
        ),
      )
      .limit(1);
    return rows[0] !== undefined ? rowToEntry(rows[0]) : null;
  }

  async countEntries(tenantId: string, entityType: SearchableEntityType): Promise<number> {
    const result = await this.db
      .select({ count: sql<string>`COUNT(*)` })
      .from(schema.searchIndex)
      .where(
        and(
          eq(schema.searchIndex.tenantId, tenantId),
          eq(schema.searchIndex.entityType, entityType),
        ),
      );
    return parseInt(result[0]?.count ?? '0', 10);
  }

  // ── SearchStore ──────────────────────────────────────────────

  async search(params: SearchStoreParams): Promise<SearchStoreResult> {
    const { tenantId, queryText, entityType, filters, sort, fuzzy, limit, offset } = params;
    const trimmed = queryText.trim();
    const hasFts = trimmed.length > 0;

    // websearch_to_tsquery is safe for raw user input — handles phrases,
    // negation, and special characters without throwing syntax errors.
    const scoreExpr = hasFts
      ? sql`ts_rank(to_tsvector('english', content_vector), websearch_to_tsquery('english', ${trimmed}))`
      : sql`1.0::float`;

    // Build WHERE conditions — all in one place to avoid count/result divergence
    const conditions: SQL[] = [eq(schema.searchIndex.tenantId, tenantId)];

    if (entityType !== undefined) {
      conditions.push(eq(schema.searchIndex.entityType, entityType));
    }

    if (hasFts) {
      if (fuzzy) {
        // Fuzzy: FTS union trigram similarity (requires pg_trgm — migration 0010)
        conditions.push(
          sql`(
            to_tsvector('english', content_vector) @@ websearch_to_tsquery('english', ${trimmed})
            OR display_title % ${trimmed}
          )`,
        );
      } else {
        conditions.push(
          sql`to_tsvector('english', content_vector) @@ websearch_to_tsquery('english', ${trimmed})`,
        );
      }
    }

    // Apply caller-supplied filters (entity_type, indexed_at)
    for (const filter of filters) {
      if (filter.field === 'entity_type') {
        if (filter.operator === 'eq') {
          conditions.push(eq(schema.searchIndex.entityType, filter.value as SearchableEntityType));
        } else if (filter.operator === 'neq') {
          conditions.push(ne(schema.searchIndex.entityType, filter.value as SearchableEntityType));
        } else if (filter.operator === 'in' && Array.isArray(filter.value)) {
          conditions.push(
            inArray(schema.searchIndex.entityType, filter.value as SearchableEntityType[]),
          );
        }
      }

      if (filter.field === 'indexed_at' && typeof filter.value === 'string') {
        const ts = new Date(filter.value);
        if (filter.operator === 'gte') {
          conditions.push(gte(schema.searchIndex.indexedAt, ts));
        } else if (filter.operator === 'lte') {
          conditions.push(lte(schema.searchIndex.indexedAt, ts));
        }
      }
    }

    const where = and(...conditions);

    // ORDER BY — respect caller sort preference
    const orderExpr: SQL =
      sort.field === 'indexed_at'
        ? sort.direction === 'asc'
          ? sql`indexed_at ASC`
          : sql`indexed_at DESC`
        : sort.field === 'updated_at'
          ? sort.direction === 'asc'
            ? sql`updated_at ASC`
            : sql`updated_at DESC`
          : sort.direction === 'asc'
            ? sql`score ASC`
            : sql`score DESC`;

    // Single query — COUNT(*) OVER () avoids a second round-trip to the DB
    const rowsResult = await this.db.execute(
      sql`SELECT
            id, entity_type, entity_id, display_title, display_subtitle,
            metadata, indexed_at, content_vector,
            ${scoreExpr} AS score,
            COUNT(*) OVER () AS total_count
          FROM search_index
          WHERE ${where}
          ORDER BY ${orderExpr}
          LIMIT ${limit} OFFSET ${offset}`,
    );

    const rows = rowsResult as unknown as Array<Record<string, unknown>>;
    const firstRow = rows[0];
    const rawCount = firstRow !== undefined ? firstRow['total_count'] : undefined;
    const total = parseInt(typeof rawCount === 'string' ? rawCount : '0', 10);

    const results: SearchStoreRow[] = rows.map((r) => ({
      id: r['id'] as string,
      entityType: r['entity_type'] as SearchableEntityType,
      entityId: r['entity_id'] as string,
      displayTitle: r['display_title'] as string,
      displaySubtitle: r['display_subtitle'] as string,
      score: typeof r['score'] === 'number' ? r['score'] : parseFloat(String(r['score'])),
      contentVector: r['content_vector'] as string,
      metadata: r['metadata'] as Record<string, unknown>,
      indexedAt: new Date(r['indexed_at'] as string),
    }));

    return { results, total };
  }

  async suggest(params: SuggestStoreParams): Promise<readonly SearchSuggestion[]> {
    const { tenantId, prefix, entityType, limit } = params;

    const conditions: SQL[] = [
      eq(schema.searchIndex.tenantId, tenantId),
      sql`display_title ILIKE ${`${prefix}%`}`,
    ];

    if (entityType !== undefined) {
      conditions.push(eq(schema.searchIndex.entityType, entityType));
    }

    const rows = await this.db
      .select({
        entityType: schema.searchIndex.entityType,
        entityId: schema.searchIndex.entityId,
        displayTitle: schema.searchIndex.displayTitle,
        displaySubtitle: schema.searchIndex.displaySubtitle,
      })
      .from(schema.searchIndex)
      .where(and(...conditions))
      .limit(limit);

    return rows.map((r) => ({
      entityType: r.entityType,
      entityId: r.entityId,
      displayTitle: r.displayTitle,
      displaySubtitle: r.displaySubtitle,
      score: 1.0,
    }));
  }

  async facetedSearch(params: FacetedSearchStoreParams): Promise<FacetedSearchStoreResult> {
    const { tenantId, queryText, limit, offset } = params;

    // Build base search result
    const searchResult = await this.search({
      tenantId,
      queryText,
      filters: params.filters,
      sort: { field: 'relevance', direction: 'desc' },
      limit,
      offset,
      fuzzy: false,
    });

    // Build entity_type facet buckets via GROUP BY
    const bucketRows = await this.db
      .select({
        entityType: schema.searchIndex.entityType,
        count: sql<string>`COUNT(*)`,
      })
      .from(schema.searchIndex)
      .where(eq(schema.searchIndex.tenantId, tenantId))
      .groupBy(schema.searchIndex.entityType);

    const buckets: FacetBucket[] = bucketRows.map((r) => ({
      key: r.entityType,
      count: parseInt(r.count, 10),
    }));

    const facets: FacetResult[] = [
      {
        type: 'entity_type',
        field: 'entity_type',
        buckets,
      },
    ];

    return { results: searchResult.results, total: searchResult.total, facets };
  }
}
