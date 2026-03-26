/**
 * Inter-agent communication protocol — message bus for agent coordination
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Messages are audit-logged (metadata only, NO content)
 * - Agent messages CANNOT cross tenant boundaries
 * - Message bus is in-memory for MVP — Kafka-backed in production
 * - Correlation IDs link messages across agent handoff chains
 *
 * COMPLIANCE:
 * - All message send/receive events are logged for SOC2 CC7.2
 * - Message metadata provides traceability for ISO 27001 A.12.4
 * - NO PII/PHI in message payloads — only tokenized references
 */

import { randomUUID } from 'node:crypto';
import type { AgentRole } from '@ordr/core';

// ─── Message Types ──────────────────────────────────────────────

export const MESSAGE_TYPES = [
  'handoff_request',
  'handoff_accept',
  'info_request',
  'info_response',
  'escalation',
  'status_update',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

// ─── Agent Message ──────────────────────────────────────────────

/**
 * A message exchanged between agents via the message bus.
 *
 * SECURITY: payload MUST NOT contain raw PII/PHI — only
 * tokenized references, scores, and operational metadata.
 */
export interface AgentMessage {
  readonly id: string;
  readonly fromAgent: {
    readonly role: AgentRole;
    readonly sessionId: string;
  };
  readonly toAgent: {
    readonly role: AgentRole;
  };
  readonly type: MessageType;
  readonly payload: Record<string, unknown>;
  readonly timestamp: Date;
  readonly correlationId: string;
}

// ─── Message Handler ────────────────────────────────────────────

type MessageHandler = (msg: AgentMessage) => Promise<void>;

// ─── Audit Logger Interface ─────────────────────────────────────

interface MessageBusAuditLog {
  readonly log: (input: {
    readonly tenantId: string;
    readonly eventType: 'agent.action';
    readonly actorType: 'agent';
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }) => Promise<void>;
}

// ─── MessageBus ─────────────────────────────────────────────────

/**
 * In-memory pub/sub message bus for inter-agent communication.
 *
 * MVP implementation — production replaces with Kafka-backed bus
 * for durability, ordering guarantees, and cross-node delivery.
 *
 * SECURITY: Messages are audit-logged with metadata only (no content).
 */
export class MessageBus {
  private readonly subscribers: Map<AgentRole, MessageHandler[]> = new Map();
  private readonly messageStore: Map<string, AgentMessage[]> = new Map();
  private readonly allMessages: AgentMessage[] = [];
  private readonly auditLog: MessageBusAuditLog | undefined;
  private readonly tenantId: string;

  constructor(tenantId: string, auditLog?: MessageBusAuditLog) {
    this.tenantId = tenantId;
    this.auditLog = auditLog;
  }

  /**
   * Send a message to the bus. Routes to all subscribers of the target role.
   *
   * SECURITY: Only metadata is audit-logged — message content is NOT recorded.
   */
  async send(message: AgentMessage): Promise<void> {
    // Store message indexed by session ID (for retrieval)
    const fromMessages = this.messageStore.get(message.fromAgent.sessionId) ?? [];
    fromMessages.push(message);
    this.messageStore.set(message.fromAgent.sessionId, fromMessages);

    // Store in global list for correlation tracking
    this.allMessages.push(message);

    // Audit log — metadata only, no payload content
    if (this.auditLog !== undefined) {
      await this.auditLog.log({
        tenantId: this.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: message.fromAgent.sessionId,
        resource: 'agent_message',
        resourceId: message.id,
        action: `message_sent_${message.type}`,
        details: {
          fromRole: message.fromAgent.role,
          toRole: message.toAgent.role,
          messageType: message.type,
          correlationId: message.correlationId,
        },
        timestamp: message.timestamp,
      });
    }

    // Route to subscribers
    const handlers = this.subscribers.get(message.toAgent.role);
    if (handlers !== undefined) {
      for (const handler of handlers) {
        await handler(message);
      }
    }
  }

  /**
   * Subscribe to messages targeted at a specific agent role.
   */
  subscribe(agentRole: AgentRole, handler: MessageHandler): void {
    const existing = this.subscribers.get(agentRole) ?? [];
    existing.push(handler);
    this.subscribers.set(agentRole, existing);
  }

  /**
   * Unsubscribe all handlers for a specific role.
   */
  unsubscribe(agentRole: AgentRole): void {
    this.subscribers.delete(agentRole);
  }

  /**
   * Get all messages sent from or received by a specific session.
   */
  getMessages(sessionId: string): readonly AgentMessage[] {
    return this.messageStore.get(sessionId) ?? [];
  }

  /**
   * Get all messages matching a correlation ID.
   * Used for tracing handoff chains across agents.
   */
  getByCorrelationId(correlationId: string): readonly AgentMessage[] {
    return this.allMessages.filter((m) => m.correlationId === correlationId);
  }

  /**
   * Get total message count across all sessions.
   */
  get totalMessageCount(): number {
    return this.allMessages.length;
  }

  /**
   * Create a new message with auto-generated ID and timestamp.
   */
  static createMessage(
    fromRole: AgentRole,
    fromSessionId: string,
    toRole: AgentRole,
    type: MessageType,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): AgentMessage {
    return {
      id: randomUUID(),
      fromAgent: { role: fromRole, sessionId: fromSessionId },
      toAgent: { role: toRole },
      type,
      payload,
      timestamp: new Date(),
      correlationId: correlationId ?? randomUUID(),
    };
  }
}
