/**
 * HeartbeatEmitter — Periodic health beacon emitter.
 *
 * Emits a HealthBeacon to Core every HEARTBEAT_INTERVAL_MS (30s).
 * Tracks consecutive failures, degrades status after CONSECUTIVE_FAIL_DEGRADE
 * failures, and surfaces the limb's health state for local monitoring.
 *
 * TypeScript port of synex_kernel/health/heartbeat.py
 *
 * RULE 10 (Infrastructure): Real-time health monitoring required.
 */

import {
  CONSECUTIVE_FAIL_DEGRADE,
  CONSECUTIVE_FAIL_WARN,
  HEARTBEAT_INTERVAL_MS,
} from './constants.js';
import type { DiodeClient } from './diode-client.js';
import type { HealthBeacon, HealthStatus } from './types.js';

export type HealthCollector = () => Omit<HealthBeacon, 'limb_id' | 'timestamp'>;

export interface HeartbeatOptions {
  intervalMs?: number;
}

export class HeartbeatEmitter {
  private _running = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _consecutiveFailures = 0;
  private _degraded = false;
  private _startedAt: Date | null = null;
  private _lastBeaconAt: Date | null = null;
  private _lastError: Error | null = null;
  private readonly _intervalMs: number;

  constructor(
    private readonly _limbId: string,
    private readonly _collectFn: HealthCollector,
    private readonly _diode: DiodeClient,
    opts: HeartbeatOptions = {},
  ) {
    this._intervalMs = opts.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  }

  get isRunning(): boolean {
    return this._running;
  }

  get isDegraded(): boolean {
    return this._degraded;
  }

  get lastBeaconAt(): Date | null {
    return this._lastBeaconAt;
  }

  get lastError(): Error | null {
    return this._lastError;
  }

  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  get uptimeSeconds(): number {
    return this._startedAt !== null ? (Date.now() - this._startedAt.getTime()) / 1_000 : 0;
  }

  /** Start the heartbeat loop. No-op if already running. */
  start(): void {
    if (this._running) return;
    this._running = true;
    this._startedAt = new Date();
    this._scheduleNext(0);
  }

  /** Stop the heartbeat loop gracefully. */
  stop(): void {
    this._running = false;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _scheduleNext(delayMs: number): void {
    this._timer = setTimeout(() => {
      void this._emit();
    }, delayMs);
  }

  private async _emit(): Promise<void> {
    if (!this._running) return;

    try {
      const collected = this._collectFn();
      const beacon: HealthBeacon = {
        limb_id: this._limbId,
        timestamp: new Date().toISOString(),
        ...collected,
      };
      await this._diode.sendHealthBeacon(beacon);
      this._lastBeaconAt = new Date();
      this._lastError = null;
      this._consecutiveFailures = 0;
      this._degraded = false;
    } catch (err) {
      this._consecutiveFailures++;
      this._lastError = err instanceof Error ? err : new Error(String(err));

      if (this._consecutiveFailures >= CONSECUTIVE_FAIL_DEGRADE && !this._degraded) {
        this._degraded = true;
        console.error(
          JSON.stringify({
            level: 'error',
            component: 'kernel-heartbeat',
            event: 'heartbeat_degraded',
            limbId: this._limbId,
            consecutiveFailures: this._consecutiveFailures,
          }),
        );
      } else if (this._consecutiveFailures >= CONSECUTIVE_FAIL_WARN) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            component: 'kernel-heartbeat',
            event: 'heartbeat_failures',
            limbId: this._limbId,
            consecutiveFailures: this._consecutiveFailures,
          }),
        );
      }
    }

    // `stop()` may have been called while awaiting the diode send above.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this._running) {
      this._scheduleNext(this._intervalMs);
    }
  }

  /** Current health status derived from failure state. */
  get status(): HealthStatus {
    if (this._degraded) return 'degraded';
    return 'alive';
  }
}
