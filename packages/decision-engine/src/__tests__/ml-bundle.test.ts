/**
 * @ordr/decision-engine — ML Bundle Tests
 *
 * Exercises bundle parsing, schema validation, SHA-256 integrity, prediction
 * output, transform pipeline, factory fallback.
 */

import { describe, it, expect } from 'vitest';
import {
  BundledLinearModel,
  parseMLBundle,
  computeBundleHash,
  type MLModelBundle,
} from '../ml-bundle.js';
import { createDefaultMLScorer } from '../ml-scorer.js';
import type { MLModel } from '../types.js';

// ─── Fixtures ────────────────────────────────────────────────────

function baseBundle(): Omit<MLModelBundle, 'sha256'> {
  return {
    version: '0.3.0',
    trainedAt: '2026-04-18T00:00:00Z',
    trainingDataHash: 'sha256:' + 'a'.repeat(64),
    auditorApprovalId: 'ML-RISK-0001',
    models: {
      propensity_to_pay: {
        version: '0.3.0-trained',
        intercept: -0.2,
        weights: {
          outstanding_balance_normalized: 1.8,
          payment_consistency_score: 2.1,
          health_score: 1.2,
          interaction_recency_score: 0.9,
          days_since_last_contact: -1.4,
        },
        transforms: {
          health_score: { divide: 100 },
          days_since_last_contact: { cap: 90, divide: 90 },
        },
      },
    },
  };
}

function signed(bundle: Omit<MLModelBundle, 'sha256'>): MLModelBundle {
  const placeholder: MLModelBundle = { ...bundle, sha256: 'sha256:' + '0'.repeat(64) };
  const hash = computeBundleHash(placeholder);
  return { ...bundle, sha256: hash };
}

// ─── Schema + Integrity ──────────────────────────────────────────

describe('parseMLBundle — schema validation', () => {
  it('accepts a well-formed, correctly-signed bundle', () => {
    const bundle = signed(baseBundle());
    const result = parseMLBundle(JSON.stringify(bundle));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bundle.version).toBe('0.3.0');
      expect(result.data.models.size).toBe(1);
      expect(result.data.models.has('propensity_to_pay')).toBe(true);
    }
  });

  it('rejects non-JSON input', () => {
    const result = parseMLBundle('{not json');
    expect(result.success).toBe(false);
  });

  it('rejects a bundle missing required fields', () => {
    const result = parseMLBundle(JSON.stringify({ version: '0.3.0' }));
    expect(result.success).toBe(false);
  });

  it('rejects a bundle with malformed sha256 field', () => {
    const bundle = { ...baseBundle(), sha256: 'not-a-hash' };
    const result = parseMLBundle(JSON.stringify(bundle));
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra properties (strict schema)', () => {
    const bundle = signed(baseBundle());
    const tampered = { ...bundle, extraField: 'should-not-be-allowed' };
    const result = parseMLBundle(JSON.stringify(tampered));
    expect(result.success).toBe(false);
  });

  it('rejects a bundle whose declared sha256 does not match its content', () => {
    // Sign correctly, then mutate a weight — the declared hash is now stale.
    const bundle = signed(baseBundle());
    const tampered: MLModelBundle = {
      ...bundle,
      models: {
        ...bundle.models,
        propensity_to_pay: {
          ...bundle.models.propensity_to_pay,
          intercept: 99,
        },
      },
    };
    const result = parseMLBundle(JSON.stringify(tampered));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('integrity check failed');
    }
  });
});

// ─── Determinism ─────────────────────────────────────────────────

describe('computeBundleHash — determinism', () => {
  it('produces the same hash regardless of top-level key order', () => {
    const b = baseBundle();
    const placeholder: MLModelBundle = { ...b, sha256: 'sha256:' + '0'.repeat(64) };
    const reordered: MLModelBundle = {
      sha256: 'sha256:' + '0'.repeat(64),
      models: b.models,
      auditorApprovalId: b.auditorApprovalId,
      trainingDataHash: b.trainingDataHash,
      trainedAt: b.trainedAt,
      version: b.version,
    };
    expect(computeBundleHash(placeholder)).toBe(computeBundleHash(reordered));
  });
});

// ─── BundledLinearModel — prediction ─────────────────────────────

