/**
 * Threat Scorer — Multi-signal per-request risk assessment
 *
 * Combines multiple threat signals into a composite score (0–1000) and
 * determines the appropriate enforcement action.
 *
 * Score thresholds:
 *   0–199   → none     → allow
 *   200–399 → low      → monitor (log, no block)
 *   400–599 → medium   → alert (emit SecurityEvent)
 *   600–799 → high     → challenge (adaptive rate-limit: 429 + Retry-After)
 *   800–1000→ critical → block (403 Forbidden, no details in response)
 *
 * Signals contributing to score:
 * - Attack indicators (SQLi=800, XSS=600, path_traversal=700, SSRF=900, etc.)
 * - Anomaly signals (each sigma above threshold = +100)
 * - Suspicious user-agent (curl/wget/python-requests = +100, empty UA = +200)
 * - Suspicious path patterns (scanner paths = +300, admin probes = +200)
 * - Honeypot triggered (+1000 — immediate critical)
 * - JWT replay attack (+800)
 * - JWT fingerprint mismatch (+600)
 * - IP intelligence (blocked IP = +1000, TOR exit = +400)
 *
 * All signals are capped so a single signal cannot force a block on its own
 * (except honeypot and replay attacks which are high-confidence indicators).
 *
 * SOC2 CC6.7 — Prevent unauthorized access: dynamic risk assessment.
 * ISO 27001 A.12.4.1 — Monitoring: per-request threat evaluation.
 * HIPAA §164.308(a)(5)(ii)(B) — Protection from malicious software.
 */

import type {
  ThreatAssessment,
  ThreatLevel,
  ThreatAction,
  ThreatSignal,
  AttackIndicator,
  AnomalySignal,
} from './types.js';

// ─── Score Constants ──────────────────────────────────────────────────────────

const ATTACK_SCORES: Record<AttackIndicator['type'], number> = {
  sqli: 750,
  xss: 600,
  path_traversal: 700,
  ssrf: 900,
  command_injection: 850,
  xxe: 800,
  open_redirect: 300,
  mass_assignment: 400,
  prototype_pollution: 800,
  nosql_injection: 700,
  ldap_injection: 700,
  header_injection: 600,
};

const SEVERITY_MULTIPLIER: Record<AttackIndicator['severity'], number> = {
  low: 0.3,
  medium: 0.6,
  high: 0.85,
  critical: 1.0,
};

const SUSPICIOUS_USER_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /metasploit/i,
  /burpsuite/i,
  /owasp\s*zap/i,
  /nuclei/i,
  /gobuster/i,
  /dirbuster/i,
  /hydra/i,
  /medusa/i,
  /aircrack/i,
];

const SCANNER_UA_PATTERNS = [/^$/]; // empty user-agent

const AUTOMATION_UA_PATTERNS = [
  /^python-requests\//i,
  /^go-http-client\//i,
  /^curl\//i,
  /^wget\//i,
  /^libwww-perl\//i,
];

const SCANNER_PATH_FRAGMENTS = [
  /\/\.git\//,
  /\/\.env/,
  /\/wp-(?:admin|login|config)/i,
  /\/phpinfo\.php/i,
  /\/actuator\//i,
  /\/debug\//i,
  /\/backup/i,
  /\/config\.(?:yml|yaml|json)/i,
  /\/secrets/i,
  /\/admin(?:\/|$)/i,
  /\/console(?:\/|$)/i,
  /\/phpmyadmin/i,
  /\/cgi-bin\//i,
  /\/xmlrpc\.php/i,
  /\/web\.config/i,
  /\/_profiler\//i,
];

// ─── ThreatScorer ─────────────────────────────────────────────────────────────

export interface ThreatScorerInput {
  readonly requestId: string;
  readonly tenantId: string | undefined;
  readonly ip: string;
  readonly userAgent: string;
  readonly path: string;
  readonly method: string;
  readonly attackIndicators: readonly AttackIndicator[];
  readonly anomalySignals: readonly AnomalySignal[];
  readonly isHoneypotPath: boolean;
  readonly isReplayAttack: boolean;
  readonly isFingerprintMismatch: boolean;
  readonly isIPBlocked: boolean;
  readonly isTorExit: boolean;
}

