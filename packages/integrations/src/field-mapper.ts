/**
 * Field Mapper — applies FieldMapping configs to CRM/ORDR record transforms.
 *
 * Pure functions only: no I/O, no DB, no HTTP.
 * Injectable and unit-testable in isolation.
 *
 * Inbound  = external CRM → ORDR (externalField → ordrField)
 * Outbound = ORDR → external CRM (ordrField → externalField)
 *
 * PHI detection:
 *   On inbound mapping, any field where `isPhi === true` is added to the
 *   returned `phiFields` list so the caller can encrypt before DB insert
 *   (HIPAA §164.312(a)(2)(iv) / CLAUDE.md Rule 1).
 *
 * Transform support:
 *   date_format — convert between 'iso', 'unix' (seconds), 'unix_ms'
 *   lowercase   — String.toLowerCase()
 *   uppercase   — String.toUpperCase()
 *   trim        — String.trim()
 *   custom      — passed through unchanged; caller applies domain logic
 *
 * SOC2 CC6.1 — tenant-scoped field configs prevent cross-tenant data leakage.
 */

import type { FieldMapping, FieldTransform } from './types.js';

// ─── Public types ────────────────────────────────────────────────

export interface MappingResult {
  /** The transformed record with mapped field names. */
  readonly record: Readonly<Record<string, unknown>>;
  /**
   * Names of fields in `record` that contain PHI (inbound only).
   * Callers MUST encrypt these fields before writing to the database.
   */
  readonly phiFields: readonly string[];
}

// ─── Core mapper ─────────────────────────────────────────────────

/**
 * Apply a set of FieldMappings to a source record.
 *
 * Only mappings whose direction matches or is 'bidirectional' are applied.
 * Fields absent in the source (undefined / null) are omitted from the output.
 *
 * @param source     Raw record from the source system.
 * @param mappings   Configured field mappings for this integration.
 * @param direction  'inbound' (external→ORDR) or 'outbound' (ORDR→external).
 */
export function applyFieldMappings(
  source: Readonly<Record<string, unknown>>,
  mappings: readonly FieldMapping[],
  direction: 'inbound' | 'outbound',
): MappingResult {
  const record: Record<string, unknown> = {};
  const phiFields: string[] = [];

  for (const mapping of mappings) {
    if (mapping.direction !== 'bidirectional' && mapping.direction !== direction) continue;

    const sourceField = direction === 'inbound' ? mapping.externalField : mapping.ordrField;
    const targetField = direction === 'inbound' ? mapping.ordrField : mapping.externalField;

    const rawValue = source[sourceField];
    if (rawValue === undefined || rawValue === null) continue;

    record[targetField] =
      mapping.transform !== undefined ? applyTransform(rawValue, mapping.transform) : rawValue;

    if (mapping.isPhi && direction === 'inbound') {
      phiFields.push(targetField);
    }
  }

  return { record, phiFields };
}

/**
 * Compute the default ORDR→CRM field mapping for a CrmContact.
 * Used when no custom mapping is configured.
 */
export function defaultContactMappings(): readonly FieldMapping[] {
  return [
    { ordrField: 'id', externalField: 'ordr_id', direction: 'outbound', isPhi: false },
    { ordrField: 'firstName', externalField: 'firstName', direction: 'bidirectional', isPhi: true },
    { ordrField: 'lastName', externalField: 'lastName', direction: 'bidirectional', isPhi: true },
    { ordrField: 'email', externalField: 'email', direction: 'bidirectional', isPhi: true },
    { ordrField: 'phone', externalField: 'phone', direction: 'bidirectional', isPhi: true },
    { ordrField: 'company', externalField: 'company', direction: 'bidirectional', isPhi: false },
    { ordrField: 'title', externalField: 'title', direction: 'bidirectional', isPhi: false },
    {
      ordrField: 'updatedAt',
      externalField: 'lastModified',
      direction: 'bidirectional',
      isPhi: false,
      transform: { type: 'date_format', config: { fromFormat: 'iso', toFormat: 'iso' } },
    },
  ];
}

// ─── Transform engine ────────────────────────────────────────────

/**
 * Apply a single FieldTransform to a value.
 * Returns the original value unchanged for 'custom' transforms or
 * when the input type does not support the transform.
 */
export function applyTransform(value: unknown, transform: FieldTransform): unknown {
  switch (transform.type) {
    case 'lowercase':
      return typeof value === 'string' ? value.toLowerCase() : value;

    case 'uppercase':
      return typeof value === 'string' ? value.toUpperCase() : value;

    case 'trim':
      return typeof value === 'string' ? value.trim() : value;

    case 'date_format':
      return transformDate(value, transform.config);

    case 'custom':
      // Custom transforms are not applied at the engine layer.
      // Callers must handle 'custom' type before invoking applyTransform.
      return value;
  }
}

// ─── Date transform ──────────────────────────────────────────────

/**
 * Convert a date value between supported formats.
 *
 * config.fromFormat: 'iso' | 'unix' | 'unix_ms'  (default: 'iso')
 * config.toFormat:   'iso' | 'unix' | 'unix_ms'  (default: 'iso')
 *
 * Returns the original value unchanged if parsing fails.
 */
function transformDate(
  value: unknown,
  config: Readonly<Record<string, string>> | undefined,
): unknown {
  const from = config?.['fromFormat'] ?? 'iso';
  const to = config?.['toFormat'] ?? 'iso';

  if (from === to) return value;

  const date = parseDate(value, from);
  if (date === null) return value;

  return serialiseDate(date, to);
}

function parseDate(value: unknown, format: string): Date | null {
  if (format === 'unix' && typeof value === 'number') {
    return new Date(value * 1_000);
  }
  if (format === 'unix_ms' && typeof value === 'number') {
    return new Date(value);
  }
  if (format === 'iso' && typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  return null;
}

function serialiseDate(date: Date, format: string): unknown {
  if (format === 'unix') return Math.floor(date.getTime() / 1_000);
  if (format === 'unix_ms') return date.getTime();
  if (format === 'iso') return date.toISOString();
  return date.toISOString();
}
