/**
 * Core AI types — type-safe LLM abstraction for ORDR-Connect
 *
 * SECURITY:
 * - All metadata fields use branded types from @ordr/core where applicable.
 * - Cost tracking is mandatory for budget enforcement (Rule 9).
 * - Safety check results gate every LLM request/response.
 */

// ─── Provider & Tier ─────────────────────────────────────────────

export const LLM_PROVIDERS = ['anthropic', 'openai'] as const;
export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export const MODEL_TIERS = ['budget', 'standard', 'premium'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const FINISH_REASONS = [
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'content_filter',
  'error',
] as const;
export type FinishReason = (typeof FINISH_REASONS)[number];

// ─── Messages ────────────────────────────────────────────────────

export const MESSAGE_ROLES = ['system', 'user', 'assistant'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface LLMMessage {
  readonly role: MessageRole;
  readonly content: string;
}

// ─── Request / Response ──────────────────────────────────────────

export interface LLMRequestMetadata {
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly agent_id: string;
}

export interface LLMRequest {
  readonly messages: readonly LLMMessage[];
  readonly modelTier: ModelTier;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly systemPrompt: string | undefined;
  readonly metadata: LLMRequestMetadata;
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly total: number;
}

export interface LLMResponse {
  readonly content: string;
  readonly model: string;
  readonly tokenUsage: TokenUsage;
  readonly costCents: number;
  readonly latencyMs: number;
  readonly provider: LLMProvider;
  readonly finishReason: FinishReason;
}

// ─── Model Configuration ─────────────────────────────────────────

export interface ModelConfig {
  readonly provider: LLMProvider;
  readonly modelName: string;
  readonly maxTokens: number;
  readonly costPerMillionInput: number;
  readonly costPerMillionOutput: number;
  readonly rateLimitRpm: number;
}

// ─── Safety ──────────────────────────────────────────────────────

export interface SafetyViolation {
  readonly rule: string;
  readonly description: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SafetyCheckResult {
  readonly passed: boolean;
  readonly violations: readonly SafetyViolation[];
  readonly blocked: boolean;
}

// ─── Prompt Templates ────────────────────────────────────────────

export interface PromptTemplate {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly systemPrompt: string;
  readonly userTemplate: string;
  readonly variables: readonly string[];
}

// ─── Client Configuration ────────────────────────────────────────

export interface LLMClientConfig {
  readonly anthropicApiKey: string;
  readonly defaultTier: ModelTier;
  readonly defaultMaxTokens: number;
  readonly defaultTemperature: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}
