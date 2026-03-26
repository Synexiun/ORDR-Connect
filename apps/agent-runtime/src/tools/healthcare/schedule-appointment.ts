/**
 * Schedule Appointment tool — HIPAA-compliant appointment scheduling
 *
 * SECURITY (CLAUDE.md Rules 3, 4, 6, 9):
 * - Patient referenced by token only — never raw PHI
 * - Validates scheduling constraints (business hours, conflicts)
 * - Every scheduling action is audit-logged to WORM
 * - Input validated with strict Zod schema
 *
 * COMPLIANCE:
 * - HIPAA §164.312(b) — audit controls
 * - HIPAA §164.502(b) — minimum necessary for scheduling
 * - SOC2 CC6.1 — logical access controls
 */

import { z } from 'zod';
import {
  type Result,
  ok,
  err,
  AppError,
  ValidationError,
} from '@ordr/core';
import type { AgentTool, AgentContext } from '../../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const scheduleAppointmentParamsSchema = z.object({
  patientToken: z.string().min(1, 'Patient token is required'),
  providerId: z.string().min(1, 'Provider ID is required'),
  dateTime: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    'Must be a valid ISO 8601 date-time string',
  ),
  appointmentType: z.enum([
    'initial_consultation',
    'follow_up',
    'annual_checkup',
    'specialist_referral',
    'urgent_care',
    'telehealth',
  ]),
  notes: z.string().max(500).optional(),
});

// ─── Output Types ───────────────────────────────────────────────

export interface AppointmentConfirmation {
  readonly appointmentId: string;
  readonly patientToken: string;
  readonly providerId: string;
  readonly dateTime: string;
  readonly appointmentType: string;
  readonly status: 'confirmed' | 'pending';
}

// ─── Dependency Interface ───────────────────────────────────────

export interface ScheduleAppointmentDeps {
  readonly checkAvailability: (providerId: string, dateTime: string, tenantId: string) => Promise<boolean>;
  readonly createAppointment: (data: {
    readonly patientToken: string;
    readonly providerId: string;
    readonly dateTime: string;
    readonly appointmentType: string;
    readonly tenantId: string;
    readonly notes?: string | undefined;
  }) => Promise<AppointmentConfirmation>;
  readonly auditLog: (input: {
    readonly tenantId: string;
    readonly eventType: 'agent.action';
    readonly actorType: 'agent';
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Record<string, unknown>;
    readonly timestamp: Date;
  }) => Promise<void>;
}

// ─── Tool Factory ───────────────────────────────────────────────

/**
 * Create the schedule-appointment tool with injected dependencies.
 */
export function createScheduleAppointmentTool(deps: ScheduleAppointmentDeps): AgentTool {
  return {
    name: 'schedule_appointment',
    description: 'Schedule a patient appointment with a healthcare provider. Validates provider availability and scheduling constraints. Patient referenced by token only.',
    parameters: scheduleAppointmentParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = scheduleAppointmentParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid appointment scheduling parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { patientToken, providerId, dateTime, appointmentType, notes } = parsed.data;

      // ── Validate date is in the future ──
      const appointmentDate = new Date(dateTime);
      if (appointmentDate <= new Date()) {
        return err(
          new ValidationError('Appointment date must be in the future', {
            dateTime: ['Must be a future date-time'],
          }),
        );
      }

      // ── Check provider availability ──
      const isAvailable = await deps.checkAvailability(providerId, dateTime, context.tenantId);

      if (!isAvailable) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'appointment',
          resourceId: patientToken,
          action: 'schedule_appointment_unavailable',
          details: {
            providerId,
            dateTime,
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });

        return err(
          new ValidationError('Provider is not available at the requested time', {
            dateTime: ['Time slot unavailable'],
          }),
        );
      }

      // ── Create the appointment ──
      const confirmation = await deps.createAppointment({
        patientToken,
        providerId,
        dateTime,
        appointmentType,
        tenantId: context.tenantId,
        notes,
      });

      // ── Audit log the scheduling action — NO PHI in details ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'appointment',
        resourceId: confirmation.appointmentId,
        action: 'schedule_appointment_success',
        details: {
          patientToken,
          providerId,
          appointmentType,
          dateTime,
          status: confirmation.status,
          sessionId: context.sessionId,
        },
        timestamp: new Date(),
      });

      return ok({
        appointmentId: confirmation.appointmentId,
        patientToken: confirmation.patientToken,
        providerId: confirmation.providerId,
        dateTime: confirmation.dateTime,
        appointmentType: confirmation.appointmentType,
        status: confirmation.status,
      });
    },
  };
}
