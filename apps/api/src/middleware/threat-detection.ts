/**
 * Threat Detection Middleware — Military-grade per-request security analysis
 *
 * Integrates all security components into a single middleware that runs
 * BEFORE authentication, rate limiting, and business logic:
 *
 * Pipeline (per request):
 *   1. Honeypot path check       → instant block + IP ban if hit
 *   2. IP intelligence check     → block banned IPs, flag TOR exits
 *   3. Attack pattern detection  → scan URL, query params, headers
 *   4. Body scanning             → scan request body for injections + DLP
 *   5. Anomaly detection         → behavioral baseline comparison
 *   6. Threat scoring            → composite 0–1000 risk score
 *   7. Action enforcement        → allow / monitor / challenge / block
 *   8. Security event emission   → emits to SecurityEventBus (audit trail)
 *   9. Response DLP              → scan outgoing responses for PII/PHI leakage
 *
 * Enforcement actions:
 *   allow     → pass through, no action
 *   monitor   → pass through, emit SecurityEvent (low/medium risk)
 *   challenge → 429 Too Many Requests with Retry-After (high risk)
 *   block     → 403 Forbidden, generic message (critical risk)
 *
 * SECURITY:
 * - Blocked responses NEVER reveal why the request was blocked
 * - No stack traces, no internal details, no attack type disclosed
 * - Correlation ID included for support (maps to internal SecurityEvent)
 * - Body scan reads body as text only when Content-Type is safe (JSON/form)
 * - Response DLP only active when dlpEnabled: true (CPU cost consideration)
 *
 * SOC2 CC6.7 — Prevent unauthorized/malicious software and code execution.
 * ISO 27001 A.12.4.1 — Event logging: all blocked requests logged.
 * ISO 27001 A.14.2.5 — Secure system engineering: defense-in-depth.
 * HIPAA §164.312(a)(1) — Access control: block unauthorized access attempts.
 * HIPAA §164.308(a)(5)(ii)(B) — Protection from malicious software.
 */

import { createMiddleware } from 'hono/factory';
import type { Env } from '../types.js';
import {
  AnomalyDetector,
  AttackDetector,
  DLPScanner,
  ThreatScorer,
  SecurityEventBus,
  IPIntelligence,
  isHoneypotPath,
  HONEYPOT_BLOCK_DURATION_MS,
} from '@ordr/security';
import type { ThreatAssessment, SecurityEventType } from '@ordr/security';

// ─── Module-level singletons ─────────────────────────────────────────────────

let anomalyDetector: AnomalyDetector | undefined;
let attackDetector: AttackDetector | undefined;
let dlpScanner: DLPScanner | undefined;
let threatScorer: ThreatScorer | undefined;
let securityEventBus: SecurityEventBus | undefined;
let ipIntelligence: IPIntelligence | undefined;
let dlpEnabled = false;

// ─── Configuration ────────────────────────────────────────────────────────────

export interface ThreatDetectionConfig {
  readonly anomalyDetector: AnomalyDetector;
  readonly attackDetector: AttackDetector;
  readonly dlpScanner: DLPScanner;
  readonly threatScorer: ThreatScorer;
  readonly securityEventBus: SecurityEventBus;
  readonly ipIntelligence: IPIntelligence;
  /** Enable DLP scanning on response bodies. Adds CPU overhead. Default: false. */
  readonly dlpEnabled?: boolean;
}

export function configureThreatDetection(config: ThreatDetectionConfig): void {
  anomalyDetector = config.anomalyDetector;
  attackDetector = config.attackDetector;
  dlpScanner = config.dlpScanner;
  threatScorer = config.threatScorer;
  securityEventBus = config.securityEventBus;
  ipIntelligence = config.ipIntelligence;
  dlpEnabled = config.dlpEnabled ?? false;
}

// ─── Threat Detection Middleware ──────────────────────────────────────────────

