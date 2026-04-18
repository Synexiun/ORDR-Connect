import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TorExitRefresher, isPlausibleIp, parseTorBulkList } from '../tor-exit-refresher.js';
import { IPIntelligence } from '../ip-intelligence.js';

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

const SAMPLE_LIST = `# Maintained by the TOR project
185.220.101.45
185.220.101.46
199.249.230.1
2001:db8::1

# trailing blank tolerated
`;

describe('isPlausibleIp', () => {
  it('accepts valid IPv4', () => {
    expect(isPlausibleIp('185.220.101.45')).toBe(true);
    expect(isPlausibleIp('0.0.0.0')).toBe(true);
    expect(isPlausibleIp('255.255.255.255')).toBe(true);
  });

  it('rejects out-of-range IPv4 octets', () => {
    expect(isPlausibleIp('300.1.1.1')).toBe(false);
    expect(isPlausibleIp('1.1.1.256')).toBe(false);
  });

  it('accepts compressed IPv6', () => {
    expect(isPlausibleIp('2001:db8::1')).toBe(true);
    expect(isPlausibleIp('::1')).toBe(true);
  });

  it('rejects obvious garbage', () => {
    expect(isPlausibleIp('')).toBe(false);
    expect(isPlausibleIp('not-an-ip')).toBe(false);
    expect(isPlausibleIp('<html>error</html>')).toBe(false);
    expect(isPlausibleIp('a'.repeat(100))).toBe(false);
  });
});

describe('parseTorBulkList', () => {
  it('extracts IPs, skipping comments and blanks', () => {
    expect(parseTorBulkList(SAMPLE_LIST)).toEqual([
      '185.220.101.45',
      '185.220.101.46',
      '199.249.230.1',
      '2001:db8::1',
    ]);
  });

  it('returns empty for non-list content', () => {
    expect(parseTorBulkList('<html><body>503 unavailable</body></html>')).toEqual([]);
  });

  it('tolerates CRLF line endings', () => {
    const body = '1.2.3.4\r\n5.6.7.8\r\n';
    expect(parseTorBulkList(body)).toEqual(['1.2.3.4', '5.6.7.8']);
  });
});

describe('TorExitRefresher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts as not running', () => {
    const r = new TorExitRefresher(new IPIntelligence());
    expect(r.isRunning).toBe(false);
  });

  it('start() sets isRunning; stop() clears it', () => {
    const r = new TorExitRefresher(new IPIntelligence(), { intervalMs: 100 });
    r.start();
    expect(r.isRunning).toBe(true);
    r.stop();
    expect(r.isRunning).toBe(false);
  });

  it('does NOT fetch immediately by default — first tick fires after intervalMs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse(SAMPLE_LIST));
    const r = new TorExitRefresher(new IPIntelligence(), { intervalMs: 500 });
    r.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('fetches immediately when fetchOnStart=true', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse(SAMPLE_LIST));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected info log
    });
    const intel = new IPIntelligence();
    const r = new TorExitRefresher(intel, { intervalMs: 500, fetchOnStart: true });
    r.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(intel.isTorExit('185.220.101.45')).toBe(true);
    warnSpy.mockRestore();
    r.stop();
  });

  it('applies the refreshed list to IPIntelligence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse(SAMPLE_LIST));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected info log
    });
    const intel = new IPIntelligence();
    const r = new TorExitRefresher(intel, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(intel.isTorExit('185.220.101.45')).toBe(true);
    expect(intel.isTorExit('199.249.230.1')).toBe(true);
    expect(r.lastCount).toBe(4);
    warnSpy.mockRestore();
    r.stop();
  });

  it('replaces the entire list on refresh (not append)', async () => {
    const intel = new IPIntelligence({ extraTorNodes: ['10.0.0.1'] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('1.2.3.4\n'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress
    });
    const r = new TorExitRefresher(intel, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(intel.isTorExit('1.2.3.4')).toBe(true);
    expect(intel.isTorExit('10.0.0.1')).toBe(false);
    warnSpy.mockRestore();
    r.stop();
  });

  it('preserves existing list on fetch failure (graceful degradation)', async () => {
    const intel = new IPIntelligence();
    intel.addTorNode('99.99.99.99');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('boom', 500));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress expected warn log
    });
    const r = new TorExitRefresher(intel, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(intel.isTorExit('99.99.99.99')).toBe(true); // preserved
    expect(r.consecutiveFailures).toBeGreaterThanOrEqual(1);
    expect(r.lastError?.message).toMatch(/HTTP 500/);
    warnSpy.mockRestore();
    r.stop();
  });

  it('treats zero-IP response as a failure', async () => {
    const intel = new IPIntelligence();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('<html>503</html>', 200));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress
    });
    const r = new TorExitRefresher(intel, { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(75);
    expect(r.lastError?.message).toMatch(/zero IPs/);
    warnSpy.mockRestore();
    r.stop();
  });

  it('resets consecutiveFailures after a successful refresh', async () => {
    let fail = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(fail ? textResponse('boom', 500) : textResponse(SAMPLE_LIST)),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress
    });
    const r = new TorExitRefresher(new IPIntelligence(), { intervalMs: 50 });
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

  it('stop() prevents further ticks even while a fetch is in-flight', async () => {
    let resolveFetch: (r: Response) => void = () => {
      /* set below */
    };
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => pending);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress
    });
    const r = new TorExitRefresher(new IPIntelligence(), { intervalMs: 50 });
    r.start();
    await vi.advanceTimersByTimeAsync(60);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    r.stop();
    resolveFetch(textResponse(SAMPLE_LIST));
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('refreshNow() triggers an immediate fetch outside the timer cadence', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse(SAMPLE_LIST));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // suppress
    });
    const intel = new IPIntelligence();
    const r = new TorExitRefresher(intel, { intervalMs: 3_600_000 });
    r.start();
    await r.refreshNow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(intel.isTorExit('185.220.101.45')).toBe(true);
    warnSpy.mockRestore();
    r.stop();
  });
});
