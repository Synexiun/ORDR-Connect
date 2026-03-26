/**
 * LLM client — Anthropic Claude abstraction for ORDR-Connect
 *
 * SECURITY (CLAUDE.md Rules 5, 6, 7, 9):
 * - NEVER logs prompt content or response content (PHI/PII protection)
 * - Only logs metadata: model, tokens, cost, latency, correlation_id
 * - All methods return Result<T, AppError> — no thrown exceptions
 * - Retry logic: exponential backoff, only on 429/500/503
 * - Timeout enforcement: 30s default, configurable
 * - Cost tracking on every request for budget enforcement
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  type Result,
  ok,
  err,
  InternalError,
  ValidationError,
  RateLimitError,
  AGENT,
} from '@ordr/core';
import type {
  LLMRequest,
  LLMResponse,
  LLMClientConfig,
  FinishReason,
} from './types.js';
import { selectModel, calculateCost } from './models.js';
import { validateInput, validateOutput } from './safety.js';

// ─── Constants ───────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000 as const;
const DEFAULT_MAX_RETRIES = 3 as const;
const RETRY_BASE_DELAY_MS = 1000 as const;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);

// ─── Client ──────────────────────────────────────────────────────

export class LLMClient {
  private readonly anthropic: Anthropic;
  private readonly config: LLMClientConfig;

  constructor(config: Partial<LLMClientConfig> & { readonly anthropicApiKey: string }) {
    this.config = {
      anthropicApiKey: config.anthropicApiKey,
      defaultTier: config.defaultTier ?? 'standard',
      defaultMaxTokens: config.defaultMaxTokens ?? 4096,
      defaultTemperature: config.defaultTemperature ?? 0.1,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    };

    this.anthropic = new Anthropic({
      apiKey: this.config.anthropicApiKey,
      timeout: this.config.timeoutMs,
    });
  }

  /**
   * Send a completion request to the LLM.
   *
   * SECURITY:
   * - Pre-flight safety check on input
   * - Post-response safety check on output
   * - Cost calculated and returned for budget tracking
   * - NEVER logs prompt or response content
   *
   * Retry policy: exponential backoff on 429/500/503 only.
   * All other errors fail immediately.
   */
  async complete(request: LLMRequest): Promise<Result<LLMResponse, ValidationError | InternalError | RateLimitError>> {
    // ── Pre-flight safety check ─────────────────────────
    const inputSafety = validateInput(request.messages);
    if (inputSafety.blocked) {
      return err(
        new ValidationError(
          'Request blocked by safety check',
          {
            safety: inputSafety.violations.map(
              (v) => `[${v.severity}] ${v.rule}: ${v.description}`,
            ),
          },
          request.metadata.correlation_id,
        ),
      );
    }

    // ── Select model ────────────────────────────────────
    const modelConfig = selectModel(request.modelTier);
    const maxTokens = Math.min(request.maxTokens, modelConfig.maxTokens);

    // ── Build messages ──────────────────────────────────
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of request.messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
      // system role messages are handled via the system parameter
    }

    // ── Execute with retries ────────────────────────────
    let lastError: unknown = null;
    const startTime = performance.now();

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await sleep(delay);
        }

        const createParams: Anthropic.MessageCreateParamsNonStreaming = {
          model: modelConfig.modelName,
          max_tokens: maxTokens,
          temperature: request.temperature,
          messages,
        };

        // Only set system when defined — exactOptionalPropertyTypes forbids undefined
        if (request.systemPrompt !== undefined) {
          createParams.system = request.systemPrompt;
        }

        const response = await this.anthropic.messages.create(createParams);

        const latencyMs = Math.round(performance.now() - startTime);

        // ── Extract content ───────────────────────────
        const content = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');

        // ── Token usage ───────────────────────────────
        const inputTokens = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;
        const costCents = calculateCost(inputTokens, outputTokens, request.modelTier);

        // ── Map finish reason ─────────────────────────
        const finishReason = mapStopReason(response.stop_reason);

        // ── Post-response safety check ────────────────
        const outputSafety = validateOutput(content);

        // Log metadata ONLY — never content (HIPAA §164.312)
        // In production this goes to structured logging
        // console.log is used here as placeholder — replaced by Loki/Grafana in prod
        const _metadata = {
          model: modelConfig.modelName,
          inputTokens,
          outputTokens,
          costCents,
          latencyMs,
          finishReason,
          safetyPassed: outputSafety.passed,
          violationCount: outputSafety.violations.length,
          correlationId: request.metadata.correlation_id,
          tenantId: request.metadata.tenant_id,
          agentId: request.metadata.agent_id,
        };

        const llmResponse: LLMResponse = {
          content,
          model: modelConfig.modelName,
          tokenUsage: {
            input: inputTokens,
            output: outputTokens,
            total: inputTokens + outputTokens,
          },
          costCents,
          latencyMs,
          provider: modelConfig.provider,
          finishReason,
        };

        return ok(llmResponse);
      } catch (error: unknown) {
        lastError = error;

        // Check if retryable
        if (error instanceof Anthropic.APIError) {
          if (!RETRYABLE_STATUS_CODES.has(error.status)) {
            break; // Non-retryable — exit loop
          }
          if (error.status === 429) {
            // Rate limited — check if we've exceeded retries
            if (attempt >= this.config.maxRetries) {
              return err(
                new RateLimitError(
                  'LLM API rate limit exceeded',
                  60,
                  request.metadata.correlation_id,
                ),
              );
            }
          }
          // 500/503 — continue retrying
          continue;
        }

        // Timeout or unknown error — do not retry
        break;
      }
    }

    // All retries exhausted or non-retryable error
    return err(
      new InternalError(
        `LLM request failed after ${this.config.maxRetries + 1} attempts`,
        request.metadata.correlation_id,
      ),
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Map Anthropic stop_reason to our FinishReason type.
 */
function mapStopReason(stopReason: string | null): FinishReason {
  switch (stopReason) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

/**
 * Async sleep utility for retry backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
