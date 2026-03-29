/**
 * Healthcare Routes tests — HIPAA-compliant patient operations endpoints
 *
 * HIPAA §164.312(a)(1) — Access control: auth required on all endpoints.
 * HIPAA §164.502(b)    — Minimum necessary: only non-PHI operational data.
 * HIPAA §164.312(b)    — Audit controls: every request logged.
 * HIPAA §164.514(b)    — De-identification safe harbor: tokenized patient IDs.
 * SOC2 CC6.1           — Logical access controls: tenant isolation enforced.
 *
 * SECURITY NOTE (SOC2 CC6.1 / HIPAA §164.312):
 * All patient identifiers are tokenized (PTK-XXXX format).
 * No PHI (name, email, phone, DOB, diagnosis) is present in any response.
 * Tests assert patientToken is non-null and follows the PTK- prefix pattern.
 *
 * Verifies:
 * - GET /queue → 200 with tokenized patient queue entries
 * - GET /appointments → 200 with tokenized appointment list
 * - GET /care-plans → 200 with tokenized care plan entries
 * - GET /compliance → 200 with HIPAA compliance summary
 * - GET /agent-activity → 200 with agent session activity
 * - Auth: unauthenticated GET /queue → 401
 * - HIPAA: patientToken in all responses is not null and is tokenized
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { requestId } from '../middleware/request-id.js';
import { healthcareRouter, configureHealthcareRoutes } from '../routes/healthcare.js';
import { configureAuth } from '../middleware/auth.js';
import { globalErrorHandler } from '../middleware/error-handler.js';

// ─── Mock @ordr/auth ─────────────────────────────────────────────

vi.mock('@ordr/auth', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({
    authenticated: true,
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['tenant_admin'],
      permissions: [],
    },
  }),
  requireRole: vi.fn(),
  requirePermission: vi.fn(),
  requireTenant: vi.fn(),
  ROLE_HIERARCHY: {},
  ROLE_PERMISSIONS: {},
  hasRole: vi.fn().mockReturnValue(true),
  hasPermission: vi.fn().mockReturnValue(true),
}));

// ─── Mock DB Fixtures ─────────────────────────────────────────────
//
// All IDs are synthetic UUIDs — no PHI. Patient names and contact
// information are never stored in these fixture objects.

const MOCK_CUSTOMERS = [
  {
    id: 'aaaa0000-0000-0000-0000-000000000001',
    healthScore: 15,
    lifecycleStage: 'lead',
    updatedAt: new Date(Date.now() - 120 * 60_000),
    status: 'active',
  },
  {
    id: 'bbbb0000-0000-0000-0000-000000000002',
    healthScore: 45,
    lifecycleStage: 'customer',
    updatedAt: new Date(Date.now() - 30 * 60_000),
    status: 'active',
  },
];

const MOCK_INTERACTIONS = [
  {
    id: 'int-0001',
    customerId: 'aaaa0000-0000-0000-0000-000000000001',
    type: 'meeting',
    channel: 'calendar',
    direction: 'inbound',
    createdAt: new Date(Date.now() - 60 * 60_000),
  },
];

const MOCK_COMPLIANCE_COUNTS = [
  { result: 'pass', total: 42 },
  { result: 'fail', total: 3 },
  { result: 'warning', total: 5 },
];

const MOCK_LATEST_AUDIT = [{ enforcedAt: new Date('2026-03-21T10:00:00Z') }];

const MOCK_AGENT_SESSIONS = [
  {
    id: 'sess-health-001',
    agentRole: 'health_monitor',
    status: 'completed',
    outcome: 'Patient queue updated',
    confidenceAvg: 0.87,
    startedAt: new Date(Date.now() - 15 * 60_000),
  },
  {
    id: 'sess-sched-001',
    agentRole: 'scheduler_agent',
    status: 'completed',
    outcome: 'Appointment scheduled',
    confidenceAvg: 0.92,
    startedAt: new Date(Date.now() - 45 * 60_000),
  },
];

// ─── Mock DB Builder ─────────────────────────────────────────────

function createMockDb() {
  let queryIndex = 0;
  const results: unknown[][] = [
    MOCK_CUSTOMERS, // queue → customers select
    MOCK_INTERACTIONS, // appointments → interactions select
    MOCK_CUSTOMERS, // care-plans → customers select
    MOCK_COMPLIANCE_COUNTS, // compliance → counts select
    MOCK_LATEST_AUDIT, // compliance → latest audit select
    MOCK_AGENT_SESSIONS, // agent-activity → health sessions
    [], // agent-activity → scheduler sessions (dedup merge)
  ];

  const makeChain = (result: unknown[]) => {
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'groupBy'];
    const thenable = {
      then: (resolve: (v: unknown) => void) => {
        resolve(result);
      },
    };
    for (const m of methods) {
      (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
    }
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    return thenable;
  };

  return {
    select: vi.fn().mockImplementation(() => {
      const result = results[queryIndex] ?? [];
      queryIndex++;
      return makeChain(result);
    }),
    _reset: () => {
      queryIndex = 0;
    },
  };
}

// ─── Setup Helpers ───────────────────────────────────────────────

function createTestApp(withTenantContext = true): Hono<Env> {
  const app = new Hono<Env>();
  app.onError(globalErrorHandler);
  app.use('*', requestId);

  if (withTenantContext) {
    app.use('*', async (c, next) => {
      c.set('tenantContext', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        roles: ['tenant_admin'],
        permissions: [],
      });
      await next();
    });
  }

  app.route('/api/v1/healthcare', healthcareRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Healthcare Routes', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    configureAuth({
      publicKey: 'test-public-key',
      privateKey: 'test-private-key',
      issuer: 'test-issuer',
      audience: 'test-audience',
      accessTokenTtl: 3600,
      refreshTokenTtl: 86400,
    } as never);

    mockDb = createMockDb();
    configureHealthcareRoutes(mockDb as never);
  });

  // ─── GET /queue ───────────────────────────────────────────────

  describe('GET /api/v1/healthcare/queue', () => {
    it('returns 200 with patient queue array', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/queue', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: Array<{
          tokenId: string;
          priority: string;
          position: number;
          waitMinutes: number;
          department: string;
        }>;
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('HIPAA §164.514(b): all queue entries use tokenized IDs (PTK- prefix), no PHI', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/queue', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: Array<{ tokenId: string }> };
      for (const entry of body.data) {
        expect(entry.tokenId).toBeTruthy();
        expect(entry.tokenId).toMatch(/^PTK-/);
      }
    });

    it('returns valid priority values for each queue entry', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/queue', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: Array<{ priority: string }> };
      const validPriorities = ['urgent', 'high', 'normal', 'low'];
      for (const entry of body.data) {
        expect(validPriorities).toContain(entry.priority);
      }
    });

    it('returns position as a sequential 1-based integer', async () => {
      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/queue', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: Array<{ position: number }> };
      body.data.forEach((entry, idx) => {
        expect(entry.position).toBe(idx + 1);
      });
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/healthcare/queue');

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /appointments ────────────────────────────────────────

  describe('GET /api/v1/healthcare/appointments', () => {
    it('returns 200 with appointment list', async () => {
      mockDb._reset();
      // Skip the customers call, use interactions result second
      const appInstance = createTestApp();

      // Re-configure db for appointments call sequence
      let callIdx = 0;
      const appointmentDb = {
        select: vi.fn().mockImplementation(() => {
          callIdx++;
          const result = callIdx === 1 ? MOCK_INTERACTIONS : [];
          const thenable = {
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
          };
          const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'groupBy'];
          for (const m of methods) {
            (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
          }
          return thenable;
        }),
      };
      configureHealthcareRoutes(appointmentDb as never);

      const res = await appInstance.request('/api/v1/healthcare/appointments', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: Array<{
          id: string;
          patientToken: string;
          scheduledAt: string;
          durationMinutes: number;
          type: string;
          status: string;
        }>;
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('HIPAA §164.514(b): patientToken is not null and uses PTK- prefix', async () => {
      let callIdx = 0;
      const appointmentDb = {
        select: vi.fn().mockImplementation(() => {
          callIdx++;
          const result = callIdx === 1 ? MOCK_INTERACTIONS : [];
          const thenable = {
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
          };
          const methods = ['from', 'where', 'orderBy', 'limit'];
          for (const m of methods) {
            (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
          }
          return thenable;
        }),
      };
      configureHealthcareRoutes(appointmentDb as never);

      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/appointments', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as {
        data: Array<{ patientToken: string | null }>;
      };
      for (const entry of body.data) {
        expect(entry.patientToken).not.toBeNull();
        expect(entry.patientToken).toMatch(/^PTK-/);
      }
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/healthcare/appointments');

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /care-plans ──────────────────────────────────────────

  describe('GET /api/v1/healthcare/care-plans', () => {
    it('returns 200 with care plan list', async () => {
      let callIdx = 0;
      const carePlanDb = {
        select: vi.fn().mockImplementation(() => {
          callIdx++;
          const result = callIdx === 1 ? MOCK_CUSTOMERS : [];
          const thenable = {
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
          };
          const methods = ['from', 'where', 'orderBy', 'limit'];
          for (const m of methods) {
            (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
          }
          return thenable;
        }),
      };
      configureHealthcareRoutes(carePlanDb as never);

      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/care-plans', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: Array<{ id: string; patientToken: string; phase: string; completionPct: number }>;
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('HIPAA §164.514(b): patientToken in care plans uses PTK- prefix', async () => {
      let callIdx = 0;
      const carePlanDb = {
        select: vi.fn().mockImplementation(() => {
          callIdx++;
          const result = callIdx === 1 ? MOCK_CUSTOMERS : [];
          const thenable = {
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
          };
          const methods = ['from', 'where', 'orderBy', 'limit'];
          for (const m of methods) {
            (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
          }
          return thenable;
        }),
      };
      configureHealthcareRoutes(carePlanDb as never);

      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/care-plans', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: Array<{ patientToken: string }> };
      for (const entry of body.data) {
        expect(entry.patientToken).toMatch(/^PTK-/);
      }
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/healthcare/care-plans');

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /compliance ──────────────────────────────────────────

  describe('GET /api/v1/healthcare/compliance', () => {
    it('returns 200 with level, hipaaScore, lastAuditDate, openFindings', async () => {
      let callIdx = 0;
      const complianceDb = {
        select: vi.fn().mockImplementation(() => {
          callIdx++;
          const result = callIdx === 1 ? MOCK_COMPLIANCE_COUNTS : MOCK_LATEST_AUDIT;
          const thenable = {
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
          };
          const methods = ['from', 'where', 'orderBy', 'limit', 'groupBy'];
          for (const m of methods) {
            (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
          }
          return thenable;
        }),
      };
      configureHealthcareRoutes(complianceDb as never);

      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/compliance', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          level: string;
          hipaaScore: number;
          lastAuditDate: string;
          openFindings: number;
          checksPassed: number;
          checksTotal: number;
        };
      };
      expect(body.success).toBe(true);
      expect(['green', 'yellow', 'red']).toContain(body.data.level);
      expect(typeof body.data.hipaaScore).toBe('number');
      expect(body.data.hipaaScore).toBeGreaterThanOrEqual(0);
      expect(body.data.hipaaScore).toBeLessThanOrEqual(100);
      expect(typeof body.data.lastAuditDate).toBe('string');
      expect(typeof body.data.openFindings).toBe('number');
    });

    it('computes openFindings as fail + warning counts', async () => {
      let callIdx = 0;
      const complianceDb = {
        select: vi.fn().mockImplementation(() => {
          callIdx++;
          const result = callIdx === 1 ? MOCK_COMPLIANCE_COUNTS : MOCK_LATEST_AUDIT;
          const thenable = {
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
          };
          const methods = ['from', 'where', 'orderBy', 'limit', 'groupBy'];
          for (const m of methods) {
            (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
          }
          return thenable;
        }),
      };
      configureHealthcareRoutes(complianceDb as never);

      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/compliance', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: { openFindings: number } };
      // From MOCK_COMPLIANCE_COUNTS: fail=3 + warning=5 = 8
      expect(body.data.openFindings).toBe(8);
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/healthcare/compliance');

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /agent-activity ──────────────────────────────────────

  describe('GET /api/v1/healthcare/agent-activity', () => {
    it('returns 200 with agent activity list', async () => {
      let callIdx = 0;
      const activityDb = {
        select: vi.fn().mockImplementation(() => {
          callIdx++;
          const result = callIdx === 1 ? MOCK_AGENT_SESSIONS : [];
          const thenable = {
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
          };
          const methods = ['from', 'where', 'orderBy', 'limit'];
          for (const m of methods) {
            (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
          }
          return thenable;
        }),
      };
      configureHealthcareRoutes(activityDb as never);

      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/agent-activity', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: Array<{
          id: string;
          agentName: string;
          action: string;
          status: string;
          timestamp: string;
        }>;
      };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns valid status values for each activity entry', async () => {
      let callIdx = 0;
      const activityDb = {
        select: vi.fn().mockImplementation(() => {
          callIdx++;
          const result = callIdx === 1 ? MOCK_AGENT_SESSIONS : [];
          const thenable = {
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
          };
          const methods = ['from', 'where', 'orderBy', 'limit'];
          for (const m of methods) {
            (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
          }
          return thenable;
        }),
      };
      configureHealthcareRoutes(activityDb as never);

      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/agent-activity', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: Array<{ status: string }> };
      const validStatuses = ['completed', 'failed', 'pending'];
      for (const entry of body.data) {
        expect(validStatuses).toContain(entry.status);
      }
    });

    it('HIPAA §164.502(b): activity entries contain no PHI fields', async () => {
      let callIdx = 0;
      const activityDb = {
        select: vi.fn().mockImplementation(() => {
          callIdx++;
          const result = callIdx === 1 ? MOCK_AGENT_SESSIONS : [];
          const thenable = {
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
            },
          };
          const methods = ['from', 'where', 'orderBy', 'limit'];
          for (const m of methods) {
            (thenable as Record<string, unknown>)[m] = vi.fn().mockReturnValue(thenable);
          }
          return thenable;
        }),
      };
      configureHealthcareRoutes(activityDb as never);

      const app = createTestApp();
      const res = await app.request('/api/v1/healthcare/agent-activity', {
        headers: { Authorization: 'Bearer mock-token' },
      });

      const body = (await res.json()) as { data: Array<Record<string, unknown>> };
      const phiFields = ['name', 'email', 'phone', 'dob', 'diagnosis', 'address', 'ssn'];
      for (const entry of body.data) {
        for (const field of phiFields) {
          expect(entry).not.toHaveProperty(field);
        }
      }
    });

    it('returns 401 when unauthenticated', async () => {
      const { authenticateRequest } = await import('@ordr/auth');
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        authenticated: false,
        context: undefined as never,
      } as never);

      const app = createTestApp(false);
      const res = await app.request('/api/v1/healthcare/agent-activity');

      expect(res.status).toBe(401);
    });
  });
});
