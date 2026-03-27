/**
 * LLM-backed Sentiment Backend — wires SentimentAnalyzer to LLMClient
 *
 * Uses 'budget' tier (claude-haiku-4-5-20251001) for cost-effective,
 * high-volume sentiment scoring.
 *
 * SECURITY (CLAUDE.md Rules 5, 6, 9):
 * - Input text has already been sanitized by SentimentAnalyzer before reaching here
 * - NEVER logs the text content — only scores/latency/cost
 * - No PHI enters the LLM prompt (handled upstream by sanitizeForSentiment)
 * - Cost tracked per call for budget enforcement
 *
 * HIPAA §164.312 — PHI excluded from analysis pipeline.
 * SOC2 CC7.2 — Sentiment monitoring for anomaly detection.
 */

import { randomUUID } from 'node:crypto';
import { ok, err, type Result, InternalError } from '@ordr/core';
import { SENTIMENT_SYSTEM_PROMPT } from './sentiment.js';
import type { SentimentBackend, SentimentRawOutput } from './sentiment.js';
import type { LLMClient } from './client.js';

// ─── Implementation ─────────────────────────────────────────────

export class LlmSentimentBackend implements SentimentBackend {
  private readonly llm: LLMClient;
  private readonly tenantId: string;

  constructor(llm: LLMClient, tenantId = 'system') {
    this.llm = llm;
    this.tenantId = tenantId;
  }

  async analyze(sanitizedText: string): Promise<Result<SentimentRawOutput>> {
    const correlationId = randomUUID();

    const result = await this.llm.complete({
      messages: [{ role: 'user', content: sanitizedText }],
      modelTier: 'budget', // claude-haiku-4-5-20251001 — cost optimized for high volume
      maxTokens: 64, // Sentiment JSON is small: { "score": x.x, "confidence": x.x }
      temperature: 0, // Deterministic scoring — no creativity needed
      systemPrompt: SENTIMENT_SYSTEM_PROMPT,
      metadata: {
        tenant_id: this.tenantId,
        correlation_id: correlationId,
        agent_id: 'sentiment-analyzer',
      },
    });

    if (!result.success) {
      return err(
        new InternalError(`Sentiment LLM call failed: ${result.error.message}`, correlationId),
      );
    }

    try {
      const parsed = JSON.parse(result.data.content) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as Record<string, unknown>)['score'] !== 'number' ||
        typeof (parsed as Record<string, unknown>)['confidence'] !== 'number'
      ) {
        return err(
          new InternalError('Sentiment model returned invalid JSON schema', correlationId),
        );
      }
      const typed = parsed as { score: number; confidence: number };
      return ok({ score: typed.score, confidence: typed.confidence });
    } catch {
      return err(new InternalError('Sentiment model returned unparseable response', correlationId));
    }
  }
}
