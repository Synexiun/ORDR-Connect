/**
 * BudgetAllocationReceiver — Periodic downward poll for Core's BudgetAllocation.
 *
 * The Synex diode is physically one-way (limb → Core for writes). Downward
 * commands from Core — BudgetAllocation, IdentityCommand, PolicyDelivery — are
 * delivered via a separate pull channel. This receiver polls
 * `GET {coreUrl}/limbs/{limbId}/allocations/current` on a cadence and applies
 * any returned allocation to the BudgetTracker.
 *
 * TypeScript port of synex_kernel/budget/receiver.py
 *
 * Wire contract:
 *   Request:  GET, signed headers (X-Synex-Limb-Id / X-Synex-Timestamp / X-Synex-Signature)
 *   Response 200: BudgetAllocation JSON { epoch, budget, limb_id }
 *   Response 404: no current allocation for this limb — silently skipped
 *   Response 4xx/5xx: logged, retried on next tick
 *
 * Idempotent: BudgetTracker.setAllocation is a no-op on retransmit of the same
 * epoch+budget, so repeated polls are safe even when Core hasn't rotated the
 * epoch.
 *
 * Does NOT drive a health-level failure state — HeartbeatEmitter already
 * surfaces Core-unreachable via its degradation logic; duplicating here would
 * double-alert on the same root cause.
 *
 * RULE 9 (Agent Safety): Closes the bidirectional budget loop so
 *                        `consume()` has real budgets to deplete.
 */

import { BUDGET_ALLOCATION_POLL_INTERVAL_MS } from './constants.js';
import type { LimbIdentity } from './identity.js';
import type { BudgetTracker } from './budget-tracker.js';
import type { BudgetAllocation } from './types.js';

export interface BudgetAllocationReceiverOptions {
  /** Poll cadence in milliseconds. Default: BUDGET_ALLOCATION_POLL_INTERVAL_MS (60s). */
  intervalMs?: number;
  /** Request timeout in milliseconds. Default: 10_000. */
  timeoutMs?: number;
}

export class BudgetAllocationReceiver {
  private _running = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _lastPollAt: Date | null = null;
  private _lastAppliedEpoch: number | null = null;
  private _lastError: Error | null = null;
  private _consecutiveFailures = 0;
  private readonly _intervalMs: number;
  private readonly _timeoutMs: number;

  constructor(
    private readonly _identity: LimbIdentity,
    private readonly _tracker: BudgetTracker,
    private readonly _coreUrl: string,
    opts: BudgetAllocationReceiverOptions = {},
  ) {
    this._intervalMs = opts.intervalMs ?? BUDGET_ALLOCATION_POLL_INTERVAL_MS;
    this._timeoutMs = opts.timeoutMs ?? 10_000;
  }

  get isRunning(): boolean {
    return this._running;
  }

  get lastPollAt(): Date | null {
    return this._lastPollAt;
  }

  get lastAppliedEpoch(): number | null {
    return this._lastAppliedEpoch;
  }

  get lastError(): Error | null {
    return this._lastError;
  }

  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  /**
   * Start the poll loop. First tick fires after intervalMs — not immediately —
   * so that Core has time to observe the limb's registration + heartbeat before
   * being asked for an allocation.
   */
  start(): void {
    if (this._running) return;
    this._running = true;
    this._scheduleNext(this._intervalMs);
  }

  /** Stop the poll loop gracefully. */
  stop(): void {
    this._running = false;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _scheduleNext(delayMs: number): void {
    this._timer = setTimeout(() => {
      void this._poll();
    }, delayMs);
  }

  private async _poll(): Promise<void> {
    if (!this._running) return;

    try {
      const allocation = await this._fetchAllocation();
      if (allocation !== null) {
        this._tracker.setAllocation(allocation);
        this._lastAppliedEpoch = allocation.epoch;
      }
      this._lastPollAt = new Date();
      this._lastError = null;
      this._consecutiveFailures = 0;
    } catch (err) {
      this._consecutiveFailures++;
      this._lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        JSON.stringify({
          level: 'warn',
          component: 'kernel-budget-allocation-receiver',
          event: 'allocation_poll_failed',
          limbId: this._identity.limbId,
          consecutiveFailures: this._consecutiveFailures,
          error: this._lastError.message,
        }),
      );
    }

    // `stop()` may have fired while awaiting the fetch above.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this._running) {
      this._scheduleNext(this._intervalMs);
    }
  }

  /**
   * Fetch the current allocation from Core.
   * Returns `null` when Core responds 404 (no allocation yet).
   * Throws on network errors, auth failures, or 5xx.
   */
  private async _fetchAllocation(): Promise<BudgetAllocation | null> {
    const url = `${this._coreUrl}/limbs/${this._identity.limbId}/allocations/current`;
    const headers = await this._identity.signRequest();

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this._timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...headers,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Core rejected allocation poll: HTTP ${response.status.toString()} ${body.slice(0, 200)}`,
      );
    }

    const parsed: unknown = await response.json();
    if (!this._isValidAllocation(parsed)) {
      throw new Error('Core returned malformed BudgetAllocation');
    }

    if (parsed.limb_id !== this._identity.limbId) {
      throw new Error(
        `Core returned allocation for wrong limb: ${parsed.limb_id} (expected ${this._identity.limbId})`,
      );
    }

    return parsed;
  }

  private _isValidAllocation(x: unknown): x is BudgetAllocation {
    if (typeof x !== 'object' || x === null) return false;
    const r = x as Record<string, unknown>;
    return (
      typeof r['epoch'] === 'number' &&
      Number.isFinite(r['epoch']) &&
      typeof r['budget'] === 'number' &&
      Number.isFinite(r['budget']) &&
      typeof r['limb_id'] === 'string'
    );
  }
}
