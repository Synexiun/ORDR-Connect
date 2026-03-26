/**
 * @ordr/ai — LLM abstraction and AI safety layer for ORDR-Connect
 *
 * Multi-tier model routing, safety validation, prompt management,
 * and cost tracking. All compliant with SOC2/ISO27001/HIPAA.
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  LLMProvider,
  ModelTier,
  FinishReason,
  MessageRole,
  LLMMessage,
  LLMRequestMetadata,
  LLMRequest,
  TokenUsage,
  LLMResponse,
  ModelConfig,
  SafetyViolation,
  SafetyCheckResult,
  PromptTemplate,
  LLMClientConfig,
} from './types.js';

export {
  LLM_PROVIDERS,
  MODEL_TIERS,
  FINISH_REASONS,
  MESSAGE_ROLES,
} from './types.js';

// ─── Models ───────────────────────────────────────────────────────
export {
  MODEL_REGISTRY,
  selectModel,
  calculateCost,
  getAvailableTiers,
  getRateLimit,
} from './models.js';

// ─── Client ───────────────────────────────────────────────────────
export { LLMClient } from './client.js';

// ─── Safety ───────────────────────────────────────────────────────
export {
  PII_PATTERNS,
  INJECTION_PATTERNS,
  MESSAGE_LIMITS,
  validateInput,
  validateOutput,
} from './safety.js';

// ─── Prompts ──────────────────────────────────────────────────────
export {
  COMPLIANCE_BLOCKS,
  BUILT_IN_TEMPLATES,
  PromptRegistry,
} from './prompts.js';

// ─── Token Counter ────────────────────────────────────────────────
export {
  estimateTokens,
  estimateRequestTokens,
  estimateRequestCost,
  estimateCostForTokens,
} from './token-counter.js';

// ─── Embeddings ──────────────────────────────────────────────────
export type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingResult,
  EmbeddingCostSummary,
  EmbeddingBackend,
} from './embeddings.js';

export {
  EMBEDDING_PROVIDERS,
  EMBEDDING_DIMENSIONS,
  EmbeddingClient,
} from './embeddings.js';

// ─── Long-Term Memory ────────────────────────────────────────────
export type {
  MemoryRecord,
  MemoryFilter,
  MemoryAuditEntry,
  MemoryEmbeddingProvider,
  MemoryEncryptor,
  VectorStore,
  VectorStoreRecord,
  MemoryAuditLogger,
  MemoryErasureProvider,
} from './memory/long-term.js';

export {
  LongTermMemory,
  cosineSimilarity,
} from './memory/long-term.js';

// ─── Sentiment Analysis ─────────────────────────────────────────
export type {
  SentimentLabel,
  SentimentResult,
  SentimentThresholds,
  SentimentBackend,
  SentimentRawOutput,
} from './sentiment.js';

export {
  SENTIMENT_LABELS,
  SENTIMENT_SYSTEM_PROMPT,
  SentimentAnalyzer,
} from './sentiment.js';

// ─── Sentiment Router ───────────────────────────────────────────
export type {
  RoutingAction,
  RoutingDecision,
  RoutingThresholds,
  RoutingAuditEntry,
  RouterSentimentProvider,
  SentimentHistoryProvider,
  RoutingAuditLogger,
} from './routing/sentiment-router.js';

export {
  ROUTING_ACTIONS,
  SentimentRouter,
} from './routing/sentiment-router.js';

// ─── Multi-Modal Processing ─────────────────────────────────────
export type {
  SupportedImageType,
  SupportedDocumentType,
  SupportedAudioType,
  SupportedMimeType,
  ImageAnalysis,
  DocumentAnalysis,
  AudioTranscription,
  ImageBackend,
  DocumentBackend,
  AudioBackend,
} from './multimodal.js';

export {
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_DOCUMENT_TYPES,
  SUPPORTED_AUDIO_TYPES,
  MultiModalProcessor,
} from './multimodal.js';
