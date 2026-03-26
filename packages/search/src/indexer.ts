/**
 * @ordr/search — Search Indexer
 *
 * Manages the search index: create, update, remove entries.
 * Uses PostgreSQL tsvector for full-text search capability.
 *
 * HIPAA §164.312 — All PHI is stripped/masked BEFORE indexing.
 * SOC2 CC6.1 — Every index operation is tenant-scoped.
 * ISO 27001 A.8.2.3 — Data classification enforced at the indexing boundary.
 *
 * PHI is NEVER stored in the search index in plaintext.
 * Names → initials, emails → domain only, phones → last 4 digits, SSN → never indexed.
 */

import type {
  SearchableEntityType,
  SearchIndexEntry,
  IndexEntityInput,
  IndexFieldMap,
} from './types.js';
import { SEARCHABLE_ENTITY_TYPES } from './types.js';
import { sanitizePhiField } from './sanitizer.js';

// ─── Store Interface ─────────────────────────────────────────────

/**
 * Pluggable storage interface for the search index.
 * In production: backed by PostgreSQL with tsvector + GIN indexes.
 * In tests: in-memory implementation.
 */
export interface SearchIndexStore {
  /**
   * Upsert a search index entry.
   * If an entry with the same (tenantId, entityType, entityId) exists, update it.
   */
  upsert(entry: IndexUpsertInput): Promise<SearchIndexEntry>;

  /**
   * Remove a search index entry.
   * Returns true if the entry existed and was removed.
   */
  remove(tenantId: string, entityType: SearchableEntityType, entityId: string): Promise<boolean>;

  /**
   * Remove all entries for a given entity type within a tenant.
   * Returns the number of entries removed.
   */
  removeAll(tenantId: string, entityType: SearchableEntityType): Promise<number>;

  /**
   * Find an entry by tenant, entity type, and entity ID.
   */
  findEntry(
    tenantId: string,
    entityType: SearchableEntityType,
    entityId: string,
  ): Promise<SearchIndexEntry | null>;

  /**
   * Count entries for a given entity type within a tenant.
   */
  countEntries(tenantId: string, entityType: SearchableEntityType): Promise<number>;
}

export interface IndexUpsertInput {
  readonly tenantId: string;
  readonly entityType: SearchableEntityType;
  readonly entityId: string;
  /** Pre-built tsvector content string (sanitized, weighted) */
  readonly contentVector: string;
  readonly displayTitle: string;
  readonly displaySubtitle: string;
  readonly metadata: Record<string, unknown>;
}

// ─── Entity Loader Interface ─────────────────────────────────────

/**
 * Callback to load all entities of a type for full reindex.
 * Returns an array of IndexEntityInput for each entity.
 */
export type EntityLoader = (
  entityType: SearchableEntityType,
  tenantId: string,
) => Promise<readonly IndexEntityInput[]>;

// ─── SearchIndexer ───────────────────────────────────────────────

export class SearchIndexer {
  private readonly store: SearchIndexStore;
  private readonly entityLoader: EntityLoader | null;

  constructor(store: SearchIndexStore, entityLoader?: EntityLoader) {
    this.store = store;
    this.entityLoader = entityLoader ?? null;
  }

  /**
   * Index a single entity. Strips PHI before indexing.
   *
   * @param input - Entity data with field map (PHI fields marked)
   * @returns The created/updated search index entry
   */
  async indexEntity(input: IndexEntityInput): Promise<SearchIndexEntry> {
    // Validate entity type
    if (!SEARCHABLE_ENTITY_TYPES.includes(input.entityType)) {
      throw new Error(`[ORDR:Search] Unsupported entity type: ${input.entityType}`);
    }

    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new Error('[ORDR:Search] tenantId is required for indexing');
    }

    if (!input.entityId || input.entityId.trim().length === 0) {
      throw new Error('[ORDR:Search] entityId is required for indexing');
    }

    // Build sanitized tsvector content and display fields
    const { contentVector, displayTitle, displaySubtitle } = this.buildIndexContent(input);

