/**
 * Event producer — validated, idempotent event publishing for ORDR-Connect
 *
 * SECURITY: Every event is schema-validated before publishing.
 * Invalid payloads are rejected at the boundary — never sent to Kafka.
 *
 * Features:
 * - Schema validation via registry (mandatory)
 * - TenantId as partition key (tenant-scoped ordering)
 * - Automatic UUID v4 generation for event IDs
 * - Batch publishing support
 * - Automatic retry with exponential backoff (via KafkaJS producer config)
 */

import type { Producer } from 'kafkajs';
import type { ZodSchema } from 'zod';
import type { EventEnvelope, EventMetadata } from './types.js';
import { validateEvent, eventSchemaRegistry } from './schemas.js';

// ─── Error Types ──────────────────────────────────────────────────

export class EventValidationError extends Error {
  public readonly eventType: string;
  public readonly issues: ReadonlyArray<{ readonly path: string; readonly message: string }>;

  constructor(
    eventType: string,
    issues: ReadonlyArray<{ readonly path: string; readonly message: string }>,
  ) {
    const details = issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    super(`Event validation failed for type '${eventType}': ${details}`);
    this.name = 'EventValidationError';
    this.eventType = eventType;
    this.issues = issues;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EventPublishError extends Error {
  public readonly topic: string;
  public readonly originalCause: unknown;

  constructor(topic: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to publish event to topic '${topic}': ${message}`);
    this.name = 'EventPublishError';
    this.topic = topic;
    this.originalCause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Event Producer ───────────────────────────────────────────────

export class EventProducer {
  private readonly producer: Producer;
  private readonly schemaRegistry: Map<string, ZodSchema>;

  constructor(
    producer: Producer,
    schemaRegistry: Map<string, ZodSchema> = eventSchemaRegistry,
  ) {
    this.producer = producer;
    this.schemaRegistry = schemaRegistry;
  }

  /**
   * Publishes a single event to the specified topic.
   *
   * - Validates the event envelope against its registered schema
   * - Uses tenantId as the partition key for tenant-scoped ordering
   * - Rejects invalid events before they reach Kafka
   */
  async publish<T>(topic: string, event: EventEnvelope<T>): Promise<void> {
    this.validateOrThrow(event);

    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: event.tenantId,
            value: JSON.stringify(event),
            headers: {
              'x-event-type': event.type,
              'x-tenant-id': event.tenantId,
              'x-correlation-id': event.metadata.correlationId,
              'x-event-id': event.id,
            },
          },
        ],
      });
    } catch (cause: unknown) {
      throw new EventPublishError(topic, cause);
    }
  }

  /**
   * Publishes a batch of events to the specified topic.
   *
   * All events are validated before any are published.
   * If any event fails validation, the entire batch is rejected.
   */
  async publishBatch<T>(topic: string, events: ReadonlyArray<EventEnvelope<T>>): Promise<void> {
    // Validate all events first — fail-fast before any I/O
    for (const event of events) {
      this.validateOrThrow(event);
    }

    const messages = events.map((event) => ({
      key: event.tenantId,
      value: JSON.stringify(event),
      headers: {
        'x-event-type': event.type,
        'x-tenant-id': event.tenantId,
        'x-correlation-id': event.metadata.correlationId,
        'x-event-id': event.id,
      },
    }));

    try {
      await this.producer.send({ topic, messages });
    } catch (cause: unknown) {
      throw new EventPublishError(topic, cause);
    }
  }

  /**
   * Validates an event against its registered schema.
   * Throws EventValidationError if invalid.
   */
  private validateOrThrow<T>(event: EventEnvelope<T>): void {
    const schema = this.schemaRegistry.get(event.type);
    if (!schema) {
      throw new EventValidationError(event.type, [
        { path: 'type', message: `No schema registered for event type '${event.type}'` },
      ]);
    }

    const result = validateEvent(schema, event);
    if (!result.success) {
      throw new EventValidationError(event.type, result.issues);
    }
  }
}

// ─── Envelope Factory ─────────────────────────────────────────────

/**
 * Creates a fully-formed EventEnvelope with auto-generated ID and timestamp.
 *
 * @param type - Event type string (must match a registered schema)
 * @param tenantId - Tenant ID for isolation and partitioning
 * @param payload - Domain-specific event payload
 * @param metadata - Partial metadata (correlationId, source required; rest auto-filled)
 */
export function createEventEnvelope<T>(
  type: string,
  tenantId: string,
  payload: T,
  metadata: Partial<EventMetadata> & { readonly source: string },
): EventEnvelope<T> {
  const correlationId = metadata.correlationId ?? crypto.randomUUID();

  return {
    id: crypto.randomUUID(),
    type,
    tenantId,
    payload,
    metadata: {
      correlationId,
      causationId: metadata.causationId ?? correlationId,
      userId: metadata.userId,
      agentId: metadata.agentId,
      source: metadata.source,
      version: metadata.version ?? 1,
    },
    timestamp: new Date().toISOString(),
  };
}
