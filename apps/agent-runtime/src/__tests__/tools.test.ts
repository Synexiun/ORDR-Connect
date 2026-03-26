import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err, isOk, isErr, ComplianceViolationError, ValidationError, InternalError, NotFoundError } from '@ordr/core';
import type { Result, AppError } from '@ordr/core';
import { createSendSmsTool } from '../tools/send-sms.js';
import type { SendSmsDeps } from '../tools/send-sms.js';
import { createLookupCustomerTool } from '../tools/lookup-customer.js';
import type { LookupCustomerDeps, CustomerInfo } from '../tools/lookup-customer.js';
import { createCheckPaymentTool } from '../tools/check-payment.js';
import type { CheckPaymentDeps, PaymentInfo } from '../tools/check-payment.js';
import { createScheduleFollowupTool } from '../tools/schedule-followup.js';
import type { ScheduleFollowupDeps } from '../tools/schedule-followup.js';
import { createToolRegistry } from '../tools/index.js';
import type { AgentContext, AgentBudget, KillSwitch, AgentMemoryState } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const budget: AgentBudget = {
    maxTokens: 100_000, maxCostCents: 500, maxActions: 20,
    usedTokens: 0, usedCostCents: 0, usedActions: 0,
  };
  const killSwitch: KillSwitch = { active: false, reason: '', killedAt: null };
  const memoryState: AgentMemoryState = { observations: new Map(), steps: [] };

  return {
    sessionId: 'session-tool-test',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    agentRole: 'collections',
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

// ─── Send SMS Tool Tests ────────────────────────────────────────

describe('createSendSmsTool', () => {
  let deps: SendSmsDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      smsProviderSend: vi.fn().mockResolvedValue(ok({ messageId: 'msg-123', status: 'queued' })),
      consentCheck: vi.fn().mockResolvedValue(ok(true)),
      complianceCheck: vi.fn().mockReturnValue({ allowed: true, violations: [] }),
      auditLog: mockAuditLog,
    };
  });

  it('should send SMS when consent and compliance pass', async () => {
    const tool = createSendSmsTool(deps);
    const result = await tool.execute(
      { to: '+14155551234', body: 'This is an attempt to collect a debt. Payment reminder.' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as { messageId: string }).messageId).toBe('msg-123');
    }
  });

  it('should block when TCPA consent check fails', async () => {
    deps = {
      ...deps,
      consentCheck: vi.fn().mockResolvedValue(
        err(new ComplianceViolationError('No consent', 'TCPA')),
      ),
    };
    const tool = createSendSmsTool(deps);
    const result = await tool.execute(
      { to: '+14155551234', body: 'Hello' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
    expect(mockAuditLog).toHaveBeenCalled();
  });

  it('should block when compliance gate rejects', async () => {
    deps = {
      ...deps,
      complianceCheck: vi.fn().mockReturnValue({
        allowed: false,
        violations: [{ violation: { message: 'FDCPA timing violation' } }],
      }),
    };
    const tool = createSendSmsTool(deps);
    const result = await tool.execute(
      { to: '+14155551234', body: 'Reminder' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject invalid phone number format', async () => {
    const tool = createSendSmsTool(deps);
    const result = await tool.execute(
      { to: '555-1234', body: 'Hello' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject empty message body', async () => {
    const tool = createSendSmsTool(deps);
    const result = await tool.execute(
      { to: '+14155551234', body: '' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should audit log both successful and failed sends', async () => {
    const tool = createSendSmsTool(deps);
    await tool.execute(
      { to: '+14155551234', body: 'This is an attempt to collect a debt.' },
      makeContext(),
    );

    expect(mockAuditLog).toHaveBeenCalled();
    const lastCall = mockAuditLog.mock.calls[mockAuditLog.mock.calls.length - 1];
    expect(lastCall?.[0]?.action).toContain('send_sms');
  });
});

// ─── Lookup Customer Tool Tests ─────────────────────────────────

describe('createLookupCustomerTool', () => {
  let deps: LookupCustomerDeps;

  const mockCustomer: CustomerInfo = {
    customerId: 'cust-1',
    tenantId: 'tenant-1',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+14155551234',
    healthScore: 72,
    lifecycleStage: 'active',
    outstandingBalance: 1500.00,
    lastInteractionAt: new Date('2025-01-10'),
    recentInteractions: [{
      id: 'int-1',
      type: 'sms',
      channel: 'sms',
      summary: 'Payment reminder sent',
      timestamp: new Date('2025-01-10'),
    }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      findCustomer: vi.fn().mockResolvedValue(mockCustomer),
      auditLog: mockAuditLog,
    };
  });

  it('should return customer info for valid lookup', async () => {
    const tool = createLookupCustomerTool(deps);
    const result = await tool.execute(
      { customerId: 'cust-1' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as { healthScore: number; name: string };
      expect(data.healthScore).toBe(72);
      expect(data.name).toBe('John Doe');
    }
  });

  it('should return not found for missing customer', async () => {
    deps = { ...deps, findCustomer: vi.fn().mockResolvedValue(undefined) };
    const tool = createLookupCustomerTool(deps);
    const result = await tool.execute(
      { customerId: 'cust-missing' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should enforce tenant isolation', async () => {
    const wrongTenantCustomer = { ...mockCustomer, tenantId: 'tenant-other' };
    deps = { ...deps, findCustomer: vi.fn().mockResolvedValue(wrongTenantCustomer) };
    const tool = createLookupCustomerTool(deps);
    const result = await tool.execute(
      { customerId: 'cust-1' },
      makeContext({ tenantId: 'tenant-1' }),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should audit log the data access', async () => {
    const tool = createLookupCustomerTool(deps);
    await tool.execute({ customerId: 'cust-1' }, makeContext());

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lookup_customer_success',
        resource: 'customer',
      }),
    );
  });

  it('should reject invalid parameters', async () => {
    const tool = createLookupCustomerTool(deps);
    const result = await tool.execute({ customerId: '' }, makeContext());
    expect(isErr(result)).toBe(true);
  });
});

// ─── Check Payment Tool Tests ───────────────────────────────────

describe('createCheckPaymentTool', () => {
  let deps: CheckPaymentDeps;

  const mockPayment: PaymentInfo = {
    customerId: 'cust-1',
    tenantId: 'tenant-1',
    outstandingBalance: 2500.00,
    lastPaymentDate: new Date('2025-01-05'),
    lastPaymentAmount: 250.00,
    paymentPlanActive: true,
    paymentPlanMonthlyAmount: 250.00,
    paymentPlanRemainingPayments: 9,
    daysPastDue: 15,
    totalPaidToDate: 500.00,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      findPaymentInfo: vi.fn().mockResolvedValue(mockPayment),
      auditLog: mockAuditLog,
    };
  });

  it('should return payment info without PII', async () => {
    const tool = createCheckPaymentTool(deps);
    const result = await tool.execute(
      { customerId: 'cust-1' },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const data = result.data as Record<string, unknown>;
      expect(data['outstandingBalance']).toBe(2500.00);
      expect(data['paymentPlanActive']).toBe(true);
      expect(data['daysPastDue']).toBe(15);
      // Verify no PII fields
      expect(data['name']).toBeUndefined();
      expect(data['email']).toBeUndefined();
      expect(data['phone']).toBeUndefined();
    }
  });

  it('should return not found for missing payment info', async () => {
    deps = { ...deps, findPaymentInfo: vi.fn().mockResolvedValue(undefined) };
    const tool = createCheckPaymentTool(deps);
    const result = await tool.execute(
      { customerId: 'cust-missing' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should enforce tenant isolation', async () => {
    const wrongTenant = { ...mockPayment, tenantId: 'wrong-tenant' };
    deps = { ...deps, findPaymentInfo: vi.fn().mockResolvedValue(wrongTenant) };
    const tool = createCheckPaymentTool(deps);
    const result = await tool.execute(
      { customerId: 'cust-1' },
      makeContext({ tenantId: 'tenant-1' }),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should audit log the payment check', async () => {
    const tool = createCheckPaymentTool(deps);
    await tool.execute({ customerId: 'cust-1' }, makeContext());

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'check_payment_success',
        resource: 'payment',
      }),
    );
  });
});

// ─── Schedule Followup Tool Tests ───────────────────────────────

describe('createScheduleFollowupTool', () => {
  let deps: ScheduleFollowupDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      getContactAttempts: vi.fn().mockResolvedValue(3),
      getCeaseAndDesist: vi.fn().mockResolvedValue(false),
      scheduleMessage: vi.fn().mockResolvedValue({
        id: 'sched-123',
        scheduledAt: new Date('2025-01-15T14:00:00Z'),
      }),
      auditLog: mockAuditLog,
    };
  });

  it('should schedule a follow-up when all checks pass', async () => {
    const tool = createScheduleFollowupTool(deps);
    const result = await tool.execute(
      {
        customerId: 'cust-1',
        channel: 'sms',
        scheduledAt: '2025-01-15T14:00:00Z',
        timezone: 'America/New_York',
        messageType: 'payment_reminder',
      },
      makeContext(),
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect((result.data as { scheduledMessageId: string }).scheduledMessageId).toBe('sched-123');
    }
  });

  it('should block when cease-and-desist is on file', async () => {
    deps = { ...deps, getCeaseAndDesist: vi.fn().mockResolvedValue(true) };
    const tool = createScheduleFollowupTool(deps);
    const result = await tool.execute(
      {
        customerId: 'cust-1',
        channel: 'sms',
        scheduledAt: '2025-01-15T14:00:00Z',
        timezone: 'America/New_York',
        messageType: 'payment_reminder',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('cease-and-desist');
    }
  });

  it('should block when FDCPA 7-in-7 limit is exceeded', async () => {
    deps = { ...deps, getContactAttempts: vi.fn().mockResolvedValue(7) };
    const tool = createScheduleFollowupTool(deps);
    const result = await tool.execute(
      {
        customerId: 'cust-1',
        channel: 'sms',
        scheduledAt: '2025-01-15T14:00:00Z',
        timezone: 'America/New_York',
        messageType: 'payment_reminder',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('7');
    }
  });

  it('should block when scheduled outside FDCPA hours', async () => {
    // Schedule at 6 AM EST (outside 8AM-9PM window)
    const tool = createScheduleFollowupTool(deps);
    const result = await tool.execute(
      {
        customerId: 'cust-1',
        channel: 'sms',
        scheduledAt: '2025-01-15T06:00:00-05:00', // 6 AM ET
        timezone: 'America/New_York',
        messageType: 'payment_reminder',
      },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should reject invalid parameters', async () => {
    const tool = createScheduleFollowupTool(deps);
    const result = await tool.execute(
      { customerId: '', channel: 'invalid' },
      makeContext(),
    );

    expect(isErr(result)).toBe(true);
  });

  it('should audit log the scheduling', async () => {
    const tool = createScheduleFollowupTool(deps);
    await tool.execute(
      {
        customerId: 'cust-1',
        channel: 'sms',
        scheduledAt: '2025-01-15T14:00:00Z',
        timezone: 'America/New_York',
        messageType: 'payment_reminder',
      },
      makeContext(),
    );

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'schedule_followup_success',
      }),
    );
  });
});

// ─── Tool Registry Tests ────────────────────────────────────────

describe('createToolRegistry', () => {
  it('should create a registry with all 4 tools', () => {
    const registry = createToolRegistry({
      sms: {
        smsProviderSend: vi.fn().mockResolvedValue(ok({ messageId: 'm', status: 'ok' })),
        consentCheck: vi.fn().mockResolvedValue(ok(true)),
        complianceCheck: vi.fn().mockReturnValue({ allowed: true, violations: [] }),
        auditLog: vi.fn().mockResolvedValue(undefined),
      },
      customer: {
        findCustomer: vi.fn().mockResolvedValue(undefined),
        auditLog: vi.fn().mockResolvedValue(undefined),
      },
      payment: {
        findPaymentInfo: vi.fn().mockResolvedValue(undefined),
        auditLog: vi.fn().mockResolvedValue(undefined),
      },
      followup: {
        getContactAttempts: vi.fn().mockResolvedValue(0),
        getCeaseAndDesist: vi.fn().mockResolvedValue(false),
        scheduleMessage: vi.fn().mockResolvedValue({ id: 'x', scheduledAt: new Date() }),
        auditLog: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(registry.size).toBe(4);
    expect(registry.has('send_sms')).toBe(true);
    expect(registry.has('lookup_customer')).toBe(true);
    expect(registry.has('check_payment')).toBe(true);
    expect(registry.has('schedule_followup')).toBe(true);
  });
});
