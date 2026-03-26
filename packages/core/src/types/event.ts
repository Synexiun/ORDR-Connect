/**
 * Domain event types — event-driven architecture for ORDR-Connect
 *
 * All state changes flow as immutable domain events through Kafka.
 * Every event carries tenant isolation and audit metadata.
 */

import type { TenantId } from './tenant.js';

// ─── Event Metadata ───────────────────────────────────────────────

export interface EventMetadata {
  readonly correlationId: string;
  readonly causationId: string;
  readonly userId: string;
  readonly agentId?: string;
  readonly source: string;
  readonly version: number;
}

// ─── Domain Event ─────────────────────────────────────────────────

export interface DomainEvent<T> {
  readonly id: string;
  readonly type: string;
  readonly tenantId: TenantId;
  readonly payload: T;
  readonly metadata: EventMetadata;
  readonly timestamp: Date;
}

// ─── Event Type Constants ─────────────────────────────────────────

export const CUSTOMER_EVENTS = {
  CREATED: 'customer.created',
  UPDATED: 'customer.updated',
  DELETED: 'customer.deleted',
  MERGED: 'customer.merged',
  SEGMENT_CHANGED: 'customer.segment_changed',
  HEALTH_SCORE_UPDATED: 'customer.health_score_updated',
  LIFECYCLE_STAGE_CHANGED: 'customer.lifecycle_stage_changed',
} as const;

export const INTERACTION_EVENTS = {
  INITIATED: 'interaction.initiated',
  COMPLETED: 'interaction.completed',
  ESCALATED: 'interaction.escalated',
  TRANSFERRED: 'interaction.transferred',
  RATED: 'interaction.rated',
  NOTE_ADDED: 'interaction.note_added',
  SENTIMENT_ANALYZED: 'interaction.sentiment_analyzed',
} as const;

export const AGENT_EVENTS = {
  TASK_ASSIGNED: 'agent.task_assigned',
  TASK_COMPLETED: 'agent.task_completed',
  ACTION_PROPOSED: 'agent.action_proposed',
  ACTION_APPROVED: 'agent.action_approved',
  ACTION_REJECTED: 'agent.action_rejected',
  ACTION_EXECUTED: 'agent.action_executed',
  CONFIDENCE_LOW: 'agent.confidence_low',
  SAFETY_BLOCK: 'agent.safety_block',
  ESCALATED_TO_HUMAN: 'agent.escalated_to_human',
} as const;

export const COMPLIANCE_EVENTS = {
  RULE_TRIGGERED: 'compliance.rule_triggered',
  VIOLATION_DETECTED: 'compliance.violation_detected',
  VIOLATION_RESOLVED: 'compliance.violation_resolved',
  POLICY_UPDATED: 'compliance.policy_updated',
  DATA_ACCESS_REQUESTED: 'compliance.data_access_requested',
  DATA_EXPORTED: 'compliance.data_exported',
  RETENTION_EXPIRED: 'compliance.retention_expired',
  CONSENT_UPDATED: 'compliance.consent_updated',
} as const;

export const AUDIT_EVENTS = {
  LOGIN: 'audit.login',
  LOGOUT: 'audit.logout',
  LOGIN_FAILED: 'audit.login_failed',
  PERMISSION_CHANGED: 'audit.permission_changed',
  RESOURCE_ACCESSED: 'audit.resource_accessed',
  RESOURCE_MODIFIED: 'audit.resource_modified',
  CONFIG_CHANGED: 'audit.config_changed',
  EXPORT_INITIATED: 'audit.export_initiated',
  MFA_ENABLED: 'audit.mfa_enabled',
  MFA_DISABLED: 'audit.mfa_disabled',
  SESSION_EXPIRED: 'audit.session_expired',
} as const;

// ─── Aggregate Type ───────────────────────────────────────────────

export const ALL_EVENTS = {
  ...CUSTOMER_EVENTS,
  ...INTERACTION_EVENTS,
  ...AGENT_EVENTS,
  ...COMPLIANCE_EVENTS,
  ...AUDIT_EVENTS,
} as const;

export type EventType = (typeof ALL_EVENTS)[keyof typeof ALL_EVENTS];
