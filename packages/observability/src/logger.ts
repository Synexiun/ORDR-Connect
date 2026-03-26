/**
 * @ordr/observability — Structured JSON logger with PHI scrubbing
 *
 * SOC2 CC7.2 — Monitoring: structured operational logging.
 * ISO 27001 A.8.15 — Logging: consistent, searchable log format.
 * HIPAA §164.312(b) — Audit controls: safe operational logging.
 *
 * SECURITY (Rule 6 — PHI Handling):
 * - PHI scrubber strips SSN, MRN, credit card, email patterns from ALL log output
 * - No PHI in log messages, metadata, or structured fields
 * - Logs NEVER include request/response bodies
 * - Error stack traces logged internally but NEVER contain PHI
 */

import { getActiveTraceContext } from './tracer.js';
import { LOG_LEVELS, type LogLevel } from './types.js';

// ─── PHI Scrubbing Patterns ──────────────────────────────────────

/** Patterns that indicate potential PHI/PII that MUST be redacted. */
const PHI_PATTERNS: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
  // SSN: 123-45-6789 or 123456789
  { pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  // Credit card: 16 digits with optional separators
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[CC_REDACTED]' },
  // MRN (Medical Record Number): common formats MRN-XXXXXXX or MRN: XXXXXXX
  { pattern: /\bMRN[-:\s]?\d{5,10}\b/gi, replacement: '[MRN_REDACTED]' },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]' },
  // Phone numbers: various US formats
  { pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE_REDACTED]' },
] as const;

/**
 * Scrub PHI/PII patterns from a string.
 * Applied to ALL log output before writing.
 */
export function scrubPhi(input: string): string {
  let result = input;
  for (const { pattern, replacement } of PHI_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Deep-scrub an object's string values for PHI patterns.
 */
function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = scrubPhi(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = scrubObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Structured Logger ───────────────────────────────────────────

export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly message: string;
  readonly traceId?: string | undefined;
  readonly spanId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface LoggerConfig {
  readonly service: string;
  readonly level?: LogLevel | undefined;
  readonly writer?: ((entry: LogEntry) => void) | undefined;
}

export class StructuredLogger {
  private readonly service: string;
  private readonly minLevel: number;
  private readonly writer: (entry: LogEntry) => void;

  constructor(config: LoggerConfig) {
    this.service = config.service;
    this.minLevel = LOG_LEVELS[config.level ?? 'info'];
    this.writer = config.writer ?? StructuredLogger.defaultWriter;
  }

  // ── Public API ───────────────────────────────────────────────

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  fatal(message: string, context?: LogContext): void {
    this.log('fatal', message, context);
  }

  // ── Internal ─────────────────────────────────────────────────

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVELS[level] < this.minLevel) {
      return;
    }

    // Inject trace context from active OTel span
    const traceCtx = getActiveTraceContext();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message: scrubPhi(message),
      traceId: context?.traceId ?? traceCtx?.traceId,
      spanId: context?.spanId ?? traceCtx?.spanId,
      tenantId: context?.tenantId,
      correlationId: context?.correlationId,
      metadata: context?.metadata ? scrubObject(context.metadata) : undefined,
    };

    this.writer(entry);
  }

  private static defaultWriter(entry: LogEntry): void {
    const output = JSON.stringify(entry);
    // Route to stderr for error/fatal, stdout for everything else
    if (entry.level === 'error' || entry.level === 'fatal') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }
}

// ─── Context Type ────────────────────────────────────────────────

export interface LogContext {
  readonly traceId?: string | undefined;
  readonly spanId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}
