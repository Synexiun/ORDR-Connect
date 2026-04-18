import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BudgetReporter } from '../budget-reporter.js';
import { BudgetTracker } from '../budget-tracker.js';
import type { DiodeClient } from '../diode-client.js';
import type { BudgetReport } from '../types.js';

const LIMB_ID = 'test-limb-001';

function makeDiode(sendFn = vi.fn().mockResolvedValue({ accepted: true })) {
  return { sendBudgetReport: sendFn } as unknown as DiodeClient;
}

describe('BudgetReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts as not running', () => {
    const tracker = new BudgetTracker();
    const r = new BudgetReporter(LIMB_ID, tracker, makeDiode());
    expect(r.isRunning).toBe(false);
  });

  it('start() sets isRunning; stop() clears it', () => {
    const tracker = new BudgetTracker();
    const r = new BudgetReporter(LIMB_ID, tracker, makeDiode(), { intervalMs: 100 });
    r.start();
    expect(r.isRunning).toBe(true);
    r.stop();
    expect(r.isRunning).toBe(false);
  });

  it('does NOT emit immediately — first tick fires after intervalMs', async () => {
    const diode = makeDiode();
    const r = new BudgetReporter(LIMB_ID, new BudgetTracker(), diode, { intervalMs: 500 });
    r.start();
    await vi.advanceTimersByTimeAsync(100);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(diode.sendBudgetReport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(diode.sendBudgetReport).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('start() is idempotent — second call does not schedule a duplicate tick', async () => {
    const diode = makeDiode();
    const r = new BudgetReporter(LIMB_ID, new BudgetTracker(), diode, { intervalMs: 200 });
    r.start();
    r.start();
    await vi.advanceTimersByTimeAsync(250);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(diode.sendBudgetReport).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('emits again after each intervalMs', async () => {
    const diode = makeDiode();
    const r = new BudgetReporter(LIMB_ID, new BudgetTracker(), diode, { intervalMs: 100 });
    r.start();
    await vi.advanceTimersByTimeAsync(350);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(diode.sendBudgetReport).toHaveBeenCalledTimes(3);
    r.stop();
  });

  it('sends a wire-compatible BudgetReport shape', async () => {
    const diode = makeDiode();
    const tracker = new BudgetTracker();
    tracker.setAllocation({ epoch: 5, budget: 1000, limb_id: LIMB_ID });
    tracker.consume(250);
    const r = new BudgetReporter(LIMB_ID, tracker, diode, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    const report = (
      (diode.sendBudgetReport as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
    )[0] as BudgetReport;
    expect(report.limb_id).toBe(LIMB_ID);
    expect(report.epoch).toBe(5);
    expect(report.consumed).toBe(250);
    expect(report.remaining).toBe(750);
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    r.stop();
  });

  it('emits sentinel shape when tracker has no allocation', async () => {
    const diode = makeDiode();
    const r = new BudgetReporter(LIMB_ID, new BudgetTracker(), diode, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    const report = (
      (diode.sendBudgetReport as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
    )[0] as BudgetReport;
    expect(report.epoch).toBe(0);
    expect(report.consumed).toBe(0);
    expect(report.remaining).toBe(1.0);
    r.stop();
  });

  it('increments consecutiveFailures on diode error; stays running', async () => {
    const diode = makeDiode(vi.fn().mockRejectedValue(new Error('core unreachable')));
    const r = new BudgetReporter(LIMB_ID, new BudgetTracker(), diode, { intervalMs: 50 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected warn log during failure path
    });
    r.start();
    await vi.advanceTimersByTimeAsync(175);
    expect(r.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(r.lastError?.message).toBe('core unreachable');
    expect(r.isRunning).toBe(true); // must keep retrying
    warnSpy.mockRestore();
    r.stop();
  });

  it('resets consecutiveFailures on successful emit', async () => {
    let fail = true;
    const sendFn = vi
      .fn()
      .mockImplementation(() =>
        fail ? Promise.reject(new Error('x')) : Promise.resolve({ accepted: true }),
      );
    const diode = makeDiode(sendFn);
    const r = new BudgetReporter(LIMB_ID, new BudgetTracker(), diode, { intervalMs: 50 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress warn log during failure path
    });
    r.start();
    await vi.advanceTimersByTimeAsync(175);
    expect(r.consecutiveFailures).toBeGreaterThanOrEqual(2);
    fail = false;
    await vi.advanceTimersByTimeAsync(60);
    expect(r.consecutiveFailures).toBe(0);
    expect(r.lastError).toBeNull();
    warnSpy.mockRestore();
    r.stop();
  });

  it('stop() prevents further ticks even if a send is in-flight', async () => {
    let resolveSend: () => void = () => {
      /* set below */
    };
    const pending = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const diode = makeDiode(
      vi.fn().mockImplementation(() => pending.then(() => ({ accepted: true }))),
    );
    const r = new BudgetReporter(LIMB_ID, new BudgetTracker(), diode, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(60);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(diode.sendBudgetReport).toHaveBeenCalledTimes(1);
    r.stop();
    resolveSend();
    await vi.advanceTimersByTimeAsync(200);
    // Must not have fired another tick — running flag guards reschedule
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(diode.sendBudgetReport).toHaveBeenCalledTimes(1);
  });
});
