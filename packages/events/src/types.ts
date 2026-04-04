/**
 * Event type definitions — domain events for ORDR-Connect event streaming
 *
 * Every state change flows as an immutable EventEnvelope through Kafka.
 * Envelopes carry tenant isolation, correlation tracking, and audit metadata
 * required by SOC2/ISO27001/HIPAA compliance.
 */

// ─── Event Metadata ───────────────────────────────────────────────

export interface EventMetadata {
  readonly correlationId: string;
  readonly causationId: string;
  readonly userId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly source: string;
  readonly version: number;
}

// ─── Event Envelope ───────────────────────────────────────────────

export interface EventEnvelope<T> {
  readonly id: string;
  readonly type: string;
  readonly tenantId: string;
  readonly payload: T;
  readonly metadata: EventMetadata;
  readonly timestamp: string;
}

// ─── Customer Payloads ────────────────────────────────────────────

export interface CustomerCreatedPayload {
  readonly customerId: string;
  readonly name: string;
  readonly email: string;
  readonly type: string;
  readonly lifecycleStage: string;
}

export interface CustomerUpdatedPayload {
  readonly customerId: string;
  readonly changes: Record<string, { readonly old: unknown; readonly new: unknown }>;
}

// ─── Interaction Payloads ─────────────────────────────────────────

export interface InteractionLoggedPayload {
  readonly interactionId: string;
  readonly customerId: string;
  readonly channel: string;
  readonly direction: string;
  readonly type: string;
  readonly sentiment?: string | undefined;
}

// ─── Agent Payloads ───────────────────────────────────────────────

export interface AgentActionExecutedPayload {
  readonly actionId: string;
  readonly agentId: string;
  readonly agentRole: string;
  readonly actionType: string;
  readonly confidence: number;
  readonly approved: boolean;
}

// ─── Compliance Payloads ──────────────────────────────────────────

export interface ComplianceCheckPayload {
  readonly recordId: string;
  readonly regulation: string;
  readonly ruleId: string;
  readonly result: string;
  readonly customerId?: string | undefined;
}

// ─── Auth Payloads ────────────────────────────────────────────────

export interface AuthEventPayload {
  readonly userId: string;
  readonly action: 'login' | 'logout' | 'failed' | 'mfa_verified';
  readonly ipAddress?: string | undefined;
}

// ─── DSR Payloads ─────────────────────────────────────────────────

export interface DsrApprovedPayload {
  readonly dsrId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly type: 'access' | 'erasure' | 'portability';
}

// ─── Event Type Constants ─────────────────────────────────────────

export const EventType = {
  // Customer
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',

  // Interaction
  INTERACTION_LOGGED: 'interaction.logged',

  // Agent
  AGENT_ACTION_EXECUTED: 'agent.action_executed',

  // Compliance
  COMPLIANCE_CHECK: 'compliance.check',

  // Auth / Audit
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_FAILED: 'auth.failed',
  AUTH_MFA_VERIFIED: 'auth.mfa_verified',

  // DSR
  DSR_APPROVED: 'dsr.approved',
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];
