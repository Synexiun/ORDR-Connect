/**
 * Healthcare tool registry — central management for healthcare agent tools
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Agent permissions use explicit tool allowlist per agent role
 * - Tools are fixed at session start — agents CANNOT modify their tool set
 * - Each tool returns Result<T, AppError> — no thrown exceptions
 * - All tool executions are audit-logged
 */

import type { AgentTool } from '../../types.js';
import { createLookupPatientTool } from './lookup-patient.js';
import type { LookupPatientDeps } from './lookup-patient.js';
import { createScheduleAppointmentTool } from './schedule-appointment.js';
import type { ScheduleAppointmentDeps } from './schedule-appointment.js';
import { createCheckCarePlanTool } from './check-care-plan.js';
import type { CheckCarePlanDeps } from './check-care-plan.js';
import { createSendHealthReminderTool } from './send-health-reminder.js';
import type { SendHealthReminderDeps } from './send-health-reminder.js';

// ─── Combined Dependencies ──────────────────────────────────────

export interface HealthcareToolRegistryDeps {
  readonly patient: LookupPatientDeps;
  readonly appointment: ScheduleAppointmentDeps;
  readonly carePlan: CheckCarePlanDeps;
  readonly healthReminder: SendHealthReminderDeps;
}

// ─── Registry Factory ───────────────────────────────────────────

/**
 * Create the healthcare tool registry with all available healthcare tools.
 */
export function createHealthcareToolRegistry(deps: HealthcareToolRegistryDeps): Map<string, AgentTool> {
  const registry = new Map<string, AgentTool>();

  const patientTool = createLookupPatientTool(deps.patient);
  registry.set(patientTool.name, patientTool);

  const appointmentTool = createScheduleAppointmentTool(deps.appointment);
  registry.set(appointmentTool.name, appointmentTool);

  const carePlanTool = createCheckCarePlanTool(deps.carePlan);
  registry.set(carePlanTool.name, carePlanTool);

  const reminderTool = createSendHealthReminderTool(deps.healthReminder);
  registry.set(reminderTool.name, reminderTool);

  return registry;
}

// ─── Re-exports ─────────────────────────────────────────────────

export { createLookupPatientTool } from './lookup-patient.js';
export type { LookupPatientDeps, TokenizedPatientInfo } from './lookup-patient.js';

export { createScheduleAppointmentTool } from './schedule-appointment.js';
export type { ScheduleAppointmentDeps, AppointmentConfirmation } from './schedule-appointment.js';

export { createCheckCarePlanTool } from './check-care-plan.js';
export type { CheckCarePlanDeps, TokenizedCarePlanSummary } from './check-care-plan.js';

export { createSendHealthReminderTool } from './send-health-reminder.js';
export type { SendHealthReminderDeps } from './send-health-reminder.js';
