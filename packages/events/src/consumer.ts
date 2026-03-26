/**
 * Event consumer — validated, deduplicated event consumption for ORDR-Connect
 *
 * SECURITY: Every consumed event is schema-validated. Invalid events are
 * rejected and routed to the Dead Letter Queue. Duplicate events are
 * detected and skipped within a configurable time window.
 *
 * Features:
 * - Per-event-type handler routing
 * - Schema validation on consume
 * - Idempotency via event ID deduplication (sliding window)
 * - DLQ routing for invalid events and handler failures
 * - Manual offset commits after successful processing
 * - Graceful shutdown
 */

import type { Consumer, EachMessagePayload } from 'kafkajs';
import type { ZodSchema } from 'zod';
import type { EventEnvelope } from './types.js';
import { validateEvent, eventSchemaRegistry } from './schemas.js';
import { DeadLetterHandler } from './dlq.js';

// ─── Types ────────────────────────────────────────────────────────

export type EventHandler = (event: EventEnvelope<unknown>) => Promise<void>;

export interface EventConsumerConfig {
  /** Maximum number of retries per message before DLQ */
  readonly maxRetries?: number | undefined;
  /** Deduplication window in milliseconds (default: 5 minutes) */
  readonly dedupWindowMs?: number | undefined;
  /** Maximum dedup cache size before eviction (default: 10,000) */
  readonly dedupMaxSize?: number | undefined;
}

// ─── Dedup Cache ──────────────────────────────────────────────────

interface DedupEntry {
  readonly timestamp: number;
}

class DedupCache {
  private readonly cache = new Map<string, DedupEntry>();
  private readonly windowMs: number;
  private readonly maxSize: number;

  constructor(windowMs: number, maxSize: number) {
    this.windowMs = windowMs;
    this.maxSize = maxSize;
  }

  /**
   * Returns true if the event ID has been seen within the window.
   * If not, records it and returns false.
   */
  isDuplicate(eventId: string): boolean {
    this.evictExpired();

    const existing = this.cache.get(eventId);
    if (existing) {
      return true;
    }

    this.cache.set(eventId, { timestamp: Date.now() });
    return false;
  }

  /** Remove entries older than the dedup window */
  private evictExpired(): void {
    const cutoff = Date.now() - this.windowMs;

    // If cache exceeds max size, force eviction of oldest entries
    if (this.cache.size > this.maxSize) {
      const entries = [...this.cache.entries()].sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      );
      const toRemove = entries.slice(0, this.cache.size - this.maxSize);
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < cutoff) {
        this.cache.delete(key);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

// ─── Event Consumer ───────────────────────────────────────────────

export class EventConsumer {
  private readonly consumer: Consumer;
  private readonly handlers: Map<string, EventHandler>;
  private readonly schemaRegistry: Map<string, ZodSchema>;
  private readonly dlqHandler: DeadLetterHandler | undefined;
  private readonly maxRetries: number;
  private readonly dedupCache: DedupCache;
  private running = false;

  constructor(
    consumer: Consumer,
    handlers: Map<string, EventHandler>,
    schemaRegistry: Map<string, ZodSchema> = eventSchemaRegistry,
    dlqHandler?: DeadLetterHandler | undefined,
    config?: EventConsumerConfig | undefined,
  ) {
    this.consumer = consumer;
    this.handlers = handlers;
    this.schemaRegistry = schemaRegistry;
    this.dlqHandler = dlqHandler;
    this.maxRetries = config?.maxRetries ?? 3;
    this.dedupCache = new DedupCache(
      config?.dedupWindowMs ?? 5 * 60 * 1000,
      config?.dedupMaxSize ?? 10_000,
    );
  }

  /**
   * Subscribes to the specified topics.
   * Must be called before start().
   */
  async subscribe(topics: string[]): Promise<void> {
    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }
  }

  /**
   * Begins consuming messages.
   * Routes each message to the appropriate handler based on event type.
   */
  async start(): Promise<void> {
    this.running = true;

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async (messagePayload: EachMessagePayload) => {
        await this.processMessage(messagePayload);
      },
    });
  }

  /**
   * Gracefully stops the consumer.
   * Finishes processing the current message before disconnecting.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.dedupCache.clear();
    await this.consumer.disconnect();
  }

  /** Whether the consumer is currently running */
  get isRunning(): boolean {
    return this.running;
  }

  // ─── Internal Processing ──────────────────────────────────────

  private async processMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const rawValue = message.value?.toString();

    if (!rawValue) {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawValue) as Record<string, unknown>;
    } catch {
      // Unparseable message — send to DLQ
      if (this.dlqHandler) {
        await this.dlqHandler.sendToDlq(
          topic,
          rawValue,
          new Error('Failed to parse message as JSON'),
          1,
        );
      }
      await this.commitOffset(payload);
      return;
    }

    const eventType = parsed['type'] as string | undefined;
    const eventId = parsed['id'] as string | undefined;

    // ── Deduplication ─────────────────────────────────────────
    if (eventId && this.dedupCache.isDuplicate(eventId)) {
      await this.commitOffset(payload);
      return;
    }

    // ── Schema Validation ─────────────────────────────────────
    if (eventType) {
      const schema = this.schemaRegistry.get(eventType);
      if (schema) {
        const validationResult = validateEvent(schema, parsed);
        if (!validationResult.success) {
          if (this.dlqHandler) {
            await this.dlqHandler.sendToDlq(
              topic,
              parsed,
              new Error(`Schema validation failed: ${validationResult.error}`),
              1,
            );
          }
          await this.commitOffset(payload);
          return;
        }
      }
    }

    // ── Handler Routing ───────────────────────────────────────
    const handler = eventType ? this.handlers.get(eventType) : undefined;
    if (!handler) {
      // No handler registered — commit and skip
      await this.commitOffset(payload);
      return;
    }

    // ── Execute Handler with Retry ────────────────────────────
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await handler(parsed as unknown as EventEnvelope<unknown>);
        lastError = undefined;
        break;
      } catch (handlerError: unknown) {
        lastError = handlerError instanceof Error
          ? handlerError
          : new Error(String(handlerError));

        if (attempt < this.maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms, ...
          const delay = 100 * Math.pow(2, attempt - 1);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, delay);
          });
        }
      }
    }

    // ── DLQ After Max Retries ─────────────────────────────────
    if (lastError) {
      if (this.dlqHandler) {
        await this.dlqHandler.sendToDlq(topic, parsed, lastError, this.maxRetries);
      }
    }

    await this.commitOffset(payload);
  }

  private async commitOffset(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const offsetToCommit = String(Number(message.offset) + 1);

    await this.consumer.commitOffsets([
      { topic, partition, offset: offsetToCommit },
    ]);
  }
}
