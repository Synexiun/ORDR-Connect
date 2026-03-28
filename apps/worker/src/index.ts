/**
 * @ordr/worker — Background event processor for ORDR-Connect
 *
 * Kafka consumer that processes domain events through the pipeline:
 * Event → Graph Enrichment → Agent Orchestration → Outbound Delivery → Audit
 */

// ─── Server ──────────────────────────────────────────────────────
export { startWorker } from './server.js';
export type { WorkerDependencies, NotificationWriter, NotificationInsert } from './server.js';

// ─── Handlers ────────────────────────────────────────────────────
export { createCustomerEventsHandler } from './handlers/customer-events.js';
export type { CustomerEventsDeps } from './handlers/customer-events.js';

export { createInteractionEventsHandler } from './handlers/interaction-events.js';
export type { InteractionEventsDeps } from './handlers/interaction-events.js';

export { createAgentEventsHandler } from './handlers/agent-events.js';
export type { AgentEventsDeps } from './handlers/agent-events.js';

export { createOutboundMessagesHandler } from './handlers/outbound-messages.js';
export type { OutboundMessagesDeps } from './handlers/outbound-messages.js';
