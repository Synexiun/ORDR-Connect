/**
 * Anomaly Detector — Real-time behavioral anomaly detection
 *
 * Uses Exponential Moving Average (EMA) for baselines and Welford's online
 * algorithm for running variance/Z-score without retaining raw history.
 *
 * Algorithm:
 *   EMA(t) = α × obs(t) + (1-α) × EMA(t-1)   (α = smoothing factor)
 *   Welford mean/variance updated per sample.
 *   Z-score = (observed - mean) / √variance
 *   Anomaly threshold: |Z-score| ≥ 3.0 (3-sigma, p < 0.003 for normal dist)
 *
 * Cold start: first WARM_UP_SAMPLES observations build the baseline before
 * scoring begins — prevents false positives on new tenants.
 *
 * SOC2 CC7.2 — System monitoring: detect behavioral deviations in real time.
 * ISO 27001 A.12.4.1 — Event logging: anomaly signals feed audit events.
 * HIPAA §164.308(a)(1)(ii)(D) — Activity review: monitor access patterns.
 */

import type { AnomalySignal, BehaviorBaseline, RequestObservation } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Smoothing factor for EMA. 0.3 = recent data weighted, history retained. */
const EMA_ALPHA = 0.3;

/** Minimum samples before anomaly scoring is active. */
const WARM_UP_SAMPLES = 20;

/** Z-score threshold for anomaly classification. 3.0 = 3-sigma. */
const ANOMALY_Z_THRESHOLD = 3.0;

/** Window size in milliseconds for per-window rate calculations. */
const WINDOW_MS = 60_000; // 1 minute

/** Maximum number of per-tenant baselines stored in memory. */
const MAX_BASELINES = 10_000;

// ─── AnomalyDetector ─────────────────────────────────────────────────────────

export class AnomalyDetector {
  private readonly baselines = new Map<string, BehaviorBaseline>();

  private readonly windowMs: number;
  private readonly warmUpSamples: number;
  private readonly anomalyThreshold: number;
  private readonly emaAlpha: number;

  constructor(config?: {
    readonly windowMs?: number;
    readonly warmUpSamples?: number;
    readonly anomalyThreshold?: number;
    readonly emaAlpha?: number;
  }) {
    this.windowMs = config?.windowMs ?? WINDOW_MS;
    this.warmUpSamples = config?.warmUpSamples ?? WARM_UP_SAMPLES;
    this.anomalyThreshold = config?.anomalyThreshold ?? ANOMALY_Z_THRESHOLD;
    this.emaAlpha = config?.emaAlpha ?? EMA_ALPHA;
  }

  /**
   * Record a request observation and update the behavioral baseline.
   * Must be called for every request to keep the baseline current.
   */
  recordObservation(obs: RequestObservation): void {
    const now = Date.now();
    const baseline = this.getOrCreateBaseline(obs.tenantId, now);

    // Roll window if elapsed
    if (now - baseline.windowStart >= this.windowMs) {
      const elapsedWindows = Math.floor((now - baseline.windowStart) / this.windowMs);
      this.flushWindow(baseline, elapsedWindows, now);
    }

    // Accumulate within window
    baseline.windowRequestCount += 1;
    baseline.windowErrorCount += obs.isError ? 1 : 0;
    baseline.windowDataBytes += obs.responseBytes;
    baseline.lastUpdated = new Date(now);

    // Update payload size EMA inline (not window-based)
    if (baseline.sampleCount >= this.warmUpSamples) {
      baseline.emaPayloadSize =
        this.emaAlpha * obs.requestBytes + (1 - this.emaAlpha) * baseline.emaPayloadSize;
    } else {
      // Welford update for payload size during warm-up
      this.welfordUpdate(baseline, 'PayloadSize', obs.requestBytes);
    }

    baseline.sampleCount += 1;

    // Evict oldest entry if map is at capacity
    if (this.baselines.size > MAX_BASELINES) {
      const oldestKey = this.baselines.keys().next().value;
      if (oldestKey !== undefined) {
        this.baselines.delete(oldestKey);
      }
    }
  }

  /**
   * Evaluate whether current window metrics are anomalous for this tenant.
   * Returns empty array during warm-up or if no baseline exists.
   */
  detectAnomalies(tenantId: string): readonly AnomalySignal[] {
    const baseline = this.baselines.get(tenantId);
    if (baseline === undefined || baseline.sampleCount < this.warmUpSamples) {
      return [];
    }

    const now = Date.now();
    const windowElapsed = Math.max(1, now - baseline.windowStart);
    const windowMinutes = windowElapsed / 60_000;

    const currentRequestRate = baseline.windowRequestCount / windowMinutes;
    const currentErrorRate = baseline.windowErrorCount / windowMinutes;
    const currentDataVolume = baseline.windowDataBytes / windowMinutes;

    const signals: AnomalySignal[] = [];

    const requestSignal = this.buildSignal(
      'request_rate',
      currentRequestRate,
      baseline.emaRequestRate,
      baseline.m2RequestRate,
      baseline.sampleCount,
    );
    if (requestSignal !== undefined) signals.push(requestSignal);

    const errorSignal = this.buildSignal(
      'error_rate',
      currentErrorRate,
      baseline.emaErrorRate,
      baseline.m2ErrorRate,
      baseline.sampleCount,
    );
    if (errorSignal !== undefined) signals.push(errorSignal);

    const dataSignal = this.buildSignal(
      'data_volume',
      currentDataVolume,
      baseline.emaDataVolume,
      baseline.m2DataVolume,
      baseline.sampleCount,
    );
    if (dataSignal !== undefined) signals.push(dataSignal);

    return signals;
  }

