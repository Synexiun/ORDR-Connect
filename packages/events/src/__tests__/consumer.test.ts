import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventConsumer, type EventHandler } from '../consumer.js';
import { DeadLetterHandler } from '../dlq.js';
import { eventSchemaRegistry } from '../schemas.js';
import { EventType } from '../types.js';
import type { EventEnvelope } from '../types.js';

// ─── Mock Factories ───────────────────────────────────────────────

function createMockConsumer() {
  return {
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    commitOffsets: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    events: {},
    logger: vi.fn(),
    seek: vi.fn(),
    describeGroup: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  };
}

function createMockDlqProducer() {
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

function makeCustomerCreatedEvent(
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

function makeMessagePayload(
  event: Record<string, unknown> | string,
  topic: string = 'ordr.customer.events',
) {
  const value = typeof event === 'string' ? event : JSON.stringify(event);
  return {
    topic,
    partition: 0,
    message: {
      key: Buffer.from('tenant-001'),
      value: Buffer.from(value),
      offset: '42',
      timestamp: String(Date.now()),
      headers: {},
      size: value.length,
      attributes: 0,
    },
    heartbeat: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  };
}

// ─── Helper to extract eachMessage from run() ─────────────────────

function getEachMessageHandler(mockConsumer: ReturnType<typeof createMockConsumer>) {
  const runCall = mockConsumer.run.mock.calls[0]![0] as {
    eachMessage: (payload: ReturnType<typeof makeMessagePayload>) => Promise<void>;
  };
  return runCall.eachMessage;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('EventConsumer', () => {
  let mockConsumer: ReturnType<typeof createMockConsumer>;
  let mockDlqProducer: ReturnType<typeof createMockDlqProducer>;
  let dlqHandler: DeadLetterHandler;
  let handlers: Map<string, EventHandler>;
  let customerHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockConsumer = createMockConsumer();
    mockDlqProducer = createMockDlqProducer();
    dlqHandler = new DeadLetterHandler(mockDlqProducer as never);
    customerHandler = vi.fn().mockResolvedValue(undefined);
    handlers = new Map<string, EventHandler>([
      [EventType.CUSTOMER_CREATED, customerHandler],
    ]);
  });

  describe('subscribe()', () => {
    it('subscribes to specified topics', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );

      await consumer.subscribe(['ordr.customer.events', 'ordr.audit.events']);

      expect(mockConsumer.subscribe).toHaveBeenCalledTimes(2);
      expect(mockConsumer.subscribe).toHaveBeenCalledWith({
        topic: 'ordr.customer.events',
        fromBeginning: false,
      });
      expect(mockConsumer.subscribe).toHaveBeenCalledWith({
        topic: 'ordr.audit.events',
        fromBeginning: false,
      });
    });
  });

  describe('start() and message routing', () => {
    it('calls run with autoCommit disabled', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );

      await consumer.start();

      expect(mockConsumer.run).toHaveBeenCalledOnce();
      const runConfig = mockConsumer.run.mock.calls[0]![0] as { autoCommit: boolean };
      expect(runConfig.autoCommit).toBe(false);
    });

    it('routes events to the correct handler by type', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      const event = makeCustomerCreatedEvent();
      await eachMessage(makeMessagePayload(event));

      expect(customerHandler).toHaveBeenCalledOnce();
      const handlerArg = customerHandler.mock.calls[0]![0] as EventEnvelope<unknown>;
      expect(handlerArg.type).toBe(EventType.CUSTOMER_CREATED);
    });

    it('commits offset after successful processing', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      await eachMessage(makeMessagePayload(makeCustomerCreatedEvent()));

      expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
        { topic: 'ordr.customer.events', partition: 0, offset: '43' },
      ]);
    });

    it('skips messages with no value', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      const emptyPayload = {
        topic: 'ordr.customer.events',
        partition: 0,
        message: {
          key: Buffer.from('tenant-001'),
          value: null,
          offset: '42',
          timestamp: String(Date.now()),
          headers: {},
          size: 0,
          attributes: 0,
        },
        heartbeat: vi.fn(),
        pause: vi.fn(),
      };

      await eachMessage(emptyPayload as never);

      expect(customerHandler).not.toHaveBeenCalled();
    });

    it('skips events with no registered handler', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      const unhandledEvent = makeCustomerCreatedEvent({
        type: EventType.COMPLIANCE_CHECK,
        payload: {
          recordId: 'rec-001',
          regulation: 'SOC2',
          ruleId: 'soc2-001',
          result: 'pass',
        } as never,
      });
      await eachMessage(makeMessagePayload(unhandledEvent));

      expect(customerHandler).not.toHaveBeenCalled();
      // Should still commit the offset
      expect(mockConsumer.commitOffsets).toHaveBeenCalled();
    });
  });

  describe('schema validation on consume', () => {
    it('rejects invalid events to DLQ', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      const invalidEvent = {
        id: 'not-a-uuid',
        type: EventType.CUSTOMER_CREATED,
        tenantId: 'tenant-001',
        payload: { invalid: true },
        metadata: { correlationId: 'x' },
        timestamp: 'not-a-date',
      };

      await eachMessage(makeMessagePayload(invalidEvent));

      // Handler should NOT have been called
      expect(customerHandler).not.toHaveBeenCalled();

      // DLQ should have received the invalid event
      expect(mockDlqProducer.send).toHaveBeenCalledOnce();
      const dlqCall = mockDlqProducer.send.mock.calls[0]![0] as {
        topic: string;
        messages: Array<{ value: string }>;
      };
      expect(dlqCall.topic).toBe('ordr.dlq');
    });

    it('sends unparseable JSON to DLQ', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      await eachMessage(makeMessagePayload('not-valid-json{{{'));

      expect(customerHandler).not.toHaveBeenCalled();
      expect(mockDlqProducer.send).toHaveBeenCalledOnce();
    });
  });

  describe('deduplication', () => {
    it('skips duplicate events with the same ID', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
        { dedupWindowMs: 60_000 },
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      const event = makeCustomerCreatedEvent();

      // Process the same event twice
      await eachMessage(makeMessagePayload(event));
      await eachMessage(makeMessagePayload(event));

      // Handler should only be called once
      expect(customerHandler).toHaveBeenCalledOnce();

      // Both offsets should be committed
      expect(mockConsumer.commitOffsets).toHaveBeenCalledTimes(2);
    });

    it('processes different events with different IDs', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      const event1 = makeCustomerCreatedEvent();
      const event2 = makeCustomerCreatedEvent();

      await eachMessage(makeMessagePayload(event1));
      await eachMessage(makeMessagePayload(event2));

      expect(customerHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('retries handler errors up to maxRetries', async () => {
      const failingHandler = vi.fn()
        .mockRejectedValueOnce(new Error('transient-1'))
        .mockRejectedValueOnce(new Error('transient-2'))
        .mockResolvedValueOnce(undefined);

      const retryHandlers = new Map<string, EventHandler>([
        [EventType.CUSTOMER_CREATED, failingHandler],
      ]);

      const consumer = new EventConsumer(
        mockConsumer as never,
        retryHandlers,
        eventSchemaRegistry,
        dlqHandler,
        { maxRetries: 3 },
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      await eachMessage(makeMessagePayload(makeCustomerCreatedEvent()));

      // Should have been called 3 times (2 failures + 1 success)
      expect(failingHandler).toHaveBeenCalledTimes(3);

      // Should NOT go to DLQ since it eventually succeeded
      expect(mockDlqProducer.send).not.toHaveBeenCalled();
    });

    it('sends to DLQ after exhausting retries', async () => {
      const alwaysFailHandler = vi.fn().mockRejectedValue(new Error('permanent failure'));

      const failHandlers = new Map<string, EventHandler>([
        [EventType.CUSTOMER_CREATED, alwaysFailHandler],
      ]);

      const consumer = new EventConsumer(
        mockConsumer as never,
        failHandlers,
        eventSchemaRegistry,
        dlqHandler,
        { maxRetries: 2 },
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      await eachMessage(makeMessagePayload(makeCustomerCreatedEvent()));

      // Should have been called maxRetries times
      expect(alwaysFailHandler).toHaveBeenCalledTimes(2);

      // Should be sent to DLQ
      expect(mockDlqProducer.send).toHaveBeenCalledOnce();
    });

    it('handles non-Error throws gracefully', async () => {
      const stringThrowHandler = vi.fn().mockRejectedValue('string error');

      const throwHandlers = new Map<string, EventHandler>([
        [EventType.CUSTOMER_CREATED, stringThrowHandler],
      ]);

      const consumer = new EventConsumer(
        mockConsumer as never,
        throwHandlers,
        eventSchemaRegistry,
        dlqHandler,
        { maxRetries: 1 },
      );
      await consumer.start();

      const eachMessage = getEachMessageHandler(mockConsumer);
      await eachMessage(makeMessagePayload(makeCustomerCreatedEvent()));

      // Should go to DLQ with a wrapped error
      expect(mockDlqProducer.send).toHaveBeenCalledOnce();
    });
  });

  describe('stop()', () => {
    it('disconnects the consumer and clears state', async () => {
      const consumer = new EventConsumer(
        mockConsumer as never,
        handlers,
        eventSchemaRegistry,
        dlqHandler,
      );

      await consumer.start();
      expect(consumer.isRunning).toBe(true);

      await consumer.stop();
      expect(consumer.isRunning).toBe(false);
      expect(mockConsumer.disconnect).toHaveBeenCalledOnce();
    });
  });
});