export const threatDetectionMiddleware = createMiddleware<Env>(async (c, next) => {
  // No-op if not configured (test environments)
  if (
    anomalyDetector === undefined ||
    attackDetector === undefined ||
    dlpScanner === undefined ||
    threatScorer === undefined ||
    securityEventBus === undefined ||
    ipIntelligence === undefined
  ) {
    await next();
    return;
  }

  const requestId = (c.get('requestId') as string | undefined) ?? 'unknown';
  const ip = extractIP(c.req.raw);
  const ua = c.req.header('user-agent') ?? '';
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;
  const tenantCtx = c.get('tenantContext');
  const tenantId = tenantCtx?.tenantId;
  const userId = tenantCtx?.userId;

  // ── 1. Honeypot check ──────────────────────────────────────────────────
  if (isHoneypotPath(path)) {
    ipIntelligence.block(ip, 'Honeypot triggered', HONEYPOT_BLOCK_DURATION_MS);
    emitEvent(securityEventBus, {
      type: 'honeypot.triggered',
      severity: 'critical',
      tenantId,
      actorId: userId,
      ip,
      userAgent: ua,
      requestId,
      path,
      details: { path, method },
    });
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'Not found', correlationId: requestId },
      },
      404,
    );
  }

  // ── 2. IP block check ──────────────────────────────────────────────────
  if (ipIntelligence.isBlocked(ip)) {
    emitEvent(securityEventBus, {
      type: 'threat.ip_blocked',
      severity: 'high',
      tenantId,
      actorId: userId,
      ip,
      userAgent: ua,
      requestId,
      path,
      details: { reason: ipIntelligence.getBlock(ip)?.reason ?? 'Blocked IP' },
    });
    return c.json(
      {
        success: false as const,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
          correlationId: requestId,
        },
      },
      403,
    );
  }

  // ── 3. Attack detection — path + query params + headers ────────────────
  // NOTE: Only scan path+query — NOT scheme+host. The scheme/host are not
  // user-supplied data and would produce false-positive SSRF detections
  // against localhost in development environments.
  const url = c.req.url;
  const parsedUrl = new URL(url);
  const pathAndQuery = parsedUrl.pathname + parsedUrl.search;
  const urlIndicators = attackDetector.detectInURL(pathAndQuery);

  const queryParams: Record<string, string> = {};
  new URL(url).searchParams.forEach((v, k) => {
    queryParams[k] = v;
  });
  const queryIndicators = attackDetector.detectInQuery(queryParams);

  const headerMap: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => {
    // Skip Authorization and Cookie headers to avoid false positives on JWT/session values
    if (k !== 'authorization' && k !== 'cookie') {
      headerMap[k] = v;
    }
  });
  const headerIndicators = attackDetector.detectInHeaders(headerMap);

  // ── 4. Body scan (JSON/form only) ──────────────────────────────────────
  const bodyIndicators: import('@ordr/security').AttackIndicator[] = [];
  const contentType = c.req.header('content-type') ?? '';
  const scanBody =
    method !== 'GET' &&
    method !== 'HEAD' &&
    (contentType.includes('application/json') ||
      contentType.includes('application/x-www-form-urlencoded'));

  if (scanBody) {
    try {
      const bodyText = await c.req.text();
      // Store body text for downstream handlers so body isn't consumed
      c.set('rawBody' as never, bodyText as never);
      const found = attackDetector.detectInBody(bodyText);
      bodyIndicators.push(...found);
    } catch {
      // Body read failure is non-fatal
    }
  }

  const allIndicators = [
    ...urlIndicators,
    ...queryIndicators,
    ...headerIndicators,
    ...bodyIndicators,
  ];

  // ── 5. Anomaly detection ────────────────────────────────────────────────
  const anomalySignals = tenantId !== undefined ? anomalyDetector.detectAnomalies(tenantId) : [];

  // ── 6. Threat scoring ──────────────────────────────────────────────────
  const assessment: ThreatAssessment = threatScorer.score({
    requestId,
    tenantId,
    ip,
    userAgent: ua,
    path,
    method,
    attackIndicators: allIndicators,
    anomalySignals,
    isHoneypotPath: false, // already handled above
    isReplayAttack: false, // handled by auth middleware after this
    isFingerprintMismatch: false, // handled by auth middleware after this
    isIPBlocked: false, // already handled above
    isTorExit: ipIntelligence.isTorExit(ip),
  });

  // Attach to context for downstream middleware/routes
  c.set('threatAssessment' as never, assessment as never);

  // ── 7. Emit security events for significant indicators ──────────────────
  if (allIndicators.length > 0 && assessment.totalScore >= 400) {
    const topIndicator = allIndicators[0];
    if (topIndicator !== undefined) {
      const eventType = `attack.${topIndicator.type}` as SecurityEventType;
      emitEvent(securityEventBus, {
        type: eventType,
        severity: topIndicator.severity === 'critical' ? 'critical' : 'high',
        tenantId,
        actorId: userId,
        ip,
        userAgent: ua,
        requestId,
        path,
        details: {
          indicatorCount: allIndicators.length,
          topType: topIndicator.type,
          topSeverity: topIndicator.severity,
          score: assessment.totalScore,
        },
      });
    }
  }

  for (const signal of anomalySignals) {
    if (signal.isAnomaly) {
      emitEvent(securityEventBus, {
        type: `anomaly.${signal.metric}` as SecurityEventType,
        severity: 'medium',
        tenantId,
        actorId: userId,
        ip,
        userAgent: ua,
        requestId,
        path,
        details: {
          metric: signal.metric,
          observed: signal.observed,
          baseline: signal.baseline,
          zScore: signal.zScore,
        },
      });
    }
  }

  // ── 8. Enforcement ─────────────────────────────────────────────────────
  if (assessment.action === 'block') {
    emitEvent(securityEventBus, {
      type: 'threat.critical_blocked',
      severity: 'critical',
      tenantId,
      actorId: userId,
      ip,
      userAgent: ua,
      requestId,
      path,
      details: { score: assessment.totalScore, signals: assessment.signals.length },
    });
    // Auto-block the IP
    ipIntelligence.block(ip, 'Automatic block: critical threat score', 60 * 60 * 1000);
    return c.json(
      {
        success: false as const,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
          correlationId: requestId,
        },
      },
      403,
    );
  }

  if (assessment.action === 'challenge') {
    emitEvent(securityEventBus, {
      type: 'threat.high_score',
      severity: 'high',
      tenantId,
      actorId: userId,
      ip,
      userAgent: ua,
      requestId,
      path,
      details: { score: assessment.totalScore },
    });
    return c.json(
      {
        success: false as const,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests',
          correlationId: requestId,
        },
      },
      429,
      { 'Retry-After': '60' },
    );
  }

  // ── 9. Continue to next middleware ─────────────────────────────────────
  await next();

  // ── 10. Response DLP (post-response) ───────────────────────────────────
  if (dlpEnabled && c.res.status < 400) {
    const responseText = await c.res.text();
    const findings = dlpScanner.scan(responseText);
    if (findings.length > 0) {
      const severity = DLPScanner.maxSeverity(findings);
      const eventType: SecurityEventType =
        severity === 'critical' || severity === 'high'
          ? 'dlp.phi_in_response'
          : 'dlp.pii_in_response';

      emitEvent(securityEventBus, {
        type: eventType,
        severity: severity ?? 'medium',
        tenantId,
        actorId: userId,
        ip,
        userAgent: ua,
        requestId,
        path,
        details: {
          findingCount: findings.length,
          types: [...new Set(findings.map((f: import('@ordr/security').DLPFinding) => f.type))],
        },
      });

      // Redact and replace response for high/critical findings
      if (severity === 'high' || severity === 'critical') {
        const { redacted } = dlpScanner.redact(responseText);
        c.res = new Response(redacted, {
          status: c.res.status,
          headers: c.res.headers,
        });
      }
    }
  }

  // ── 11. Record observation for anomaly baseline ────────────────────────
  if (tenantId !== undefined) {
    const responseSize = parseInt(c.res.headers.get('content-length') ?? '0', 10);
    const contentLength = parseInt(c.req.header('content-length') ?? '0', 10);
    anomalyDetector.recordObservation({
      tenantId,
      isError: c.res.status >= 500,
      responseBytes: responseSize,
      requestBytes: contentLength,
    });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractIP(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff !== null && xff.length > 0) {
    const firstHop = xff.split(',')[0];
    return firstHop?.trim() ?? '';
  }
  return '';
}

function emitEvent(
  bus: SecurityEventBus,
  partial: Omit<Parameters<SecurityEventBus['emit']>[0], never>,
): void {
  try {
    bus.emit(partial);
  } catch {
    // Event bus errors MUST NOT disrupt the request path
  }
}
