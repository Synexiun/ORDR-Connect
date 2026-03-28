/**
 * Honeypot — Decoy paths for scanner/bot detection
 *
 * Any request to a honeypot path is immediately treated as malicious:
 * - The requester's IP is blocked for BLOCK_DURATION_MS
 * - A critical SecurityEvent is emitted
 * - A generic 404 is returned (do NOT reveal it's a trap)
 *
 * No legitimate client should ever access these paths. If it does, it's:
 * - A vulnerability scanner (Nikto, Shodan, etc.)
 * - A pentesting tool (Metasploit, BurpSuite)
 * - A malicious actor probing for weaknesses
 *
 * SOC2 CC6.7 — Restrict unauthorized access: detect and block probes.
 * ISO 27001 A.12.6.1 — Vulnerability management: detect scanning activity.
 * HIPAA §164.312(a)(1) — Access control: detect unauthorized access attempts.
 */

/** How long to block an IP that triggered a honeypot (24 hours). */
export const HONEYPOT_BLOCK_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Paths that no legitimate ORDR client should access.
 * All must NOT overlap with real API routes.
 */
export const HONEYPOT_PATHS: ReadonlySet<string> = new Set([
  // CMS / legacy systems
  '/wp-admin',
  '/wp-login.php',
  '/wp-config.php',
  '/wordpress',
  '/xmlrpc.php',
  // Config files
  '/.env',
  '/.env.local',
  '/.env.production',
  '/.git/config',
  '/.git/HEAD',
  '/config.yml',
  '/config.yaml',
  '/secrets.yml',
  // PHP probes
  '/phpinfo.php',
  '/phpmyadmin',
  '/php/phpinfo.php',
  // Java/Spring
  '/actuator',
  '/actuator/env',
  '/actuator/heapdump',
  '/console',
  '/h2-console',
  // Admin panels
  '/admin',
  '/administrator',
  '/admin/login',
  // Backup / debug
  '/backup',
  '/debug',
  '/trace',
  '/_profiler',
  // AWS / cloud metadata
  '/latest/meta-data',
  '/computeMetadata/v1',
  // Windows
  '/web.config',
  '/Global.asax',
  // Unsupported old API versions
  '/api/v0',
  '/v1',
  '/v2',
  // CGI
  '/cgi-bin/phpinfo.php',
  '/cgi-bin/test-cgi',
]);

/**
 * Returns true if the request path exactly matches a honeypot path,
 * or starts with one (e.g. /wp-admin/index.php).
 */
export function isHoneypotPath(path: string): boolean {
  // Normalize: strip query string
  const cleanPath = path.split('?')[0] ?? path;

  if (HONEYPOT_PATHS.has(cleanPath)) return true;

  // Prefix match for paths like /wp-admin/something
  for (const hpPath of HONEYPOT_PATHS) {
    if (cleanPath.startsWith(hpPath + '/')) return true;
  }

  return false;
}
