import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOk, isErr } from '@ordr/core';
import { createScheduleAppointmentTool } from '../../tools/healthcare/schedule-appointment.js';
import type { ScheduleAppointmentDeps, AppointmentConfirmation } from '../../tools/healthcare/schedule-appointment.js';
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
    sessionId: 'session-appt-test',
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

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const mockConfirmation: AppointmentConfirmation = {
  appointmentId: 'appt-123',
  patientToken: 'pat-token-001',
  providerId: 'prov-001',
  dateTime: futureDate,
  appointmentType: 'follow_up',
  status: 'confirmed',
};

const mockAuditLog = vi.fn().mockResolvedValue(undefined);

// ─── Tests ──────────────────────────────────────────────────────

describe('createScheduleAppointmentTool', () => {
  let deps: ScheduleAppointmentDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      checkAvailability: vi.fn().mockResolvedValue(true),
      createAppointment: vi.fn().mockResolvedValue(mockConfirmation),
      auditLog: mockAuditLog,
    };
  });

  it('should schedule a valid appointment', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as Record<string, unknown>;
      expect(data['appointmentId']).toBe('appt-123');
      expect(data['status']).toBe('confirmed');
    }
  });

  it('should return appointment ID in confirmation', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'initial_consultation',
      },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as Record<string, unknown>)['appointmentId']).toBeDefined();
    }
  });

  it('should reject past date-time', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: pastDate,
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject invalid date-time string', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: 'not-a-date',
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject when provider is unavailable', async () => {
    deps = { ...deps, checkAvailability: vi.fn().mockResolvedValue(false) };
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-busy',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should audit-log unavailability', async () => {
    deps = { ...deps, checkAvailability: vi.fn().mockResolvedValue(false) };
    const tool = createScheduleAppointmentTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-busy',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'schedule_appointment_unavailable',
      }),
    );
  });

  it('should reject missing patient token', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject empty patient token', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: '',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject missing provider ID', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject invalid appointment type', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'invalid_type',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should accept all valid appointment types', async () => {
    const types = [
      'initial_consultation',
      'follow_up',
      'annual_checkup',
      'specialist_referral',
      'urgent_care',
      'telehealth',
    ];

    for (const appointmentType of types) {
      const tool = createScheduleAppointmentTool(deps);
      const result = await tool.execute(
        {
          patientToken: 'pat-token-001',
          providerId: 'prov-001',
          dateTime: futureDate,
          appointmentType,
        },
        makeContext(),
      );

      expect(isOk(result)).toBe(true);
    }
  });

  it('should audit-log successful scheduling', async () => {
    const tool = createScheduleAppointmentTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'schedule_appointment_success',
        resource: 'appointment',
      }),
    );
  });

  it('should have tool name "schedule_appointment"', () => {
    const tool = createScheduleAppointmentTool(deps);
    expect(tool.name).toBe('schedule_appointment');
  });

  it('should pass tenantId to checkAvailability', async () => {
    const tool = createScheduleAppointmentTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext({ tenantId: 'tenant-health' }),
    );

    expect(deps.checkAvailability).toHaveBeenCalledWith('prov-001', futureDate, 'tenant-health');
  });

  it('should pass tenantId to createAppointment', async () => {
    const tool = createScheduleAppointmentTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext({ tenantId: 'tenant-health' }),
    );

    expect(deps.createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-health' }),
    );
  });

  it('should include patientToken in audit log', async () => {
    const tool = createScheduleAppointmentTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
      },
      makeContext(),
    );

    const lastCall = mockAuditLog.mock.calls[mockAuditLog.mock.calls.length - 1];
    expect(lastCall?.[0]?.details?.patientToken).toBe('pat-token-001');
  });

  it('should accept optional notes field', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
        notes: 'Patient prefers morning appointments',
      },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
  });

  it('should reject notes exceeding 500 characters', async () => {
    const tool = createScheduleAppointmentTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        providerId: 'prov-001',
        dateTime: futureDate,
        appointmentType: 'follow_up',
        notes: 'x'.repeat(501),
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });
});
