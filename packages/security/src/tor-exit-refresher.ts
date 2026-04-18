/**
 * TorExitRefresher — periodic refresh of the TOR exit node list.
 *
 * The static seed list baked into `IPIntelligence` is only a fallback for
 * tests. Real deployments must keep the list fresh — TOR exit nodes rotate
 * frequently (hours to days) and stale data means either false positives
 * (blocking legitimate users whose IP was formerly a TOR exit) or false
 * negatives (missing currently active TOR traffic).
 *
 * Source: https://check.torproject.org/torbulkexitlist (canonical, public,
 * updated by the TOR project itself). One IPv4/IPv6 per line, blank lines
 * and comments are tolerated.
 *
 * Failure mode: graceful. If the fetch fails, the previous list is left in
 * place — we degrade to stale-but-valid rather than wiping the list to empty.
 * Consecutive failures are counted and logged so operators notice if the feed
 * has been unreachable for an extended period.
 *
 * SOC2 CC6.6 — Logical access restriction: block known malicious sources.
 * ISO 27001 A.8.20 — Networks security: automated threat intelligence feeds.
 */

import type { IPIntelligence } from './ip-intelligence.js';

/** Canonical TOR project bulk exit list URL. */
export const TOR_EXIT_LIST_URL = 'https://check.torproject.org/torbulkexitlist';

/** Default refresh cadence: 30 minutes. Matches the TOR project's stated update frequency. */
export const TOR_REFRESH_INTERVAL_MS = 30 * 60 * 1_000;

/** Default HTTP timeout: 15 seconds. The feed is small (~tens of KB). */
export const TOR_FETCH_TIMEOUT_MS = 15_000;

export interface TorExitRefresherOptions {
  /** Source URL. Default: TOR_EXIT_LIST_URL. */
  url?: string;
  /** Refresh cadence in milliseconds. Default: 30 minutes. */
  intervalMs?: number;
  /** HTTP timeout in milliseconds. Default: 15 s. */
  timeoutMs?: number;
  /**
   * If true, fetch immediately on start() instead of waiting for the first
   * interval. Useful at boot — operators usually want the fresh list applied
   * before traffic starts flowing.
   */
  fetchOnStart?: boolean;
}

/**
 * Validates that a candidate string is a plausible IP address.
 * Accepts IPv4 dotted-quad and compressed IPv6. Rejects obvious garbage.
 * Intentionally permissive on IPv6 — the TOR feed publishes well-formed
 * addresses; we just want to catch the occasional HTML error page.
 */
export function isPlausibleIp(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > 45) return false;
  // IPv4 dotted-quad
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(candidate)) {
    const octets = candidate.split('.').map((o) => parseInt(o, 10));
    return octets.every((o) => Number.isFinite(o) && o >= 0 && o <= 255);
  }
  // IPv6 — any sequence of hex groups separated by colons, plus the
  // compressed "::" form. Requires at least one colon.
  if (candidate.includes(':')) {
    return /^[0-9a-fA-F:]+$/.test(candidate);
  }
  return false;
}

/** Parse the bulk exit list body: one IP per line, strip blanks and comments. */
export function parseTorBulkList(body: string): readonly string[] {
  const ips: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    if (!isPlausibleIp(line)) continue;
    ips.push(line);
  }
  return ips;
}

export class TorExitRefresher {
  private _running = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _lastRefreshAt: Date | null = null;
  private _lastCount = 0;
  private _lastError: Error | null = null;
  private _consecutiveFailures = 0;
  private readonly _url: string;
  private readonly _intervalMs: number;
  private readonly _timeoutMs: number;
  private readonly _fetchOnStart: boolean;

  constructor(
    private readonly _intel: IPIntelligence,
    opts: TorExitRefresherOptions = {},
  ) {
    this._url = opts.url ?? TOR_EXIT_LIST_URL;
    this._intervalMs = opts.intervalMs ?? TOR_REFRESH_INTERVAL_MS;
    this._timeoutMs = opts.timeoutMs ?? TOR_FETCH_TIMEOUT_MS;
    this._fetchOnStart = opts.fetchOnStart ?? false;
  }

  get isRunning(): boolean {
    return this._running;
  }

  get lastRefreshAt(): Date | null {
    return this._lastRefreshAt;
  }

  get lastCount(): number {
    return this._lastCount;
  }

  get lastError(): Error | null {
    return this._lastError;
  }

  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    if (this._fetchOnStart) {
      void this._refresh();
    } else {
      this._scheduleNext(this._intervalMs);
    }
  }

  stop(): void {
    this._running = false;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Manually trigger a refresh. Useful from tests, or to recover from a
   * known-bad remote feed event without waiting for the next tick.
   */
  async refreshNow(): Promise<void> {
    await this._refresh();
  }

  private _scheduleNext(delayMs: number): void {
    this._timer = setTimeout(() => {
      void this._refresh();
    }, delayMs);
  }

  private async _refresh(): Promise<void> {
    if (!this._running) return;

    try {
      const ips = await this._fetchList();
      this._intel.refreshTorList(ips);
      this._lastRefreshAt = new Date();
      this._lastCount = ips.length;
      this._lastError = null;
      this._consecutiveFailures = 0;
      console.warn(
        JSON.stringify({
          level: 'info',
          component: 'security-tor-exit-refresher',
          event: 'tor_list_refreshed',
          count: ips.length,
          url: this._url,
        }),
      );
    } catch (err) {
      this._consecutiveFailures++;
      this._lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        JSON.stringify({
          level: 'warn',
          component: 'security-tor-exit-refresher',
          event: 'tor_list_refresh_failed',
          consecutiveFailures: this._consecutiveFailures,
          error: this._lastError.message,
          url: this._url,
        }),
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this._running) {
      this._scheduleNext(this._intervalMs);
    }
  }

  private async _fetchList(): Promise<readonly string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this._timeoutMs);

    let response: Response;
    try {
      response = await fetch(this._url, {
        method: 'GET',
        headers: { Accept: 'text/plain' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // Cancel the unread body so undici releases the underlying TCP
      // connection immediately. Without this, the Response waits for GC
      // to release the socket — under flapping upstream conditions that
      // accumulates dangling connections and exhausts the pool.
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`TOR list fetch failed: HTTP ${response.status.toString()}`);
    }

    const body = await response.text();
    const ips = parseTorBulkList(body);

    if (ips.length === 0) {
      throw new Error('TOR list fetch returned zero IPs (probable upstream error)');
    }

    return ips;
  }
}
