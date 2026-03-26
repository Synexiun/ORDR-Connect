/**
 * @ordr/scheduler — Lightweight Cron Expression Parser
 *
 * Parses standard 5-field cron expressions:
 *   minute (0-59) | hour (0-23) | day-of-month (1-31) | month (1-12) | day-of-week (0-6, 0=Sunday)
 *
 * Supports:
 * - Wildcards: *
 * - Ranges: 1-5
 * - Steps: * /15 (or 1-30/5)
 * - Lists: 1,3,5
 * - Combinations: 1-5,10,20-25/2
 *
 * Zero external dependencies — uses only native Date math.
 */

import type { CronExpression } from './types.js';

// ─── Field Boundaries ────────────────────────────────────────────

interface FieldBounds {
  readonly min: number;
  readonly max: number;
}

const FIELD_BOUNDS: readonly FieldBounds[] = [
  { min: 0, max: 59 },   // minute
  { min: 0, max: 23 },   // hour
  { min: 1, max: 31 },   // day of month
  { min: 1, max: 12 },   // month
  { min: 0, max: 6 },    // day of week (0 = Sunday)
] as const;

const FIELD_NAMES = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'] as const;

// ─── Parsed Cron ─────────────────────────────────────────────────

export interface ParsedCron {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly daysOfWeek: ReadonlySet<number>;
}

// ─── Parser Implementation ───────────────────────────────────────

/**
 * Parse a single cron field into a set of valid values.
 *
 * @param field - The raw field string (e.g., star-slash-15, "1-5", "1,3,5")
 * @param bounds - Min/max values for this field
 * @param fieldName - Name for error messages
 * @returns Set of valid integer values
 */
function parseField(field: string, bounds: FieldBounds, fieldName: string): Set<number> {
  const values = new Set<number>();

  const parts = field.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') {
      throw new Error(`Empty segment in ${fieldName} field`);
    }

    // Check for step syntax: X/Y
    const stepParts = trimmed.split('/');

    if (stepParts.length > 2) {
      throw new Error(`Invalid step syntax "${trimmed}" in ${fieldName} field`);
    }

    const rangePart = stepParts[0]!;
    const stepStr = stepParts[1];
    let step = 1;

    if (stepStr !== undefined) {
      step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value "${stepStr}" in ${fieldName} field`);
      }
    }

    // Parse the range part
    if (rangePart === '*') {
      // Wildcard — all values in range with step
      for (let i = bounds.min; i <= bounds.max; i += step) {
        values.add(i);
      }
    } else if (rangePart.includes('-')) {
      // Range: start-end
      const rangeBounds = rangePart.split('-');
      if (rangeBounds.length !== 2) {
        throw new Error(`Invalid range "${rangePart}" in ${fieldName} field`);
      }

      const start = parseInt(rangeBounds[0]!, 10);
      const end = parseInt(rangeBounds[1]!, 10);

      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Non-numeric range "${rangePart}" in ${fieldName} field`);
      }

      if (start < bounds.min || start > bounds.max) {
        throw new Error(`Range start ${start} out of bounds [${bounds.min}-${bounds.max}] in ${fieldName} field`);
      }

      if (end < bounds.min || end > bounds.max) {
        throw new Error(`Range end ${end} out of bounds [${bounds.min}-${bounds.max}] in ${fieldName} field`);
      }

      if (start > end) {
        throw new Error(`Range start ${start} > end ${end} in ${fieldName} field`);
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else {
      // Single value
      const value = parseInt(rangePart, 10);

      if (isNaN(value)) {
        throw new Error(`Non-numeric value "${rangePart}" in ${fieldName} field`);
      }

      if (value < bounds.min || value > bounds.max) {
        throw new Error(`Value ${value} out of bounds [${bounds.min}-${bounds.max}] in ${fieldName} field`);
      }

      // Single value with step still just yields that value
      if (stepStr !== undefined) {
        // e.g., "5/10" means starting at 5, every 10
        for (let i = value; i <= bounds.max; i += step) {
          values.add(i);
        }
      } else {
        values.add(value);
      }
    }
  }

  if (values.size === 0) {
    throw new Error(`No valid values produced for ${fieldName} field from "${field}"`);
  }

  return values;
}

