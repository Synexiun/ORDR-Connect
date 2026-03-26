/**
 * Zod schemas — runtime validation for every event payload
 *
 * SECURITY: Every event MUST be validated before publishing or consuming.
 * Invalid payloads are rejected at the boundary, never silently passed through.
 * Schema registry maps event types to their Zod schemas for automatic lookup.
 */

import { z, type ZodSchema } from 'zod';
import { EventType } from './types.js';

// ─── Result Type ──────────────────────────────────────────────────

export interface ValidationSuccess<T> {
  readonly success: true;
  readonly data: T;
}

export interface ValidationFailure {
  readonly success: false;
  readonly error: string;
  readonly issues: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// ─── Metadata Schema ──────────────────────────────────────────────

export const eventMetadataSchema = z.object({
  correlationId: z.string().min(1),
  causationId: z.string().min(1),
  userId: z.string().optional(),
  agentId: z.string().optional(),
  source: z.string().min(1),
  version: z.number().int().positive(),
});

// ─── Envelope Schema Factory ──────────────────────────────────────

export function createEnvelopeSchema<T extends z.ZodTypeAny>(
  payloadSchema: T,
): z.ZodObject<{
  id: z.ZodString;
  type: z.ZodString;
  tenantId: z.ZodString;
  payload: T;
  metadata: typeof eventMetadataSchema;
  timestamp: z.ZodString;
}> {
  return z.object({
    id: z.string().uuid(),
    type: z.string().min(1),
    tenantId: z.string().min(1),
    payload: payloadSchema,
    metadata: eventMetadataSchema,
    timestamp: z.string().datetime(),
  });
}

// ─── Customer Schemas ─────────────────────────────────────────────

export const customerCreatedPayloadSchema = z.object({
  customerId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  type: z.string().min(1),
  lifecycleStage: z.string().min(1),
});

export const customerUpdatedPayloadSchema = z.object({
  customerId: z.string().min(1),
  changes: z.record(
    z.string(),
    z.object({
      old: z.unknown(),
      new: z.unknown(),
    }),
  ),
});

// ─── Interaction Schemas ──────────────────────────────────────────

export const interactionLoggedPayloadSchema = z.object({
  interactionId: z.string().min(1),
  customerId: z.string().min(1),
  channel: z.string().min(1),
  direction: z.string().min(1),
  type: z.string().min(1),
  sentiment: z.string().optional(),
});

// ─── Agent Schemas ────────────────────────────────────────────────

export const agentActionExecutedPayloadSchema = z.object({
  actionId: z.string().min(1),
  agentId: z.string().min(1),
  agentRole: z.string().min(1),
  actionType: z.string().min(1),
  confidence: z.number().min(0).max(1),
  approved: z.boolean(),
});

// ─── Compliance Schemas ───────────────────────────────────────────

export const complianceCheckPayloadSchema = z.object({
  recordId: z.string().min(1),
  regulation: z.string().min(1),
  ruleId: z.string().min(1),
  result: z.string().min(1),
  customerId: z.string().optional(),
});

// ─── Auth Schemas ─────────────────────────────────────────────────

export const authEventPayloadSchema = z.object({
  userId: z.string().min(1),
  action: z.enum(['login', 'logout', 'failed', 'mfa_verified']),
  ipAddress: z.string().optional(),
});

// ─── Schema Registry ──────────────────────────────────────────────

/**
 * Maps event type strings to their payload Zod schemas.
 * Used by producer and consumer to automatically validate events.
 */
export const eventSchemaRegistry = new Map<string, ZodSchema>([
  [EventType.CUSTOMER_CREATED, createEnvelopeSchema(customerCreatedPayloadSchema)],
  [EventType.CUSTOMER_UPDATED, createEnvelopeSchema(customerUpdatedPayloadSchema)],
  [EventType.INTERACTION_LOGGED, createEnvelopeSchema(interactionLoggedPayloadSchema)],
  [EventType.AGENT_ACTION_EXECUTED, createEnvelopeSchema(agentActionExecutedPayloadSchema)],
  [EventType.COMPLIANCE_CHECK, createEnvelopeSchema(complianceCheckPayloadSchema)],
  [EventType.AUTH_LOGIN, createEnvelopeSchema(authEventPayloadSchema)],
  [EventType.AUTH_LOGOUT, createEnvelopeSchema(authEventPayloadSchema)],
  [EventType.AUTH_FAILED, createEnvelopeSchema(authEventPayloadSchema)],
  [EventType.AUTH_MFA_VERIFIED, createEnvelopeSchema(authEventPayloadSchema)],
]);

// ─── Validation Helper ────────────────────────────────────────────

/**
 * Validates unknown data against a Zod schema.
 * Returns a discriminated Result — never throws.
 */
export function validateEvent<T>(schema: ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

  return {
    success: false,
    error: `Validation failed: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    issues,
  };
}
