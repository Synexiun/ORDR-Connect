/**
 * Worker Entry Point — background event processor for ORDR-Connect
 *
 * Consumes Kafka events and triggers agent workflows, graph enrichment,
 * and outbound message processing.
 *
 * SOC2 CC7.1 — Monitoring: event processing with audit trail.
 * ISO 27001 A.12.4.1 — Event logging for all processed messages.
 * HIPAA §164.312(b) — Audit controls on all data access.
 *
 * SECURITY:
 * - Manual offset commits — process then commit (no data loss)
 * - Graceful shutdown on SIGTERM/SIGINT
 * - All handlers publish audit events
 * - NEVER logs event payloads (may contain PHI)
 */

import type { EventConsumer, EventHandler } from '@ordr/events';
import { TOPICS } from '@ordr/events';
import type { AuditLogger } from '@ordr/audit';
import type { AgentEngine } from '@ordr/agent-runtime';
import type { GraphEnricher } from '@ordr/graph';
import type { ComplianceGate } from '@ordr/compliance';
import type {
  ConsentManager,
  ConsentStore,
  SmsProvider,
  EmailProvider,
  MessageStateMachine,
} from '@ordr/channels';
import type { EventProducer } from '@ordr/events';
import { createCustomerEventsHandler } from './handlers/customer-events.js';
import {
  createInteractionEventsHandler,
  type NBAEvaluator,
  type AgentDispatcher,
  type CustomerProfileSnapshot,
} from './handlers/interaction-events.js';
import { createAgentEventsHandler } from './handlers/agent-events.js';
import { createOutboundMessagesHandler } from './handlers/outbound-messages.js';

// ─── Worker Dependencies ─────────────────────────────────────────

export interface WorkerDependencies {
  readonly consumer: EventConsumer;
  readonly eventProducer: EventProducer;
  readonly auditLogger: AuditLogger;
  readonly agentEngine: AgentEngine;
  readonly graphEnricher: GraphEnricher;
  readonly complianceGate: ComplianceGate;
  readonly consentManager: ConsentManager;
  readonly consentStore: ConsentStore;
  readonly smsProvider: SmsProvider;
  readonly emailProvider: EmailProvider;
  readonly stateMachine: MessageStateMachine;
  /** NBA pipeline — evaluates inbound interactions to produce Next-Best-Action decisions. */
  readonly nbaPipeline: NBAEvaluator;
  /** Agent orchestrator — dispatches NBA decisions to the correct agent role. */
  readonly orchestrator: AgentDispatcher;
  /** Fetch customer profile for NBA context. Returns null if unavailable. */
  readonly getCustomerProfile: (
    tenantId: string,
    customerId: string,
  ) => Promise<CustomerProfileSnapshot | null>;
  readonly getCustomerContact: (
    tenantId: string,
    customerId: string,
    channel: string,
  ) => Promise<{ readonly contact: string; readonly contentBody: string } | null>;
  readonly updateMessageStatus: (messageId: string, status: string) => Promise<void>;
}

// ─── Worker Startup ──────────────────────────────────────────────

export async function startWorker(
  deps: WorkerDependencies,
): Promise<{ stop: () => Promise<void> }> {
  const { consumer, auditLogger } = deps;

  // Register handlers for each topic
  const handlers = new Map<string, EventHandler>();

  // Customer event handlers
  const customerHandler = createCustomerEventsHandler({
    graphEnricher: deps.graphEnricher,
    auditLogger: deps.auditLogger,
  });
  handlers.set('customer.created', customerHandler);
  handlers.set('customer.updated', customerHandler);

  // Interaction event handlers — graph enrichment + NBA pipeline + orchestrator dispatch
  const interactionHandler = createInteractionEventsHandler({
    graphEnricher: deps.graphEnricher,
    auditLogger: deps.auditLogger,
    nbaPipeline: deps.nbaPipeline,
    orchestrator: deps.orchestrator,
    eventProducer: deps.eventProducer,
    getCustomerProfile: deps.getCustomerProfile,
  });
  handlers.set('interaction.logged', interactionHandler);

  // Agent event handlers
  const agentHandler = createAgentEventsHandler({
    agentEngine: deps.agentEngine,
    graphEnricher: deps.graphEnricher,
    eventProducer: deps.eventProducer,
    auditLogger: deps.auditLogger,
  });
  handlers.set('agent.triggered', agentHandler);
  handlers.set('agent.action_executed', agentHandler);

  // Outbound message handlers
  const outboundHandler = createOutboundMessagesHandler({
    consentManager: deps.consentManager,
    consentStore: deps.consentStore,
    complianceGate: deps.complianceGate,
    smsProvider: deps.smsProvider,
    emailProvider: deps.emailProvider,
    eventProducer: deps.eventProducer,
    auditLogger: deps.auditLogger,
    stateMachine: deps.stateMachine,
    getCustomerContact: deps.getCustomerContact,
    updateMessageStatus: deps.updateMessageStatus,
  });
  handlers.set('outbound.message', outboundHandler);

  // Subscribe to topics
  await consumer.subscribe([
    TOPICS.CUSTOMER_EVENTS,
    TOPICS.INTERACTION_EVENTS,
    TOPICS.AGENT_EVENTS,
    TOPICS.OUTBOUND_MESSAGES,
  ]);

  // Start consuming
  await consumer.start();

  console.warn('[ORDR:WORKER] Worker started — consuming from Kafka topics');

  // Audit log worker startup
  await auditLogger.log({
    tenantId: 'system',
    eventType: 'system.deployment',
    actorType: 'system',
    actorId: 'worker',
    resource: 'worker',
    resourceId: 'main',
    action: 'started',
    details: {
      topics: [
        TOPICS.CUSTOMER_EVENTS,
        TOPICS.INTERACTION_EVENTS,
        TOPICS.AGENT_EVENTS,
        TOPICS.OUTBOUND_MESSAGES,
      ],
    },
    timestamp: new Date(),
  });

  // Graceful shutdown
  const stop = async (): Promise<void> => {
    console.warn('[ORDR:WORKER] Shutting down gracefully...');
    await consumer.stop();

    await auditLogger.log({
      tenantId: 'system',
      eventType: 'system.deployment',
      actorType: 'system',
      actorId: 'worker',
      resource: 'worker',
      resourceId: 'main',
      action: 'stopped',
      details: {},
      timestamp: new Date(),
    });

    console.warn('[ORDR:WORKER] Worker stopped');
  };

  // Register signal handlers
  const onSignal = (): void => {
    stop().catch((shutdownErr: unknown) => {
      console.error('[ORDR:WORKER] Error during shutdown:', shutdownErr);
      process.exit(1);
    });
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  return { stop };
}
