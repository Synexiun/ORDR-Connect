/**
 * Worker handler tests
 *
 * Verifies:
 * - Customer events → graph enrichment
 * - Interaction events → graph enrichment
 * - Agent events → session orchestration, graph enrichment
 * - Outbound messages → consent → compliance → send → audit pipeline
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCustomerEventsHandler } from '../handlers/customer-events.js';
import { createInteractionEventsHandler } from '../handlers/interaction-events.js';
import { createAgentEventsHandler } from '../handlers/agent-events.js';
import { createOutboundMessagesHandler } from '../handlers/outbound-messages.js';
import type { EventEnvelope } from '@ordr/events';

// ---- Test Helpers -----------------------------------------------------------

function createMockAuditLogger() {
  return {
    log: vi.fn().mockResolvedValue({
      id: 'audit-1',
      sequenceNumber: 1,
      hash: 'abc',
      previousHash: '000',
    }),
  };
}

function createMockEventProducer() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    publishBatch: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockGraphEnricher() {
  return {
    handleCustomerCreated: vi.fn().mockResolvedValue({ success: true, data: { id: 'node-1' } }),
    handleInteractionLogged: vi.fn().mockResolvedValue({ success: true, data: { id: 'edge-1' } }),
    handleAgentAction: vi.fn().mockResolvedValue({ success: true, data: { id: 'edge-2' } }),
  };
}

function createMockAgentEngine() {
  return {
    startSession: vi.fn().mockResolvedValue({
      success: true,
      data: {
        sessionId: 'session-1',
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        agentRole: 'collections',
        autonomyLevel: 'supervised',
        tools: new Map(),
        memory: { observations: new Map(), steps: [] },
        budget: { maxTokens: 100000, maxCostCents: 500, maxActions: 20, usedTokens: 0, usedCostCents: 0, usedActions: 0 },
        killSwitch: { active: false, reason: '', killedAt: null },
        triggerEventId: 'event-1',
        startedAt: new Date(),
      },
    }),
    runLoop: vi.fn().mockResolvedValue({
      success: true,
      data: {
        sessionId: 'session-1',
        result: 'completed',
        totalSteps: 3,
        totalCost: 50,
        totalTokens: 5000,
        description: 'Session completed successfully',
      },
    }),
    killSession: vi.fn(),
    getHitlQueue: vi.fn(),
  };
}

function makeEvent<T>(type: string, tenantId: string, payload: T): EventEnvelope<T> {
  return {
    id: 'event-1',
    type,
    tenantId,
    payload,
    metadata: {
      correlationId: 'corr-1',
      causationId: 'corr-1',
      source: 'test',
      version: 1,
    },
    timestamp: new Date().toISOString(),
  };
}

// ---- Customer Events --------------------------------------------------------

describe('Customer Event Handlers', () => {
  it('calls graphEnricher.handleCustomerCreated for customer.created', async () => {
    const mockGraph = createMockGraphEnricher();
    const mockAudit = createMockAuditLogger();
    const handler = createCustomerEventsHandler({
      graphEnricher: mockGraph as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('customer.created', 'tenant-1', {
      customerId: 'cust-1',
      name: 'John Doe',
      email: 'john@example.com',
      type: 'individual',
      lifecycleStage: 'lead',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockGraph.handleCustomerCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        tenantId: 'tenant-1',
      }),
    );
  });

  it('logs audit event for customer.created processing', async () => {
    const mockGraph = createMockGraphEnricher();
    const mockAudit = createMockAuditLogger();
    const handler = createCustomerEventsHandler({
      graphEnricher: mockGraph as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('customer.created', 'tenant-1', {
      customerId: 'cust-1', name: 'Jane', email: 'jane@example.com', type: 'individual', lifecycleStage: 'lead',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'customer_graph', action: 'graph_enrichment' }),
    );
  });

  it('handles customer.updated events', async () => {
    const mockGraph = createMockGraphEnricher();
    const mockAudit = createMockAuditLogger();
    const handler = createCustomerEventsHandler({
      graphEnricher: mockGraph as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('customer.updated', 'tenant-1', {
      customerId: 'cust-1',
      changes: { status: { old: 'active', new: 'churning' } },
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockGraph.handleCustomerCreated).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'data.updated' }),
    );
  });

  it('handles graph enrichment failures gracefully', async () => {
    const mockGraph = createMockGraphEnricher();
    mockGraph.handleCustomerCreated.mockResolvedValue({ success: false, error: { message: 'Graph error', code: 'INTERNAL' } });
    const mockAudit = createMockAuditLogger();
    const handler = createCustomerEventsHandler({
      graphEnricher: mockGraph as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('customer.created', 'tenant-1', {
      customerId: 'cust-1', name: 'Bob', email: 'bob@example.com', type: 'individual', lifecycleStage: 'lead',
    });

    // Should not throw
    await handler(event as EventEnvelope<unknown>);
    expect(mockAudit.log).toHaveBeenCalled();
  });
});

// ---- Interaction Events -----------------------------------------------------

describe('Interaction Event Handlers', () => {
  it('calls graphEnricher.handleInteractionLogged', async () => {
    const mockGraph = createMockGraphEnricher();
    const mockAudit = createMockAuditLogger();
    const handler = createInteractionEventsHandler({
      graphEnricher: mockGraph as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('interaction.logged', 'tenant-1', {
      interactionId: 'int-1',
      customerId: 'cust-1',
      channel: 'sms',
      direction: 'outbound',
      type: 'message',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockGraph.handleInteractionLogged).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionId: 'int-1',
        customerId: 'cust-1',
        channel: 'sms',
      }),
    );
  });

  it('audits interaction processing', async () => {
    const mockGraph = createMockGraphEnricher();
    const mockAudit = createMockAuditLogger();
    const handler = createInteractionEventsHandler({
      graphEnricher: mockGraph as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('interaction.logged', 'tenant-1', {
      interactionId: 'int-1', customerId: 'cust-1', channel: 'email', direction: 'inbound', type: 'message',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'interaction_graph' }),
    );
  });
});

// ---- Agent Events -----------------------------------------------------------

describe('Agent Event Handlers', () => {
  it('starts agent session and runs loop for agent.triggered', async () => {
    const mockEngine = createMockAgentEngine();
    const mockGraph = createMockGraphEnricher();
    const mockProducer = createMockEventProducer();
    const mockAudit = createMockAuditLogger();

    const handler = createAgentEventsHandler({
      agentEngine: mockEngine as never,
      graphEnricher: mockGraph as never,
      eventProducer: mockProducer as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('agent.triggered', 'tenant-1', {
      sessionId: 'session-1',
      customerId: 'cust-1',
      agentRole: 'collections',
      autonomyLevel: 'supervised',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockEngine.startSession).toHaveBeenCalledWith(
      'tenant-1',
      'cust-1',
      'collections',
      'event-1',
      'supervised',
    );
    expect(mockEngine.runLoop).toHaveBeenCalled();
  });

  it('publishes agent outcome event after loop completion', async () => {
    const mockEngine = createMockAgentEngine();
    const mockGraph = createMockGraphEnricher();
    const mockProducer = createMockEventProducer();
    const mockAudit = createMockAuditLogger();

    const handler = createAgentEventsHandler({
      agentEngine: mockEngine as never,
      graphEnricher: mockGraph as never,
      eventProducer: mockProducer as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('agent.triggered', 'tenant-1', {
      sessionId: 'session-1', customerId: 'cust-1', agentRole: 'follow_up', autonomyLevel: 'supervised',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockProducer.publish).toHaveBeenCalled();
  });

  it('handles agent session start failure gracefully', async () => {
    const mockEngine = createMockAgentEngine();
    mockEngine.startSession.mockResolvedValue({
      success: false,
      error: { message: 'Session limit reached', code: 'AGENT_SAFETY_BLOCK' },
    });
    const mockGraph = createMockGraphEnricher();
    const mockProducer = createMockEventProducer();
    const mockAudit = createMockAuditLogger();

    const handler = createAgentEventsHandler({
      agentEngine: mockEngine as never,
      graphEnricher: mockGraph as never,
      eventProducer: mockProducer as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('agent.triggered', 'tenant-1', {
      sessionId: 'session-1', customerId: 'cust-1', agentRole: 'collections', autonomyLevel: 'supervised',
    });

    // Should not throw
    await handler(event as EventEnvelope<unknown>);
    expect(mockEngine.runLoop).not.toHaveBeenCalled();
  });

  it('enriches graph for agent.action_executed', async () => {
    const mockEngine = createMockAgentEngine();
    const mockGraph = createMockGraphEnricher();
    const mockProducer = createMockEventProducer();
    const mockAudit = createMockAuditLogger();

    const handler = createAgentEventsHandler({
      agentEngine: mockEngine as never,
      graphEnricher: mockGraph as never,
      eventProducer: mockProducer as never,
      auditLogger: mockAudit as never,
    });

    const event = makeEvent('agent.action_executed', 'tenant-1', {
      actionId: 'action-1',
      agentId: 'agent-1',
      agentRole: 'collections',
      actionType: 'send_sms',
      confidence: 0.9,
      approved: true,
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockGraph.handleAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'action-1', agentId: 'agent-1' }),
    );
  });
});

// ---- Outbound Messages ------------------------------------------------------

describe('Outbound Message Handlers', () => {
  it('processes outbound message through consent → compliance → send pipeline', async () => {
    const mockSend = vi.fn().mockResolvedValue({ success: true, data: { messageId: 'sms-1', providerMessageId: 'provider-1', status: 'sent' } });
    const mockAudit = createMockAuditLogger();
    const mockProducer = createMockEventProducer();

    const handler = createOutboundMessagesHandler({
      consentManager: {
        verifyConsentForSend: vi.fn().mockResolvedValue({ success: true }),
      } as never,
      consentStore: {} as never,
      complianceGate: {
        check: vi.fn().mockReturnValue({ allowed: true, results: [], violations: [], timestamp: new Date() }),
      } as never,
      smsProvider: { send: mockSend } as never,
      emailProvider: { send: vi.fn() } as never,
      eventProducer: mockProducer as never,
      auditLogger: mockAudit as never,
      stateMachine: {} as never,
      getCustomerContact: vi.fn().mockResolvedValue({ contact: '+14155551234', contentBody: 'Hello' }),
      updateMessageStatus: vi.fn().mockResolvedValue(undefined),
    });

    const event = makeEvent('outbound.message', 'tenant-1', {
      messageId: 'msg-1',
      customerId: 'cust-1',
      channel: 'sms',
      contentRef: 'ref-123',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockSend).toHaveBeenCalledWith('+14155551234', 'Hello');
  });

  it('blocks message when consent denied', async () => {
    const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);
    const mockAudit = createMockAuditLogger();

    const handler = createOutboundMessagesHandler({
      consentManager: {
        verifyConsentForSend: vi.fn().mockResolvedValue({ success: false, error: { message: 'No consent' } }),
      } as never,
      consentStore: {} as never,
      complianceGate: { check: vi.fn() } as never,
      smsProvider: { send: vi.fn() } as never,
      emailProvider: { send: vi.fn() } as never,
      eventProducer: createMockEventProducer() as never,
      auditLogger: mockAudit as never,
      stateMachine: {} as never,
      getCustomerContact: vi.fn(),
      updateMessageStatus: mockUpdateStatus,
    });

    const event = makeEvent('outbound.message', 'tenant-1', {
      messageId: 'msg-2', customerId: 'cust-1', channel: 'sms', contentRef: 'ref-456',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockUpdateStatus).toHaveBeenCalledWith('msg-2', 'opted_out');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consent_denied' }),
    );
  });

  it('blocks message when compliance gate fails', async () => {
    const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);
    const mockAudit = createMockAuditLogger();

    const handler = createOutboundMessagesHandler({
      consentManager: {
        verifyConsentForSend: vi.fn().mockResolvedValue({ success: true }),
      } as never,
      consentStore: {} as never,
      complianceGate: {
        check: vi.fn().mockReturnValue({
          allowed: false,
          results: [],
          violations: [{ violation: { message: 'TCPA timing restriction' } }],
          timestamp: new Date(),
        }),
      } as never,
      smsProvider: { send: vi.fn() } as never,
      emailProvider: { send: vi.fn() } as never,
      eventProducer: createMockEventProducer() as never,
      auditLogger: mockAudit as never,
      stateMachine: {} as never,
      getCustomerContact: vi.fn(),
      updateMessageStatus: mockUpdateStatus,
    });

    const event = makeEvent('outbound.message', 'tenant-1', {
      messageId: 'msg-3', customerId: 'cust-1', channel: 'sms', contentRef: 'ref-789',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockUpdateStatus).toHaveBeenCalledWith('msg-3', 'failed');
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance_blocked' }),
    );
  });

  it('handles missing customer contact gracefully', async () => {
    const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);
    const mockAudit = createMockAuditLogger();

    const handler = createOutboundMessagesHandler({
      consentManager: { verifyConsentForSend: vi.fn().mockResolvedValue({ success: true }) } as never,
      consentStore: {} as never,
      complianceGate: { check: vi.fn().mockReturnValue({ allowed: true, results: [], violations: [], timestamp: new Date() }) } as never,
      smsProvider: { send: vi.fn() } as never,
      emailProvider: { send: vi.fn() } as never,
      eventProducer: createMockEventProducer() as never,
      auditLogger: mockAudit as never,
      stateMachine: {} as never,
      getCustomerContact: vi.fn().mockResolvedValue(null),
      updateMessageStatus: mockUpdateStatus,
    });

    const event = makeEvent('outbound.message', 'tenant-1', {
      messageId: 'msg-4', customerId: 'cust-1', channel: 'sms', contentRef: 'ref-000',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockUpdateStatus).toHaveBeenCalledWith('msg-4', 'failed');
  });

  it('publishes interaction.logged event on successful send', async () => {
    const mockProducer = createMockEventProducer();

    const handler = createOutboundMessagesHandler({
      consentManager: { verifyConsentForSend: vi.fn().mockResolvedValue({ success: true }) } as never,
      consentStore: {} as never,
      complianceGate: { check: vi.fn().mockReturnValue({ allowed: true, results: [], violations: [], timestamp: new Date() }) } as never,
      smsProvider: {
        send: vi.fn().mockResolvedValue({ success: true, data: { messageId: 'sms-x', providerMessageId: 'p-1', status: 'sent' } }),
      } as never,
      emailProvider: { send: vi.fn() } as never,
      eventProducer: mockProducer as never,
      auditLogger: createMockAuditLogger() as never,
      stateMachine: {} as never,
      getCustomerContact: vi.fn().mockResolvedValue({ contact: '+14155551234', contentBody: 'Test' }),
      updateMessageStatus: vi.fn().mockResolvedValue(undefined),
    });

    const event = makeEvent('outbound.message', 'tenant-1', {
      messageId: 'msg-5', customerId: 'cust-1', channel: 'sms', contentRef: 'ref-111',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockProducer.publish).toHaveBeenCalled();
  });

  it('processes email channel correctly', async () => {
    const mockEmailSend = vi.fn().mockResolvedValue({
      success: true,
      data: { messageId: 'email-x', providerMessageId: 'sg-1', status: 'queued' },
    });

    const handler = createOutboundMessagesHandler({
      consentManager: { verifyConsentForSend: vi.fn().mockResolvedValue({ success: true }) } as never,
      consentStore: {} as never,
      complianceGate: { check: vi.fn().mockReturnValue({ allowed: true, results: [], violations: [], timestamp: new Date() }) } as never,
      smsProvider: { send: vi.fn() } as never,
      emailProvider: { send: mockEmailSend } as never,
      eventProducer: createMockEventProducer() as never,
      auditLogger: createMockAuditLogger() as never,
      stateMachine: {} as never,
      getCustomerContact: vi.fn().mockResolvedValue({ contact: 'test@example.com', contentBody: '<p>Hello</p>' }),
      updateMessageStatus: vi.fn().mockResolvedValue(undefined),
    });

    const event = makeEvent('outbound.message', 'tenant-1', {
      messageId: 'msg-6', customerId: 'cust-1', channel: 'email', contentRef: 'ref-222',
    });

    await handler(event as EventEnvelope<unknown>);

    expect(mockEmailSend).toHaveBeenCalledWith('test@example.com', 'Message from ORDR-Connect', '<p>Hello</p>');
  });
});
