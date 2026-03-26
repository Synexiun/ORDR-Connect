import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StructuredLogger, scrubPhi } from '../logger.js';
import type { LogEntry } from '../logger.js';

// ─── Helpers ─────────────────────────────────────────────────────

function createTestLogger(level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'): {
  logger: StructuredLogger;
  entries: LogEntry[];
} {
  const entries: LogEntry[] = [];
  const logger = new StructuredLogger({
    service: 'test-service',
    level: level ?? 'debug',
    writer: (entry) => entries.push(entry),
  });
  return { logger, entries };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('StructuredLogger', () => {
  describe('structured JSON output', () => {
    it('produces structured log entries with all required fields', () => {
      const { logger, entries } = createTestLogger();

      logger.info('Server started', { tenantId: 'tenant-1' });

      expect(entries).toHaveLength(1);
      const entry = entries[0]!;

      expect(entry.timestamp).toBeTruthy();
      expect(entry.level).toBe('info');
      expect(entry.service).toBe('test-service');
      expect(entry.message).toBe('Server started');
      expect(entry.tenantId).toBe('tenant-1');
    });

    it('includes correlation_id when provided', () => {
      const { logger, entries } = createTestLogger();

      logger.info('Request received', {
        correlationId: 'req-abc-123',
      });

      expect(entries[0]!.correlationId).toBe('req-abc-123');
    });

    it('includes metadata when provided', () => {
      const { logger, entries } = createTestLogger();

      logger.info('Query executed', {
        metadata: { duration_ms: 42, table: 'customers' },
      });

      expect(entries[0]!.metadata).toEqual({ duration_ms: 42, table: 'customers' });
    });
  });

  describe('log levels', () => {
    it('logs debug messages when level is debug', () => {
      const { logger, entries } = createTestLogger('debug');
      logger.debug('debug msg');
      expect(entries).toHaveLength(1);
    });

    it('filters debug messages when level is info', () => {
      const { logger, entries } = createTestLogger('info');
      logger.debug('should be filtered');
      expect(entries).toHaveLength(0);
    });

    it('filters info messages when level is warn', () => {
      const { logger, entries } = createTestLogger('warn');
      logger.info('should be filtered');
      expect(entries).toHaveLength(0);
    });

    it('allows warn and above when level is warn', () => {
      const { logger, entries } = createTestLogger('warn');
      logger.warn('warning');
      logger.error('error');
      logger.fatal('fatal');
      expect(entries).toHaveLength(3);
    });

    it('logs fatal at any level', () => {
      const { logger, entries } = createTestLogger('fatal');
      logger.debug('nope');
      logger.info('nope');
      logger.warn('nope');
      logger.error('nope');
      logger.fatal('yes');
      expect(entries).toHaveLength(1);
      expect(entries[0]!.level).toBe('fatal');
    });
  });

  describe('PHI scrubber', () => {
    it('removes SSN patterns (with dashes)', () => {
      const { logger, entries } = createTestLogger();
      logger.info('Found SSN 123-45-6789 in record');
      expect(entries[0]!.message).toBe('Found SSN [SSN_REDACTED] in record');
    });

    it('removes SSN patterns (without dashes)', () => {
      const { logger, entries } = createTestLogger();
      logger.info('SSN is 123456789');
      expect(entries[0]!.message).toBe('SSN is [SSN_REDACTED]');
    });

    it('removes credit card patterns (with spaces)', () => {
      const { logger, entries } = createTestLogger();
      logger.info('Card: 4111 1111 1111 1111');
      expect(entries[0]!.message).toBe('Card: [CC_REDACTED]');
    });

    it('removes credit card patterns (with dashes)', () => {
      const { logger, entries } = createTestLogger();
      logger.info('Card: 4111-1111-1111-1111');
      expect(entries[0]!.message).toBe('Card: [CC_REDACTED]');
    });

    it('removes credit card patterns (contiguous digits)', () => {
      const { logger, entries } = createTestLogger();
      logger.info('Card: 4111111111111111');
      expect(entries[0]!.message).toBe('Card: [CC_REDACTED]');
    });

    it('removes MRN patterns', () => {
      const { logger, entries } = createTestLogger();
      logger.info('Medical record MRN-1234567 accessed');
      expect(entries[0]!.message).toBe('Medical record [MRN_REDACTED] accessed');
    });

    it('removes email patterns', () => {
      const { logger, entries } = createTestLogger();
      logger.info('Sent to john.doe@example.com');
      expect(entries[0]!.message).toBe('Sent to [EMAIL_REDACTED]');
    });

    it('scrubs PHI from metadata values', () => {
      const { logger, entries } = createTestLogger();
      logger.info('Event', {
        metadata: { note: 'SSN 123-45-6789 on file', safe_field: 42 },
      });

      expect(entries[0]!.metadata).toEqual({
        note: 'SSN [SSN_REDACTED] on file',
        safe_field: 42,
      });
    });

    it('scrubs PHI from nested metadata', () => {
      const { logger, entries } = createTestLogger();
      logger.info('Event', {
        metadata: {
          outer: {
            inner: 'Contact: jane@example.org',
          },
        },
      });

      const meta = entries[0]!.metadata as Record<string, Record<string, string>>;
      expect(meta['outer']!['inner']).toBe('Contact: [EMAIL_REDACTED]');
    });

    it('handles messages with no PHI (passthrough)', () => {
      const { logger, entries } = createTestLogger();
      logger.info('Normal operational message');
      expect(entries[0]!.message).toBe('Normal operational message');
    });
  });

  describe('context injection', () => {
    it('includes manually provided trace_id', () => {
      const { logger, entries } = createTestLogger();
      logger.info('traced', {
        traceId: 'abc123def456',
        spanId: 'span-789',
      });

      expect(entries[0]!.traceId).toBe('abc123def456');
      expect(entries[0]!.spanId).toBe('span-789');
    });

    it('omits undefined optional fields', () => {
      const { logger, entries } = createTestLogger();
      logger.info('minimal');

      const entry = entries[0]!;
      expect(entry.tenantId).toBeUndefined();
      expect(entry.correlationId).toBeUndefined();
      expect(entry.metadata).toBeUndefined();
    });
  });
});

describe('scrubPhi()', () => {
  it('is a pure function', () => {
    const input = 'SSN 123-45-6789';
    const result1 = scrubPhi(input);
    const result2 = scrubPhi(input);
    expect(result1).toBe(result2);
    expect(input).toBe('SSN 123-45-6789'); // Original unchanged
  });

  it('handles empty strings', () => {
    expect(scrubPhi('')).toBe('');
  });

  it('handles strings with no PHI', () => {
    const clean = 'Normal text without sensitive data';
    expect(scrubPhi(clean)).toBe(clean);
  });
});
