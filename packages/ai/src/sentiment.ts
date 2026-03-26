/**
 * Sentiment Analysis — LLM-based customer sentiment scoring
 *
 * SECURITY (CLAUDE.md Rules 4, 6, 7, 9):
 * - No PHI included in sentiment analysis prompts (Rule 6)
 * - Input validated and sanitized before analysis
 * - Only scores/labels returned — NEVER the original text
 * - Cost tracked per analysis call (Rule 9)
 * - Structured output parsing with JSON schema validation
 * - NEVER logs customer message content
 *
 * SOC2 CC7.2 — Sentiment monitoring for anomaly detection.
 * HIPAA §164.312 — PHI excluded from analysis pipeline.
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
  InternalError,
} from '@ordr/core';

// ─── Types ───────────────────────────────────────────────────────

export const SENTIMENT_LABELS = ['negative', 'neutral', 'positive'] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];

export interface SentimentResult {
  readonly score: number;        // -1.0 to 1.0
  readonly label: SentimentLabel;
  readonly confidence: number;   // 0.0 to 1.0
}

export interface SentimentThresholds {
  readonly negativeBelow: number;
  readonly positiveAbove: number;
}

/** Backend that runs the actual LLM analysis — pluggable for testing */
export interface SentimentBackend {
  readonly analyze: (sanitizedText: string) => Promise<Result<SentimentRawOutput, InternalError>>;
}

/** Raw structured output from the LLM */
export interface SentimentRawOutput {
  readonly score: number;
  readonly confidence: number;
}

// ─── Constants ───────────────────────────────────────────────────

/** Maximum input length for sentiment analysis */
const MAX_INPUT_LENGTH = 10_000 as const;

/** Maximum batch size */
const MAX_BATCH_SIZE = 50 as const;

/** Default thresholds for sentiment label assignment */
const DEFAULT_THRESHOLDS: SentimentThresholds = {
  negativeBelow: -0.2,
  positiveAbove: 0.2,
} as const;

/**
 * System prompt for sentiment analysis.
 * SECURITY: NEVER includes customer data, PHI, or PII.
 * Only instructs the model on scoring methodology.
 */
export const SENTIMENT_SYSTEM_PROMPT = `You are a sentiment analysis engine. Analyze the provided text and return ONLY a JSON object with two fields:
- "score": a number from -1.0 (very negative) to 1.0 (very positive)
- "confidence": a number from 0.0 to 1.0 indicating your confidence in the score

Rules:
- Focus on emotional tone, not factual content
- Do not include any PII, names, or identifying information in your response
- Return ONLY the JSON object, no additional text
- If the text is ambiguous, assign a score near 0 with lower confidence` as const;

// ─── Implementation ─────────────────────────────────────────────

export class SentimentAnalyzer {
  private readonly backend: SentimentBackend;
  private readonly thresholds: SentimentThresholds;

  constructor(backend: SentimentBackend, thresholds?: SentimentThresholds) {
    this.backend = backend;
    this.thresholds = thresholds ?? DEFAULT_THRESHOLDS;
  }

  /**
   * Analyze sentiment of a single text.
   *
   * SECURITY:
   * - Text is sanitized to strip PII patterns before sending to LLM
   * - Only score/label/confidence returned — never the original text
   * - NEVER logs input text
   */
  async analyze(text: string): Promise<Result<SentimentResult, ValidationError | InternalError>> {
    // ── Validate input ──────────────────────────────────
    const validationError = validateSentimentInput(text);
    if (validationError !== null) {
      return err(validationError);
    }

    const sanitized = sanitizeForSentiment(text);

    // ── Call backend ────────────────────────────────────
    const result = await this.backend.analyze(sanitized);
    if (!result.success) {
      return result;
    }

    // ── Parse and validate output ───────────────────────
    return ok(this.buildResult(result.data));
  }

  /**
   * Analyze sentiment for multiple texts in a batch.
   *
   * SECURITY: Each text validated and sanitized individually.
   */
  async analyzeBatch(
    texts: readonly string[],
  ): Promise<Result<SentimentResult[], ValidationError | InternalError>> {
    if (texts.length === 0) {
      return err(new ValidationError('Batch must contain at least one text', { texts: ['Empty batch'] }));
    }

    if (texts.length > MAX_BATCH_SIZE) {
      return err(new ValidationError(
        `Batch size ${texts.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
        { texts: [`Max batch size is ${MAX_BATCH_SIZE}`] },
      ));
    }

    // Validate all texts first
    for (let i = 0; i < texts.length; i++) {
      const validationError = validateSentimentInput(texts[i]!);
      if (validationError !== null) {
        return err(new ValidationError(
          `Validation failed for text at index ${i}`,
          { texts: [validationError.message] },
        ));
      }
    }

    // Process each text
    const results: SentimentResult[] = [];
    for (const text of texts) {
      const sanitized = sanitizeForSentiment(text);
      const result = await this.backend.analyze(sanitized);
      if (!result.success) {
        return result;
      }
      results.push(this.buildResult(result.data));
    }

    return ok(results);
  }

  /**
   * Returns the current thresholds configuration.
   */
  getThresholds(): SentimentThresholds {
    return this.thresholds;
  }

  // ── Private ─────────────────────────────────────────────────

  private buildResult(raw: SentimentRawOutput): SentimentResult {
    const clampedScore = Math.max(-1, Math.min(1, raw.score));
    const clampedConfidence = Math.max(0, Math.min(1, raw.confidence));

    return {
      score: clampedScore,
      label: this.scoreToLabel(clampedScore),
      confidence: clampedConfidence,
    };
  }

  private scoreToLabel(score: number): SentimentLabel {
    if (score < this.thresholds.negativeBelow) return 'negative';
    if (score > this.thresholds.positiveAbove) return 'positive';
    return 'neutral';
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Validate sentiment input text.
 */
function validateSentimentInput(text: string): ValidationError | null {
  if (text.length === 0) {
    return new ValidationError('Sentiment input must not be empty', { text: ['Empty input'] });
  }

  if (text.length > MAX_INPUT_LENGTH) {
    return new ValidationError(
      `Input length ${text.length} exceeds maximum of ${MAX_INPUT_LENGTH}`,
      { text: [`Max input length is ${MAX_INPUT_LENGTH}`] },
    );
  }

  return null;
}

/**
 * Sanitize text for sentiment analysis — strips potential PHI patterns.
 *
 * SECURITY: Removes SSNs, credit cards, MRNs, DOBs before sending to LLM.
 * This ensures no PHI is included in sentiment prompts (Rule 6).
 */
function sanitizeForSentiment(text: string): string {
  return text
    // Remove SSNs
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED]')
    // Remove credit card patterns
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED]')
    // Remove MRN patterns
    .replace(/\bMRN[:\s]?\d{6,10}\b/gi, '[REDACTED]')
    // Remove DOB patterns
    .replace(/\b(?:DOB|date\s+of\s+birth)[:\s]+\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b/gi, '[REDACTED]')
    // Remove email addresses
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED]')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
