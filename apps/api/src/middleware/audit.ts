/**
 * Audit Middleware — automatic audit trail for every API request
 *
 * SOC2 CC7.2 — Monitoring: log all system activities.
 * ISO 27001 A.12.4.1 — Event logging.
 * HIPAA §164.312(b) — Audit controls: record and examine system activity.
 *
 * SECURITY:
 * - NEVER logs request/response bodies (may contain PHI)
 * - Only logs method, path, status, duration, actor, and tenant
 * - State-changing methods (POST/PUT/PATCH/DELETE) always audited
 * - GET requests audit-logged at 'api.request' level for compliance trail
 */

import { createMiddleware } from 'hono/factory';
import type { AuditLogger, AuditEventType } from '@ordr/audit';
import type { Env } from '../types.js';

// ---- Module-level reference (set once at startup) -------------------------

let auditLogger: AuditLogger | null = null;

/**
 * Call once at startup to provide the AuditLogger instance.
 */
export function configureAudit(logger: AuditLogger): void {
  auditLogger = logger;
}

// ---- HTTP method → audit event type mapping --------------------------------

const METHOD_EVENT_MAP: Readonly<Record<string, AuditEventType>> = {
  POST: 'data.created',
  PUT: 'data.updated',
  PATCH: 'data.updated',
  DELETE: 'data.deleted',
  GET: 'api.request',
} as const;

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ---- Middleware -------------------------------------------------------------

export const audit = createMiddleware<Env>(async (c, next) => {
  const startTime = Date.now();

  await next();

  // Fire-and-forget audit logging — do not block the response
  if (!auditLogger) {
    return;
  }

  const method = c.req.method.toUpperCase();
  const status = c.res.status;
  const duration = Date.now() - startTime;
  const requestId = c.get('requestId');
  const tenantContext = c.get('tenantContext');

  // Always audit state-changing methods; also audit reads for compliance trail
  const isStateChanging = STATE_CHANGING_METHODS.has(method);
  if (!isStateChanging && method !== 'GET') {
    // HEAD, OPTIONS, etc. — skip
    return;
  }

  const eventType: AuditEventType = METHOD_EVENT_MAP[method] ?? 'api.request';

  // Extract resource from path (e.g., /api/v1/customers -> customers)
  const pathSegments = c.req.path.split('/').filter(Boolean);
  const resource = pathSegments[pathSegments.length - 1] ?? 'unknown';

  try {
    await auditLogger.log({
      tenantId: tenantContext?.tenantId ?? 'system',
      eventType,
      actorType: tenantContext ? 'user' : 'system',
      actorId: tenantContext?.userId ?? 'anonymous',
      resource,
      resourceId: requestId,
      action: `${method} ${c.req.path}`,
      details: {
        // SECURITY: NO request/response bodies — they may contain PHI
        method,
        path: c.req.path,
        status,
        durationMs: duration,
      },
      timestamp: new Date(),
    });
  } catch {
    // Audit logging failure must NEVER crash the request.
    // In production, this should alert an on-call engineer.
    console.error(`[ORDR:AUDIT] Failed to log audit event for ${method} ${c.req.path}`);
  }
});
