/**
 * Dead Letter Queue handler — failed event recovery for ORDR-Connect
 *
 * Events that fail validation or processing after max retries are sent
 * to the DLQ topic for manual review and retry. Every DLQ entry preserves
 * the full context needed for incident investigation.
 */

import type { Producer } from 'kafkajs';
import { TOPICS } from './topics.js';

// ─── DLQ Event Type ───────────────────────────────────────────────

export interface DlqEvent {
  readonly id: string;
  readonly originalTopic: string;
  readonly originalEvent: unknown;
  readonly errorMessage: string;
  readonly errorStack: string | undefined;
  readonly attempt: number;
  readonly timestamp: string;
}

// ─── Dead Letter Handler ──────────────────────────────────────────

export class DeadLetterHandler {
  private readonly producer: Producer;
  private readonly dlqTopic: string;

  constructor(producer: Producer, dlqTopic: string = TOPICS.DEAD_LETTER) {
    this.producer = producer;
    this.dlqTopic = dlqTopic;
  }

  /**
   * Sends a failed event to the Dead Letter Queue.
   *
   * Preserves the original topic, raw event data, error details,
   * and retry attempt count for incident investigation.
   */
  async sendToDlq(
    originalTopic: string,
    event: unknown,
    error: Error,
    attempt: number,
  ): Promise<void> {
    const dlqEvent: DlqEvent = {
      id: crypto.randomUUID(),
      originalTopic,
      originalEvent: event,
      errorMessage: error.message,
      errorStack: error.stack,
      attempt,
      timestamp: new Date().toISOString(),
    };

    await this.producer.send({
      topic: this.dlqTopic,
      messages: [
        {
          key: originalTopic,
          value: JSON.stringify(dlqEvent),
          headers: {
            'x-dlq-original-topic': originalTopic,
            'x-dlq-error': error.message,
            'x-dlq-attempt': String(attempt),
            'x-dlq-timestamp': dlqEvent.timestamp,
          },
        },
      ],
    });
  }

  /**
   * Processes DLQ events for manual review or automated retry.
   *
   * The handler receives each DLQ event and returns true if the event
   * was successfully reprocessed, false to leave it in the DLQ.
   *
   * @param consumer - KafkaJS consumer subscribed to the DLQ topic
   * @param handler - Async function that processes each DLQ event
   */
  async processDlq(
    handler: (dlqEvent: DlqEvent) => Promise<boolean>,
  ): Promise<ProcessDlqHandle> {
    const { Kafka } = await import('kafkajs');
    void Kafka; // reference to keep import for type context

    // Return a handle that callers use with their own consumer
    return {
      handleMessage: async (rawValue: string): Promise<boolean> => {
        const parsed = JSON.parse(rawValue) as DlqEvent;
        return handler(parsed);
      },
    };
  }
}

// ─── Process Handle ───────────────────────────────────────────────

export interface ProcessDlqHandle {
  readonly handleMessage: (rawValue: string) => Promise<boolean>;
}