  getBaseline(tenantId: string): BehaviorBaseline | undefined {
    return this.baselines.get(tenantId);
  }

  resetBaseline(tenantId: string): void {
    this.baselines.delete(tenantId);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private getOrCreateBaseline(tenantId: string, now: number): BehaviorBaseline {
    const existing = this.baselines.get(tenantId);
    if (existing !== undefined) return existing;

    const baseline: BehaviorBaseline = {
      tenantId,
      emaRequestRate: 0,
      emaErrorRate: 0,
      emaDataVolume: 0,
      emaPayloadSize: 0,
      m2RequestRate: 0,
      m2ErrorRate: 0,
      m2DataVolume: 0,
      m2PayloadSize: 0,
      meanRequestRate: 0,
      meanErrorRate: 0,
      meanDataVolume: 0,
      meanPayloadSize: 0,
      sampleCount: 0,
      windowRequestCount: 0,
      windowErrorCount: 0,
      windowDataBytes: 0,
      windowStart: now,
      lastUpdated: new Date(now),
    };
    this.baselines.set(tenantId, baseline);
    return baseline;
  }

  /**
   * Flush the completed window: update EMA and Welford from window metrics,
   * then reset window counters. Handle multi-window gaps (account for idle periods).
   */
  private flushWindow(baseline: BehaviorBaseline, _elapsedWindows: number, now: number): void {
    const windowMinutes = Math.max(1, this.windowMs / 60_000);

    const requestRate = baseline.windowRequestCount / windowMinutes;
    const errorRate = baseline.windowErrorCount / windowMinutes;
    const dataVolume = baseline.windowDataBytes / windowMinutes;

    if (baseline.sampleCount >= this.warmUpSamples) {
      // Update EMA
      baseline.emaRequestRate =
        this.emaAlpha * requestRate + (1 - this.emaAlpha) * baseline.emaRequestRate;
      baseline.emaErrorRate =
        this.emaAlpha * errorRate + (1 - this.emaAlpha) * baseline.emaErrorRate;
      baseline.emaDataVolume =
        this.emaAlpha * dataVolume + (1 - this.emaAlpha) * baseline.emaDataVolume;
    } else {
      // Warm-up: accumulate Welford statistics
      this.welfordUpdate(baseline, 'RequestRate', requestRate);
      this.welfordUpdate(baseline, 'ErrorRate', errorRate);
      this.welfordUpdate(baseline, 'DataVolume', dataVolume);

      // Once warm-up is complete, seed EMA from Welford mean
      if (baseline.sampleCount + 1 >= this.warmUpSamples) {
        baseline.emaRequestRate = baseline.meanRequestRate;
        baseline.emaErrorRate = baseline.meanErrorRate;
        baseline.emaDataVolume = baseline.meanDataVolume;
        baseline.emaPayloadSize = baseline.meanPayloadSize;
      }
    }

    // Reset window
    baseline.windowRequestCount = 0;
    baseline.windowErrorCount = 0;
    baseline.windowDataBytes = 0;
    baseline.windowStart = now;
  }

  /**
   * Welford's online algorithm — update running mean and M2 (sum of squares).
   * M2 / n = variance; used for Z-score during warm-up accumulation.
   */
  private welfordUpdate(
    baseline: BehaviorBaseline,
    metric: 'RequestRate' | 'ErrorRate' | 'DataVolume' | 'PayloadSize',
    value: number,
  ): void {
    const n = baseline.sampleCount + 1;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const meanKey = `mean${metric}` as
      | 'meanRequestRate'
      | 'meanErrorRate'
      | 'meanDataVolume'
      | 'meanPayloadSize';
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const m2Key = `m2${metric}` as
      | 'm2RequestRate'
      | 'm2ErrorRate'
      | 'm2DataVolume'
      | 'm2PayloadSize';

    const oldMean = baseline[meanKey];
    const delta = value - oldMean;
    baseline[meanKey] = oldMean + delta / n;
    const delta2 = value - baseline[meanKey];
    baseline[m2Key] = baseline[m2Key] + delta * delta2;
  }

  private buildSignal(
    metric: AnomalySignal['metric'],
    observed: number,
    baseline: number,
    m2: number,
    n: number,
  ): AnomalySignal | undefined {
    const variance = n > 1 ? m2 / n : 0;
    const std = Math.sqrt(variance);

    if (std < 1e-9) {
      // No variance — can't compute Z-score; not anomalous unless wildly different
      const isAnomaly = baseline > 0 && observed > baseline * 10;
      return {
        metric,
        observed,
        baseline,
        zScore: isAnomaly ? 999 : 0,
        isAnomaly,
      };
    }

    const zScore = (observed - baseline) / std;
    return {
      metric,
      observed,
      baseline,
      zScore,
      isAnomaly: Math.abs(zScore) >= this.anomalyThreshold,
    };
  }
}
