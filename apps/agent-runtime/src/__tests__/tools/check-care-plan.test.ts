import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOk, isErr } from '@ordr/core';
import { createCheckCarePlanTool } from '../../tools/healthcare/check-care-plan.js';
import type { CheckCarePlanDeps, TokenizedCarePlanSummary } from '../../tools/healthcare/check-care-plan.js';
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
    sessionId: 'session-careplan-test',
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

const mockCarePlan: TokenizedCarePlanSummary = {
  carePlanId: 'cp-001',
  patientToken: 'pat-token-001',
  status: 'active',
  createdDate: '2026-01-15',
  lastUpdatedDate: '2026-03-20',
  goalCount: 5,
  activeGoals: 3,
  completedGoals: 2,
  nextReviewDate: '2026-04-15',
  careTeamSize: 4,
  primaryProviderId: 'prov-001',
};

const mockAuditLog = vi.fn().mockResolvedValue(undefined);

// ─── Tests ──────────────────────────────────────────────────────

describe('createCheckCarePlanTool', () => {
  let deps: CheckCarePlanDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      findCarePlan: vi.fn().mockResolvedValue(mockCarePlan),
      auditLog: mockAuditLog,
    };
  });

  it('should return tokenized care plan data', async () => {
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as Record<string, unknown>;
      expect(data['carePlanId']).toBe('cp-001');
      expect(data['status']).toBe('active');
      expect(data['goalCount']).toBe(5);
    }
  });

  it('should return active and completed goal counts', async () => {
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as Record<string, unknown>;
      expect(data['activeGoals']).toBe(3);
      expect(data['completedGoals']).toBe(2);
    }
  });

  it('should never return raw PHI in care plan output', async () => {
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as Record<string, unknown>;
      // These clinical PHI fields should NEVER appear
      expect(data['diagnosis']).toBeUndefined();
      expect(data['medications']).toBeUndefined();
      expect(data['treatmentDetails']).toBeUndefined();
      expect(data['patientName']).toBeUndefined();
      expect(data['clinicalNotes']).toBeUndefined();
    }
  });

  it('should audit-log the read access', async () => {
    const tool = createCheckCarePlanTool(deps);
    await tool.execute({ patientToken: 'pat-token-001' }, makeContext());

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'check_care_plan_success',
        resource: 'care_plan',
      }),
    );
  });

  it('should mark access as read_only in audit log', async () => {
    const tool = createCheckCarePlanTool(deps);
    await tool.execute({ patientToken: 'pat-token-001' }, makeContext());

    const lastCall = mockAuditLog.mock.calls[mockAuditLog.mock.calls.length - 1];
    expect(lastCall?.[0]?.details?.accessType).toBe('read_only');
  });

  it('should return not found when care plan does not exist', async () => {
    deps = { ...deps, findCarePlan: vi.fn().mockResolvedValue(undefined) };
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-missing' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should audit-log not-found lookups', async () => {
    deps = { ...deps, findCarePlan: vi.fn().mockResolvedValue(undefined) };
    const tool = createCheckCarePlanTool(deps);
    await tool.execute({ patientToken: 'pat-missing' }, makeContext());

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'check_care_plan_not_found',
      }),
    );
  });

  it('should reject empty patient token', async () => {
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: '' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject missing patient token', async () => {
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      {},
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should have tool name "check_care_plan"', () => {
    const tool = createCheckCarePlanTool(deps);
    expect(tool.name).toBe('check_care_plan');
  });

  it('should have a description mentioning read-only', () => {
    const tool = createCheckCarePlanTool(deps);
    expect(tool.description).toContain('Read-only');
  });

  it('should return nextReviewDate when available', async () => {
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as Record<string, unknown>)['nextReviewDate']).toBe('2026-04-15');
    }
  });

  it('should return primaryProviderId', async () => {
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as Record<string, unknown>)['primaryProviderId']).toBe('prov-001');
    }
  });

  it('should pass tenantId to findCarePlan', async () => {
    const tool = createCheckCarePlanTool(deps);
    await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext({ tenantId: 'tenant-health' }),
    );

    expect(deps.findCarePlan).toHaveBeenCalledWith('pat-token-001', 'tenant-health');
  });

  it('should include sessionId in audit log', async () => {
    const tool = createCheckCarePlanTool(deps);
    await tool.execute({ patientToken: 'pat-token-001' }, makeContext());

    const lastCall = mockAuditLog.mock.calls[mockAuditLog.mock.calls.length - 1];
    expect(lastCall?.[0]?.details?.sessionId).toBe('session-careplan-test');
  });

  it('should include carePlanStatus in audit log', async () => {
    const tool = createCheckCarePlanTool(deps);
    await tool.execute({ patientToken: 'pat-token-001' }, makeContext());

    const lastCall = mockAuditLog.mock.calls[mockAuditLog.mock.calls.length - 1];
    expect(lastCall?.[0]?.details?.carePlanStatus).toBe('active');
  });

  it('should return careTeamSize in output', async () => {
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as Record<string, unknown>)['careTeamSize']).toBe(4);
    }
  });

  it('should handle null nextReviewDate', async () => {
    const planWithoutReview = { ...mockCarePlan, nextReviewDate: null };
    deps = { ...deps, findCarePlan: vi.fn().mockResolvedValue(planWithoutReview) };
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as Record<string, unknown>)['nextReviewDate']).toBeNull();
    }
  });

  it('should handle null primaryProviderId', async () => {
    const planWithoutProvider = { ...mockCarePlan, primaryProviderId: null };
    deps = { ...deps, findCarePlan: vi.fn().mockResolvedValue(planWithoutProvider) };
    const tool = createCheckCarePlanTool(deps);
    const result = await tool.execute(
      { patientToken: 'pat-token-001' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as Record<string, unknown>)['primaryProviderId']).toBeNull();
    }
  });
});
