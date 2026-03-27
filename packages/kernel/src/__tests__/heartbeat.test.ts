import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatEmitter } from '../heartbeat.js';
import type { DiodeClient } from '../diode-client.js';
import type { HealthBeacon } from '../types.js';
import { CONSECUTIVE_FAIL_DEGRADE, CONSECUTIVE_FAIL_WARN } from '../constants.js';

const LIMB_ID = 'test-limb-001';

function makeCollector(overrides: Partial<Omit<HealthBeacon, 'limb_id' | 'timestamp'>> = {}) {
  return () => ({
    status: 'alive' as const,
    budget_remaining: 0.9,
    budget_total: 1.0,
    epoch: 1,
    uptime_seconds: 0,
    ...overrides,
  });
}

function makeDiode(sendFn = vi.fn().mockResolvedValue({ accepted: true })) {
  return { sendHealthBeacon: sendFn } as unknown as DiodeClient;
}

describe('HeartbeatEmitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts as not running', () => {
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), makeDiode());
    expect(hb.isRunning).toBe(false);
  });

  it('start() sets isRunning', () => {
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), makeDiode());
    hb.start();
    expect(hb.isRunning).toBe(true);
    hb.stop();
  });

  it('stop() clears isRunning', () => {
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), makeDiode());
    hb.start();
    hb.stop();
    expect(hb.isRunning).toBe(false);
  });

  it('start() is a no-op if already running', () => {
    const diode = makeDiode();
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), diode, { intervalMs: 1_000 });
    hb.start();
    hb.start(); // second call — should not schedule an extra tick
    vi.advanceTimersByTime(1_100);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(diode.sendHealthBeacon).toHaveBeenCalledTimes(1);
    hb.stop();
  });

  it('emits a beacon immediately on start, then again after intervalMs', async () => {
    const diode = makeDiode();
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), diode, { intervalMs: 500 });
    hb.start();
    // First tick fires at 0ms (immediate), second at 500ms
    await vi.advanceTimersByTimeAsync(100);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(diode.sendHealthBeacon).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(450);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(diode.sendHealthBeacon).toHaveBeenCalledTimes(2);
    hb.stop();
  });

  it('sends beacon with limb_id and timestamp', async () => {
    const diode = makeDiode();
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), diode, { intervalMs: 100 });
    hb.start();
    await vi.advanceTimersByTimeAsync(150);
    const beacon = (
      (diode.sendHealthBeacon as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
    )[0] as HealthBeacon;
    expect(beacon.limb_id).toBe(LIMB_ID);
    expect(beacon.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    hb.stop();
  });

  it('resets consecutiveFailures on success', async () => {
    const diode = makeDiode();
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), diode, { intervalMs: 100 });
    hb.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(hb.consecutiveFailures).toBe(0);
    expect(hb.lastError).toBeNull();
    hb.stop();
  });

  it('increments consecutiveFailures on send error', async () => {
    const diode = makeDiode(vi.fn().mockRejectedValue(new Error('network error')));
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), diode, { intervalMs: 100 });
    hb.start();
    await vi.advanceTimersByTimeAsync(350);
    expect(hb.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(hb.lastError?.message).toBe('network error');
    hb.stop();
  });

  it(`marks degraded after ${CONSECUTIVE_FAIL_DEGRADE.toString()} consecutive failures`, async () => {
    const diode = makeDiode(vi.fn().mockRejectedValue(new Error('down')));
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), diode, { intervalMs: 10 });
    hb.start();
    await vi.advanceTimersByTimeAsync(10 * (CONSECUTIVE_FAIL_DEGRADE + 1));
    expect(hb.isDegraded).toBe(true);
    expect(hb.status).toBe('degraded');
    hb.stop();
  });

  it(`status is alive before ${CONSECUTIVE_FAIL_WARN.toString()} failures`, async () => {
    const diode = makeDiode(vi.fn().mockRejectedValue(new Error('x')));
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), diode, { intervalMs: 10 });
    hb.start();
    await vi.advanceTimersByTimeAsync(10 * (CONSECUTIVE_FAIL_WARN - 1));
    expect(hb.status).toBe('alive');
    hb.stop();
  });

  it('recovers from degraded on success', async () => {
    let fail = true;
    const diode = makeDiode(
      vi
        .fn()
        .mockImplementation(() =>
          fail ? Promise.reject(new Error('x')) : Promise.resolve({ accepted: true }),
        ),
    );
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), diode, { intervalMs: 10 });
    hb.start();
    await vi.advanceTimersByTimeAsync(10 * (CONSECUTIVE_FAIL_DEGRADE + 2));
    expect(hb.isDegraded).toBe(true);
    fail = false;
    await vi.advanceTimersByTimeAsync(15);
    expect(hb.isDegraded).toBe(false);
    expect(hb.status).toBe('alive');
    hb.stop();
  });

  it('uptimeSeconds increases', async () => {
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), makeDiode(), { intervalMs: 5_000 });
    hb.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(hb.uptimeSeconds).toBeGreaterThanOrEqual(2.9);
    hb.stop();
  });

  it('returns 0 uptimeSeconds before start', () => {
    const hb = new HeartbeatEmitter(LIMB_ID, makeCollector(), makeDiode());
    expect(hb.uptimeSeconds).toBe(0);
  });
});
