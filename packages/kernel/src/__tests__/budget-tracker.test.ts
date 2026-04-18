import { describe, it, expect } from 'vitest';
import { BudgetTracker } from '../budget-tracker.js';
import { BUDGET_DEGRADED_THRESHOLD } from '../constants.js';

const LIMB_ID = 'synexcom-ordr-001';

describe('BudgetTracker', () => {
  describe('initial state (no allocation)', () => {
    it('starts with epoch 0 and not tracking', () => {
      const b = new BudgetTracker();
      expect(b.epoch).toBe(0);
      expect(b.isTracking).toBe(false);
      expect(b.consumed).toBe(0);
    });

    it('reports sentinel 1.0/1.0 before any allocation (wire compatibility)', () => {
      const b = new BudgetTracker();
      expect(b.total).toBe(1.0);
      expect(b.remaining).toBe(1.0);
      expect(b.remainingRatio).toBe(1.0);
    });

    it('is NOT draining when idle — fresh limb pre-allocation', () => {
      const b = new BudgetTracker();
      expect(b.isDraining).toBe(false);
      expect(b.isExhausted).toBe(false);
    });

    it('consume() is a no-op when not tracking', () => {
      const b = new BudgetTracker();
      b.consume(50);
      expect(b.consumed).toBe(0);
    });
  });

  describe('setAllocation', () => {
    it('activates tracking with provided epoch and budget', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 7, budget: 1000, limb_id: LIMB_ID });
      expect(b.isTracking).toBe(true);
      expect(b.epoch).toBe(7);
      expect(b.total).toBe(1000);
      expect(b.remaining).toBe(1000);
    });

    it('is idempotent on retransmit (same epoch + same budget)', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 500, limb_id: LIMB_ID });
      b.consume(100);
      // Retransmit — must NOT reset consumed
      b.setAllocation({ epoch: 1, budget: 500, limb_id: LIMB_ID });
      expect(b.consumed).toBe(100);
      expect(b.remaining).toBe(400);
    });

    it('resets consumed when epoch advances', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 500, limb_id: LIMB_ID });
      b.consume(300);
      b.setAllocation({ epoch: 2, budget: 500, limb_id: LIMB_ID });
      expect(b.epoch).toBe(2);
      expect(b.consumed).toBe(0);
      expect(b.remaining).toBe(500);
    });

    it('resets consumed when budget changes within same epoch', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 500, limb_id: LIMB_ID });
      b.consume(200);
      b.setAllocation({ epoch: 1, budget: 1000, limb_id: LIMB_ID });
      expect(b.consumed).toBe(0);
      expect(b.total).toBe(1000);
    });

    it('rejects negative budget', () => {
      const b = new BudgetTracker();
      expect(() => {
        b.setAllocation({ epoch: 1, budget: -1, limb_id: LIMB_ID });
      }).toThrow(RangeError);
    });

    it('rejects negative epoch', () => {
      const b = new BudgetTracker();
      expect(() => {
        b.setAllocation({ epoch: -1, budget: 100, limb_id: LIMB_ID });
      }).toThrow(RangeError);
    });

    it('accepts zero budget (allocation of 0 means no work permitted)', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 0, limb_id: LIMB_ID });
      expect(b.epoch).toBe(1);
      // _total is still 0, so sentinel applies
      expect(b.isTracking).toBe(false);
    });
  });

  describe('consume', () => {
    it('reduces remaining by the consumed amount', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 1000, limb_id: LIMB_ID });
      b.consume(250);
      expect(b.consumed).toBe(250);
      expect(b.remaining).toBe(750);
    });

    it('accumulates across multiple consume() calls', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 100, limb_id: LIMB_ID });
      b.consume(10);
      b.consume(20);
      b.consume(30);
      expect(b.consumed).toBe(60);
      expect(b.remaining).toBe(40);
    });

    it('clamps at total — overconsumption is capped, not rejected', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 100, limb_id: LIMB_ID });
      b.consume(200);
      expect(b.consumed).toBe(100);
      expect(b.remaining).toBe(0);
      expect(b.isExhausted).toBe(true);
    });

    it('rejects negative amount', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 100, limb_id: LIMB_ID });
      expect(() => {
        b.consume(-5);
      }).toThrow(RangeError);
    });

    it('rejects non-finite amount (NaN, Infinity)', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 100, limb_id: LIMB_ID });
      expect(() => {
        b.consume(Number.NaN);
      }).toThrow(RangeError);
      expect(() => {
        b.consume(Number.POSITIVE_INFINITY);
      }).toThrow(RangeError);
    });

    it('accepts fractional amounts (tokens are often fractional in cost)', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 10, limb_id: LIMB_ID });
      b.consume(0.5);
      b.consume(0.25);
      expect(b.consumed).toBe(0.75);
    });
  });

  describe('isDraining', () => {
    it(`fires when remaining ratio falls below ${BUDGET_DEGRADED_THRESHOLD.toString()}`, () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 100, limb_id: LIMB_ID });
      // 91% consumed → 9% remaining, below 10% threshold
      b.consume(91);
      expect(b.isDraining).toBe(true);
    });

    it('does NOT fire at exactly the threshold boundary', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 100, limb_id: LIMB_ID });
      // Exactly 10% remaining — predicate is strict `<`, so not draining yet
      b.consume(90);
      expect(b.remainingRatio).toBe(BUDGET_DEGRADED_THRESHOLD);
      expect(b.isDraining).toBe(false);
    });

    it('does NOT fire when not tracking (idle limb)', () => {
      const b = new BudgetTracker();
      // remainingRatio is 1.0 sentinel — below-threshold guard still blocks
      expect(b.isDraining).toBe(false);
    });

    it('fires when budget is fully consumed', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 1, budget: 100, limb_id: LIMB_ID });
      b.consume(100);
      expect(b.isExhausted).toBe(true);
      expect(b.isDraining).toBe(true);
    });
  });

  describe('buildReport', () => {
    it('returns a wire-compatible BudgetReport', () => {
      const b = new BudgetTracker();
      b.setAllocation({ epoch: 3, budget: 1000, limb_id: LIMB_ID });
      b.consume(400);

      const report = b.buildReport(LIMB_ID);
      expect(report.limb_id).toBe(LIMB_ID);
      expect(report.epoch).toBe(3);
      expect(report.consumed).toBe(400);
      expect(report.remaining).toBe(600);
      expect(typeof report.timestamp).toBe('string');
      // ISO 8601 shape sanity check
      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('reports sentinel 1.0 remaining when not tracking', () => {
      const b = new BudgetTracker();
      const report = b.buildReport(LIMB_ID);
      expect(report.epoch).toBe(0);
      expect(report.consumed).toBe(0);
      expect(report.remaining).toBe(1.0);
    });
  });
});
