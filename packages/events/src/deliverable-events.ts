/**
 * DELIVERABLE_EVENTS — the set of event types that can be delivered
 * to developer-registered webhooks.
 *
 * Source of truth for webhook event validation. Adding new events
 * here makes them available to the webhook registration endpoint.
 */

export const DELIVERABLE_EVENTS = [
  'customer.created',
  'customer.updated',
  'interaction.logged',
  'agent.triggered',
  'agent.action_executed',
  'agent.completed',
  'ticket.created',
  'ticket.resolved',
  'dsr.approved',
  'dsr.completed',
  'compliance.alert',
  'integration.webhook_received',
] as const;

export type DeliverableEvent = (typeof DELIVERABLE_EVENTS)[number];
