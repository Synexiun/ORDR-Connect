/**
 * Compliance API Tests
 *
 * Validates:
 * - fetchComplianceMetrics → GET /v1/analytics/compliance?range=:timeRange
 * - fetchComplianceScore → GET /v1/analytics/compliance?range=30d
 * - fetchComplianceSummary → GET /v1/compliance/summary
 * - fetchViolations with no params → GET /v1/compliance/violations
 * - fetchViolations with regulation/resolved/page/pageSize filters
 * - resolveViolation → POST /v1/compliance/violations/:id/resolve (with/without note)
 * - fetchConsentStatus → GET /v1/compliance/consent-status
 *
 * COMPLIANCE: SOC2 CC7.2 / HIPAA §164.312 — no PHI in test assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import {
  fetchComplianceMetrics,
  fetchComplianceScore,
  fetchComplianceSummary,
  fetchViolations,
  resolveViolation,
  fetchConsentStatus,
} from '../compliance-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_COMPLIANCE_METRICS = {
  scoreTrend: [{ date: '2026-03-28', score: 97.5 }],
  violationBreakdown: [],
  checkRatios: [],
};

const MOCK_SCORE_SUMMARY = {
  overall: 97.5,
  byRegulation: { HIPAA: 98, FDCPA: 97, TCPA: 96, GDPR: 99, PIPEDA: 97, LGPD: 97, SOC2: 99 },
  openViolations: 2,
  criticalViolations: 0,
  trend: 'improving' as const,
};

const MOCK_COMPLIANCE_SUMMARY = {
  score: 97.5,
  totalChecks: 120,
  passingChecks: 117,
  failingChecks: 3,
  lastAudit: '2026-03-28T00:00:00Z',
  regulations: [{ regulation: 'HIPAA' as const, score: 98, ruleCount: 40 }],
};

const MOCK_VIOLATION = {
  id: 'vio-test-1',
  rule: 'TCPA-001',
  regulation: 'TCPA' as const,
  severity: 'medium' as const,
  description: 'Outbound call without consent record',
  customerId: 'cust-0001',
  customerName: '[REDACTED]',
  timestamp: new Date('2026-03-28T09:00:00Z').toISOString(),
  resolved: false,
  resolvedAt: null,
  resolvedBy: null,
};

const MOCK_VIOLATION_LIST = {
  success: true as const,
  data: [MOCK_VIOLATION],
  total: 1,
  page: 1,
  pageSize: 25,
};

const MOCK_CONSENT_CHANNELS = [
  { channel: 'sms', consented: 950, total: 1000, percentage: 95 },
  { channel: 'email', consented: 880, total: 900, percentage: 97.8 },
];

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ success: true, data: MOCK_COMPLIANCE_SUMMARY });
  mockPost.mockResolvedValue({
    success: true,
    data: {
      id: 'vio-test-1',
      resolved: true,
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'admin',
      note: null,
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('fetchComplianceMetrics', () => {
  it('calls GET /v1/analytics/compliance?range=7d', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_COMPLIANCE_METRICS });
    await fetchComplianceMetrics('7d');
    expect(mockGet).toHaveBeenCalledWith('/v1/analytics/compliance?range=7d');
  });

  it('appends the provided timeRange', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_COMPLIANCE_METRICS });
    await fetchComplianceMetrics('90d');
    expect(mockGet).toHaveBeenCalledWith('/v1/analytics/compliance?range=90d');
  });
});

describe('fetchComplianceScore', () => {
  it('calls GET /v1/analytics/compliance?range=30d', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_SCORE_SUMMARY });
    await fetchComplianceScore();
    expect(mockGet).toHaveBeenCalledWith('/v1/analytics/compliance?range=30d');
  });

  it('returns wrapped score summary on success', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_SCORE_SUMMARY });
    const result = await fetchComplianceScore();
    expect(result.data.overall).toBe(97.5);
    expect(result.data.trend).toBe('improving');
  });
});

describe('fetchComplianceSummary', () => {
  it('calls GET /v1/compliance/summary', async () => {
    await fetchComplianceSummary();
    expect(mockGet).toHaveBeenCalledWith('/v1/compliance/summary');
  });

  it('returns wrapped summary with score and check counts', async () => {
    const result = await fetchComplianceSummary();
    expect(result.data.score).toBe(97.5);
    expect(result.data.totalChecks).toBe(120);
    expect(result.data.passingChecks).toBe(117);
  });
});

describe('fetchViolations', () => {
  it('calls GET /v1/compliance/violations with no query string when no params', async () => {
    mockGet.mockResolvedValue(MOCK_VIOLATION_LIST);
    await fetchViolations();
    expect(mockGet).toHaveBeenCalledWith('/v1/compliance/violations');
  });

  it('appends regulation filter', async () => {
    mockGet.mockResolvedValue(MOCK_VIOLATION_LIST);
    await fetchViolations({ regulation: 'HIPAA' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('regulation=HIPAA');
  });

  it('appends resolved filter', async () => {
    mockGet.mockResolvedValue(MOCK_VIOLATION_LIST);
    await fetchViolations({ resolved: false });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('resolved=false');
  });

  it('appends page and pageSize', async () => {
    mockGet.mockResolvedValue(MOCK_VIOLATION_LIST);
    await fetchViolations({ page: 2, pageSize: 50 });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
  });

  it('returns ViolationListResponse with data array', async () => {
    mockGet.mockResolvedValue(MOCK_VIOLATION_LIST);
    const result = await fetchViolations();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('vio-test-1');
    expect(result.data[0].regulation).toBe('TCPA');
  });
});

describe('resolveViolation', () => {
  it('calls POST /v1/compliance/violations/:id/resolve without note', async () => {
    await resolveViolation('vio-test-1');
    expect(mockPost).toHaveBeenCalledWith('/v1/compliance/violations/vio-test-1/resolve', {});
  });

  it('calls POST /v1/compliance/violations/:id/resolve with note', async () => {
    await resolveViolation('vio-test-1', 'Corrective action taken');
    expect(mockPost).toHaveBeenCalledWith('/v1/compliance/violations/vio-test-1/resolve', {
      note: 'Corrective action taken',
    });
  });

  it('returns resolved:true on success', async () => {
    const result = await resolveViolation('vio-test-1');
    expect(result.data.resolved).toBe(true);
    expect(result.data.id).toBe('vio-test-1');
  });
});

describe('fetchConsentStatus', () => {
  it('calls GET /v1/compliance/consent-status', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_CONSENT_CHANNELS });
    await fetchConsentStatus();
    expect(mockGet).toHaveBeenCalledWith('/v1/compliance/consent-status');
  });

  it('returns wrapped consent channel array', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_CONSENT_CHANNELS });
    const result = await fetchConsentStatus();
    expect(result.data).toHaveLength(2);
    expect(result.data[0].channel).toBe('sms');
    expect(result.data[0].percentage).toBe(95);
  });
});
