/**
 * Tool registry — central tool management for agent runtime
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Agent permissions use explicit tool allowlist per agent role
 * - Tools are fixed at session start — agents CANNOT modify their tool set
 * - Each tool returns Result<T, AppError> — no thrown exceptions
 * - All tool executions are audit-logged
 */

import type { AgentTool } from '../types.js';
import { createSendSmsTool } from './send-sms.js';
import type { SendSmsDeps } from './send-sms.js';
import { createLookupCustomerTool } from './lookup-customer.js';
import type { LookupCustomerDeps } from './lookup-customer.js';
import { createCheckPaymentTool } from './check-payment.js';
import type { CheckPaymentDeps } from './check-payment.js';
import { createScheduleFollowupTool } from './schedule-followup.js';
import type { ScheduleFollowupDeps } from './schedule-followup.js';

// ─── Combined Dependencies ──────────────────────────────────────

export interface ToolRegistryDeps {
  readonly sms: SendSmsDeps;
  readonly customer: LookupCustomerDeps;
  readonly payment: CheckPaymentDeps;
  readonly followup: ScheduleFollowupDeps;
}

// ─── Registry Factory ───────────────────────────────────────────

/**
 * Create the tool registry with all available tools.
 *
 * Returns a Map<string, AgentTool> that is frozen at creation time.
 * Agents receive a reference to this map at session start and
 * CANNOT add, remove, or modify tools.
 */
export function createToolRegistry(deps: ToolRegistryDeps): Map<string, AgentTool> {
  const registry = new Map<string, AgentTool>();

  const smsTool = createSendSmsTool(deps.sms);
  registry.set(smsTool.name, smsTool);

  const customerTool = createLookupCustomerTool(deps.customer);
  registry.set(customerTool.name, customerTool);

  const paymentTool = createCheckPaymentTool(deps.payment);
  registry.set(paymentTool.name, paymentTool);

  const followupTool = createScheduleFollowupTool(deps.followup);
  registry.set(followupTool.name, followupTool);

  return registry;
}

// ─── Re-exports ─────────────────────────────────────────────────

export { createSendSmsTool } from './send-sms.js';
export type { SendSmsDeps } from './send-sms.js';

export { createLookupCustomerTool } from './lookup-customer.js';
export type { LookupCustomerDeps, CustomerInfo, CustomerInteraction } from './lookup-customer.js';

export { createCheckPaymentTool } from './check-payment.js';
export type { CheckPaymentDeps, PaymentInfo } from './check-payment.js';

export { createScheduleFollowupTool } from './schedule-followup.js';
export type { ScheduleFollowupDeps } from './schedule-followup.js';
