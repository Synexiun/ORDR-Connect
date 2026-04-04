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
import type { NotificationWriter } from './types.js';
import { createCustomerEventsHandler } from './handlers/customer-events.js';
import {
  createInteractionEventsHandler,
  type NBAEvaluator,
  type AgentDispatcher,
  type CustomerProfileSnapshot,
} from './handlers/interaction-events.js';
import { createAgentEventsHandler } from './handlers/agent-events.js';
import { createOutboundMessagesHandler } from './handlers/outbound-messages.js';
import { createDsrExportHandler } from './handlers/dsr-export.js';
import type { DsrExportDeps } from './handlers/dsr-export.js';
import { createIntegrationSyncHandler } from './handlers/integration-sync.js';
import type { IntegrationSyncDeps } from './handlers/integration-sync.js';

export type { NotificationWriter, NotificationInsert } from './types.js';

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
  readonly notificationWriter: NotificationWriter;
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
  /** Integration sync deps — wired at server bootstrap with real DB/Redis/adapter deps. */
  readonly integrationSyncDeps?: IntegrationSyncDeps | undefined;
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
    notificationWriter: deps.notificationWriter,
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
    notificationWriter: deps.notificationWriter,
    getCustomerContact: deps.getCustomerContact,
    updateMessageStatus: deps.updateMessageStatus,
  });
  handlers.set('outbound.message', outboundHandler);

  // DSR export + erasure handler — deps are resolved at runtime via injected stubs.
  // Full implementation wires real DB/S3 deps in the concrete server bootstrap.

  const notConfigured = (name: string) => (): Promise<never> =>
    Promise.reject(new Error(`[ORDR:WORKER:DSR] ${name} not configured`));
  const dsrExportDeps: DsrExportDeps = {
    transitionProcessing: notConfigured('transitionProcessing'),
    loadCustomer: notConfigured('loadCustomer'),
    loadContacts: notConfigured('loadContacts'),
    loadConsent: notConfigured('loadConsent'),
    loadTickets: notConfigured('loadTickets'),
    loadMemories: notConfigured('loadMemories'),
    loadAnalytics: notConfigured('loadAnalytics'),
    uploadExport: notConfigured('uploadExport'),
    saveExport: notConfigured('saveExport'),
    completeDsr: notConfigured('completeDsr'),
    scheduleErasure: notConfigured('scheduleErasure'),
    executeErasure: notConfigured('executeErasure'),
    verifyErasure: notConfigured('verifyErasure'),
    pseudonymise: notConfigured('pseudonymise'),
    auditLogger: deps.auditLogger,
  };
  // Cast: EventHandler accepts EventEnvelope<unknown>; DSR handler is typed
  // more specifically as EventEnvelope<DsrApprovedPayload>. Safe cast: the
  // consumer only sends dsr.approved events to this handler at runtime.
  handlers.set(
    'dsr.approved',
    createDsrExportHandler(dsrExportDeps) as unknown as import('@ordr/events').EventHandler,
  );

  // Integration sync handler — outbound (customer events) + inbound (webhook received)
  const notConfiguredSync = (name: string) => (): Promise<never> =>
    Promise.reject(new Error(`[ORDR:WORKER:INTEGRATION] ${name} not configured`));

  const integrationSyncDeps: IntegrationSyncDeps = deps.integrationSyncDeps ?? {
    listConnectedProviders: notConfiguredSync('listConnectedProviders'),
    getCustomer: notConfiguredSync('getCustomer'),
    enqueueOutbound: notConfiguredSync('enqueueOutbound'),
    insertSyncEvent: notConfiguredSync('insertSyncEvent'),
    findEntityMapping: notConfiguredSync('findEntityMapping'),
    insertEntityMapping: notConfiguredSync('insertEntityMapping'),
    createCustomerFromCrm: notConfiguredSync('createCustomerFromCrm'),
    applyCustomerDelta: notConfiguredSync('applyCustomerDelta'),
    getIntegrationId: notConfiguredSync('getIntegrationId'),
    notifyTenantAdmin: notConfiguredSync('notifyTenantAdmin'),
    adapters: new Map(),
    credManagerDeps: { getIntegrationConfig: notConfiguredSync('getIntegrationConfig') } as never,
    oauthConfigs: new Map(),
    fieldEncryptor: {} as never,
    auditLogger: deps.auditLogger,
  };

  const integrationSyncHandler = createIntegrationSyncHandler(
    integrationSyncDeps,
  ) as unknown as import('@ordr/events').EventHandler;

  // Register integration webhook received handler
  handlers.set('integration.webhook_received', integrationSyncHandler);

  // Fan-out customer events to both customerHandler and integrationSyncHandler
  handlers.set('customer.created', (event) =>
    Promise.all([customerHandler(event), integrationSyncHandler(event)]).then(() => undefined),
  );
  handlers.set('customer.updated', (event) =>
    Promise.all([customerHandler(event), integrationSyncHandler(event)]).then(() => undefined),
  );

  // Subscribe to topics
  await consumer.subscribe([
    TOPICS.CUSTOMER_EVENTS,
    TOPICS.INTERACTION_EVENTS,
    TOPICS.AGENT_EVENTS,
    TOPICS.OUTBOUND_MESSAGES,
    TOPICS.DSR_EVENTS,
    TOPICS.INTEGRATION_EVENTS,
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
        TOPICS.DSR_EVENTS,
        TOPICS.INTEGRATION_EVENTS,
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
