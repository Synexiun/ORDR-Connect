/**
 * @ordr/decision-engine — Shadow Scorer Tests
 *
 * Exercises the A/B harness: primary result flows through unchanged, shadow
 * results produce divergence events, shadow failures are isolated, missing
 * models produce typed events.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ShadowScorer, InMemoryShadowSink, type ShadowDefinition } from '../shadow-scorer.js';
import { MLScorer } from '../ml-scorer.js';
import type { DecisionContext, MLModel, MLFeatureVector } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────

function ctx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    eventType: 'payment_overdue',
    eventPayload: {},
    customerProfile: {
      healthScore: 70,
      lifecycleStage: 'active',
      segment: 'mid-market',
      ltv: 25000,
      sentimentAvg: 0.4,
      responseRate: 0.7,
      preferredChannel: 'sms',
      outstandingBalance: 3000,
      maxBalance: 10000,
      daysSinceLastContact: 5,
      totalInteractions30d: 8,
      paymentHistory: [],
    },
    channelPreferences: ['sms', 'email'],
    interactionHistory: [],
    constraints: {
      budgetCents: undefined,
      timeWindowMinutes: undefined,
      blockedChannels: [],
      maxContactsPerWeek: 3,
      maxSmsPerDay: 1,
      maxEmailsPerWeek: 5,
    },
    timestamp: new Date('2026-04-18T12:00:00Z'),
    correlationId: 'corr-1',
    ...overrides,
  };
}

class FixedModel implements MLModel {
  readonly name: string;
  readonly version = '1.0.0';
  private readonly value: number;

  constructor(name: string, value: number) {
    this.name = name;
    this.value = value;
  }

  predict(_features: MLFeatureVector): Promise<number> {
    return Promise.resolve(this.value);
  }
}

class ExplodingModel implements MLModel {
  readonly name: string;
  readonly version = '1.0.0';

  constructor(name: string) {
    this.name = name;
  }

  predict(_features: MLFeatureVector): Promise<number> {
    throw new Error('shadow model boom');
  }
}

function scorerWith(name: string, value: number): MLScorer {
  return new MLScorer(new Map<string, MLModel>([[name, new FixedModel(name, value)]]));
}

function scorerWithExploder(name: string): MLScorer {
  return new MLScorer(new Map<string, MLModel>([[name, new ExplodingModel(name)]]));
}

// ─── Tests ───────────────────────────────────────────────────────

describe('ShadowScorer — primary pass-through', () => {
  it('returns the primary result when no shadows are registered', async () => {
    const primary = scorerWith('propensity_to_pay', 0.8);
    const shadow = new ShadowScorer({ primary, shadows: [] });
    const result = await shadow.score(ctx(), 'propensity_to_pay');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.score).toBe(0.8);
    }
  });

  it('returns the primary result (not the shadow) when shadows disagree', async () => {
    const primary = scorerWith('propensity_to_pay', 0.8);
    const candidate = scorerWith('propensity_to_pay', 0.2);
    const scorer = new ShadowScorer({
      primary,
      shadows: [{ name: 'candidate', scorer: candidate }],
    });
    const result = await scorer.score(ctx(), 'propensity_to_pay');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.score).toBe(0.8); // primary wins, shadow observed only
    }
  });

  it('propagates a primary NotFound error unchanged', async () => {
    const primary = scorerWith('propensity_to_pay', 0.8);
    const scorer = new ShadowScorer({ primary, shadows: [] });
    const result = await scorer.score(ctx(), 'does_not_exist');
    expect(result.success).toBe(false);
  });
});

// ─── Sink events ─────────────────────────────────────────────────

describe('ShadowScorer — comparison events', () => {
  let sink: InMemoryShadowSink;

  beforeEach(() => {
    sink = new InMemoryShadowSink();
  });

  it('records a divergence event with tenantId + customerId + both scores', async () => {
    const primary = scorerWith('churn_risk', 0.7);
    const candidate = scorerWith('churn_risk', 0.5);
    const scorer = new ShadowScorer({
      primary,
      shadows: [{ name: 'candidate-v0.4', scorer: candidate }],
      sink,
    });

    await scorer.score(ctx(), 'churn_risk');
    const events = sink.all();
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.tenantId).toBe('tenant-1');
    expect(e.customerId).toBe('cust-1');
    expect(e.modelName).toBe('churn_risk');
    expect(e.shadowName).toBe('candidate-v0.4');
    expect(e.primaryScore).toBe(0.7);
    expect(e.shadowScore).toBe(0.5);
    expect(e.divergence).toBeCloseTo(0.2, 6);
    expect(e.shadowError).toBeUndefined();
  });

  it('records one event per shadow', async () => {
    const primary = scorerWith('churn_risk', 0.7);
    const shadows: ShadowDefinition[] = [
      { name: 'A', scorer: scorerWith('churn_risk', 0.6) },
      { name: 'B', scorer: scorerWith('churn_risk', 0.4) },
      { name: 'C', scorer: scorerWith('churn_risk', 0.9) },
    ];
    const scorer = new ShadowScorer({ primary, shadows, sink });
    await scorer.score(ctx(), 'churn_risk');
    const names = sink
      .all()
      .map((e) => e.shadowName)
      .sort();
    expect(names).toEqual(['A', 'B', 'C']);
  });

  it('zero divergence when primary and shadow produce identical output', async () => {
    const primary = scorerWith('churn_risk', 0.55);
    const twin = scorerWith('churn_risk', 0.55);
    const scorer = new ShadowScorer({
      primary,
      shadows: [{ name: 'twin', scorer: twin }],
      sink,
    });
    await scorer.score(ctx(), 'churn_risk');
    expect(sink.all()[0]!.divergence).toBe(0);
  });

  it('does not record events when no sink is configured', async () => {
    const primary = scorerWith('churn_risk', 0.7);
    const candidate = scorerWith('churn_risk', 0.3);
    const scorer = new ShadowScorer({
      primary,
      shadows: [{ name: 'candidate', scorer: candidate }],
      // no sink
    });
    const result = await scorer.score(ctx(), 'churn_risk');
    expect(result.success).toBe(true);
  });
});

// ─── Error isolation ─────────────────────────────────────────────

describe('ShadowScorer — error isolation', () => {
  it('captures an exploding shadow as an event with shadowError set', async () => {
    const primary = scorerWith('churn_risk', 0.7);
    const sink = new InMemoryShadowSink();
    const scorer = new ShadowScorer({
      primary,
      shadows: [{ name: 'boom', scorer: scorerWithExploder('churn_risk') }],
      sink,
    });
    const result = await scorer.score(ctx(), 'churn_risk');
    expect(result.success).toBe(true);
    const events = sink.all();
    expect(events.length).toBe(1);
    expect(events[0]!.shadowError).toContain('boom');
    expect(Number.isNaN(events[0]!.shadowScore)).toBe(true);
  });

  it('isolates failure of one shadow from others', async () => {
    const primary = scorerWith('churn_risk', 0.7);
    const sink = new InMemoryShadowSink();
    const scorer = new ShadowScorer({
      primary,
      shadows: [
        { name: 'healthy', scorer: scorerWith('churn_risk', 0.6) },
        { name: 'broken', scorer: scorerWithExploder('churn_risk') },
      ],
      sink,
    });
    await scorer.score(ctx(), 'churn_risk');
    const events = sink.all();
    expect(events.length).toBe(2);
    const healthy = events.find((e) => e.shadowName === 'healthy')!;
    const broken = events.find((e) => e.shadowName === 'broken')!;
    expect(healthy.shadowError).toBeUndefined();
    expect(healthy.shadowScore).toBe(0.6);
    expect(broken.shadowError).toBeDefined();
  });

  it('records an event when a shadow does not register the requested model', async () => {
    const primary = scorerWith('churn_risk', 0.7);
    const sink = new InMemoryShadowSink();
    const scorer = new ShadowScorer({
      primary,
      shadows: [{ name: 'wrong_model', scorer: scorerWith('propensity_to_pay', 0.3) }],
      sink,
    });
    await scorer.score(ctx(), 'churn_risk');
    const events = sink.all();
    expect(events.length).toBe(1);
    expect(events[0]!.shadowError).toContain('does not register model');
  });

  it('primary result is still returned even if a sink throws', async () => {
    const throwingSink = {
      record: (): Promise<void> => Promise.reject(new Error('sink down')),
    };
    const primary = scorerWith('churn_risk', 0.7);
    const scorer = new ShadowScorer({
      primary,
      shadows: [{ name: 'candidate', scorer: scorerWith('churn_risk', 0.3) }],
      sink: throwingSink,
    });
    const result = await scorer.score(ctx(), 'churn_risk');
    expect(result.success).toBe(true);
  });
});

// ─── scoreAll + introspection ────────────────────────────────────

describe('ShadowScorer — scoreAll and introspection', () => {
  it('scoreAll runs primary across all models and produces one event per (model, shadow) pair', async () => {
    const primaryMap = new Map<string, MLModel>([
      ['propensity_to_pay', new FixedModel('propensity_to_pay', 0.8)],
      ['churn_risk', new FixedModel('churn_risk', 0.2)],
    ]);
    const primary = new MLScorer(primaryMap);
    const candidateMap = new Map<string, MLModel>([
      ['propensity_to_pay', new FixedModel('propensity_to_pay', 0.6)],
      ['churn_risk', new FixedModel('churn_risk', 0.3)],
    ]);
    const sink = new InMemoryShadowSink();
    const scorer = new ShadowScorer({
      primary,
      shadows: [{ name: 'candidate', scorer: new MLScorer(candidateMap) }],
      sink,
    });
    const result = await scorer.scoreAll(ctx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(2);
    }
    expect(sink.all().length).toBe(2);
  });

  it('hasModel / getModelNames delegate to primary', () => {
    const primary = new MLScorer(
      new Map<string, MLModel>([['propensity_to_pay', new FixedModel('propensity_to_pay', 0.5)]]),
    );
    const scorer = new ShadowScorer({ primary, shadows: [] });
    expect(scorer.hasModel('propensity_to_pay')).toBe(true);
    expect(scorer.hasModel('missing')).toBe(false);
    expect(scorer.getModelNames()).toEqual(['propensity_to_pay']);
  });
});