describe('BundledLinearModel.predict — mathematical equivalence', () => {
  it('reproduces the hand-tuned propensity_to_pay output for identical weights', async () => {
    const bundle = signed(baseBundle());
    const parsed = parseMLBundle(JSON.stringify(bundle));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const bundled = parsed.data.models.get('propensity_to_pay');
    expect(bundled).toBeDefined();
    const features = {
      outstanding_balance_normalized: 0.7,
      payment_consistency_score: 0.8,
      health_score: 60,
      interaction_recency_score: 0.5,
      days_since_last_contact: 10,
    };
    const bundledScore = await bundled!.predict(features);

    // Expected logit using the same formula as PropensityToPayModel.predict
    const expectedLogit =
      -0.2 + 0.7 * 1.8 + 0.8 * 2.1 + (60 / 100) * 1.2 + 0.5 * 0.9 + (10 / 90) * -1.4;
    const expected = 1 / (1 + Math.exp(-expectedLogit));
    expect(bundledScore).toBeCloseTo(expected, 6);
  });

  it('clamps scores to [0, 1]', async () => {
    const impossible = {
      ...baseBundle(),
      models: {
        runaway: {
          version: '0.0.1',
          intercept: 1000,
          weights: {},
        },
      },
    };
    const bundle = signed(impossible);
    const parsed = parseMLBundle(JSON.stringify(bundle));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const score = await parsed.data.models.get('runaway')!.predict({});
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('treats a missing feature as 0 (default) rather than throwing', async () => {
    const bundle = signed(baseBundle());
    const parsed = parseMLBundle(JSON.stringify(bundle));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const score = await parsed.data.models.get('propensity_to_pay')!.predict({});
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── Transforms ──────────────────────────────────────────────────

describe('BundledLinearModel transforms', () => {
  it('applies divide transform', async () => {
    const b = {
      ...baseBundle(),
      models: {
        only_health: {
          version: '0.0.1',
          intercept: 0,
          weights: { health_score: 1 },
          transforms: { health_score: { divide: 100 } },
        },
      },
    };
    const bundle = signed(b);
    const parsed = parseMLBundle(JSON.stringify(bundle));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // intercept=0, weight=1, health=100 → health/100=1 → logit=1 → sigmoid(1)≈0.731
    const score = await parsed.data.models.get('only_health')!.predict({ health_score: 100 });
    expect(score).toBeCloseTo(1 / (1 + Math.exp(-1)), 6);
  });

  it('applies cap + divide together (days_since_last_contact style)', async () => {
    const b = {
      ...baseBundle(),
      models: {
        only_staleness: {
          version: '0.0.1',
          intercept: 0,
          weights: { days_since_last_contact: 1 },
          transforms: { days_since_last_contact: { cap: 90, divide: 90 } },
        },
      },
    };
    const bundle = signed(b);
    const parsed = parseMLBundle(JSON.stringify(bundle));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // raw 200 → cap 90 → /90 = 1 → logit=1 → sigmoid(1)
    const score = await parsed.data.models
      .get('only_staleness')!
      .predict({ days_since_last_contact: 200 });
    expect(score).toBeCloseTo(1 / (1 + Math.exp(-1)), 6);
  });

  it('applies normalizeFromNegOneToOne transform (sentiment style)', async () => {
    const b = {
      ...baseBundle(),
      models: {
        only_sentiment: {
          version: '0.0.1',
          intercept: 0,
          weights: { sentiment_avg: 1 },
          transforms: { sentiment_avg: { normalizeFromNegOneToOne: true } },
        },
      },
    };
    const bundle = signed(b);
    const parsed = parseMLBundle(JSON.stringify(bundle));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // raw -1 → (-1+1)/2 = 0 → logit=0 → sigmoid(0)=0.5
    const score = await parsed.data.models.get('only_sentiment')!.predict({ sentiment_avg: -1 });
    expect(score).toBeCloseTo(0.5, 6);
  });
});

// ─── Model metadata ──────────────────────────────────────────────

describe('BundledLinearModel metadata', () => {
  it('exposes bundle version and sha256 for audit trail', () => {
    const bundle = signed(baseBundle());
    const model = new BundledLinearModel('propensity_to_pay', bundle.models.propensity_to_pay, {
      version: bundle.version,
      sha256: bundle.sha256,
    });
    expect(model.name).toBe('propensity_to_pay');
    expect(model.version).toBe('0.3.0-trained');
    expect(model.bundleVersion).toBe('0.3.0');
    expect(model.bundleSha256).toBe(bundle.sha256);
  });
});

// ─── Factory fallback ────────────────────────────────────────────

describe('createDefaultMLScorer factory', () => {
  it('falls back to hand-tuned models when no bundle is provided', () => {
    const scorer = createDefaultMLScorer();
    const names = scorer.getModelNames();
    expect(names).toContain('propensity_to_pay');
    expect(names).toContain('churn_risk');
    expect(names).toContain('contact_responsiveness');
  });

  it('uses bundle models when provided', () => {
    const bundle = signed(baseBundle());
    const parsed = parseMLBundle(JSON.stringify(bundle));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const scorer = createDefaultMLScorer(parsed.data.models);
    const names = scorer.getModelNames();
    expect(names).toEqual(['propensity_to_pay']);
  });

  it('falls back when provided map is empty', () => {
    const scorer = createDefaultMLScorer(new Map<string, MLModel>());
    expect(scorer.getModelNames().length).toBeGreaterThan(0);
  });
});
