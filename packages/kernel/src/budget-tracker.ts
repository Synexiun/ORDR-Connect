/**
 * BudgetTracker — Per-epoch budget consumption ledger for a limb.
 *
 * Core (the Synexiun authority) pushes a `BudgetAllocation` downward each epoch
 * via the policy channel. The limb consumes from it throughout the epoch (LLM
 * tokens, API calls, work units — the kernel is protocol-neutral about units)
 * and periodically reports back via `BudgetReport` on the upward diode.
 *
 * TypeScript port of synex_kernel/budget/tracker.py
 *
 * Wire compatibility:
 *   When no allocation has been received (fresh boot, no pushdown yet), the
 *   tracker reports `remaining=1, total=1` as a sentinel. This matches the
 *   Python kernel's current behavior and prevents false-positive `draining`
 *   status before Core has made its first allocation.
 *
 * RULE 9 (Agent Safety): Agent budgets enforce token/action/cost limits.
 * CLAUDE.md: "Agent budgets: Token limits, action limits, cost limits per execution."
 */

import type { BudgetAllocation, BudgetReport } from './types.js';
import { BUDGET_DEGRADED_THRESHOLD } from './constants.js';

export class BudgetTracker {
  private _epoch = 0;
  private _total = 0;
  private _consumed = 0;

  /**
   * Apply a new allocation from Core. Resets consumption for the new epoch.
   *
   * Idempotent for the same epoch — reapplying an allocation with the same
   * epoch+budget leaves state unchanged. Applying a new epoch resets consumed
   * to zero.
   */
  setAllocation(alloc: BudgetAllocation): void {
    if (alloc.budget < 0) {
      throw new RangeError(
        `BudgetTracker: allocation budget must be >= 0 (got ${String(alloc.budget)})`,
      );
    }
    if (alloc.epoch < 0) {
      throw new RangeError(
        `BudgetTracker: allocation epoch must be >= 0 (got ${String(alloc.epoch)})`,
      );
    }

    // Same epoch + same budget → no-op (defensive idempotency on retransmit)
    if (this._epoch === alloc.epoch && this._total === alloc.budget) {
      return;
    }

    this._epoch = alloc.epoch;
    this._total = alloc.budget;
    this._consumed = 0;
  }

  /**
   * Record consumption against the current allocation.
   *
   * Clamped at `_total` — attempts to consume past the allocation are capped
   * rather than rejected, so the tracker always reports a valid
   * `remaining >= 0`. Callers that need to gate on exhaustion should check
   * `isExhausted` before dispatching the operation.
   *
   * Negative amounts are rejected — use a fresh allocation to reset.
   */
  consume(amount: number): void {
    if (!Number.isFinite(amount)) {
      throw new RangeError(`BudgetTracker: consume amount must be finite (got ${String(amount)})`);
    }
    if (amount < 0) {
      throw new RangeError(`BudgetTracker: consume amount must be >= 0 (got ${String(amount)})`);
    }

    // Silently no-op when untracked — caller should have no-cost path available
    if (this._total === 0) return;

    this._consumed = Math.min(this._total, this._consumed + amount);
  }

  /** True once Core has pushed down at least one allocation with budget > 0. */
  get isTracking(): boolean {
    return this._total > 0;
  }

  /** Current epoch. Zero before first allocation. */
  get epoch(): number {
    return this._epoch;
  }

  /**
   * Total budget for this epoch.
   * Returns sentinel `1.0` when not tracking (preserves Python wire behavior).
   */
  get total(): number {
    return this._total === 0 ? 1.0 : this._total;
  }

  /** Raw consumed units. Zero when not tracking. */
  get consumed(): number {
    return this._consumed;
  }

  /**
   * Remaining budget in the current epoch.
   * Returns sentinel `1.0` when not tracking (preserves Python wire behavior).
   */
  get remaining(): number {
    if (this._total === 0) return 1.0;
    return this._total - this._consumed;
  }

  /** Remaining as a ratio of total (0.0–1.0). `1.0` when not tracking. */
  get remainingRatio(): number {
    if (this._total === 0) return 1.0;
    return (this._total - this._consumed) / this._total;
  }

  /**
   * True when actively tracking AND remaining ratio has fallen below the
   * `BUDGET_DEGRADED_THRESHOLD` (default 0.1 = 10%). Drives the limb's
   * `draining` health status.
   *
   * Does NOT fire when `isTracking === false` — a fresh limb without
   * allocations is not draining, just idle.
   */
  get isDraining(): boolean {
    return this.isTracking && this.remainingRatio < BUDGET_DEGRADED_THRESHOLD;
  }

  /** True when the allocation is fully consumed. False when not tracking. */
  get isExhausted(): boolean {
    return this.isTracking && this._consumed >= this._total;
  }

  /**
   * Build an upward BudgetReport for the diode.
   * Called on the BUDGET_REPORT_INTERVAL_MS cadence by the reporting loop.
   */
  buildReport(limbId: string): BudgetReport {
    return {
      limb_id: limbId,
      epoch: this._epoch,
      consumed: this._consumed,
      remaining: this._total === 0 ? 1.0 : this._total - this._consumed,
      timestamp: new Date().toISOString(),
    };
  }
}
