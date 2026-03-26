import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventProducer, EventValidationError, createEventEnvelope } from '../producer.js';
import { eventSchemaRegistry } from '../schemas.js';
import { EventType } from '../types.js';
import type { EventEnvelope } from '../types.js';

// ─── Mock Producer ────────────────────────────────────────────────

function createMockProducer() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isIdempotent: vi.fn().mockReturnValue(true),
    events: {},
    on: vi.fn(),
    logger: vi.fn(),
    transaction: vi.fn(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

function makeCustomerCreatedEnvelope(
  overrides: Partial<EventEnvelope<unknown>> = {},
): EventEnvelope<{
  customerId: string;
  name: string;
  email: string;
  type: string;
  lifecycleStage: string;
}> {
  return {
    id: crypto.randomUUID(),
    type: EventType.CUSTOMER_CREATED,
    tenantId: 'tenant-001',
    payload: {
      customerId: 'cust-001',
      name: 'Acme Corp',
      email: 'contact@acme.com',
      type: 'enterprise',
      lifecycleStage: 'onboarding',
    },
    metadata: {
      correlationId: crypto.randomUUID(),
      causationId: crypto.randomUUID(),
      userId: 'user-001',
      source: 'test-suite',
      version: 1,
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeAuthEventEnvelope(): EventEnvelope<{
  userId: string;
  action: 'login';
  ipAddress: string;
}> {
  return {
    id: crypto.randomUUID(),
    type: EventType.AUTH_LOGIN,
    tenantId: 'tenant-001',
    payload: {
      userId: 'user-001',
      action: 'login',
      ipAddress: '10.0.0.1',
    },
    metadata: {
      correlationId: crypto.randomUUID(),
      causationId: crypto.randomUUID(),
      userId: 'user-001',
      source: 'auth-service',
      version: 1,
    },
    timestamp: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('EventProducer', () => {
  let mockProducer: ReturnType<typeof createMockProducer>;
  let producer: EventProducer;

  beforeEach(() => {
    mockProducer = createMockProducer();
    producer = new EventProducer(mockProducer as never, eventSchemaRegistry);
  });

  describe('publish()', () => {
    it('publishes a valid event to the specified topic', async () => {
      const event = makeCustomerCreatedEnvelope();

      await producer.publish('ordr.customer.events', event);

      expect(mockProducer.send).toHaveBeenCalledOnce();
      const callArgs = mockProducer.send.mock.calls[0]![0] as {
        topic: string;
        messages: Array<{ key: string; value: string; headers: Record<string, string> }>;
      };
      expect(callArgs.topic).toBe('ordr.customer.events');
      expect(callArgs.messages).toHaveLength(1);
    });

    it('uses tenantId as partition key', async () => {
      const event = makeCustomerCreatedEnvelope();

      await producer.publish('ordr.customer.events', event);

      const callArgs = mockProducer.send.mock.calls[0]![0] as {
        topic: string;
        messages: Array<{ key: string; value: string }>;
      };
      expect(callArgs.messages[0]!.key).toBe('tenant-001');
    });

    it('serializes the event as JSON in the message value', async () => {
      const event = makeCustomerCreatedEnvelope();

      await producer.publish('ordr.customer.events', event);

      const callArgs = mockProducer.send.mock.calls[0]![0] as {
        messages: Array<{ value: string }>;
      };
      const parsed = JSON.parse(callArgs.messages[0]!.value) as Record<string, unknown>;
      expect(parsed['type']).toBe(EventType.CUSTOMER_CREATED);
      expect(parsed['tenantId']).toBe('tenant-001');
    });

    it('sets correlation headers on the message', async () => {
      const event = makeCustomerCreatedEnvelope();

      await producer.publish('ordr.customer.events', event);

      const callArgs = mockProducer.send.mock.calls[0]![0] as {
        messages: Array<{ headers: Record<string, string> }>;
      };
      const headers = callArgs.messages[0]!.headers;
      expect(headers['x-event-type']).toBe(EventType.CUSTOMER_CREATED);
      expect(headers['x-tenant-id']).toBe('tenant-001');
      expect(headers['x-event-id']).toBe(event.id);
      expect(headers['x-correlation-id']).toBe(event.metadata.correlationId);
    });

    it('rejects events that fail schema validation', async () => {
      const invalidEvent = makeCustomerCreatedEnvelope({
        payload: { invalid: true } as never,
      });

      await expect(
        producer.publish('ordr.customer.events', invalidEvent),
      ).rejects.toThrow(EventValidationError);

      expect(mockProducer.send).not.toHaveBeenCalled();
    });

    it('rejects events with unregistered type', async () => {
      const event = makeCustomerCreatedEnvelope({
        type: 'unknown.event.type',
      });

      await expect(
        producer.publish('ordr.customer.events', event),
      ).rejects.toThrow(EventValidationError);

      expect(mockProducer.send).not.toHaveBeenCalled();
    });

    it('publishes auth events', async () => {
      const event = makeAuthEventEnvelope();

      await producer.publish('ordr.audit.events', event);

      expect(mockProducer.send).toHaveBeenCalledOnce();
    });

    it('wraps Kafka errors in EventPublishError', async () => {
      mockProducer.send.mockRejectedValueOnce(new Error('Kafka connection failed'));
      const event = makeCustomerCreatedEnvelope();

      await expect(
        producer.publish('ordr.customer.events', event),
      ).rejects.toThrow('Failed to publish event');
    });
  });

  describe('publishBatch()', () => {
    it('publishes multiple valid events in a single batch', async () => {
      const events = [
        makeCustomerCreatedEnvelope(),
        makeCustomerCreatedEnvelope({ tenantId: 'tenant-002' }),
      ];

      await producer.publishBatch('ordr.customer.events', events);

      expect(mockProducer.send).toHaveBeenCalledOnce();
      const callArgs = mockProducer.send.mock.calls[0]![0] as {
        messages: Array<{ key: string }>;
      };
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages[0]!.key).toBe('tenant-001');
      expect(callArgs.messages[1]!.key).toBe('tenant-002');
    });

    it('rejects entire batch if any event fails validation', async () => {
      const events = [
        makeCustomerCreatedEnvelope(),
        makeCustomerCreatedEnvelope({ payload: { broken: true } as never }),
      ];

      await expect(
        producer.publishBatch('ordr.customer.events', events),
      ).rejects.toThrow(EventValidationError);

      expect(mockProducer.send).not.toHaveBeenCalled();
    });

    it('publishes empty batch without error', async () => {
      await producer.publishBatch('ordr.customer.events', []);

      // send is called with 0 messages
      expect(mockProducer.send).toHaveBeenCalledOnce();
    });
  });
});

// ─── createEventEnvelope Tests ────────────────────────────────────

describe('createEventEnvelope', () => {
  it('generates a valid UUID for the event ID', () => {
    const envelope = createEventEnvelope(
      EventType.CUSTOMER_CREATED,
      'tenant-001',
      {
        customerId: 'cust-001',
        name: 'Acme',
        email: 'a@b.com',
        type: 'enterprise',
        lifecycleStage: 'onboarding',
      },
      { source: 'test' },
    );

    // UUID v4 pattern
    expect(envelope.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('sets the correct event type and tenantId', () => {
    const envelope = createEventEnvelope(
      EventType.INTERACTION_LOGGED,
      'tenant-042',
      {
        interactionId: 'int-001',
        customerId: 'cust-001',
        channel: 'email',
        direction: 'inbound',
        type: 'support',
      },
      { source: 'interaction-service' },
    );

    expect(envelope.type).toBe(EventType.INTERACTION_LOGGED);
    expect(envelope.tenantId).toBe('tenant-042');
  });

  it('auto-generates correlationId when not provided', () => {
    const envelope = createEventEnvelope(
      EventType.CUSTOMER_CREATED,
      'tenant-001',
      {
        customerId: 'cust-001',
        name: 'Test',
        email: 'a@b.com',
        type: 'smb',
        lifecycleStage: 'active',
      },
      { source: 'test' },
    );

    expect(envelope.metadata.correlationId).toBeTruthy();
    // causationId defaults to correlationId when not provided
    expect(envelope.metadata.causationId).toBe(envelope.metadata.correlationId);
  });

  it('preserves provided correlationId and causationId', () => {
    const envelope = createEventEnvelope(
      EventType.CUSTOMER_CREATED,
      'tenant-001',
      {
        customerId: 'cust-001',
        name: 'Test',
        email: 'a@b.com',
        type: 'smb',
        lifecycleStage: 'active',
      },
      {
        source: 'test',
        correlationId: 'corr-fixed',
        causationId: 'cause-fixed',
      },
    );

    expect(envelope.metadata.correlationId).toBe('corr-fixed');
    expect(envelope.metadata.causationId).toBe('cause-fixed');
  });

  it('generates ISO 8601 timestamp', () => {
    const before = new Date().toISOString();
    const envelope = createEventEnvelope(
      EventType.CUSTOMER_CREATED,
      'tenant-001',
      {
        customerId: 'cust-001',
        name: 'Test',
        email: 'a@b.com',
        type: 'smb',
        lifecycleStage: 'active',
      },
      { source: 'test' },
    );
    const after = new Date().toISOString();

    expect(envelope.timestamp >= before).toBe(true);
    expect(envelope.timestamp <= after).toBe(true);
  });

  it('sets version to 1 by default', () => {
    const envelope = createEventEnvelope(
      EventType.CUSTOMER_CREATED,
      'tenant-001',
      {
        customerId: 'cust-001',
        name: 'Test',
        email: 'a@b.com',
        type: 'smb',
        lifecycleStage: 'active',
      },
      { source: 'test' },
    );

    expect(envelope.metadata.version).toBe(1);
  });

  it('allows overriding version', () => {
    const envelope = createEventEnvelope(
      EventType.CUSTOMER_CREATED,
      'tenant-001',
      {
        customerId: 'cust-001',
        name: 'Test',
        email: 'a@b.com',
        type: 'smb',
        lifecycleStage: 'active',
      },
      { source: 'test', version: 3 },
    );

    expect(envelope.metadata.version).toBe(3);
  });

  it('includes optional userId and agentId in metadata', () => {
    const envelope = createEventEnvelope(
      EventType.AGENT_ACTION_EXECUTED,
      'tenant-001',
      {
        actionId: 'act-001',
        agentId: 'agent-001',
        agentRole: 'lead_qualifier',
        actionType: 'score_lead',
        confidence: 0.9,
        approved: true,
      },
      {
        source: 'agent-runtime',
        userId: 'user-admin',
        agentId: 'agent-001',
      },
    );

    expect(envelope.metadata.userId).toBe('user-admin');
    expect(envelope.metadata.agentId).toBe('agent-001');
  });
});
