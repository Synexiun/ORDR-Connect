/**
 * Synexiun Data Diode Protocol Types
 *
 * TypeScript port of synex_kernel/diode/protocol.py and synex_kernel/health/status.py
 * All message shapes must remain wire-compatible with the Python Pydantic models.
 */

// --- Health ---

export type HealthStatus = 'alive' | 'degraded' | 'draining' | 'dead';

export interface HealthReport {
  limb_id: string;
  status: HealthStatus;
  budget_remaining: number;
  budget_total: number;
  epoch: number;
  uptime_seconds: number;
  error_count: number;
  timestamp: string; // ISO 8601
}

// --- Upward messages (limb → Core) ---

export interface HealthBeacon {
  limb_id: string;
  status: HealthStatus;
  budget_remaining: number;
  budget_total: number;
  epoch: number;
  uptime_seconds: number;
  timestamp: string; // ISO 8601
}

export interface AuditReport {
  limb_id: string;
  chain_length: number;
  latest_hash: string;
  epoch: number;
  timestamp: string; // ISO 8601
}

export interface BudgetReport {
  limb_id: string;
  epoch: number;
  consumed: number;
  remaining: number;
  timestamp: string; // ISO 8601
}

export type UpwardMessageType = 'health_beacon' | 'audit_report' | 'budget_report';

export interface UpwardMessage {
  type: UpwardMessageType;
  payload: HealthBeacon | AuditReport | BudgetReport;
}

// --- Downward messages (Core → limb) ---

export type IdentityAction = 'revoke' | 'rotate';

export interface PolicyDelivery {
  epoch: number;
  artifact_b64: string;
  signature: string;
}

export interface IdentityCommand {
  action: IdentityAction;
  limb_id: string;
  reason: string;
}

export interface BudgetAllocation {
  epoch: number;
  budget: number;
  limb_id: string;
}

// --- Registration ---

export interface RegisterRequest {
  display_name?: string;
  validity_days?: number;
  public_key: string; // hex-encoded Ed25519 verify key
}

export interface RegisterResponse {
  limb_id: string;
  certificate: {
    certificate: {
      limb_id: string;
      public_key: string;
      issued_at: string;
      expires_at: string;
      issuer: string;
      version: number;
    };
    signature: string;
  };
  message: string;
  _deprecation?: string;
}

// --- Diode response ---

export interface DiodeAcceptResponse {
  status: 'accepted';
  type: UpwardMessageType;
  limb_id: string;
}
