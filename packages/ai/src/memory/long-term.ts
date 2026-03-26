/**
 * Long-Term Memory — persistent semantic memory using pgvector
 *
 * SECURITY (CLAUDE.md Rules 1, 2, 3, 6):
 * - All content encrypted BEFORE storage (AES-256-GCM field-level encryption)
 * - All queries scoped by tenant_id (RLS enforcement, Rule 2)
 * - All operations audit-logged (WORM, Rule 3)
 * - No PHI in metadata, logs, or error messages (Rule 6)
 * - Cryptographic erasure via key destruction (GDPR Art 17, HIPAA §164.310)
 *
 * SOC2 CC6.1 — Tenant isolation in memory storage.
 * HIPAA §164.312(a)(2)(iv) — Encryption of stored content.
 * ISO 27001 A.8.10 — Information deletion via cryptographic erasure.
 */

import { randomUUID } from 'node:crypto';
import {
  type Result,
  ok,
  err,
  ValidationError,
  InternalError,
  NotFoundError,
} from '@ordr/core';

// ─── Types ───────────────────────────────────────────────────────

export interface MemoryRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly content: string;
  readonly embedding: readonly number[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly similarityScore: number | null;
  readonly consolidationCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MemoryFilter {
  readonly sessionId?: string;
  readonly metadataKey?: string;
  readonly metadataValue?: string;
  readonly minScore?: number;
  readonly createdAfter?: Date;
  readonly createdBefore?: Date;
}

/** Audit entry for memory operations — NEVER contains content or PHI */
export interface MemoryAuditEntry {
  readonly tenantId: string;
  readonly operation: 'store' | 'search' | 'forget' | 'consolidate';
  readonly memoryId: string;
  readonly sessionId: string;
  readonly timestamp: Date;
  readonly metadata: Readonly<Record<string, string>>;
}

// ─── Dependency Interfaces ──────────────────────────────────────

/** Pluggable embedding generation */
export interface MemoryEmbeddingProvider {
  readonly generate: (text: string) => Promise<Result<number[], InternalError>>;
}

/** Pluggable field encryption */
export interface MemoryEncryptor {
  readonly encrypt: (plaintext: string) => string;
  readonly decrypt: (ciphertext: string) => string;
}

/** Pluggable vector store (abstracts pgvector) */
export interface VectorStore {
  readonly insert: (record: VectorStoreRecord) => Promise<Result<string, InternalError>>;
  readonly search: (
    tenantId: string,
    embedding: readonly number[],
    topK: number,
    filters?: MemoryFilter,
  ) => Promise<Result<VectorStoreRecord[], InternalError>>;
  readonly delete: (tenantId: string, memoryId: string) => Promise<Result<void, InternalError | NotFoundError>>;
  readonly findBySession: (
    tenantId: string,
    sessionId: string,
  ) => Promise<Result<VectorStoreRecord[], InternalError>>;
  readonly update: (record: VectorStoreRecord) => Promise<Result<void, InternalError>>;
}

export interface VectorStoreRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly encryptedContent: string;
  readonly embedding: readonly number[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly similarityScore: number | null;
  readonly consolidationCount: number;
  readonly keyId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Pluggable audit logger */
export type MemoryAuditLogger = (entry: MemoryAuditEntry) => void;

/** Pluggable cryptographic erasure */
export interface MemoryErasureProvider {
  readonly erase: (tenantId: string, keyId: string, reason: string) => Result<void, InternalError>;
}

// ─── Constants ───────────────────────────────────────────────────

/** Cosine similarity threshold for consolidation (memories more similar than this get merged) */
const CONSOLIDATION_THRESHOLD = 0.95 as const;

/** Maximum content length for a single memory */
const MAX_CONTENT_LENGTH = 50_000 as const;

/** Maximum metadata entries */
const MAX_METADATA_ENTRIES = 50 as const;

/** Maximum topK for search queries */
const MAX_TOP_K = 100 as const;

// ─── Implementation ─────────────────────────────────────────────

export class LongTermMemory {
  private readonly embeddingProvider: MemoryEmbeddingProvider;
  private readonly encryptor: MemoryEncryptor;
  private readonly vectorStore: VectorStore;
  private readonly auditLog: MemoryAuditLogger;
  private readonly erasureProvider: MemoryErasureProvider;
  private readonly tenantId: string;
  private readonly keyId: string;

  constructor(deps: {
    readonly embeddingProvider: MemoryEmbeddingProvider;
    readonly encryptor: MemoryEncryptor;
    readonly vectorStore: VectorStore;
    readonly auditLog: MemoryAuditLogger;
    readonly erasureProvider: MemoryErasureProvider;
    readonly tenantId: string;
    readonly keyId: string;
  }) {
    this.embeddingProvider = deps.embeddingProvider;
    this.encryptor = deps.encryptor;
    this.vectorStore = deps.vectorStore;
    this.auditLog = deps.auditLog;
    this.erasureProvider = deps.erasureProvider;
    this.tenantId = deps.tenantId;
    this.keyId = deps.keyId;
  }

  /**
   * Store a memory: embed content, encrypt, persist to pgvector.
   *
   * SECURITY:
   * - Content encrypted before storage (AES-256-GCM)
   * - Embedding generated from plaintext, then plaintext discarded
   * - Audit-logged (WORM)
   * - Tenant-scoped
   */
  async store(
    sessionId: string,
    content: string,
    metadata: Readonly<Record<string, string>>,
  ): Promise<Result<string, ValidationError | InternalError>> {
    // ── Validate inputs ─────────────────────────────────
    if (sessionId.length === 0) {
      return err(new ValidationError('Session ID must not be empty', { sessionId: ['Required'] }));
    }

    if (content.length === 0) {
      return err(new ValidationError('Content must not be empty', { content: ['Required'] }));
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return err(new ValidationError(
        `Content length ${content.length} exceeds maximum of ${MAX_CONTENT_LENGTH}`,
        { content: [`Max length is ${MAX_CONTENT_LENGTH}`] },
      ));
    }

    if (Object.keys(metadata).length > MAX_METADATA_ENTRIES) {
      return err(new ValidationError(
        `Metadata entry count exceeds maximum of ${MAX_METADATA_ENTRIES}`,
        { metadata: [`Max entries is ${MAX_METADATA_ENTRIES}`] },
      ));
    }

    // ── Generate embedding from plaintext ───────────────
    const embeddingResult = await this.embeddingProvider.generate(content);
    if (!embeddingResult.success) {
      return embeddingResult;
    }

    // ── Encrypt content before storage ──────────────────
    const encryptedContent = this.encryptor.encrypt(content);

    const memoryId = randomUUID();
    const now = new Date();

    // ── Persist to vector store ─────────────────────────
    const record: VectorStoreRecord = {
      id: memoryId,
      tenantId: this.tenantId,
      sessionId,
      encryptedContent,
      embedding: embeddingResult.data,
      metadata,
      similarityScore: null,
      consolidationCount: 0,
      keyId: this.keyId,
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await this.vectorStore.insert(record);
    if (!insertResult.success) {
      return insertResult;
    }

    // ── Audit log (WORM) — no content in log ───────────
    this.auditLog({
      tenantId: this.tenantId,
      operation: 'store',
      memoryId,
      sessionId,
      timestamp: now,
      metadata: { keyCount: String(Object.keys(metadata).length) },
    });

    return ok(memoryId);
  }

  /**
   * Semantic search across memories using cosine similarity.
   *
   * SECURITY:
   * - Query is embedded but never stored or logged
   * - Results decrypted in-memory, never cached
   * - Tenant-scoped (only searches within tenant boundary)
   * - Audit-logged
   */
  async search(
    query: string,
    topK: number,
    filters?: MemoryFilter,
  ): Promise<Result<MemoryRecord[], ValidationError | InternalError>> {
    if (query.length === 0) {
      return err(new ValidationError('Search query must not be empty', { query: ['Required'] }));
    }

    if (topK <= 0 || topK > MAX_TOP_K) {
      return err(new ValidationError(
        `topK must be between 1 and ${MAX_TOP_K}`,
        { topK: [`Must be 1-${MAX_TOP_K}`] },
      ));
    }

    // ── Embed query ─────────────────────────────────────
    const embeddingResult = await this.embeddingProvider.generate(query);
    if (!embeddingResult.success) {
      return embeddingResult;
    }

    // ── Search vector store (tenant-scoped) ─────────────
    const searchResult = await this.vectorStore.search(
      this.tenantId,
      embeddingResult.data,
      topK,
      filters,
    );
    if (!searchResult.success) {
      return searchResult;
    }

    // ── Decrypt content in memory ───────────────────────
    const records: MemoryRecord[] = searchResult.data.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      sessionId: r.sessionId,
      content: this.encryptor.decrypt(r.encryptedContent),
      embedding: r.embedding,
      metadata: r.metadata,
      similarityScore: r.similarityScore,
      consolidationCount: r.consolidationCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    // ── Audit log — no content in log ───────────────────
    this.auditLog({
      tenantId: this.tenantId,
      operation: 'search',
      memoryId: 'search-query',
      sessionId: 'n/a',
      timestamp: new Date(),
      metadata: { topK: String(topK), resultCount: String(records.length) },
    });

    return ok(records);
  }

  /**
   * Forget a memory via cryptographic erasure.
   *
   * SECURITY:
   * - Uses CryptographicErasure to destroy the encryption key
   * - Data becomes permanently irrecoverable
   * - Audit-logged (WORM)
   *
   * GDPR Art. 17 — Right to erasure.
   * HIPAA §164.310(d)(2)(i) — Disposal of ePHI.
   */
  async forget(
    memoryId: string,
  ): Promise<Result<void, ValidationError | InternalError | NotFoundError>> {
    if (memoryId.length === 0) {
      return err(new ValidationError('Memory ID must not be empty', { memoryId: ['Required'] }));
    }

    // ── Delete from vector store ────────────────────────
    const deleteResult = await this.vectorStore.delete(this.tenantId, memoryId);
    if (!deleteResult.success) {
      return deleteResult;
    }

    // ── Trigger cryptographic erasure ───────────────────
    const erasureResult = this.erasureProvider.erase(
      this.tenantId,
      this.keyId,
      `Memory forget request for memory ${memoryId}`,
    );
    if (!erasureResult.success) {
      return erasureResult;
    }

    // ── Audit log ───────────────────────────────────────
    this.auditLog({
      tenantId: this.tenantId,
      operation: 'forget',
      memoryId,
      sessionId: 'n/a',
      timestamp: new Date(),
      metadata: { erasureKeyId: this.keyId },
    });

    return ok(undefined);
  }

  /**
   * Consolidate similar memories within a session.
   * Merges memories with cosine similarity > 0.95 threshold.
   *
   * SECURITY:
   * - Operates within tenant boundary only
   * - Content decrypted in-memory for comparison, re-encrypted after merge
   * - Audit-logged
   */
  async consolidate(
    sessionId: string,
  ): Promise<Result<void, ValidationError | InternalError>> {
    if (sessionId.length === 0) {
      return err(new ValidationError('Session ID must not be empty', { sessionId: ['Required'] }));
    }

    // ── Fetch all memories for session ──────────────────
    const sessionResult = await this.vectorStore.findBySession(this.tenantId, sessionId);
    if (!sessionResult.success) {
      return sessionResult;
    }

    const memories = sessionResult.data;
    if (memories.length < 2) {
      return ok(undefined); // Nothing to consolidate
    }

    // ── Find pairs above consolidation threshold ────────
    const merged = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      if (merged.has(memories[i]!.id)) continue;

      for (let j = i + 1; j < memories.length; j++) {
        if (merged.has(memories[j]!.id)) continue;

        const similarity = cosineSimilarity(memories[i]!.embedding, memories[j]!.embedding);
        if (similarity >= CONSOLIDATION_THRESHOLD) {
          // Merge j into i: combine content, keep the earlier one
          const contentA = this.encryptor.decrypt(memories[i]!.encryptedContent);
          const contentB = this.encryptor.decrypt(memories[j]!.encryptedContent);
          const mergedContent = `${contentA}\n---\n${contentB}`;
          const encryptedMerged = this.encryptor.encrypt(mergedContent);

          // Update the surviving memory
          const updatedRecord: VectorStoreRecord = {
            ...memories[i]!,
            encryptedContent: encryptedMerged,
            consolidationCount: memories[i]!.consolidationCount + 1,
            updatedAt: new Date(),
          };

          const updateResult = await this.vectorStore.update(updatedRecord);
          if (!updateResult.success) {
            return updateResult;
          }

          // Delete the merged-in memory
          const deleteResult = await this.vectorStore.delete(this.tenantId, memories[j]!.id);
          if (!deleteResult.success) {
            return deleteResult;
          }

          merged.add(memories[j]!.id);
        }
      }
    }

    // ── Audit log ───────────────────────────────────────
    this.auditLog({
      tenantId: this.tenantId,
      operation: 'consolidate',
      memoryId: 'batch',
      sessionId,
      timestamp: new Date(),
      metadata: { mergedCount: String(merged.size), totalMemories: String(memories.length) },
    });

    return ok(undefined);
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 * Returns value in range [-1, 1].
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
