/**
 * PrometheusShadowSink — unit tests
 *
 * Verifies that shadow comparison events are translated to the correct
 * metrics calls, including status-label classification and the NaN-guard
 * on the divergence histogram.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PrometheusShadowSink, type ShadowMetricsSink } from '../prometheus-shadow-sink.js';
import type { ShadowComparisonEvent, ShadowComparisonSink } from '../shadow-scorer.js';

// ─── Mock metrics sink ───────────────────────────────────────────

interface CounterCall {
  name: string;
  labels: Record<string, string>;
  value: number;
}
interface HistogramCall {
  name: string;
  labels: Record<string, string>;
  value: number;
}

class FakeMetrics implements ShadowMetricsSink {
  readonly counters: CounterCall[] = [];
  readonly histograms: HistogramCall[] = [];

  incrementCounter(name: string, labels: Record<string, string>, value: number = 1): void {
    this.counters.push({ name, labels, value });
  }

  observeHistogram(name: string, labels: Record<string, string>, value: number): void {
    this.histograms.push({ name, labels, value });
  }
}

// ─── Event factory ───────────────────────────────────────────────

function event(overrides: Partial<ShadowComparisonEvent> = {}): ShadowComparisonEvent {
  return {
    ts: 1_700_000_000_000,
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    modelName: 'churn_risk',
    shadowName: 'candidate-v0.4.0',
    primaryScore: 0.7,
    primaryConfidence: 0.9,
    shadowScore: 0.72,
    shadowConfidence: 0.88,
    divergence: 0.02,
    featureCount: 12,
    shadowError: undefined,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('PrometheusShadowSink', () => {
  let metrics: FakeMetrics;
  let sink: PrometheusShadowSink;

  beforeEach(() => {
    metrics = new FakeMetrics();
    sink = new PrometheusShadowSink({ metrics });
  });

  describe('status classification', () => {
    it('classifies small divergence as agreement', async () => {
      await sink.record(event({ divergence: 0.02 }));
      expect(metrics.counters).toHaveLength(1);
      expect(metrics.counters[0]?.labels.status).toBe('agreement');
    });

    it('classifies boundary divergence (== epsilon) as agreement', async () => {
      await sink.record(event({ divergence: 0.05 }));
      expect(metrics.counters[0]?.labels.status).toBe('agreement');
    });

    it('classifies divergence above epsilon as divergence', async () => {
      await sink.record(event({ divergence: 0.3 }));
      expect(metrics.counters[0]?.labels.status).toBe('divergence');
    });

    it('classifies shadow error as error', async () => {
      await sink.record(
        event({
          shadowError: 'shadow crashed',
          shadowScore: Number.NaN,
          shadowConfidence: Number.NaN,
          divergence: Number.NaN,
        }),
      );
      expect(metrics.counters[0]?.labels.status).toBe('error');
    });

    it('classifies missing-model sentinel as missing_model', async () => {
      await sink.record(
        event({
          shadowError: 'shadow "candidate" does not register model "churn_risk"',
          shadowScore: Number.NaN,
          shadowConfidence: Number.NaN,
          divergence: Number.NaN,
        }),
      );
      expect(metrics.counters[0]?.labels.status).toBe('missing_model');
    });

    it('honors custom agreementEpsilon', async () => {
      const strict = new PrometheusShadowSink({ metrics, agreementEpsilon: 0.01 });
      await strict.record(event({ divergence: 0.02 }));
      expect(metrics.counters[0]?.labels.status).toBe('divergence');
    });
  });

  describe('histogram guard', () => {
    it('observes finite divergence on the histogram', async () => {
      await sink.record(event({ divergence: 0.15 }));
      expect(metrics.histograms).toHaveLength(1);
      expect(metrics.histograms[0]?.value).toBe(0.15);
      expect(metrics.histograms[0]?.labels).toEqual({
        model_name: 'churn_risk',
        shadow_name: 'candidate-v0.4.0',
      });
    });

    it('skips histogram observation when divergence is NaN (error/missing)', async () => {
      await sink.record(
        event({
          shadowError: 'boom',
          divergence: Number.NaN,
        }),
      );
      expect(metrics.histograms).toHaveLength(0);
      expect(metrics.counters).toHaveLength(1); // but counter still fires
    });
  });

  describe('label safety (Rule 6)', () => {
    it('does not include tenantId or customerId in counter labels', async () => {
      await sink.record(event());
      const labels = metrics.counters[0]?.labels ?? {};
      expect(labels).not.toHaveProperty('tenant_id');
      expect(labels).not.toHaveProperty('customer_id');
      expect(labels).not.toHaveProperty('tenantId');
      expect(labels).not.toHaveProperty('customerId');
    });

    it('does not include tenantId or customerId in histogram labels', async () => {
      await sink.record(event());
      const labels = metrics.histograms[0]?.labels ?? {};
      expect(labels).not.toHaveProperty('tenant_id');
      expect(labels).not.toHaveProperty('customer_id');
    });
  });

  describe('passthrough', () => {
    it('forwards the full event to a passthrough sink when configured', async () => {
      const captured: ShadowComparisonEvent[] = [];
      const passthrough: ShadowComparisonSink = {
        record: async (e) => {
          captured.push(e);
        },
      };
      const withPassthrough = new PrometheusShadowSink({ metrics, passthrough });
      const evt = event({ tenantId: 'tenant-alpha', customerId: 'cust-42' });
      await withPassthrough.record(evt);
      expect(captured).toHaveLength(1);
      expect(captured[0]?.tenantId).toBe('tenant-alpha');
      expect(captured[0]?.customerId).toBe('cust-42');
    });
  });
});
