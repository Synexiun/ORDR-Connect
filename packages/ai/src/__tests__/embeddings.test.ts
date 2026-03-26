import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOk, isErr, ok, err, InternalError } from '@ordr/core';
import type { EmbeddingBackend } from '../embeddings.js';
import { EmbeddingClient, EMBEDDING_DIMENSIONS } from '../embeddings.js';

// ─── Mock Backend ───────────────────────────────────────────────

function makeVector(dim: number = EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length: dim }, (_, i) => Math.sin(i * 0.01));
}

function createMockBackend(overrides: Partial<EmbeddingBackend> = {}): EmbeddingBackend {
  return {
    generate: vi.fn().mockResolvedValue(ok(makeVector())),
    generateBatch: vi.fn().mockImplementation(
      (texts: readonly string[]) => Promise.resolve(ok(texts.map(() => makeVector()))),
    ),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('EmbeddingClient', () => {
  let backend: EmbeddingBackend;
  let client: EmbeddingClient;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = createMockBackend();
    client = new EmbeddingClient('openai', backend);
  });

  // ── Construction ────────────────────────────────────────

  it('creates a client with openai provider', () => {
    expect(client).toBeDefined();
    expect(client.getConfig().provider).toBe('openai');
  });

  it('creates a client with cohere provider', () => {
    const cohereClient = new EmbeddingClient('cohere', backend);
    expect(cohereClient.getConfig().provider).toBe('cohere');
    expect(cohereClient.getConfig().model).toBe('embed-english-v3.0');
  });

  it('creates a client with local provider (zero cost)', () => {
    const localClient = new EmbeddingClient('local', backend);
    expect(localClient.getConfig().costPerMillionTokens).toBe(0);
  });

  // ── Single Embedding ────────────────────────────────────

  it('generates embedding with correct dimensions', async () => {
    const result = await client.generateEmbedding('Hello, world!');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(EMBEDDING_DIMENSIONS);
    }
  });

  it('calls backend.generate with sanitized text', async () => {
    await client.generateEmbedding('  Hello  world  ');
    expect(backend.generate).toHaveBeenCalledWith('Hello world');
  });

  it('strips control characters before embedding', async () => {
    await client.generateEmbedding('Hello\x00\x01 world');
    expect(backend.generate).toHaveBeenCalledWith('Hello world');
  });

  it('returns ValidationError for empty input', async () => {
    const result = await client.generateEmbedding('');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('returns ValidationError for input exceeding max length', async () => {
    const longText = 'x'.repeat(33_000);
    const result = await client.generateEmbedding(longText);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('exceeds maximum');
    }
  });

  it('returns InternalError when backend fails', async () => {
    const failingBackend = createMockBackend({
      generate: vi.fn().mockResolvedValue(err(new InternalError('Provider unavailable'))),
    });
    const failClient = new EmbeddingClient('openai', failingBackend);
    const result = await failClient.generateEmbedding('Test');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  // ── Cost Tracking ───────────────────────────────────────

  it('tracks cost after single embedding call', async () => {
    await client.generateEmbedding('Hello');
    const summary = client.getCostSummary();
    expect(summary.totalCalls).toBe(1);
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(summary.totalCostCents).toBeGreaterThanOrEqual(0);
  });

  it('accumulates cost across multiple calls', async () => {
    await client.generateEmbedding('Hello');
    await client.generateEmbedding('World');
    const summary = client.getCostSummary();
    expect(summary.totalCalls).toBe(2);
  });

  it('tracks zero cost for local provider', async () => {
    const localClient = new EmbeddingClient('local', backend);
    await localClient.generateEmbedding('Test');
    const summary = localClient.getCostSummary();
    expect(summary.totalCostCents).toBe(0);
  });

  it('does not increment cost on validation failure', async () => {
    await client.generateEmbedding('');
    const summary = client.getCostSummary();
    expect(summary.totalCalls).toBe(0);
    expect(summary.totalTokens).toBe(0);
  });

  // ── Batch Embedding ─────────────────────────────────────

  it('generates batch embeddings for multiple texts', async () => {
    const result = await client.generateBatchEmbeddings(['Hello', 'World', 'Test']);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(3);
      for (const embedding of result.data) {
        expect(embedding).toHaveLength(EMBEDDING_DIMENSIONS);
      }
    }
  });

  it('returns ValidationError for empty batch', async () => {
    const result = await client.generateBatchEmbeddings([]);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('at least one text');
    }
  });

  it('returns ValidationError for batch exceeding max size', async () => {
    const texts = Array.from({ length: 101 }, (_, i) => `Text ${i}`);
    const result = await client.generateBatchEmbeddings(texts);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('exceeds maximum');
    }
  });

  it('validates each text in batch individually', async () => {
    const result = await client.generateBatchEmbeddings(['Valid text', '', 'Another']);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('index 1');
    }
  });

  it('tracks cost for batch calls', async () => {
    await client.generateBatchEmbeddings(['Hello', 'World']);
    const summary = client.getCostSummary();
    expect(summary.totalCalls).toBe(1);
    expect(summary.totalTokens).toBeGreaterThan(0);
  });

  it('returns InternalError when batch backend fails', async () => {
    const failingBackend = createMockBackend({
      generateBatch: vi.fn().mockResolvedValue(err(new InternalError('Batch failed'))),
    });
    const failClient = new EmbeddingClient('openai', failingBackend);
    const result = await failClient.generateBatchEmbeddings(['A', 'B']);
    expect(isErr(result)).toBe(true);
  });

  // ── Provider Configuration ──────────────────────────────

  it('returns correct config for openai', () => {
    const config = client.getConfig();
    expect(config.model).toBe('text-embedding-ada-002');
    expect(config.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(config.maxInputTokens).toBe(8191);
  });

  it('returns correct config for cohere', () => {
    const cohereClient = new EmbeddingClient('cohere', backend);
    const config = cohereClient.getConfig();
    expect(config.model).toBe('embed-english-v3.0');
    expect(config.maxInputTokens).toBe(512);
  });

  it('returns dimensions as 1536', () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });

  // ── Cost Summary Initialization ─────────────────────────

  it('starts with zero cost summary', () => {
    const summary = client.getCostSummary();
    expect(summary.totalCalls).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalCostCents).toBe(0);
  });
});