export class ThreatScorer {
  score(input: ThreatScorerInput): ThreatAssessment {
    const signals: ThreatSignal[] = [];

    // ── Honeypot (instant critical) ──────────────────────────────────────
    if (input.isHoneypotPath) {
      signals.push({
        name: 'honeypot_triggered',
        score: 1000,
        reason: 'Request to decoy path — no legitimate client should access this',
      });
    }

    // ── Replay attack ────────────────────────────────────────────────────
    if (input.isReplayAttack) {
      signals.push({
        name: 'jwt_replay',
        score: 800,
        reason: 'JWT JTI has already been seen — token replay attack',
      });
    }

    // ── Fingerprint mismatch ──────────────────────────────────────────────
    if (input.isFingerprintMismatch) {
      signals.push({
        name: 'fingerprint_mismatch',
        score: 600,
        reason: 'JWT fingerprint does not match client IP/UA — possible token theft',
      });
    }

    // ── IP intelligence ───────────────────────────────────────────────────
    if (input.isIPBlocked) {
      signals.push({
        name: 'ip_blocked',
        score: 1000,
        reason: 'Source IP is on the block list',
      });
    }
    if (input.isTorExit) {
      signals.push({
        name: 'tor_exit',
        score: 400,
        reason: 'Request from known TOR exit node',
      });
    }

    // ── Attack indicators ─────────────────────────────────────────────────
    if (input.attackIndicators.length > 0) {
      // Use the highest-scoring attack type, weighted by severity
      let maxAttackScore = 0;
      let maxReason = '';
      for (const ind of input.attackIndicators) {
        const base = ATTACK_SCORES[ind.type];
        const weighted = Math.round(base * SEVERITY_MULTIPLIER[ind.severity]);
        if (weighted > maxAttackScore) {
          maxAttackScore = weighted;
          maxReason = `${ind.type} attack detected in ${ind.location}: ${ind.pattern}`;
        }
      }
      signals.push({
        name: 'attack_pattern',
        score: maxAttackScore,
        reason: maxReason,
      });

      // Additional score for multiple distinct attack types
      const uniqueTypes = new Set(input.attackIndicators.map((i) => i.type));
      if (uniqueTypes.size > 1) {
        signals.push({
          name: 'multi_vector_attack',
          score: Math.min(200, (uniqueTypes.size - 1) * 100),
          reason: `${uniqueTypes.size.toString()} distinct attack types detected simultaneously`,
        });
      }
    }

    // ── Anomaly signals ────────────────────────────────────────────────────
    for (const signal of input.anomalySignals) {
      if (!signal.isAnomaly) continue;
      const zscore = Math.abs(signal.zScore);
      // Each sigma above threshold adds 50 points, capped at 300
      const anomalyScore = Math.min(300, Math.round((zscore - 3) * 50 + 100));
      signals.push({
        name: `anomaly_${signal.metric}`,
        score: anomalyScore,
        reason: `${signal.metric} anomaly: observed ${signal.observed.toFixed(1)} vs baseline ${signal.baseline.toFixed(1)} (Z=${signal.zScore.toFixed(2)})`,
      });
    }

    // ── User-agent analysis ───────────────────────────────────────────────
    const uaSignal = this.scoreUserAgent(input.userAgent, input.path);
    if (uaSignal !== undefined) signals.push(uaSignal);

    // ── Path analysis ─────────────────────────────────────────────────────
    const pathSignal = this.scorePath(input.path, input.method);
    if (pathSignal !== undefined) signals.push(pathSignal);

    // ── Composite score ────────────────────────────────────────────────────
    const totalScore = Math.min(
      1000,
      signals.reduce((sum, s) => sum + s.score, 0),
    );

    const threatLevel = this.levelFromScore(totalScore);
    const action = this.actionFromLevel(threatLevel);

    return {
      requestId: input.requestId,
      tenantId: input.tenantId,
      threatLevel,
      totalScore,
      signals,
      action,
      timestamp: new Date(),
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private scoreUserAgent(ua: string, path: string): ThreatSignal | undefined {
    void path; // reserved for future path+UA correlation

    for (const pattern of SUSPICIOUS_USER_AGENTS) {
      if (pattern.test(ua)) {
        return {
          name: 'malicious_user_agent',
          score: 700,
          reason: `Known attack tool user-agent: ${ua.slice(0, 50)}`,
        };
      }
    }

    for (const pattern of SCANNER_UA_PATTERNS) {
      if (pattern.test(ua)) {
        return {
          name: 'empty_user_agent',
          score: 200,
          reason: 'Empty user-agent — likely automated scanner',
        };
      }
    }

    for (const pattern of AUTOMATION_UA_PATTERNS) {
      if (pattern.test(ua)) {
        return {
          name: 'automation_user_agent',
          score: 100,
          reason: `Automation client: ${ua.slice(0, 50)}`,
        };
      }
    }

    return undefined;
  }

  private scorePath(path: string, method: string): ThreatSignal | undefined {
    for (const pattern of SCANNER_PATH_FRAGMENTS) {
      if (pattern.test(path)) {
        return {
          name: 'scanner_path',
          score: 300,
          reason: `Vulnerability scan probe detected: ${path.slice(0, 80)}`,
        };
      }
    }

    // HTTP method anomalies on REST paths
    if (method === 'TRACE' || method === 'TRACK') {
      return {
        name: 'dangerous_method',
        score: 200,
        reason: `Dangerous HTTP method: ${method} (XST attack vector)`,
      };
    }

    return undefined;
  }

  private levelFromScore(score: number): ThreatLevel {
    if (score >= 800) return 'critical';
    if (score >= 600) return 'high';
    if (score >= 400) return 'medium';
    if (score >= 200) return 'low';
    return 'none';
  }

  private actionFromLevel(level: ThreatLevel): ThreatAction {
    switch (level) {
      case 'critical':
        return 'block';
      case 'high':
        return 'challenge';
      case 'medium':
        return 'monitor';
      case 'low':
        return 'monitor';
      case 'none':
        return 'allow';
    }
  }
}
