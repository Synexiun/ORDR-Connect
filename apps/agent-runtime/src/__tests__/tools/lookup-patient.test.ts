import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, isOk, isErr, AuthorizationError, InternalError } from '@ordr/core';
import { createLookupPatientTool } from '../../tools/healthcare/lookup-patient.js';
import type { LookupPatientDeps, TokenizedPatientInfo } from '../../tools/healthcare/lookup-patient.js';
import type { AgentContext, AgentBudget, KillSwitch, AgentMemoryState } from '../../types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const budget: AgentBudget = {
    maxTokens: 50_000, maxCostCents: 200, maxActions: 10,
    usedTokens: 0, usedCostCents: 0, usedActions: 0,
  };
  const killSwitch: KillSwitch = { active: false, reason: '', killedAt: null };
  const memoryState: AgentMemoryState = { observations: new Map(), steps: [] };

  return {
    sessionId: 'session-patient-test',
    tenantId: 'tenant-health',
    customerId: 'pat-token-001',
    agentRole: 'healthcare',
    autonomyLevel: 'supervised',
    tools: new Map(),
    memory: memoryState,
    budget,
    killSwitch,
    triggerEventId: 'evt-1',
    startedAt: new Date(),
    ...overrides,
  };
}

const mockPatient: TokenizedPatientInfo = {
  patientToken: 'pat-token-001',
  tenantId: 'tenant-health',
  status: 'active',
  careTeamSize: 3,
  activeCarePlan: true,
  upcomingAppointments: 2,
  consentStatus: 'granted',
  lastVisitDate: '2026-03-01',
};

const mockAuditLog = vi.fn().mockResolvedValue(undefined);

// ─── Tests ──────────────────────────────────────────────────────

describe('createLookupPatientTool', () => {
  let deps: LookupPatientDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      findPatient: vi.fn().mockResolvedValue(mockPatient),
      checkPhiAccess: vi.fn().mockResolvedValue(true),
      auditLog: mockAuditLog,
    };
  });

  it('should return tokenized patient data when all checks pass', async () => {
    const tool = createLookupPatientTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as Record<string, unknown>;
      expect(data['patientToken']).toBe('pat-token-001');
      expect(data['status']).toBe('active');
      expect(data['activeCarePlan']).toBe(true);
    }
  });

  it('should never return raw PHI fields', async () => {
    const tool = createLookupPatientTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as Record<string, unknown>;
      // These PHI fields should NEVER appear
      expect(data['name']).toBeUndefined();
      expect(data['ssn']).toBeUndefined();
      expect(data['dateOfBirth']).toBeUndefined();
      expect(data['diagnosis']).toBeUndefined();
      expect(data['address']).toBeUndefined();
      expect(data['phoneNumber']).toBeUndefined();
      expect(data['email']).toBeUndefined();
      expect(data['medicalRecordNumber']).toBeUndefined();
    }
  });

  it('should audit-log successful PHI access', async () => {
    const tool = createLookupPatientTool(deps);
    await tool.execute({ patientToken: 'pat-token-001' }, makeContext());

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lookup_patient_success',
        resource: 'patient',
        resourceId: 'pat-token-001',
      }),
    );
  });

  it('should validate PHI access permission before lookup', async () => {
    const tool = createLookupPatientTool(deps);
    await tool.execute({ patientToken: 'pat-token-001' }, makeContext());

    expect(deps.checkPhiAccess).toHaveBeenCalledWith(
      'session-patient-test',
      'tenant-health',
      'pat-token-001',
    );
  });

  it('should reject when PHI access is denied', async () => {
    deps = { ...deps, checkPhiAccess: vi.fn().mockResolvedValue(false) };
    const tool = createLookupPatientTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('PHI access denied');
    }
  });

  it('should audit-log denied PHI access attempts', async () => {
    deps = { ...deps, checkPhiAccess: vi.fn().mockResolvedValue(false) };
    const tool = createLookupPatientTool(deps);
    await tool.execute({ patientToken: 'pat-token-001' }, makeContext());

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lookup_patient_denied',
        resource: 'patient',
      }),
    );
  });

  it('should return not found when patient does not exist', async () => {
    deps = { ...deps, findPatient: vi.fn().mockResolvedValue(undefined) };
    const tool = createLookupPatientTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-missing' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should audit-log not-found lookups', async () => {
    deps = { ...deps, findPatient: vi.fn().mockResolvedValue(undefined) };
    const tool = createLookupPatientTool(deps);
    await tool.execute({ patientToken: 'pat-missing' }, makeContext());

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lookup_patient_not_found',
      }),
    );
  });

  it('should enforce tenant isolation', async () => {
    const wrongTenantPatient = { ...mockPatient, tenantId: 'tenant-other' };
    deps = { ...deps, findPatient: vi.fn().mockResolvedValue(wrongTenantPatient) };
    const tool = createLookupPatientTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext({ tenantId: 'tenant-health' }),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Cross-tenant');
    }
  });

  it('should audit-log cross-tenant access attempts', async () => {
    const wrongTenantPatient = { ...mockPatient, tenantId: 'tenant-other' };
    deps = { ...deps, findPatient: vi.fn().mockResolvedValue(wrongTenantPatient) };
    const tool = createLookupPatientTool(deps);
    await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext({ tenantId: 'tenant-health' }),
    );

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lookup_patient_tenant_violation',
      }),
    );
  });

  it('should reject empty patient token', async () => {
    const tool = createLookupPatientTool(deps);
    const result = await tool.execute(
      { patientToken: '' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject missing patient token', async () => {
    const tool = createLookupPatientTool(deps);
    const result = await tool.execute(
      {},
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should have tool name "lookup_patient"', () => {
    const tool = createLookupPatientTool(deps);
    expect(tool.name).toBe('lookup_patient');
  });

  it('should have a HIPAA-relevant description', () => {
    const tool = createLookupPatientTool(deps);
    expect(tool.description).toContain('tokenized');
  });

  it('should return careTeamSize in tokenized output', async () => {
    const tool = createLookupPatientTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as Record<string, unknown>)['careTeamSize']).toBe(3);
    }
  });

  it('should return consentStatus in tokenized output', async () => {
    const tool = createLookupPatientTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as Record<string, unknown>)['consentStatus']).toBe('granted');
    }
  });

  it('should include sessionId in audit log details', async () => {
    const tool = createLookupPatientTool(deps);
    await tool.execute({ patientToken: 'pat-token-001' }, makeContext());

    const lastCall = mockAuditLog.mock.calls[mockAuditLog.mock.calls.length - 1];
    expect(lastCall?.[0]?.details?.sessionId).toBe('session-patient-test');
  });

  it('should pass tenantId to findPatient', async () => {
    const tool = createLookupPatientTool(deps);
    await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext({ tenantId: 'tenant-health' }),
    );

    expect(deps.findPatient).toHaveBeenCalledWith('pat-token-001', 'tenant-health');
  });
});
