/**
 * @ordr/audit — WORM Audit Log Types
 *
 * SOC2 / ISO27001 / HIPAA compliant immutable audit trail.
 * All types are strict — zero `any`, zero optional where required.
 */

/** Every auditable action in the system. */
export type AuditEventType =
  | 'data.created'
  | 'data.read'
  | 'data.updated'
  | 'data.deleted'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed'
  | 'auth.mfa_verified'
  | 'agent.action'
  | 'agent.decision'
  | 'agent.killed'
  | 'compliance.check'
  | 'compliance.violation'
  | 'system.config_change'
  | 'system.deployment'
  | 'phi.accessed'
  | 'phi.exported'
  | 'api.request'
  | 'user.provisioned'
  | 'user.updated'
  | 'user.deactivated'
  | 'group.created'
  | 'group.updated'
  | 'config.updated'
  | 'organization.created'
  | 'organization.deleted'
  | 'auth.sso.success'
  | 'sso.connection.created'
  | 'sso.connection.deleted'
  | 'user.invited'
  | 'user.role_changed'
  | 'user.suspended'
  | 'user.profile_updated'
  | 'user.password_changed'
  | 'user.mfa_enabled'
  | 'user.mfa_disabled'
  | 'user.session_revoked'
  | 'api_key.created'
  | 'api_key.revoked'
  // DSR — GDPR Data Subject Requests (Art. 12, 15, 17, 20)
  | 'dsr.requested'
  | 'dsr.approved'
  | 'dsr.rejected'
  | 'dsr.cancelled'
  | 'dsr.exported'
  | 'dsr.failed'
  | 'dsr.erasure_scheduled'
  | 'dsr.erasure_executed'
  | 'dsr.erasure_verified'
  // Integration (Phase 52)
  | 'integration.connected'
  | 'integration.disconnected'
  | 'integration.sync_completed'
  | 'integration.sync_failed'
  | 'integration.conflict_detected'
  | 'integration.webhook_received'
  | 'integration.webhook_invalid_signature';

/** Who performed the action. */
export type ActorType = 'user' | 'agent' | 'system';

/**
 * A single immutable audit event.
 *
 * `details` MUST NEVER contain PHI directly — use tokenized references only.
 * `hash` is the SHA-256 chain link binding this event to its predecessor.
 */
export interface AuditEvent {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly tenantId: string;
  readonly eventType: AuditEventType;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly resource: string;
  readonly resourceId: string;
  readonly action: string;
  readonly details: Record<string, unknown>;
  readonly previousHash: string;
  readonly hash: string;
  readonly timestamp: Date;
}

/** Result of verifying a hash chain segment. */
export interface AuditChainStatus {
  readonly valid: boolean;
  readonly totalEvents: number;
  readonly lastSequence: number;
  readonly lastHash: string;
  /** Sequence number of the first broken link, if any. */
  readonly brokenAt?: number | undefined;
}

/** Merkle root computed over a batch of sequential audit events. */
export interface MerkleRoot {
  readonly batchStart: number;
  readonly batchEnd: number;
  readonly root: string;
  readonly timestamp: Date;
  readonly eventCount: number;
}

/** Proof that a specific event is included in a Merkle batch. */
export interface MerkleProof {
  readonly leaf: string;
  readonly proof: ReadonlyArray<{
    readonly hash: string;
    readonly position: 'left' | 'right';
  }>;
  readonly root: string;
}
