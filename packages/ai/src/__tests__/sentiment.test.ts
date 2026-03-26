import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOk, isErr, ok, err, InternalError } from '@ordr/core';
import type { SentimentBackend, SentimentRawOutput } from '../sentiment.js';
import { SentimentAnalyzer, SENTIMENT_LABELS, SENTIMENT_SYSTEM_PROMPT } from '../sentiment.js';

// ─── Mock Backend ───────────────────────────────────────────────

function createMockBackend(defaultOutput?: SentimentRawOutput): SentimentBackend {
  const output = defaultOutput ?? { score: 0.0, confidence: 0.85 };
  return {
    analyze: vi.fn().mockResolvedValue(ok(output)),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('SentimentAnalyzer', () => {
  let backend: SentimentBackend;
  let analyzer: SentimentAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = createMockBackend();
    analyzer = new SentimentAnalyzer(backend);
  });

  // ── Single Analysis ─────────────────────────────────────

  it('returns positive score for positive text', async () => {
    backend = createMockBackend({ score: 0.8, confidence: 0.9 });
    analyzer = new SentimentAnalyzer(backend);
    const result = await analyzer.analyze('This is wonderful and amazing!');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.score).toBe(0.8);
      expect(result.data.label).toBe('positive');
      expect(result.data.confidence).toBe(0.9);
    }
  });

  it('returns negative score for negative text', async () => {
    backend = createMockBackend({ score: -0.7, confidence: 0.85 });
    analyzer = new SentimentAnalyzer(backend);
    const result = await analyzer.analyze('This is terrible and frustrating.');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.score).toBe(-0.7);
      expect(result.data.label).toBe('negative');
    }
  });

  it('returns neutral score for neutral text', async () => {
    backend = createMockBackend({ score: 0.05, confidence: 0.7 });
    analyzer = new SentimentAnalyzer(backend);
    const result = await analyzer.analyze('The meeting is at 3pm.');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.score).toBe(0.05);
      expect(result.data.label).toBe('neutral');
    }
  });

  it('clamps score to valid range [-1, 1]', async () => {
    backend = createMockBackend({ score: 1.5, confidence: 0.9 });
    analyzer = new SentimentAnalyzer(backend);
    const result = await analyzer.analyze('Extremely positive');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.score).toBeLessThanOrEqual(1);
    }
  });

  it('clamps negative score to -1 minimum', async () => {
    backend = createMockBackend({ score: -2.0, confidence: 0.9 });
    analyzer = new SentimentAnalyzer(backend);
    const result = await analyzer.analyze('Extremely negative');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.score).toBeGreaterThanOrEqual(-1);
    }
  });

  it('clamps confidence to [0, 1]', async () => {
    backend = createMockBackend({ score: 0.5, confidence: 1.5 });
    analyzer = new SentimentAnalyzer(backend);
    const result = await analyzer.analyze('Test');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('returns confidence of 0 minimum', async () => {
    backend = createMockBackend({ score: 0.5, confidence: -0.5 });
    analyzer = new SentimentAnalyzer(backend);
    const result = await analyzer.analyze('Test');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.confidence).toBeGreaterThanOrEqual(0);
    }
  });

  // ── Input Validation ────────────────────────────────────

  it('returns ValidationError for empty input', async () => {
    const result = await analyzer.analyze('');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('returns ValidationError for very long input', async () => {
    const result = await analyzer.analyze('x'.repeat(11_000));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('exceeds maximum');
    }
  });

  // ── PHI Protection ──────────────────────────────────────

  it('strips SSN patterns before sending to backend', async () => {
    await analyzer.analyze('My SSN is 123-45-6789');
    const call = (backend.analyze as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(call).not.toContain('123-45-6789');
    expect(call).toContain('[REDACTED]');
  });

  it('strips email patterns before sending to backend', async () => {
    await analyzer.analyze('Email me at john@example.com please');
    const call = (backend.analyze as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(call).not.toContain('john@example.com');
  });

  it('strips credit card patterns before sending to backend', async () => {
    await analyzer.analyze('Card 4111 1111 1111 1111 declined');
    const call = (backend.analyze as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(call).not.toContain('4111');
  });

  it('strips MRN patterns before sending to backend', async () => {
    await analyzer.analyze('Patient MRN:12345678 is upset');
    const call = (backend.analyze as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(call).not.toContain('MRN:12345678');
  });

  it('system prompt does not contain PHI instructions', () => {
    // The system prompt should instruct the model to NOT include PII
    expect(SENTIMENT_SYSTEM_PROMPT).toContain('Do not include any PII');
  });

  // ── Backend Errors ──────────────────────────────────────

  it('returns InternalError when backend fails', async () => {
    const failingBackend: SentimentBackend = {
      analyze: vi.fn().mockResolvedValue(err(new InternalError('LLM unavailable'))),
    };
    const failAnalyzer = new SentimentAnalyzer(failingBackend);
    const result = await failAnalyzer.analyze('Test input');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  // ── Batch Analysis ──────────────────────────────────────

  it('analyzes batch of texts', async () => {
    backend = createMockBackend({ score: 0.5, confidence: 0.9 });
    analyzer = new SentimentAnalyzer(backend);
    const result = await analyzer.analyzeBatch(['Good', 'Great', 'Wonderful']);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(3);
      for (const r of result.data) {
        expect(r.score).toBe(0.5);
        expect(r.label).toBe('positive');
      }
    }
  });

  it('returns ValidationError for empty batch', async () => {
    const result = await analyzer.analyzeBatch([]);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('at least one text');
    }
  });

  it('returns ValidationError for batch exceeding max size', async () => {
    const texts = Array.from({ length: 51 }, (_, i) => `Text ${i}`);
    const result = await analyzer.analyzeBatch(texts);
    expect(isErr(result)).toBe(true);
  });

  it('validates each text in batch individually', async () => {
    const result = await analyzer.analyzeBatch(['Good', '', 'Great']);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('index 1');
    }
  });

  it('returns error if any batch item backend call fails', async () => {
    let callCount = 0;
    const mixedBackend: SentimentBackend = {
      analyze: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.resolve(err(new InternalError('Failed')));
        return Promise.resolve(ok({ score: 0.5, confidence: 0.9 }));
      }),
    };
    const mixedAnalyzer = new SentimentAnalyzer(mixedBackend);
    const result = await mixedAnalyzer.analyzeBatch(['A', 'B', 'C']);
    expect(isErr(result)).toBe(true);
  });

  // ── Thresholds ──────────────────────────────────────────

  it('uses default thresholds', () => {
    const thresholds = analyzer.getThresholds();
    expect(thresholds.negativeBelow).toBe(-0.2);
    expect(thresholds.positiveAbove).toBe(0.2);
  });

  it('accepts custom thresholds', () => {
    const customAnalyzer = new SentimentAnalyzer(backend, { negativeBelow: -0.5, positiveAbove: 0.5 });
    const thresholds = customAnalyzer.getThresholds();
    expect(thresholds.negativeBelow).toBe(-0.5);
    expect(thresholds.positiveAbove).toBe(0.5);
  });

  // ── Label Constants ─────────────────────────────────────

  it('exports correct sentiment labels', () => {
    expect(SENTIMENT_LABELS).toEqual(['negative', 'neutral', 'positive']);
  });
});
