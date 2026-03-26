import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOk, isErr, ok, err, InternalError, NotFoundError } from '@ordr/core';
import type {
  MemoryEmbeddingProvider,
  MemoryEncryptor,
  VectorStore,
  VectorStoreRecord,
  MemoryAuditLogger,
  MemoryErasureProvider,
  MemoryFilter,
} from '../memory/long-term.js';
import { LongTermMemory, cosineSimilarity } from '../memory/long-term.js';
import { EMBEDDING_DIMENSIONS } from '../embeddings.js';

// ─── Mock Factories ─────────────────────────────────────────────

function makeVector(seed: number = 1, dim: number = EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length: dim }, (_, i) => Math.sin(seed + i * 0.01));
}

function createMockEmbeddingProvider(): MemoryEmbeddingProvider {
  return {
    generate: vi.fn().mockResolvedValue(ok(makeVector())),
  };
}

function createMockEncryptor(): MemoryEncryptor {
  return {
    encrypt: vi.fn().mockImplementation((text: string) => `encrypted:${text}`),
    decrypt: vi.fn().mockImplementation((text: string) => text.replace('encrypted:', '')),
  };
}

function createMockVectorStore(records: VectorStoreRecord[] = []): VectorStore {
  return {
    insert: vi.fn().mockResolvedValue(ok('inserted-id')),
    search: vi.fn().mockResolvedValue(ok(records)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    findBySession: vi.fn().mockResolvedValue(ok(records)),
    update: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function createMockAuditLogger(): MemoryAuditLogger {
  return vi.fn();
}

function createMockErasureProvider(): MemoryErasureProvider {
  return {
    erase: vi.fn().mockReturnValue(ok(undefined)),
  };
}

function makeStoreRecord(overrides: Partial<VectorStoreRecord> = {}): VectorStoreRecord {
  return {
    id: 'mem-001',
    tenantId: 'tenant-abc',
    sessionId: 'session-123',
    encryptedContent: 'encrypted:Hello world',
    embedding: makeVector(),
    metadata: { tag: 'test' },
    similarityScore: 0.92,
    consolidationCount: 0,
    keyId: 'key-001',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

const TENANT_ID = 'tenant-abc';
const KEY_ID = 'key-001';

function createMemory(overrides: {
  embeddingProvider?: MemoryEmbeddingProvider;
  encryptor?: MemoryEncryptor;
  vectorStore?: VectorStore;
  auditLog?: MemoryAuditLogger;
  erasureProvider?: MemoryErasureProvider;
} = {}): LongTermMemory {
  return new LongTermMemory({
    embeddingProvider: overrides.embeddingProvider ?? createMockEmbeddingProvider(),
    encryptor: overrides.encryptor ?? createMockEncryptor(),
    vectorStore: overrides.vectorStore ?? createMockVectorStore(),
    auditLog: overrides.auditLog ?? createMockAuditLogger(),
    erasureProvider: overrides.erasureProvider ?? createMockErasureProvider(),
    tenantId: TENANT_ID,
    keyId: KEY_ID,
  });
}

// ─── Store Tests ────────────────────────────────────────────────

describe('LongTermMemory.store', () => {
  it('stores a memory and returns its ID', async () => {
    const memory = createMemory();
    const result = await memory.store('session-1', 'Hello world', { tag: 'test' });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(typeof result.data).toBe('string');
      expect(result.data.length).toBeGreaterThan(0);
    }
  });

  it('generates embedding from plaintext content', async () => {
    const embeddingProvider = createMockEmbeddingProvider();
    const memory = createMemory({ embeddingProvider });
    await memory.store('session-1', 'Test content', {});
    expect(embeddingProvider.generate).toHaveBeenCalledWith('Test content');
  });

  it('encrypts content before storage', async () => {
    const encryptor = createMockEncryptor();
    const vectorStore = createMockVectorStore();
    const memory = createMemory({ encryptor, vectorStore });
    await memory.store('session-1', 'Sensitive data', {});
    expect(encryptor.encrypt).toHaveBeenCalledWith('Sensitive data');
    const insertCall = (vectorStore.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0] as VectorStoreRecord;
    expect(insertCall.encryptedContent).toBe('encrypted:Sensitive data');
  });

  it('sets tenant_id on stored record', async () => {
    const vectorStore = createMockVectorStore();
    const memory = createMemory({ vectorStore });
    await memory.store('session-1', 'Content', {});
    const insertCall = (vectorStore.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0] as VectorStoreRecord;
    expect(insertCall.tenantId).toBe(TENANT_ID);
  });

  it('audit-logs the store operation', async () => {
    const auditLog = createMockAuditLogger();
    const memory = createMemory({ auditLog });
    await memory.store('session-1', 'Content', { a: 'b' });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        operation: 'store',
        sessionId: 'session-1',
      }),
    );
  });

  it('audit log does NOT contain content (PHI protection)', async () => {
    const auditLog = createMockAuditLogger();
    const memory = createMemory({ auditLog });
    await memory.store('session-1', 'Secret PHI content', {});
    const entry = (auditLog as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(JSON.stringify(entry)).not.toContain('Secret PHI content');
  });

  it('returns ValidationError for empty sessionId', async () => {
    const memory = createMemory();
    const result = await memory.store('', 'Content', {});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns ValidationError for empty content', async () => {
    const memory = createMemory();
    const result = await memory.store('session-1', '', {});
    expect(isErr(result)).toBe(true);
  });

  it('returns ValidationError for content exceeding max length', async () => {
    const memory = createMemory();
    const result = await memory.store('session-1', 'x'.repeat(51_000), {});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('exceeds maximum');
  });

  it('returns ValidationError for too many metadata entries', async () => {
    const memory = createMemory();
    const bigMetadata: Record<string, string> = {};
    for (let i = 0; i < 51; i++) bigMetadata[`key${i}`] = `value${i}`;
    const result = await memory.store('session-1', 'Content', bigMetadata);
    expect(isErr(result)).toBe(true);
  });

  it('returns error when embedding generation fails', async () => {
    const embeddingProvider: MemoryEmbeddingProvider = {
      generate: vi.fn().mockResolvedValue(err(new InternalError('Embedding service down'))),
    };
    const memory = createMemory({ embeddingProvider });
    const result = await memory.store('session-1', 'Content', {});
    expect(isErr(result)).toBe(true);
  });

  it('returns error when vector store insert fails', async () => {
    const vectorStore = createMockVectorStore();
    (vectorStore.insert as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new InternalError('DB connection failed')),
    );
    const memory = createMemory({ vectorStore });
    const result = await memory.store('session-1', 'Content', {});
    expect(isErr(result)).toBe(true);
  });
});

// ─── Search Tests ───────────────────────────────────────────────

describe('LongTermMemory.search', () => {
  it('returns relevant results by cosine similarity', async () => {
    const records = [makeStoreRecord({ similarityScore: 0.95 })];
    const vectorStore = createMockVectorStore(records);
    const memory = createMemory({ vectorStore });
    const result = await memory.search('query', 5);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.similarityScore).toBe(0.95);
    }
  });

  it('search respects tenant isolation', async () => {
    const vectorStore = createMockVectorStore();
    const memory = createMemory({ vectorStore });
    await memory.search('query', 10);
    expect(vectorStore.search).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Array),
      10,
      undefined,
    );
  });

  it('decrypts content in search results', async () => {
    const records = [makeStoreRecord()];
    const vectorStore = createMockVectorStore(records);
    const encryptor = createMockEncryptor();
    const memory = createMemory({ vectorStore, encryptor });
    const result = await memory.search('query', 5);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data[0]!.content).toBe('Hello world');
    }
    expect(encryptor.decrypt).toHaveBeenCalled();
  });

  it('passes filters to vector store', async () => {
    const vectorStore = createMockVectorStore();
    const memory = createMemory({ vectorStore });
    const filters: MemoryFilter = { sessionId: 'sess-1', minScore: 0.5 };
    await memory.search('query', 5, filters);
    expect(vectorStore.search).toHaveBeenCalledWith(TENANT_ID, expect.any(Array), 5, filters);
  });

  it('audit-logs search operations', async () => {
    const auditLog = createMockAuditLogger();
    const memory = createMemory({ auditLog });
    await memory.search('query', 10);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'search',
        tenantId: TENANT_ID,
      }),
    );
  });

  it('returns ValidationError for empty query', async () => {
    const memory = createMemory();
    const result = await memory.search('', 5);
    expect(isErr(result)).toBe(true);
  });

  it('returns ValidationError for topK = 0', async () => {
    const memory = createMemory();
    const result = await memory.search('query', 0);
    expect(isErr(result)).toBe(true);
  });

  it('returns ValidationError for topK exceeding max', async () => {
    const memory = createMemory();
    const result = await memory.search('query', 101);
    expect(isErr(result)).toBe(true);
  });

  it('returns empty array when no results match', async () => {
    const vectorStore = createMockVectorStore([]);
    const memory = createMemory({ vectorStore });
    const result = await memory.search('query', 5);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toHaveLength(0);
  });

  it('returns error when embedding generation fails during search', async () => {
    const embeddingProvider: MemoryEmbeddingProvider = {
      generate: vi.fn().mockResolvedValue(err(new InternalError('Failed'))),
    };
    const memory = createMemory({ embeddingProvider });
    const result = await memory.search('query', 5);
    expect(isErr(result)).toBe(true);
  });
});

