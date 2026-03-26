/**
 * @ordr/events — event streaming package for ORDR-Connect
 *
 * Kafka-based event streaming with schema validation, tenant isolation,
 * dead letter queue handling, and SOC2/ISO27001/HIPAA compliance.
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  EventEnvelope,
  EventMetadata,
  CustomerCreatedPayload,
  CustomerUpdatedPayload,
  InteractionLoggedPayload,
  AgentActionExecutedPayload,
  ComplianceCheckPayload,
  AuthEventPayload,
  EventTypeValue,
} from './types.js';

export { EventType } from './types.js';

// ─── Schemas ──────────────────────────────────────────────────────
export type { ValidationResult, ValidationSuccess, ValidationFailure } from './schemas.js';

export {
  eventMetadataSchema,
  createEnvelopeSchema,
  customerCreatedPayloadSchema,
  customerUpdatedPayloadSchema,
  interactionLoggedPayloadSchema,
  agentActionExecutedPayloadSchema,
  complianceCheckPayloadSchema,
  authEventPayloadSchema,
  eventSchemaRegistry,
  validateEvent,
} from './schemas.js';

// ─── Topics ───────────────────────────────────────────────────────
export type { TopicName, TopicConfig } from './topics.js';

export { TOPICS, DEFAULT_TOPIC_CONFIGS } from './topics.js';

// ─── Kafka Client ─────────────────────────────────────────────────
export type { EventsKafkaConfig, Producer, Consumer } from './kafka-client.js';

export {
  createKafkaClient,
  createProducer,
  createConsumer,
  Kafka,
  CompressionTypes,
} from './kafka-client.js';

// ─── Producer ─────────────────────────────────────────────────────
export {
  EventProducer,
  EventValidationError,
  EventPublishError,
  createEventEnvelope,
} from './producer.js';

// ─── Consumer ─────────────────────────────────────────────────────
export type { EventHandler, EventConsumerConfig } from './consumer.js';

export { EventConsumer } from './consumer.js';

// ─── Dead Letter Queue ────────────────────────────────────────────
export type { DlqEvent, ProcessDlqHandle } from './dlq.js';

export { DeadLetterHandler } from './dlq.js';
