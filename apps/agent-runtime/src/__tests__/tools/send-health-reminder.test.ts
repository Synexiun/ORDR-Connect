import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, isOk, isErr, InternalError } from '@ordr/core';
import { createSendHealthReminderTool } from '../../tools/healthcare/send-health-reminder.js';
import type { SendHealthReminderDeps } from '../../tools/healthcare/send-health-reminder.js';
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
    sessionId: 'session-reminder-test',
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

const mockAuditLog = vi.fn().mockResolvedValue(undefined);

// ─── Tests ──────────────────────────────────────────────────────

describe('createSendHealthReminderTool', () => {
  let deps: SendHealthReminderDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      checkTcpaConsent: vi.fn().mockResolvedValue(true),
      checkHipaaConsent: vi.fn().mockResolvedValue(true),
      sendReminder: vi.fn().mockResolvedValue(ok({ deliveryId: 'del-123', status: 'queued' })),
      auditLog: mockAuditLog,
    };
  });

  it('should send reminder when both TCPA and HIPAA consent pass', async () => {
    const tool = createSendHealthReminderTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as Record<string, unknown>;
      expect(data['deliveryId']).toBe('del-123');
      expect(data['status']).toBe('queued');
    }
  });

  it('should return channel and reminderType in response', async () => {
    const tool = createSendHealthReminderTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'medication_reminder',
        channelPreference: 'email',
      },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as Record<string, unknown>;
      expect(data['channel']).toBe('email');
      expect(data['reminderType']).toBe('medication_reminder');
    }
  });

  it('should verify TCPA consent before sending', async () => {
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(deps.checkTcpaConsent).toHaveBeenCalledWith(
      'pat-token-001',
      'sms',
      'tenant-health',
    );
  });

  it('should verify HIPAA consent before sending', async () => {
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(deps.checkHipaaConsent).toHaveBeenCalledWith(
      'pat-token-001',
      'appointment_reminder',
      'tenant-health',
    );
  });

  it('should block when TCPA consent is not verified', async () => {
    deps = { ...deps, checkTcpaConsent: vi.fn().mockResolvedValue(false) };
    const tool = createSendHealthReminderTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('TCPA');
    }
  });

  it('should block when HIPAA consent is not verified', async () => {
    deps = { ...deps, checkHipaaConsent: vi.fn().mockResolvedValue(false) };
    const tool = createSendHealthReminderTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'medication_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('HIPAA');
    }
  });

  it('should audit-log TCPA consent denial', async () => {
    deps = { ...deps, checkTcpaConsent: vi.fn().mockResolvedValue(false) };
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send_health_reminder_blocked_tcpa',
      }),
    );
  });

  it('should audit-log HIPAA consent denial', async () => {
    deps = { ...deps, checkHipaaConsent: vi.fn().mockResolvedValue(false) };
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send_health_reminder_blocked_hipaa',
      }),
    );
  });

  it('should audit-log successful delivery', async () => {
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send_health_reminder_success',
      }),
    );
  });

  it('should audit-log failed delivery', async () => {
    deps = {
      ...deps,
      sendReminder: vi.fn().mockResolvedValue(err(new InternalError('Provider down'))),
    };
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send_health_reminder_failed',
      }),
    );
  });

  it('should NOT call sendReminder when TCPA consent fails', async () => {
    deps = { ...deps, checkTcpaConsent: vi.fn().mockResolvedValue(false) };
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(deps.sendReminder).not.toHaveBeenCalled();
  });

  it('should NOT call sendReminder when HIPAA consent fails', async () => {
    deps = { ...deps, checkHipaaConsent: vi.fn().mockResolvedValue(false) };
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(deps.sendReminder).not.toHaveBeenCalled();
  });

  it('should reject empty patient token', async () => {
    const tool = createSendHealthReminderTool(deps);
    const result = await tool.execute(
      {
        patientToken: '',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject invalid reminder type', async () => {
    const tool = createSendHealthReminderTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'invalid_type',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject invalid channel preference', async () => {
    const tool = createSendHealthReminderTool(deps);
    const result = await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'pigeon',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should accept all valid reminder types', async () => {
    const types = [
      'appointment_reminder',
      'medication_reminder',
      'follow_up_reminder',
      'wellness_check',
      'lab_results_ready',
      'annual_screening',
    ];

    for (const reminderType of types) {
      const tool = createSendHealthReminderTool(deps);
      const result = await tool.execute(
        {
          patientToken: 'pat-token-001',
          reminderType,
          channelPreference: 'sms',
        },
        makeContext(),
      );

      expect(isOk(result)).toBe(true);
    }
  });

  it('should accept all valid channels', async () => {
    const channels = ['sms', 'email', 'voice'];

    for (const channelPreference of channels) {
      const tool = createSendHealthReminderTool(deps);
      const result = await tool.execute(
        {
          patientToken: 'pat-token-001',
          reminderType: 'appointment_reminder',
          channelPreference,
        },
        makeContext(),
      );

      expect(isOk(result)).toBe(true);
    }
  });

  it('should have tool name "send_health_reminder"', () => {
    const tool = createSendHealthReminderTool(deps);
    expect(tool.name).toBe('send_health_reminder');
  });

  it('should include channel in audit log details', async () => {
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'email',
      },
      makeContext(),
    );

    const lastCall = mockAuditLog.mock.calls[mockAuditLog.mock.calls.length - 1];
    expect(lastCall?.[0]?.details?.channel).toBe('email');
  });

  it('should include reminderType in audit log details', async () => {
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'medication_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    const lastCall = mockAuditLog.mock.calls[mockAuditLog.mock.calls.length - 1];
    expect(lastCall?.[0]?.details?.reminderType).toBe('medication_reminder');
  });

  it('should include sessionId in audit log details', async () => {
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    const lastCall = mockAuditLog.mock.calls[mockAuditLog.mock.calls.length - 1];
    expect(lastCall?.[0]?.details?.sessionId).toBe('session-reminder-test');
  });

  it('should check TCPA consent before HIPAA consent', async () => {
    const callOrder: string[] = [];
    deps = {
      ...deps,
      checkTcpaConsent: vi.fn().mockImplementation(() => {
        callOrder.push('tcpa');
        return Promise.resolve(true);
      }),
      checkHipaaConsent: vi.fn().mockImplementation(() => {
        callOrder.push('hipaa');
        return Promise.resolve(true);
      }),
    };

    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(callOrder[0]).toBe('tcpa');
    expect(callOrder[1]).toBe('hipaa');
  });

  it('should not check HIPAA consent if TCPA consent fails', async () => {
    deps = { ...deps, checkTcpaConsent: vi.fn().mockResolvedValue(false) };
    const tool = createSendHealthReminderTool(deps);
    await tool.execute(
      {
        patientToken: 'pat-token-001',
        reminderType: 'appointment_reminder',
        channelPreference: 'sms',
      },
      makeContext(),
    );

    expect(deps.checkHipaaConsent).not.toHaveBeenCalled();
  });

  it('should reject missing parameters', async () => {
    const tool = createSendHealthReminderTool(deps);
    const result = await tool.execute({}, makeContext());

    expect(isErr(result)).toBe(true);
  });
});