// ─── Forget Tests ───────────────────────────────────────────────

describe('LongTermMemory.forget', () => {
  it('deletes memory and triggers cryptographic erasure', async () => {
    const vectorStore = createMockVectorStore();
    const erasureProvider = createMockErasureProvider();
    const memory = createMemory({ vectorStore, erasureProvider });
    const result = await memory.forget('mem-001');
    expect(isOk(result)).toBe(true);
    expect(vectorStore.delete).toHaveBeenCalledWith(TENANT_ID, 'mem-001');
    expect(erasureProvider.erase).toHaveBeenCalledWith(
      TENANT_ID,
      KEY_ID,
      expect.stringContaining('mem-001'),
    );
  });

  it('audit-logs the forget operation', async () => {
    const auditLog = createMockAuditLogger();
    const memory = createMemory({ auditLog });
    await memory.forget('mem-001');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'forget',
        memoryId: 'mem-001',
      }),
    );
  });

  it('returns ValidationError for empty memoryId', async () => {
    const memory = createMemory();
    const result = await memory.forget('');
    expect(isErr(result)).toBe(true);
  });

  it('returns error when vector store delete fails', async () => {
    const vectorStore = createMockVectorStore();
    (vectorStore.delete as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new NotFoundError('Memory not found')),
    );
    const memory = createMemory({ vectorStore });
    const result = await memory.forget('nonexistent');
    expect(isErr(result)).toBe(true);
  });

  it('returns error when erasure fails', async () => {
    const erasureProvider: MemoryErasureProvider = {
      erase: vi.fn().mockReturnValue(err(new InternalError('Erasure failed'))),
    };
    const memory = createMemory({ erasureProvider });
    const result = await memory.forget('mem-001');
    expect(isErr(result)).toBe(true);
  });
});

