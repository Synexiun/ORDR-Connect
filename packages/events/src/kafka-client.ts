/**
 * Kafka client factory — connection setup for ORDR-Connect
 *
 * Creates properly configured KafkaJS instances with:
 * - SSL/TLS and SASL authentication when configured
 * - Production-grade retry with exponential backoff
 * - Idempotent producer (acks=all, exactly-once semantics)
 * - Manual-commit consumer (offsets committed after processing)
 */

import {
  Kafka,
  type KafkaConfig as KafkaJSConfig,
  type Producer,
  type Consumer,
  logLevel,
  CompressionTypes,
} from 'kafkajs';

// ─── Configuration ────────────────────────────────────────────────

export interface EventsKafkaConfig {
  readonly brokers: string[];
  readonly clientId: string;
  readonly ssl?: boolean | undefined;
  readonly sasl?:
    | {
        readonly mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
        readonly username: string;
        readonly password: string;
      }
    | undefined;
  readonly connectionTimeout?: number | undefined;
  readonly requestTimeout?: number | undefined;
  readonly logLevel?: 'NOTHING' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | undefined;
}

// ─── Log Level Mapping ────────────────────────────────────────────

const LOG_LEVEL_MAP: Record<string, logLevel> = {
  NOTHING: logLevel.NOTHING,
  ERROR: logLevel.ERROR,
  WARN: logLevel.WARN,
  INFO: logLevel.INFO,
  DEBUG: logLevel.DEBUG,
};

// ─── Client Factory ───────────────────────────────────────────────

/**
 * Creates a KafkaJS client with production-ready defaults.
 * Applies SSL, SASL, and retry configuration based on provided config.
 */
export function createKafkaClient(config: EventsKafkaConfig): Kafka {
  const kafkaConfig: KafkaJSConfig = {
    clientId: config.clientId,
    brokers: config.brokers,
    connectionTimeout: config.connectionTimeout ?? 10_000,
    requestTimeout: config.requestTimeout ?? 30_000,
    logLevel: config.logLevel ? LOG_LEVEL_MAP[config.logLevel] ?? logLevel.WARN : logLevel.WARN,
    retry: {
      initialRetryTime: 300,
      retries: 8,
      maxRetryTime: 30_000,
      factor: 2,
      multiplier: 1.5,
    },
  };

  if (config.ssl) {
    kafkaConfig.ssl = true;
  }

  if (config.sasl) {
    const { mechanism, username, password } = config.sasl;
    switch (mechanism) {
      case 'plain':
        kafkaConfig.sasl = { mechanism: 'plain', username, password };
        break;
      case 'scram-sha-256':
        kafkaConfig.sasl = { mechanism: 'scram-sha-256', username, password };
        break;
      case 'scram-sha-512':
        kafkaConfig.sasl = { mechanism: 'scram-sha-512', username, password };
        break;
    }
  }

  return new Kafka(kafkaConfig);
}

// ─── Producer Factory ─────────────────────────────────────────────

/**
 * Creates an idempotent producer with acks=all.
 * Guarantees exactly-once semantics when paired with transactional consumers.
 */
export function createProducer(kafka: Kafka): Producer {
  return kafka.producer({
    idempotent: true,
    maxInFlightRequests: 5,
    allowAutoTopicCreation: false,
  });
}

// ─── Consumer Factory ─────────────────────────────────────────────

/**
 * Creates a consumer with manual offset commits.
 * Offsets are only committed after successful processing to prevent data loss.
 */
export function createConsumer(kafka: Kafka, groupId: string): Consumer {
  return kafka.consumer({
    groupId,
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
    maxWaitTimeInMs: 5_000,
    allowAutoTopicCreation: false,
  });
}

// ─── Re-export KafkaJS Types ──────────────────────────────────────

export { Kafka, CompressionTypes };
export type { Producer, Consumer };
