/**
 * @ordr/kernel — Synexiun limb integration for ORDR-Connect (SynexCom).
 *
 * Public API surface for the kernel package.
 * All protocol types and subsystem classes are exported here.
 */

// Main orchestrator
export { Limb } from './limb.js';
export type { LimbEnv, LimbHealthSnapshot } from './limb.js';

// Subsystems (exported for advanced use and testing)
export { LimbIdentity } from './identity.js';
export type { SignedHeaders } from './identity.js';

export { DiodeClient, DiodeError } from './diode-client.js';
export type { DiodeClientOptions } from './diode-client.js';

export { HeartbeatEmitter } from './heartbeat.js';
export type { HealthCollector, HeartbeatOptions } from './heartbeat.js';

export { KillSwitchReceiver, KillSwitchActivatedError } from './kill-switch.js';
export type { KillSwitchStatus } from './kill-switch.js';

export { BudgetTracker } from './budget-tracker.js';

export { BudgetReporter } from './budget-reporter.js';
export type { BudgetReporterOptions } from './budget-reporter.js';

export { BudgetAllocationReceiver } from './budget-allocation-receiver.js';
export type { BudgetAllocationReceiverOptions } from './budget-allocation-receiver.js';

export { IdentityCommandReceiver } from './identity-command-receiver.js';
export type { IdentityCommandReceiverOptions } from './identity-command-receiver.js';

export { LimbRegistrar, RegistrationError } from './registrar.js';
export type { RegistrarOptions } from './registrar.js';

export { LateralGuard, LateralCommunicationError } from './lateral-guard.js';

// Protocol types
export type {
  HealthBeacon,
  HealthStatus,
  AuditReport,
  BudgetAllocation,
  BudgetReport,
  IdentityAction,
  IdentityCommand,
  PolicyDelivery,
  UpwardMessage,
  UpwardMessageType,
  DiodeAcceptResponse,
  RegisterResponse,
} from './types.js';

// Constants
export {
  ORDR_LIMB_ID,
  CORE_ID,
  HEARTBEAT_INTERVAL_MS,
  AUDIT_REPORT_INTERVAL_MS,
  BUDGET_REPORT_INTERVAL_MS,
  BUDGET_ALLOCATION_POLL_INTERVAL_MS,
  IDENTITY_COMMAND_POLL_INTERVAL_MS,
  BUDGET_DEGRADED_THRESHOLD,
  MAX_CLOCK_SKEW_MS,
  CONSECUTIVE_FAIL_WARN,
  CONSECUTIVE_FAIL_DEGRADE,
} from './constants.js';
