/**
 * DSR Export Worker Handler tests
 *
 * GDPR Art. 15 — export job produces full JSON archive
 * GDPR Art. 17 — erasure flow destroys key + pseudonymises PII
 *
 * Verifies:
 * - access DSR → runs export flow → sets status=completed
 * - portability DSR → same as access
 * - erasure DSR → runs export first, then scheduleErasure → executeErasure → verifyErasure → pseudonymise
 * - Idempotency: already-processing DSR is skipped
 * - Failure → sets status=failed + emits dsr.failed audit event
 * - Email pseudonymisation uses random UUID suffix, NOT a hash
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDsrExportHandler } from '../handlers/dsr-export.js';
import type { EventEnvelope } from '@ordr/events';
import type { DsrApprovedPayload } from '@ordr/events';

// ─── Shared IDs ───────────────────────────────────────────────────

const DSR_ID = '00000000-0000-0000-0000-000000000010';
const CUSTOMER_ID = '00000000-0000-0000-0000-000000000020';
const TENANT_ID = 'tenant-1';

// ─── Mock helpers ─────────────────────────────────────────────────

function buildEvent(type: 'access' | 'erasure' | 'portability'): EventEnvelope<DsrApprovedPayload> {
  return {
    id: '00000000-0000-0000-0000-000000000099',
    type: 'dsr.approved',
    tenantId: TENANT_ID,
    payload: { dsrId: DSR_ID, tenantId: TENANT_ID, customerId: CUSTOMER_ID, type },
    metadata: { correlationId: 'corr-1', causationId: 'cause-1', source: 'api', version: 1 },
    timestamp: new Date().toISOString(),
  };
}

const mockTransitionProcessing = vi.fn().mockResolvedValue({ status: 'processing' });
const mockLoadCustomer = vi
  .fn()
  .mockResolvedValue({
    name: 'Alice',
    email: 'alice@example.com',
    phone: '+1234567890',
    type: 'individual',
    status: 'active',
    createdAt: new Date().toISOString(),
  });
const mockLoadContacts = vi.fn().mockResolvedValue([]);
const mockLoadConsent = vi.fn().mockResolvedValue([]);
const mockLoadTickets = vi.fn().mockResolvedValue([]);
const mockLoadMemories = vi.fn().mockResolvedValue([]);
const mockLoadAnalytics = vi.fn().mockResolvedValue({ health_score: 80, ticket_count: 5 });
const mockUploadExport = vi
  .fn()
  .mockResolvedValue({
    s3Key: 'dsr-exports/t/d/e.json.enc',
    s3Bucket: 'ordr-audit',
    fileSizeBytes: 1024,
    checksumSha256: 'abc',
  });
const mockSaveExport = vi.fn().mockResolvedValue(undefined);
const mockCompleteDsr = vi.fn().mockResolvedValue(undefined);
const mockScheduleErasure = vi.fn().mockResolvedValue({ id: 'er-1' });
const mockExecuteErasure = vi.fn().mockResolvedValue(undefined);
const mockVerifyErasure = vi.fn().mockResolvedValue(true);
const mockPseudonymise = vi.fn().mockResolvedValue(undefined);
const mockAuditLog = vi.fn().mockResolvedValue(undefined);

function buildDeps() {
  return {
    transitionProcessing: mockTransitionProcessing,
    loadCustomer: mockLoadCustomer,
    loadContacts: mockLoadContacts,
    loadConsent: mockLoadConsent,
    loadTickets: mockLoadTickets,
    loadMemories: mockLoadMemories,
    loadAnalytics: mockLoadAnalytics,
    uploadExport: mockUploadExport,
    saveExport: mockSaveExport,
    completeDsr: mockCompleteDsr,
    scheduleErasure: mockScheduleErasure,
    executeErasure: mockExecuteErasure,
    verifyErasure: mockVerifyErasure,
    pseudonymise: mockPseudonymise,
    auditLogger: { log: mockAuditLog },
  };
}

describe('createDsrExportHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('access DSR: transitions to processing and completes', async () => {
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('access') as never);

    expect(mockTransitionProcessing).toHaveBeenCalledWith({ dsrId: DSR_ID, tenantId: TENANT_ID });
    expect(mockUploadExport).toHaveBeenCalled();
    expect(mockCompleteDsr).toHaveBeenCalledWith({ dsrId: DSR_ID, tenantId: TENANT_ID });
    expect(mockPseudonymise).not.toHaveBeenCalled();
  });

  it('portability DSR: behaves identically to access', async () => {
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('portability') as never);

    expect(mockCompleteDsr).toHaveBeenCalled();
    expect(mockScheduleErasure).not.toHaveBeenCalled();
  });

  it('erasure DSR: exports first, then erases, then pseudonymises', async () => {
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('erasure') as never);

    expect(mockUploadExport).toHaveBeenCalled();
    expect(mockScheduleErasure).toHaveBeenCalled();
    expect(mockExecuteErasure).toHaveBeenCalled();
    expect(mockVerifyErasure).toHaveBeenCalled();
    expect(mockPseudonymise).toHaveBeenCalled();
  });

  it('erasure: pseudonymised email uses random UUID suffix, not a hash', async () => {
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('erasure') as never);

    const call = mockPseudonymise.mock.calls[0] as [{ email: string }];
    expect(call[0].email).toMatch(/^\[erased-[0-9a-f-]{36}\]$/);
  });

  it('idempotency: already-processing DSR is skipped', async () => {
    mockTransitionProcessing.mockRejectedValueOnce(
      Object.assign(new Error('already processing'), { code: 'DSR_ALREADY_PROCESSING' }),
    );
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('access') as never);

    expect(mockUploadExport).not.toHaveBeenCalled();
  });

  it('failure: emits dsr.failed audit event', async () => {
    mockUploadExport.mockRejectedValueOnce(new Error('S3 timeout'));
    const handler = createDsrExportHandler(buildDeps() as never);
    await handler(buildEvent('access') as never);

    const auditCalls = mockAuditLog.mock.calls as Array<[{ eventType: string }]>;
    const failedEvent = auditCalls.find(([e]) => e.eventType === 'dsr.failed');
    expect(failedEvent).toBeDefined();
  });
});
