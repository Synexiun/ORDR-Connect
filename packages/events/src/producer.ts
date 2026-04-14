/**
 * Event producer — validated, idempotent event publishing for ORDR-Connect
 *
 * SECURITY: Every event is schema-validated before publishing.
 * Invalid payloads are rejected at the boundary — never sent to Kafka.
 *
 * Features:
 * - Schema validation via Zod registry (mandatory — hard gate)
 * - Confluent Schema Registry integration (optional — compliance hardening)
 * - TenantId as partition key (tenant-scoped ordering)
 * - Automatic UUID v4 generation for event IDs
 * - Batch publishing support
 * - Automatic retry with exponential backoff (via KafkaJS producer config)
 */

import type { Producer } from 'kafkajs';
import type { ZodSchema } from 'zod';
import type { EventEnvelope, EventMetadata } from './types.js';
import { validateEvent, eventSchemaRegistry } from './schemas.js';
import type { ConfluentRegistryClient } from './confluent-registry.js';
import { getJsonSchemaForEventType } from './json-schemas.js';

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
  private readonly confluentRegistry: ConfluentRegistryClient | undefined;

  constructor(
    producer: Producer,
    schemaRegistry: Map<string, ZodSchema> = eventSchemaRegistry,
    confluentRegistry?: ConfluentRegistryClient,
  ) {
    this.producer = producer;
    this.schemaRegistry = schemaRegistry;
    this.confluentRegistry = confluentRegistry;
  }

  /**
   * Publishes a single event to the specified topic.
   *
   * 1. Validates the event envelope against its Zod schema (hard gate).
   * 2. If a Confluent registry is configured, looks up or registers the
   *    schema and stamps `x-schema-id` + `x-schema-version` on the message.
   * 3. Uses tenantId as the partition key for tenant-scoped ordering.
   */
  async publish<T>(topic: string, event: EventEnvelope<T>): Promise<void> {
    this.validateOrThrow(event);

    const schemaId = await this.resolveSchemaId(event.type);

    const headers: Record<string, string> = {
      'x-event-type': event.type,
      'x-tenant-id': event.tenantId,
      'x-correlation-id': event.metadata.correlationId,
      'x-event-id': event.id,
      'x-schema-version': String(event.metadata.version),
    };
    if (schemaId !== undefined) {
      headers['x-schema-id'] = String(schemaId);
    }

    try {
      await this.producer.send({
        topic,
        messages: [{ key: event.tenantId, value: JSON.stringify(event), headers }],
      });
    } catch (cause: unknown) {
      throw new EventPublishError(topic, cause);
    }
  }

  /**
   * Publishes a batch of events to the specified topic.
   *
   * All events are Zod-validated before any are published.
   * If any event fails validation, the entire batch is rejected.
   * Schema IDs are resolved concurrently for all unique event types.
   */
  async publishBatch<T>(topic: string, events: ReadonlyArray<EventEnvelope<T>>): Promise<void> {
    // Validate all events first — fail-fast before any I/O
    for (const event of events) {
      this.validateOrThrow(event);
    }

    // Resolve schema IDs for all unique event types (concurrent)
    const uniqueTypes = [...new Set(events.map((e) => e.type))];
    const schemaIdMap = new Map<string, number | undefined>();
    await Promise.all(
      uniqueTypes.map(async (type) => {
        schemaIdMap.set(type, await this.resolveSchemaId(type));
      }),
    );

    const messages = events.map((event) => {
      const schemaId = schemaIdMap.get(event.type);
      const headers: Record<string, string> = {
        'x-event-type': event.type,
        'x-tenant-id': event.tenantId,
        'x-correlation-id': event.metadata.correlationId,
        'x-event-id': event.id,
        'x-schema-version': String(event.metadata.version),
      };
      if (schemaId !== undefined) {
        headers['x-schema-id'] = String(schemaId);
      }
      return { key: event.tenantId, value: JSON.stringify(event), headers };
    });

    try {
      await this.producer.send({ topic, messages });
    } catch (cause: unknown) {
      throw new EventPublishError(topic, cause);
    }
  }

  /**
   * Pre-registers all known schemas with the Confluent registry.
   *
   * Call this once during application startup (after Kafka connection)
   * so that schema compatibility is verified before any traffic flows.
   * No-op if no Confluent registry is configured.
   */
  async registerAllSchemas(): Promise<void> {
    const registry = this.confluentRegistry;
    if (registry === undefined) return;

    const { getAllJsonSchemas } = await import('./json-schemas.js');
    const allSchemas = getAllJsonSchemas();

    await Promise.allSettled(
      [...allSchemas.entries()].map(async ([eventType, jsonSchema]) => {
        try {
          await registry.registerSchema(eventType, jsonSchema);
        } catch (err) {
          // Non-fatal — log and continue. Service still publishes with Zod validation.
          console.warn(
            `[ORDR:events] Schema Registry: failed to register '${eventType}':`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }),
    );
  }

  /**
   * Looks up or lazily registers the Confluent schema ID for an event type.
   *
   * Returns undefined if no Confluent registry is configured, or if
   * registration fails (non-fatal — Zod is the hard gate).
   */
  private async resolveSchemaId(eventType: string): Promise<number | undefined> {
    if (this.confluentRegistry === undefined) return undefined;

    const cached = this.confluentRegistry.cachedIdFor(eventType);
    if (cached !== undefined) return cached;

    const jsonSchema = getJsonSchemaForEventType(eventType);
    if (jsonSchema === undefined) return undefined;

    try {
      return await this.confluentRegistry.registerSchema(eventType, jsonSchema);
    } catch (err) {
      // Non-fatal — registry failures never block event publishing.
      console.warn(
        `[ORDR:events] Schema Registry: lazy registration failed for '${eventType}':`,
        err instanceof Error ? err.message : String(err),
      );
      return undefined;
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
