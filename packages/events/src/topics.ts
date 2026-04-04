/**
 * Kafka topic configuration — topic registry for ORDR-Connect
 *
 * Centralized topic definitions with production-ready defaults.
 * Partitioning strategy: customer/interaction events partition by tenantId
 * for tenant-scoped ordering guarantees.
 */

// ─── Topic Names ──────────────────────────────────────────────────

export const TOPICS = {
  /** Customer lifecycle events — partitioned by tenantId */
  CUSTOMER_EVENTS: 'ordr.customer.events',

  /** Interaction events — calls, emails, chats, meetings */
  INTERACTION_EVENTS: 'ordr.interaction.events',

  /** AI agent action events — proposals, approvals, executions */
  AGENT_EVENTS: 'ordr.agent.events',

  /** Compliance rule triggers and violation events */
  COMPLIANCE_EVENTS: 'ordr.compliance.events',

  /** Audit trail events — login, access, config changes */
  AUDIT_EVENTS: 'ordr.audit.events',

  /** Outbound message execution — email, SMS, webhook */
  OUTBOUND_MESSAGES: 'ordr.outbound.messages',

  /** Dead letter queue — failed events for manual review/retry */
  DEAD_LETTER: 'ordr.dlq',

  /** GDPR Data Subject Request lifecycle events */
  DSR_EVENTS: 'ordr.dsr.events',

  /** CRM integration sync events — webhooks received, outbound syncs, conflicts */
  INTEGRATION_EVENTS: 'ordr.integration.events',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

// ─── Topic Configuration ──────────────────────────────────────────

export interface TopicConfig {
  readonly name: string;
  readonly partitions: number;
  readonly replicationFactor: number;
  readonly retentionMs: number;
  readonly cleanupPolicy: 'delete' | 'compact' | 'compact,delete';
  readonly minInsyncReplicas: number;
}

// ─── Default Configs ──────────────────────────────────────────────

/**
 * Production-ready topic configurations.
 *
 * - Customer/Interaction: 12 partitions for tenant-scoped parallelism
 * - Agent/Compliance/Audit: 6 partitions (lower throughput, higher ordering)
 * - Outbound: 12 partitions for high-throughput message delivery
 * - DLQ: 3 partitions, 30-day retention for investigation
 */
export const DEFAULT_TOPIC_CONFIGS: Record<TopicName, TopicConfig> = {
  [TOPICS.CUSTOMER_EVENTS]: {
    name: TOPICS.CUSTOMER_EVENTS,
    partitions: 12,
    replicationFactor: 3,
    retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
  [TOPICS.INTERACTION_EVENTS]: {
    name: TOPICS.INTERACTION_EVENTS,
    partitions: 12,
    replicationFactor: 3,
    retentionMs: 7 * 24 * 60 * 60 * 1000,
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
  [TOPICS.AGENT_EVENTS]: {
    name: TOPICS.AGENT_EVENTS,
    partitions: 6,
    replicationFactor: 3,
    retentionMs: 14 * 24 * 60 * 60 * 1000, // 14 days
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
  [TOPICS.COMPLIANCE_EVENTS]: {
    name: TOPICS.COMPLIANCE_EVENTS,
    partitions: 6,
    replicationFactor: 3,
    retentionMs: 90 * 24 * 60 * 60 * 1000, // 90 days — compliance retention
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
  [TOPICS.AUDIT_EVENTS]: {
    name: TOPICS.AUDIT_EVENTS,
    partitions: 6,
    replicationFactor: 3,
    retentionMs: 365 * 24 * 60 * 60 * 1000, // 1 year — audit retention
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
  [TOPICS.OUTBOUND_MESSAGES]: {
    name: TOPICS.OUTBOUND_MESSAGES,
    partitions: 12,
    replicationFactor: 3,
    retentionMs: 3 * 24 * 60 * 60 * 1000, // 3 days
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
  [TOPICS.DEAD_LETTER]: {
    name: TOPICS.DEAD_LETTER,
    partitions: 3,
    replicationFactor: 3,
    retentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
  [TOPICS.DSR_EVENTS]: {
    name: TOPICS.DSR_EVENTS,
    partitions: 6,
    replicationFactor: 3,
    retentionMs: 365 * 24 * 60 * 60 * 1000, // 1 year — GDPR/SOC2 audit retention
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
  [TOPICS.INTEGRATION_EVENTS]: {
    name: TOPICS.INTEGRATION_EVENTS,
    partitions: 6,
    replicationFactor: 3,
    retentionMs: 14 * 24 * 60 * 60 * 1000, // 14 days
    cleanupPolicy: 'delete',
    minInsyncReplicas: 2,
  },
} as const;
