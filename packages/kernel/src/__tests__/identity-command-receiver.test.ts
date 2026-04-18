import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdentityCommandReceiver } from '../identity-command-receiver.js';
import { KillSwitchReceiver } from '../kill-switch.js';
import type { LimbIdentity, SignedHeaders } from '../identity.js';
import type { IdentityCommand } from '../types.js';

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

function commandResponse(cmd: IdentityCommand, status = 200): Response {
  return new Response(JSON.stringify(cmd), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

describe('IdentityCommandReceiver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts as not running', () => {
    const r = new IdentityCommandReceiver(
      makeIdentity(),
      new KillSwitchReceiver(LIMB_ID),
      CORE_URL,
    );
    expect(r.isRunning).toBe(false);
  });

  it('start() sets isRunning; stop() clears it', () => {
    const r = new IdentityCommandReceiver(
      makeIdentity(),
      new KillSwitchReceiver(LIMB_ID),
      CORE_URL,
      { intervalMs: 100 },
    );
    r.start();
    expect(r.isRunning).toBe(true);
    r.stop();
    expect(r.isRunning).toBe(false);
  });

  it('does NOT poll immediately — first tick fires after intervalMs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(noContentResponse());
    const r = new IdentityCommandReceiver(
      makeIdentity(),
      new KillSwitchReceiver(LIMB_ID),
      CORE_URL,
      { intervalMs: 500 },
    );
    r.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('start() is idempotent — second call does not schedule duplicate tick', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(noContentResponse());
    const r = new IdentityCommandReceiver(
      makeIdentity(),
      new KillSwitchReceiver(LIMB_ID),
      CORE_URL,
      { intervalMs: 200 },
    );
    r.start();
    r.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('treats 204 as no-command — kill switch stays inactive', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(noContentResponse());
    const killSwitch = new KillSwitchReceiver(LIMB_ID);
    const r = new IdentityCommandReceiver(makeIdentity(), killSwitch, CORE_URL, {
      intervalMs: 50,
    });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(killSwitch.isActivated).toBe(false);
    expect(r.lastCommand).toBeNull();
    expect(r.consecutiveFailures).toBe(0);
    r.stop();
  });

  it('activates kill switch on revoke command', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      commandResponse({ action: 'revoke', limb_id: LIMB_ID, reason: 'policy-violation' }),
    );
    const killSwitch = new KillSwitchReceiver(LIMB_ID);
    const r = new IdentityCommandReceiver(makeIdentity(), killSwitch, CORE_URL, {
      intervalMs: 50,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected kill_switch_activating warn log
    });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(killSwitch.isActivated).toBe(true);
    expect(killSwitch.reason).toBe('policy-violation');
    expect(r.lastCommand?.action).toBe('revoke');
    warnSpy.mockRestore();
    r.stop();
  });

  it('logs but does not activate kill switch on rotate command', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      commandResponse({ action: 'rotate', limb_id: LIMB_ID, reason: 'key-age-90d' }),
    );
    const killSwitch = new KillSwitchReceiver(LIMB_ID);
    const r = new IdentityCommandReceiver(makeIdentity(), killSwitch, CORE_URL, {
      intervalMs: 50,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected rotate_command_received warn log
    });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(killSwitch.isActivated).toBe(false);
    expect(r.lastCommand?.action).toBe('rotate');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    r.stop();
  });

  it('signs the request with identity headers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(noContentResponse());
    const identity = makeIdentity();
    const r = new IdentityCommandReceiver(identity, new KillSwitchReceiver(LIMB_ID), CORE_URL, {
      intervalMs: 50,
    });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${CORE_URL}/limbs/${LIMB_ID}/commands/identity/pending`,
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

  it('increments consecutiveFailures on 500; keeps running', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const r = new IdentityCommandReceiver(
      makeIdentity(),
      new KillSwitchReceiver(LIMB_ID),
      CORE_URL,
      { intervalMs: 50 },
    );
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

  it('rejects command for a different limb_id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      commandResponse({ action: 'revoke', limb_id: 'other-limb', reason: 'x' }),
    );
    const killSwitch = new KillSwitchReceiver(LIMB_ID);
    const r = new IdentityCommandReceiver(makeIdentity(), killSwitch, CORE_URL, {
      intervalMs: 50,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected warn log
    });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(killSwitch.isActivated).toBe(false);
    expect(r.lastError?.message).toMatch(/wrong limb/);
    warnSpy.mockRestore();
    r.stop();
  });

  it('rejects malformed command JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ action: 'unknown-verb' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const killSwitch = new KillSwitchReceiver(LIMB_ID);
    const r = new IdentityCommandReceiver(makeIdentity(), killSwitch, CORE_URL, {
      intervalMs: 50,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected warn log
    });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(killSwitch.isActivated).toBe(false);
    expect(r.lastError?.message).toMatch(/malformed/i);
    warnSpy.mockRestore();
    r.stop();
  });

  it('resets consecutiveFailures after a successful poll', async () => {
    let fail = true;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(fail ? new Response('x', { status: 500 }) : noContentResponse()),
      );
    const r = new IdentityCommandReceiver(
      makeIdentity(),
      new KillSwitchReceiver(LIMB_ID),
      CORE_URL,
      { intervalMs: 50 },
    );
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
    const r = new IdentityCommandReceiver(
      makeIdentity(),
      new KillSwitchReceiver(LIMB_ID),
      CORE_URL,
      { intervalMs: 50 },
    );
    r.start();
    await vi.advanceTimersByTimeAsync(60);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    r.stop();
    resolveFetch(noContentResponse());
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('records lastPollAt timestamp on each successful poll', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(noContentResponse());
    const r = new IdentityCommandReceiver(
      makeIdentity(),
      new KillSwitchReceiver(LIMB_ID),
      CORE_URL,
      { intervalMs: 50 },
    );
    expect(r.lastPollAt).toBeNull();
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(r.lastPollAt).toBeInstanceOf(Date);
    r.stop();
  });
});
