/**
 * Healthcare API Tests
 *
 * Validates:
 * - getPatientQueue → GET /api/v1/healthcare/queue
 * - getAppointments → GET /api/v1/healthcare/appointments
 * - getCarePlans → GET /api/v1/healthcare/care-plans
 * - getComplianceStatus → GET /api/v1/healthcare/compliance
 * - getAgentActivity → GET /api/v1/healthcare/agent-activity
 *
 * Note: healthcare-api uses global fetch (not apiClient), so tests mock globalThis.fetch.
 *
 * COMPLIANCE: HIPAA §164.312(a)(1) — no PHI in test assertions.
 * All identifiers are tokenized (patientToken, tokenId).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getPatientQueue,
  getAppointments,
  getCarePlans,
  getComplianceStatus,
  getAgentActivity,
} from '../healthcare-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_QUEUE_ITEM = {
  tokenId: 'tok-q-001',
  priority: 'high' as const,
  position: 1,
  waitMinutes: 15,
  department: 'Cardiology',
};

const MOCK_APPOINTMENT = {
  id: 'apt-test-1',
  patientToken: 'tok-p-001',
  scheduledAt: new Date('2026-03-29T10:00:00Z').toISOString(),
  durationMinutes: 30,
  type: 'consultation' as const,
  status: 'scheduled' as const,
};

const MOCK_CARE_PLAN = {
  id: 'cp-test-1',
  patientToken: 'tok-p-001',
  phase: 'implementation' as const,
  completionPct: 65,
  updatedAt: new Date('2026-03-28T00:00:00Z').toISOString(),
};

const MOCK_COMPLIANCE_STATUS = {
  level: 'green' as const,
  hipaaScore: 97.5,
  lastAuditDate: '2026-03-01',
  openFindings: 1,
  checksPassed: 118,
  checksTotal: 120,
};

const MOCK_AGENT_ACTIVITY = {
  id: 'act-test-1',
  agentName: 'Intake Agent',
  action: 'Scheduled follow-up',
  status: 'completed' as const,
  timestamp: new Date('2026-03-28T10:00:00Z').toISOString(),
  confidence: 0.92,
};

// ─── Helpers ──────────────────────────────────────────────────────

function mockFetchSuccess(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data }),
    }),
  );
}

function mockFetchFailure(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({}),
    }),
  );
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  mockFetchSuccess([MOCK_QUEUE_ITEM]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('getPatientQueue', () => {
  it('calls /api/v1/healthcare/queue', async () => {
    mockFetchSuccess([MOCK_QUEUE_ITEM]);
    await getPatientQueue();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/healthcare/queue',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns queue items on success', async () => {
    mockFetchSuccess([MOCK_QUEUE_ITEM]);
    const result = await getPatientQueue();
    expect(result).toHaveLength(1);
    expect(result[0].tokenId).toBe('tok-q-001');
    expect(result[0].priority).toBe('high');
  });

  it('throws on non-ok response', async () => {
    mockFetchFailure(503);
    await expect(getPatientQueue()).rejects.toThrow('Healthcare API error');
  });
});

describe('getAppointments', () => {
  it('calls /api/v1/healthcare/appointments', async () => {
    mockFetchSuccess([MOCK_APPOINTMENT]);
    await getAppointments();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/healthcare/appointments',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns appointments on success', async () => {
    mockFetchSuccess([MOCK_APPOINTMENT]);
    const result = await getAppointments();
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('consultation');
    expect(result[0].status).toBe('scheduled');
  });
});

describe('getCarePlans', () => {
  it('calls /api/v1/healthcare/care-plans', async () => {
    mockFetchSuccess([MOCK_CARE_PLAN]);
    await getCarePlans();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/healthcare/care-plans',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns care plan statuses on success', async () => {
    mockFetchSuccess([MOCK_CARE_PLAN]);
    const result = await getCarePlans();
    expect(result[0].phase).toBe('implementation');
    expect(result[0].completionPct).toBe(65);
  });
});

describe('getComplianceStatus', () => {
  it('calls /api/v1/healthcare/compliance', async () => {
    mockFetchSuccess(MOCK_COMPLIANCE_STATUS);
    await getComplianceStatus();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/healthcare/compliance',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns compliance status with hipaaScore', async () => {
    mockFetchSuccess(MOCK_COMPLIANCE_STATUS);
    const result = await getComplianceStatus();
    expect(result.level).toBe('green');
    expect(result.hipaaScore).toBe(97.5);
    expect(result.checksPassed).toBe(118);
  });
});

describe('getAgentActivity', () => {
  it('calls /api/v1/healthcare/agent-activity', async () => {
    mockFetchSuccess([MOCK_AGENT_ACTIVITY]);
    await getAgentActivity();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/healthcare/agent-activity',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns agent activity items on success', async () => {
    mockFetchSuccess([MOCK_AGENT_ACTIVITY]);
    const result = await getAgentActivity();
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('completed');
    expect(result[0].confidence).toBe(0.92);
  });

  it('throws when success=false in response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false, data: [] }),
      }),
    );
    await expect(getAgentActivity()).rejects.toThrow('success=false');
  });
});
