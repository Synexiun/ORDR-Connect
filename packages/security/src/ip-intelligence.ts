/**
 * IP Intelligence — IP reputation, geo-velocity, and blocking
 *
 * Provides:
 * - Private/loopback range detection (RFC 1918, RFC 4193, RFC 3927)
 * - Known TOR exit node detection (seed list; production replaces with live feed)
 * - IP block list management with expiry
 * - Geo-velocity anomaly detection: flag impossible travel between requests
 *   (same user from two distant IPs within a short window)
 * - Known scanner/botnet IP detection
 *
 * Production hardening notes:
 * - TOR exit list should be refreshed every 30 minutes from check.torproject.org
 * - Block list should be backed by Redis for multi-instance deployments
 * - Geo-velocity requires IP→geo mapping (MaxMind GeoIP2 or similar)
 *   Currently implemented as IP-change detection (same effect without geo dep)
 *
 * SOC2 CC6.6 — Logical access restriction: block known malicious sources.
 * ISO 27001 A.13.1.1 — Network controls: restrict traffic from bad actors.
 * HIPAA §164.312(a)(1) — Access control: block unauthorized IP ranges.
 */

import type { IPBlock } from './types.js';

// ─── RFC 1918 / Private Ranges ────────────────────────────────────────────────

/**
 * Returns true if the IP is in a private, loopback, link-local, or
 * documentation range. These should never appear as legitimate external clients.
 */
export function isPrivateIP(ip: string): boolean {
  // IPv4
  const ipv4 = parseIPv4(ip);
  if (ipv4 !== null) {
    const [a, b] = ipv4;
    // 127.0.0.0/8 — loopback
    if (a === 127) return true;
    // 10.0.0.0/8 — RFC 1918
    if (a === 10) return true;
    // 172.16.0.0/12 — RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 — RFC 1918
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 — link-local / AWS metadata
    if (a === 169 && b === 254) return true;
    // 0.0.0.0/8 — reserved
    if (a === 0) return true;
    return false;
  }

  // IPv6 loopback / link-local / ULA
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  return false;
}

// ─── TOR Exit Node Detection ─────────────────────────────────────────────────

// Seed list of known TOR exit nodes for testing.
// Production: refresh from https://check.torproject.org/torbulkexitlist every 30 min.
const TOR_EXIT_NODES = new Set([
  '185.220.101.1',
  '185.220.101.2',
  '185.220.101.3',
  '185.220.100.240',
  '185.220.100.241',
  '194.165.16.77',
  '199.249.230.87',
  '199.249.230.113',
  '23.129.64.100',
  '45.66.33.45',
]);

// ─── Known Scanner / Botnet Ranges ───────────────────────────────────────────

const KNOWN_SCANNER_IPS = new Set([
  '34.142.40.195', // Shodan
  '66.240.192.138', // Shodan
  '66.240.236.119', // Shodan
  '71.6.135.131', // Shodan
  '71.6.146.186', // Shodan
  '71.6.158.166', // Shodan
  '80.82.77.33', // Shodan
  '80.82.77.139', // Shodan
  '89.248.167.131', // Shodan
  '93.174.95.106', // Shodan
  '104.236.198.48', // Censys
  '198.20.69.74', // Censys
  '198.20.69.98', // Censys
]);

// ─── IPIntelligence ───────────────────────────────────────────────────────────

export class IPIntelligence {
  private readonly blockList = new Map<string, IPBlock>();
  private readonly torExitNodes: Set<string>;
  private readonly scannerIPs: Set<string>;
  // Per-user last-seen IP for velocity checks
  private readonly userLastIP = new Map<string, { ip: string; seenAt: Date }>();

  constructor(config?: {
    readonly extraTorNodes?: readonly string[];
    readonly extraScannerIPs?: readonly string[];
  }) {
    this.torExitNodes = new Set([...TOR_EXIT_NODES, ...(config?.extraTorNodes ?? [])]);
    this.scannerIPs = new Set([...KNOWN_SCANNER_IPS, ...(config?.extraScannerIPs ?? [])]);
  }

  /** Returns true if the IP is a known TOR exit node. */
  isTorExit(ip: string): boolean {
    return this.torExitNodes.has(ip);
  }

  /** Returns true if the IP is a known scanner/crawler/botnet node. */
  isKnownScanner(ip: string): boolean {
    return this.scannerIPs.has(ip);
  }

  /** Returns true if the IP is in a private/reserved range. */
  isPrivate(ip: string): boolean {
    return isPrivateIP(ip);
  }

  /**
   * Block an IP for the specified duration.
   * Replaces any existing block for the same IP.
   */
  block(ip: string, reason: string, durationMs: number): void {
    const now = new Date();
    this.blockList.set(ip, {
      ip,
      reason,
      blockedAt: now,
      expiresAt: new Date(now.getTime() + durationMs),
    });
  }

  /** Remove a block. Returns true if a block was removed. */
  unblock(ip: string): boolean {
    return this.blockList.delete(ip);
  }

  /**
   * Returns true if the IP is currently blocked and the block has not expired.
   * Automatically removes expired blocks on check.
   */
  isBlocked(ip: string): boolean {
    const block = this.blockList.get(ip);
    if (block === undefined) return false;
    if (block.expiresAt.getTime() <= Date.now()) {
      this.blockList.delete(ip);
      return false;
    }
    return true;
  }

  getBlock(ip: string): IPBlock | undefined {
    return this.blockList.get(ip);
  }

  /** Return all currently active blocks. */
  getActiveBlocks(): readonly IPBlock[] {
    const now = Date.now();
    const active: IPBlock[] = [];
    for (const [ip, block] of this.blockList) {
      if (block.expiresAt.getTime() > now) {
        active.push(block);
      } else {
        this.blockList.delete(ip);
      }
    }
    return active;
  }

  /**
   * Record a user accessing from an IP and detect impossible geo-velocity.
   * Returns true if the user's IP changed suspiciously fast.
   *
   * Heuristic: if a user was seen from IP-A less than MIN_TRAVEL_MS ago and
   * now appears from a different IP, flag as suspicious.
   * (Production: replace with real geo-distance calculation.)
   */
  detectIPSwitch(
    userId: string,
    ip: string,
    minTravelMs = 60_000, // 1 minute minimum between IP switches
  ): boolean {
    const prev = this.userLastIP.get(userId);
    this.userLastIP.set(userId, { ip, seenAt: new Date() });

    if (prev === undefined) return false;
    if (prev.ip === ip) return false;

    const elapsed = Date.now() - prev.seenAt.getTime();
    return elapsed < minTravelMs;
  }

  /** Add a TOR exit node to the live set. */
  addTorNode(ip: string): void {
    this.torExitNodes.add(ip);
  }

  /** Replace the TOR exit list with a fresh batch (called after feed refresh). */
  refreshTorList(nodes: readonly string[]): void {
    this.torExitNodes.clear();
    for (const n of nodes) {
      this.torExitNodes.add(n);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseIPv4(ip: string): readonly [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return nums as unknown as [number, number, number, number];
}