    return this.store.upsert({
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      contentVector,
      displayTitle,
      displaySubtitle,
      metadata: input.metadata ?? {},
    });
  }

  /**
   * Remove an entity from the search index.
   *
   * @returns true if the entry existed and was removed
   */
  async removeEntity(
    entityType: SearchableEntityType,
    entityId: string,
    tenantId: string,
  ): Promise<boolean> {
    if (!SEARCHABLE_ENTITY_TYPES.includes(entityType)) {
      throw new Error(`[ORDR:Search] Unsupported entity type: ${entityType}`);
    }

    return this.store.remove(tenantId, entityType, entityId);
  }

  /**
   * Reindex all entities of a type within a tenant.
   * Requires an entity loader to be configured.
   *
   * @returns The number of entities reindexed
   */
  async reindexAll(
    entityType: SearchableEntityType,
    tenantId: string,
  ): Promise<number> {
    if (!SEARCHABLE_ENTITY_TYPES.includes(entityType)) {
      throw new Error(`[ORDR:Search] Unsupported entity type: ${entityType}`);
    }

    if (!this.entityLoader) {
      throw new Error('[ORDR:Search] Entity loader not configured — cannot reindex');
    }

    // Remove existing entries for this type
    await this.store.removeAll(tenantId, entityType);

    // Load all entities
    const entities = await this.entityLoader(entityType, tenantId);

    // Index each entity
    let count = 0;
    for (const entity of entities) {
      await this.indexEntity(entity);
      count++;
    }

    return count;
  }

  // ─── Private Helpers ──────────────────────────────────────────

  /**
   * Build the tsvector content string and display fields from the input.
   * All PHI fields are sanitized before inclusion.
   */
  private buildIndexContent(input: IndexEntityInput): {
    contentVector: string;
    displayTitle: string;
    displaySubtitle: string;
  } {
    const weightedParts: { text: string; weight: string }[] = [];

    for (const [fieldName, fieldValue] of Object.entries(input.fields)) {
      if (!fieldValue.value || fieldValue.value.trim().length === 0) {
        continue;
      }

      // Sanitize PHI fields before they enter the index
      const sanitizedValue = fieldValue.isPhi
        ? sanitizePhiField(fieldName, fieldValue.value)
        : fieldValue.value;

      if (sanitizedValue.length > 0) {
        weightedParts.push({
          text: sanitizedValue,
          weight: fieldValue.weight,
        });
      }
    }

    // Build a tsvector-compatible content string with weight markers
    // Format: setweight(to_tsvector('english', 'text'), 'A') || ...
    // For our in-memory implementation, we store the concatenated text
    const contentVector = weightedParts
      .map((p) => `${p.weight}:${p.text}`)
      .join(' ');

    // Build display fields from the input or from sanitized field values
    const displayTitle = input.displayTitle ?? this.buildDisplayTitle(input.fields);
    const displaySubtitle = input.displaySubtitle ?? this.buildDisplaySubtitle(input.fields);

    return { contentVector, displayTitle, displaySubtitle };
  }

  /**
   * Build a display title from the highest-weight fields.
   * Uses weight A fields first, then B.
   */
  private buildDisplayTitle(fields: IndexFieldMap): string {
    for (const weight of ['A', 'B'] as const) {
      for (const [fieldName, fieldValue] of Object.entries(fields)) {
        if (fieldValue.weight === weight && fieldValue.value.trim().length > 0) {
          return fieldValue.isPhi
            ? sanitizePhiField(fieldName, fieldValue.value)
            : fieldValue.value;
        }
      }
    }
    return '';
  }

  /**
   * Build a display subtitle from secondary fields.
   * Uses weight B fields first, then C.
   */
  private buildDisplaySubtitle(fields: IndexFieldMap): string {
    let titleWeight: string | null = null;

    // Find the weight used for the title
    for (const weight of ['A', 'B'] as const) {
      for (const fieldValue of Object.values(fields)) {
        if (fieldValue.weight === weight && fieldValue.value.trim().length > 0) {
          titleWeight = weight;
          break;
        }
      }
      if (titleWeight) break;
    }

    // Use the next weight level for subtitle
    const subtitleWeights = titleWeight === 'A' ? ['B', 'C'] : ['C', 'D'];

    for (const weight of subtitleWeights) {
      for (const [fieldName, fieldValue] of Object.entries(fields)) {
        if (fieldValue.weight === weight && fieldValue.value.trim().length > 0) {
          return fieldValue.isPhi
            ? sanitizePhiField(fieldName, fieldValue.value)
            : fieldValue.value;
        }
      }
    }

    return '';
  }
}
