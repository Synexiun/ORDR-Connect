/**
 * Security Event Bus — In-process security event streaming and correlation
 *
 * A lightweight, synchronous pub/sub bus for security events. Supports:
 * - Real-time event subscription (handlers notified on emit)
 * - Rolling in-memory ring buffer (last N events, configurable)
 * - SIEM-lite correlation: detect attack bursts across a sliding window
 * - Pattern-based alerting (escalate to critical when same IP attacks repeatedly)
 *
 * This is an in-process bus. For production SIEM integration, events should
 * also be written to Kafka (topic: security.events) or forwarded to an external
 * SIEM via the SecurityEvent Kafka consumer.
 *
 * Thread safety: Node.js is single-threaded; no locking required.
 *
 * SOC2 CC7.2 — System monitoring: real-time security event aggregation.
 * ISO 27001 A.16.1.2 — Reporting information security events.
 * HIPAA §164.308(a)(6)(i) — Security incident procedures.
 */

import { randomUUID } from 'node:crypto';
import type { SecurityEvent, SecurityEventType, SecuritySeverity } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SecurityEventHandler = (event: SecurityEvent) => void | Promise<void>;

export interface SecurityCorrelation {
  /** IP address responsible for correlated events. */
  readonly ip: string;
  readonly eventCount: number;
  readonly distinctTypes: readonly SecurityEventType[];
  readonly windowMs: number;
  readonly escalatedSeverity: SecuritySeverity;
  readonly correlatedAt: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RING_BUFFER_SIZE = 1000;
const DEFAULT_CORRELATION_WINDOW_MS = 60_000; // 1 minute
const CORRELATION_THRESHOLD = 5; // events in window before correlation fires

// ─── SecurityEventBus ────────────────────────────────────────────────────────

export class SecurityEventBus {
  private readonly handlers: Set<SecurityEventHandler> = new Set();
  private readonly ringBuffer: SecurityEvent[] = [];
  private readonly bufferSize: number;
  private readonly correlationWindowMs: number;

  constructor(config?: { readonly bufferSize?: number; readonly correlationWindowMs?: number }) {
    this.bufferSize = config?.bufferSize ?? DEFAULT_RING_BUFFER_SIZE;
    this.correlationWindowMs = config?.correlationWindowMs ?? DEFAULT_CORRELATION_WINDOW_MS;
  }

  /**
   * Subscribe to all security events.
   * Returns an unsubscribe function; call it to stop receiving events.
   */
  subscribe(handler: SecurityEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Emit a security event. Dispatches to all subscribers synchronously
   * (async handlers are fired-and-forgotten with error swallowing to prevent
   * security events from disrupting the request path).
   */
  emit(partial: Omit<SecurityEvent, 'id' | 'timestamp'>): SecurityEvent {
    const event: SecurityEvent = {
      ...partial,
      id: randomUUID(),
      timestamp: new Date(),
    };

    // Append to ring buffer, evict oldest if full
    if (this.ringBuffer.length >= this.bufferSize) {
      this.ringBuffer.shift();
    }
    this.ringBuffer.push(event);

    // Notify subscribers — errors are swallowed to never block the request path
    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((handlerErr: unknown) => {
            console.error('[ORDR:SECURITY] SecurityEventBus handler error:', handlerErr);
          });
        }
      } catch (handlerErr: unknown) {
        console.error('[ORDR:SECURITY] SecurityEventBus handler threw:', handlerErr);
      }
    }

    return event;
  }

  /**
   * Return the most recent events from the ring buffer.
   * @param limit Maximum number of events to return (default: 100).
   */
  getRecentEvents(limit = 100): readonly SecurityEvent[] {
    return this.ringBuffer.slice(-Math.min(limit, this.bufferSize));
  }

  /**
   * SIEM-lite correlation: identify IPs with >= CORRELATION_THRESHOLD events
   * within the correlation window, grouped by distinct attack types.
   *
   * Used to detect distributed attacks, brute-force campaigns, and
   * reconnaissance patterns across multiple requests.
   */
  correlate(): readonly SecurityCorrelation[] {
    const now = Date.now();
    const windowStart = now - this.correlationWindowMs;

    // Gather events within the window
    const windowEvents = this.ringBuffer.filter((e) => e.timestamp.getTime() >= windowStart);

    // Group by IP
    const byIP = new Map<string, SecurityEvent[]>();
    for (const event of windowEvents) {
      if (event.ip.length === 0) continue;
      const existing = byIP.get(event.ip) ?? [];
      existing.push(event);
      byIP.set(event.ip, existing);
    }

    const correlations: SecurityCorrelation[] = [];

    for (const [ip, events] of byIP) {
      if (events.length < CORRELATION_THRESHOLD) continue;

      const distinctTypes = [...new Set(events.map((e) => e.type))];
      const escalatedSeverity = this.escalatedSeverity(events);

      correlations.push({
        ip,
        eventCount: events.length,
        distinctTypes,
        windowMs: this.correlationWindowMs,
        escalatedSeverity,
        correlatedAt: new Date(),
      });
    }

    return correlations;
  }

  /** Return total event count in the ring buffer. */
  get eventCount(): number {
    return this.ringBuffer.length;
  }

  /** Drain ring buffer (for testing). */
  clear(): void {
    this.ringBuffer.length = 0;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private escalatedSeverity(events: readonly SecurityEvent[]): SecuritySeverity {
    const order: Record<SecuritySeverity, number> = {
      info: 0,
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };

    let max: SecuritySeverity = 'info';
    for (const e of events) {
      if (order[e.severity] > order[max]) {
        max = e.severity;
      }
    }

    // Escalate: multiple medium events → high; multiple high events → critical
    const highCount = events.filter((e) => order[e.severity] >= order['high']).length;
    if (highCount >= 3) return 'critical';
    if (order[max] >= order['medium'] && events.length >= 10) return 'high';
    return max;
  }
}
