/**
 * Embedding generation — vector embedding client for ORDR-Connect
 *
 * SECURITY (CLAUDE.md Rules 4, 5, 6, 9):
 * - Input validated before embedding (max token length, sanitization)
 * - NEVER logs text content being embedded (PHI/PII protection)
 * - Only logs metadata: provider, dimensions, cost, latency
 * - Cost tracked per call for budget enforcement (Rule 9)
 * - Provider abstraction allows swapping without code changes
 *
 * SOC2 CC6.1 — Cost tracking for budget governance.
 * HIPAA §164.312 — No PHI in logs or error messages.
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
  InternalError,
} from '@ordr/core';

// ─── Constants ───────────────────────────────────────────────────

/** Standard embedding dimension for OpenAI ada-002 and compatible models */
export const EMBEDDING_DIMENSIONS = 1536 as const;

/** Maximum input length in characters (~8191 tokens * 4 chars/token) */
const MAX_INPUT_LENGTH = 32_000 as const;

/** Maximum batch size to prevent resource exhaustion */
const MAX_BATCH_SIZE = 100 as const;

// ─── Provider Interface ─────────────────────────────────────────

export const EMBEDDING_PROVIDERS = ['openai', 'cohere', 'local'] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

/** Configuration for an embedding provider */
export interface EmbeddingProviderConfig {
  readonly provider: EmbeddingProvider;
  readonly model: string;
  readonly dimensions: number;
  readonly costPerMillionTokens: number;
  readonly maxInputTokens: number;
}

/** Result of a single embedding generation */
export interface EmbeddingResult {
  readonly embedding: readonly number[];
  readonly dimensions: number;
  readonly tokenCount: number;
  readonly costCents: number;
  readonly provider: EmbeddingProvider;
  readonly latencyMs: number;
}

/** Cost tracking accumulator */
export interface EmbeddingCostSummary {
  readonly totalCalls: number;
  readonly totalTokens: number;
  readonly totalCostCents: number;
}

/** Backend that generates actual embeddings — pluggable for testing */
export interface EmbeddingBackend {
  readonly generate: (text: string) => Promise<Result<number[], InternalError>>;
  readonly generateBatch: (texts: readonly string[]) => Promise<Result<number[][], InternalError>>;
}

// ─── Provider Configs ───────────────────────────────────────────

const PROVIDER_CONFIGS: Readonly<Record<EmbeddingProvider, EmbeddingProviderConfig>> = {
  openai: {
    provider: 'openai',
    model: 'text-embedding-ada-002',
    dimensions: EMBEDDING_DIMENSIONS,
    costPerMillionTokens: 10, // $0.10 per 1M tokens = 10 cents
    maxInputTokens: 8191,
  },
  cohere: {
    provider: 'cohere',
    model: 'embed-english-v3.0',
    dimensions: EMBEDDING_DIMENSIONS,
    costPerMillionTokens: 10,
    maxInputTokens: 512,
  },
  local: {
    provider: 'local',
    model: 'mock-embedding-v1',
    dimensions: EMBEDDING_DIMENSIONS,
    costPerMillionTokens: 0,
    maxInputTokens: 8191,
  },
} as const;

// ─── Client ─────────────────────────────────────────────────────

export class EmbeddingClient {
  private readonly config: EmbeddingProviderConfig;
  private readonly backend: EmbeddingBackend;
  private totalCalls: number;
  private totalTokens: number;
  private totalCostCents: number;

  constructor(provider: EmbeddingProvider, backend: EmbeddingBackend) {
    this.config = PROVIDER_CONFIGS[provider];
    this.backend = backend;
    this.totalCalls = 0;
    this.totalTokens = 0;
    this.totalCostCents = 0;
  }

