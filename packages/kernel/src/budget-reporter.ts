/**
 * BudgetReporter — Periodic budget consumption report emitter.
 *
 * Emits a BudgetReport to Core every BUDGET_REPORT_INTERVAL_MS (300s / 5min).
 * Unlike HeartbeatEmitter, the reporter does NOT drive a health status —
 * diode failures are already surfaced by the heartbeat's degradation state,
 * so duplicating that logic here would cause double-alerting on the same
 * root cause (Core unreachable).
 *
 * TypeScript port of synex_kernel/budget/reporter.py
 *
 * RULE 9 (Agent Safety): Budget telemetry is mandatory for cost enforcement.
 */

import { BUDGET_REPORT_INTERVAL_MS } from './constants.js';
import type { BudgetTracker } from './budget-tracker.js';
import type { DiodeClient } from './diode-client.js';

export interface BudgetReporterOptions {
  intervalMs?: number;
}

export class BudgetReporter {
  private _running = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _lastReportAt: Date | null = null;
  private _lastError: Error | null = null;
  private _consecutiveFailures = 0;
  private readonly _intervalMs: number;

  constructor(
    private readonly _limbId: string,
    private readonly _tracker: BudgetTracker,
    private readonly _diode: DiodeClient,
    opts: BudgetReporterOptions = {},
  ) {
    this._intervalMs = opts.intervalMs ?? BUDGET_REPORT_INTERVAL_MS;
  }

  get isRunning(): boolean {
    return this._running;
  }

  get lastReportAt(): Date | null {
    return this._lastReportAt;
  }

  get lastError(): Error | null {
    return this._lastError;
  }

  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  /**
   * Start the reporter loop. First tick fires after intervalMs (not immediately)
   * to avoid flooding Core at startup when budgets are still being negotiated.
   */
  start(): void {
    if (this._running) return;
    this._running = true;
    this._scheduleNext(this._intervalMs);
  }

  /** Stop the reporter loop gracefully. */
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
      const report = this._tracker.buildReport(this._limbId);
      await this._diode.sendBudgetReport(report);
      this._lastReportAt = new Date();
      this._lastError = null;
      this._consecutiveFailures = 0;
    } catch (err) {
      this._consecutiveFailures++;
      this._lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        JSON.stringify({
          level: 'warn',
          component: 'kernel-budget-reporter',
          event: 'budget_report_failed',
          limbId: this._limbId,
          consecutiveFailures: this._consecutiveFailures,
          error: this._lastError.message,
        }),
      );
    }

    // `stop()` may have been called while awaiting the diode send above.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this._running) {
      this._scheduleNext(this._intervalMs);
    }
  }
}
