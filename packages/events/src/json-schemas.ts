/**
 * JSON Schema bridge — derives JSON Schema representations from the
 * existing Zod schema registry using `zod-to-json-schema`.
 *
 * Zod is the single source of truth for all event shapes. The JSON Schema
 * output is used solely for Confluent Schema Registry registration — it is
 * always generated from the Zod schemas, never maintained separately.
 *
 * This keeps the two representations permanently in sync: any Zod schema
 * change automatically produces an updated JSON Schema on next startup.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import { eventSchemaRegistry } from './schemas.js';

// ─── Conversion Options ───────────────────────────────────────────

const ZOD_TO_JSON_OPTIONS = {
  // Inline all $ref definitions — Confluent needs a self-contained schema.
  $refStrategy: 'none',
  // Use JSON Schema draft-07 (widest compatibility with Confluent).
  target: 'jsonSchema7',
} as const;

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Returns the JSON Schema for a given event type, derived from its Zod schema.
 * Returns undefined if the event type is not registered.
 */
export function getJsonSchemaForEventType(eventType: string): object | undefined {
  const zodSchema = eventSchemaRegistry.get(eventType);
  if (zodSchema === undefined) return undefined;
  return zodToJsonSchema(zodSchema, ZOD_TO_JSON_OPTIONS) as object;
}

/**
 * Returns a Map of all registered event types to their JSON Schemas.
 * Used during startup to pre-register all schemas with the Confluent registry.
 */
export function getAllJsonSchemas(): ReadonlyMap<string, object> {
  const result = new Map<string, object>();
  for (const [eventType, zodSchema] of eventSchemaRegistry.entries()) {
    result.set(eventType, zodToJsonSchema(zodSchema, ZOD_TO_JSON_OPTIONS) as object);
  }
  return result;
}
