import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BudgetAllocationReceiver } from '../budget-allocation-receiver.js';
import { BudgetTracker } from '../budget-tracker.js';
import type { LimbIdentity, SignedHeaders } from '../identity.js';
import type { BudgetAllocation } from '../types.js';

const LIMB_ID = 'test-limb-001';
const CORE_URL = 'https://core.test.local:8100';

function makeIdentity(limbId = LIMB_ID): LimbIdentity {
  return {
    limbId,
    signRequest: vi.fn().mockResolvedValue({
      'X-Synex-Limb-Id': limbId,
      'X-Synex-Timestamp': '2026-04-18T00:00:00Z',
      'X-Synex-Signature': 'aa'.repeat(64),
    } satisfies SignedHeaders),
  } as unknown as LimbIdentity;
}

function allocationResponse(alloc: BudgetAllocation, status = 200): Response {
  return new Response(JSON.stringify(alloc), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BudgetAllocationReceiver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts as not running', () => {
    const r = new BudgetAllocationReceiver(makeIdentity(), new BudgetTracker(), CORE_URL);
    expect(r.isRunning).toBe(false);
  });

  it('start() sets isRunning; stop() clears it', () => {
    const r = new BudgetAllocationReceiver(makeIdentity(), new BudgetTracker(), CORE_URL, {
      intervalMs: 100,
    });
    r.start();
    expect(r.isRunning).toBe(true);
    r.stop();
    expect(r.isRunning).toBe(false);
  });

  it('does NOT poll immediately — first tick fires after intervalMs', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(allocationResponse({ limb_id: LIMB_ID, epoch: 1, budget: 1000 }));
    const r = new BudgetAllocationReceiver(makeIdentity(), new BudgetTracker(), CORE_URL, {
      intervalMs: 500,
    });
    r.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('start() is idempotent — second call does not schedule duplicate tick', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(allocationResponse({ limb_id: LIMB_ID, epoch: 1, budget: 1000 }));
    const r = new BudgetAllocationReceiver(makeIdentity(), new BudgetTracker(), CORE_URL, {
      intervalMs: 200,
    });
    r.start();
    r.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('applies a fetched allocation to the tracker', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      allocationResponse({ limb_id: LIMB_ID, epoch: 7, budget: 5000 }),
    );
    const tracker = new BudgetTracker();
    const r = new BudgetAllocationReceiver(makeIdentity(), tracker, CORE_URL, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(tracker.epoch).toBe(7);
    expect(tracker.total).toBe(5000);
    expect(tracker.isTracking).toBe(true);
    expect(r.lastAppliedEpoch).toBe(7);
    r.stop();
  });

  it('signs the request with identity headers', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(allocationResponse({ limb_id: LIMB_ID, epoch: 1, budget: 100 }));
    const identity = makeIdentity();
    const r = new BudgetAllocationReceiver(identity, new BudgetTracker(), CORE_URL, {
      intervalMs: 50,
    });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${CORE_URL}/limbs/${LIMB_ID}/allocations/current`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-Synex-Limb-Id': LIMB_ID,
          'X-Synex-Signature': expect.any(String),
        }),
      }),
    );
    r.stop();
  });

  it('treats 404 as no-allocation — tracker stays at sentinel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const tracker = new BudgetTracker();
    const r = new BudgetAllocationReceiver(makeIdentity(), tracker, CORE_URL, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(tracker.isTracking).toBe(false);
    expect(tracker.remaining).toBe(1.0); // sentinel
    expect(r.lastAppliedEpoch).toBeNull();
    expect(r.consecutiveFailures).toBe(0); // 404 is not a failure
    r.stop();
  });

  it('increments consecutiveFailures on 500; keeps running', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const r = new BudgetAllocationReceiver(makeIdentity(), new BudgetTracker(), CORE_URL, {
      intervalMs: 50,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected warn log during failure path
    });
    r.start();
    await vi.advanceTimersByTimeAsync(175);
    expect(r.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(r.isRunning).toBe(true);
    warnSpy.mockRestore();
    r.stop();
  });

  it('rejects allocation for a different limb_id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      allocationResponse({ limb_id: 'other-limb', epoch: 1, budget: 100 }),
    );
    const tracker = new BudgetTracker();
    const r = new BudgetAllocationReceiver(makeIdentity(), tracker, CORE_URL, { intervalMs: 50 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected warn log
    });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(tracker.isTracking).toBe(false);
    expect(r.lastError?.message).toMatch(/wrong limb/);
    warnSpy.mockRestore();
    r.stop();
  });

  it('rejects malformed allocation JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ epoch: 'not-a-number' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const tracker = new BudgetTracker();
    const r = new BudgetAllocationReceiver(makeIdentity(), tracker, CORE_URL, { intervalMs: 50 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected warn log
    });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(tracker.isTracking).toBe(false);
    expect(r.lastError?.message).toMatch(/malformed/i);
    warnSpy.mockRestore();
    r.stop();
  });

  it('resets consecutiveFailures after a successful poll', async () => {
    let fail = true;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          fail
            ? new Response('x', { status: 500 })
            : allocationResponse({ limb_id: LIMB_ID, epoch: 1, budget: 100 }),
        ),
      );
    const r = new BudgetAllocationReceiver(makeIdentity(), new BudgetTracker(), CORE_URL, {
      intervalMs: 50,
    });
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
    expect(fetchSpy).toHaveBeenCalled();
    r.stop();
  });

  it('stop() prevents further ticks even while a fetch is in-flight', async () => {
    let resolveFetch: (r: Response) => void = () => {
      /* set below */
    };
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => pending);
    const r = new BudgetAllocationReceiver(makeIdentity(), new BudgetTracker(), CORE_URL, {
      intervalMs: 50,
    });
    r.start();
    await vi.advanceTimersByTimeAsync(60);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    r.stop();
    resolveFetch(allocationResponse({ limb_id: LIMB_ID, epoch: 1, budget: 100 }));
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('idempotently reapplies same allocation — consumed stays unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      allocationResponse({ limb_id: LIMB_ID, epoch: 3, budget: 1000 }),
    );
    const tracker = new BudgetTracker();
    tracker.setAllocation({ limb_id: LIMB_ID, epoch: 3, budget: 1000 });
    tracker.consume(400);
    expect(tracker.consumed).toBe(400);
    const r = new BudgetAllocationReceiver(makeIdentity(), tracker, CORE_URL, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(tracker.consumed).toBe(400); // same epoch+budget → no reset
    r.stop();
  });
});