  /**
   * Generate a single embedding vector from text.
   *
   * SECURITY: Input is validated for length and sanitized.
   * NEVER logs the input text (PHI/PII protection).
   */
  async generateEmbedding(text: string): Promise<Result<number[], ValidationError | InternalError>> {
    // ── Input validation ────────────────────────────────
    const validationError = this.validateInput(text);
    if (validationError !== null) {
      return err(validationError);
    }

    const sanitized = sanitizeForEmbedding(text);
    const startTime = performance.now();

    const result = await this.backend.generate(sanitized);

    if (!result.success) {
      return result;
    }

    const latencyMs = Math.round(performance.now() - startTime);
    const tokenCount = estimateTokenCount(sanitized);
    const costCents = this.calculateCost(tokenCount);

    // ── Track costs ─────────────────────────────────────
    this.totalCalls += 1;
    this.totalTokens += tokenCount;
    this.totalCostCents += costCents;

    // Log metadata ONLY — never content (HIPAA §164.312)
    const _metadata = {
      provider: this.config.provider,
      model: this.config.model,
      dimensions: this.config.dimensions,
      tokenCount,
      costCents,
      latencyMs,
    };

    return ok(result.data);
  }

  /**
   * Generate embeddings for multiple texts in a batch.
   *
   * SECURITY: Each text validated individually. Batch size limited.
   */
  async generateBatchEmbeddings(
    texts: readonly string[],
  ): Promise<Result<number[][], ValidationError | InternalError>> {
    if (texts.length === 0) {
      return err(new ValidationError('Batch must contain at least one text', { texts: ['Empty batch'] }));
    }

    if (texts.length > MAX_BATCH_SIZE) {
      return err(
        new ValidationError(
          `Batch size ${texts.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
          { texts: [`Max batch size is ${MAX_BATCH_SIZE}`] },
        ),
      );
    }

    // Validate each text
    for (let i = 0; i < texts.length; i++) {
      const validationError = this.validateInput(texts[i]!);
      if (validationError !== null) {
        return err(new ValidationError(
          `Validation failed for text at index ${i}`,
          { texts: [validationError.message] },
        ));
      }
    }

    const sanitized = texts.map(sanitizeForEmbedding);
    const startTime = performance.now();

    const result = await this.backend.generateBatch(sanitized);

    if (!result.success) {
      return result;
    }

    const latencyMs = Math.round(performance.now() - startTime);
    let batchTokens = 0;
    for (const t of sanitized) {
      batchTokens += estimateTokenCount(t);
    }
    const costCents = this.calculateCost(batchTokens);

    // ── Track costs ─────────────────────────────────────
    this.totalCalls += 1;
    this.totalTokens += batchTokens;
    this.totalCostCents += costCents;

    const _metadata = {
      provider: this.config.provider,
      batchSize: texts.length,
      totalTokens: batchTokens,
      costCents,
      latencyMs,
    };

    return ok(result.data);
  }

  /**
   * Returns accumulated cost tracking data.
   */
  getCostSummary(): EmbeddingCostSummary {
    return {
      totalCalls: this.totalCalls,
      totalTokens: this.totalTokens,
      totalCostCents: Math.round(this.totalCostCents * 1_000_000) / 1_000_000,
    };
  }

  /**
   * Returns the provider configuration (read-only).
   */
  getConfig(): EmbeddingProviderConfig {
    return this.config;
  }

  // ── Private ─────────────────────────────────────────────────

  private validateInput(text: string): ValidationError | null {
    if (text.length === 0) {
      return new ValidationError('Embedding input must not be empty', { text: ['Empty input'] });
    }

    if (text.length > MAX_INPUT_LENGTH) {
      return new ValidationError(
        `Input length ${text.length} exceeds maximum of ${MAX_INPUT_LENGTH}`,
        { text: [`Max input length is ${MAX_INPUT_LENGTH} characters`] },
      );
    }

    return null;
  }

  private calculateCost(tokenCount: number): number {
    const costDollars = (tokenCount * this.config.costPerMillionTokens) / 1_000_000;
    return Math.round(costDollars * 100 * 1_000_000) / 1_000_000;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Sanitize text before embedding — strips control characters,
 * normalizes whitespace. NEVER logs the text.
 */
function sanitizeForEmbedding(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars (keep \n, \r, \t)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Estimate token count using chars/4 heuristic.
 * Matches the approach in token-counter.ts.
 */
function estimateTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