/**
 * Validate and parse a 5-field cron expression.
 *
 * @param expression - Cron expression string (e.g., "0 * /6 * * *")
 * @returns Parsed cron with sets of valid values per field
 * @throws Error if the expression is invalid
 */
export function parseCron(expression: string): ParsedCron {
  const trimmed = expression.trim();
  const fields = trimmed.split(/\s+/);

  if (fields.length !== 5) {
    throw new Error(
      `Cron expression must have exactly 5 fields (minute hour day month weekday), got ${fields.length}: "${trimmed}"`,
    );
  }

  const minutes = parseField(fields[0]!, FIELD_BOUNDS[0]!, FIELD_NAMES[0]!);
  const hours = parseField(fields[1]!, FIELD_BOUNDS[1]!, FIELD_NAMES[1]!);
  const daysOfMonth = parseField(fields[2]!, FIELD_BOUNDS[2]!, FIELD_NAMES[2]!);
  const months = parseField(fields[3]!, FIELD_BOUNDS[3]!, FIELD_NAMES[3]!);
  const daysOfWeek = parseField(fields[4]!, FIELD_BOUNDS[4]!, FIELD_NAMES[4]!);

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
  };
}

/**
 * Validate whether a string is a valid 5-field cron expression.
 *
 * @param expression - The string to validate
 * @returns true if valid, false otherwise
 */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a branded CronExpression from a raw string.
 * Validates the expression and throws if invalid.
 *
 * @param expression - Raw cron string
 * @returns Branded CronExpression
 */
export function createCronExpression(expression: string): CronExpression {
  parseCron(expression); // throws on invalid
  return expression as CronExpression;
}

/**
 * Calculate the next occurrence of a cron schedule after the given date.
 *
 * Searches forward up to 2 years to find the next matching date/time.
 * Handles month-day overflow (e.g., Feb 30 is skipped).
 *
 * @param parsed - The parsed cron expression
 * @param after - The reference date (exclusive — finds the NEXT match after this time)
 * @returns The next matching Date, or null if none found within 2 years
 */
export function nextOccurrence(parsed: ParsedCron, after: Date): Date | null {
  // Start from the next minute after `after`
  const candidate = new Date(after.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxDate = new Date(after.getTime());
  maxDate.setFullYear(maxDate.getFullYear() + 2);

  while (candidate.getTime() <= maxDate.getTime()) {
    // Check month (1-12)
    const month = candidate.getMonth() + 1; // JS months are 0-indexed
    if (!parsed.months.has(month)) {
      // Skip to next month
      candidate.setMonth(candidate.getMonth() + 1);
      candidate.setDate(1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    // Check day of month (1-31)
    const dayOfMonth = candidate.getDate();
    if (!parsed.daysOfMonth.has(dayOfMonth)) {
      // Skip to next day
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    // Check day of week (0-6, 0=Sunday)
    const dayOfWeek = candidate.getDay();
    if (!parsed.daysOfWeek.has(dayOfWeek)) {
      // Skip to next day
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    // Check hour (0-23)
    const hour = candidate.getHours();
    if (!parsed.hours.has(hour)) {
      // Skip to next hour
      candidate.setHours(candidate.getHours() + 1);
      candidate.setMinutes(0, 0, 0);
      continue;
    }

    // Check minute (0-59)
    const minute = candidate.getMinutes();
    if (!parsed.minutes.has(minute)) {
      // Skip to next minute
      candidate.setMinutes(candidate.getMinutes() + 1);
      candidate.setSeconds(0, 0);
      continue;
    }

    // All fields match
    return new Date(candidate.getTime());
  }

  // No match within 2 years
  return null;
}