// ─── Consolidate Tests ──────────────────────────────────────────

describe('LongTermMemory.consolidate', () => {
  it('merges similar memories above 0.95 threshold', async () => {
    const sharedVector = makeVector(1);
    const records: VectorStoreRecord[] = [
      makeStoreRecord({ id: 'mem-1', embedding: sharedVector, encryptedContent: 'encrypted:Content A' }),
      makeStoreRecord({ id: 'mem-2', embedding: sharedVector, encryptedContent: 'encrypted:Content B' }),
    ];
    const vectorStore = createMockVectorStore(records);
    const memory = createMemory({ vectorStore });
    const result = await memory.consolidate('session-123');
    expect(isOk(result)).toBe(true);
    // Should have updated the surviving memory and deleted the merged one
    expect(vectorStore.update).toHaveBeenCalled();
    expect(vectorStore.delete).toHaveBeenCalledWith(TENANT_ID, 'mem-2');
  });

  it('does not merge memories below threshold', async () => {
    const records: VectorStoreRecord[] = [
      makeStoreRecord({ id: 'mem-1', embedding: makeVector(1) }),
      makeStoreRecord({ id: 'mem-2', embedding: makeVector(100) }), // Very different
    ];
    const vectorStore = createMockVectorStore(records);
    const memory = createMemory({ vectorStore });
    const result = await memory.consolidate('session-123');
    expect(isOk(result)).toBe(true);
    expect(vectorStore.update).not.toHaveBeenCalled();
    expect(vectorStore.delete).not.toHaveBeenCalled();
  });

  it('returns ok when fewer than 2 memories exist', async () => {
    const records: VectorStoreRecord[] = [makeStoreRecord()];
    const vectorStore = createMockVectorStore(records);
    const memory = createMemory({ vectorStore });
    const result = await memory.consolidate('session-123');
    expect(isOk(result)).toBe(true);
  });

  it('returns ok when no memories exist', async () => {
    const vectorStore = createMockVectorStore([]);
    const memory = createMemory({ vectorStore });
    const result = await memory.consolidate('session-123');
    expect(isOk(result)).toBe(true);
  });

  it('audit-logs consolidation operations', async () => {
    const auditLog = createMockAuditLogger();
    const vectorStore = createMockVectorStore([makeStoreRecord(), makeStoreRecord({ id: 'mem-2' })]);
    const memory = createMemory({ auditLog, vectorStore });
    await memory.consolidate('session-123');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'consolidate', sessionId: 'session-123' }),
    );
  });

  it('returns ValidationError for empty sessionId', async () => {
    const memory = createMemory();
    const result = await memory.consolidate('');
    expect(isErr(result)).toBe(true);
  });

  it('increments consolidation count on merged memory', async () => {
    const sharedVector = makeVector(1);
    const records: VectorStoreRecord[] = [
      makeStoreRecord({ id: 'mem-1', embedding: sharedVector, consolidationCount: 2 }),
      makeStoreRecord({ id: 'mem-2', embedding: sharedVector }),
    ];
    const vectorStore = createMockVectorStore(records);
    const memory = createMemory({ vectorStore });
    await memory.consolidate('session-123');
    const updateCall = (vectorStore.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as VectorStoreRecord;
    expect(updateCall.consolidationCount).toBe(3);
  });
});

// ─── Cosine Similarity ─────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 0, 0, 1];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched dimensions', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('handles zero vectors gracefully', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('computes correct similarity for 1536-dim vectors', () => {
    const a = makeVector(1);
    const b = makeVector(1);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });
});
