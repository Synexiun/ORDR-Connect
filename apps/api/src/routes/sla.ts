/**
 * SLA Routes — SLA breach status and manual check trigger
 *
 * SOC2 CC7.2 — Monitoring: SLA breach detection and alerting.
 * ISO 27001 A.16.1.1 — Information security event reporting.
 *
 * Endpoints:
 * POST /api/v1/sla/check   — Trigger immediate SLA check (returns breach count)
 * GET  /api/v1/sla/status  — Current SLA checker status
 *
 * Both endpoints require authentication (admin/operator role).
 */

import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import type { SlaChecker } from '../lib/sla-checker.js';

// ─── Module-level SlaChecker ──────────────────────────────────────

let _checker: SlaChecker | null = null;

export function configureSlaRoutes(checker: SlaChecker): void {
  _checker = checker;
}

function getChecker(): SlaChecker {
  if (_checker === null) {
    throw new Error('[ORDR:API] SLA routes not configured — call configureSlaRoutes()');
  }
  return _checker;
}

// ─── Router ──────────────────────────────────────────────────────

const slaRouter = new Hono<Env>();

// ── POST /check — trigger immediate check ─────────────────────────

slaRouter.post('/check', requireAuth(), async (c): Promise<Response> => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  const checker = getChecker();
  const breachCount = await checker.check();

  return c.json({
    success: true as const,
    data: { breachesFound: breachCount },
  });
});

// ── GET /status — checker health ─────────────────────────────────

slaRouter.get('/status', requireAuth(), (c): Response => {
  const ctx = c.get('tenantContext');
  if (!ctx)
    return c.json(
      {
        success: false as const,
        error: { code: 'AUTH_FAILED' as const, message: 'Authentication required' },
      },
      401,
    );

  return c.json({
    success: true as const,
    data: {
      enabled: _checker !== null,
      thresholdHours: 4,
      intervalMinutes: 5,
    },
  });
});

export { slaRouter };
