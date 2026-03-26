/**
 * Lookup Patient tool — HIPAA-compliant patient record retrieval
 *
 * SECURITY (CLAUDE.md Rules 2, 3, 6, 9):
 * - Returns ONLY tokenized patient data — never raw PHI
 * - Validates caller has PHI access permission before lookup
 * - Every access is audit-logged to WORM (HIPAA §164.312(b))
 * - Tenant isolation enforced server-side
 * - Minimum necessary principle: only authorized fields returned
 *
 * COMPLIANCE:
 * - HIPAA §164.312(b) — audit controls for PHI access
 * - HIPAA §164.502(b) — minimum necessary access
 * - HIPAA §164.312(a)(1) — access control
 * - SOC2 CC6.1 — logical access controls
 */

import { z } from 'zod';
import {
  type Result,
  ok,
  err,
  AppError,
  NotFoundError,
  AuthorizationError,
  ValidationError,
} from '@ordr/core';
import type { AgentTool, AgentContext } from '../../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const lookupPatientParamsSchema = z.object({
  patientToken: z.string().min(1, 'Patient token is required'),
});

// ─── Output Types ───────────────────────────────────────────────

/** Tokenized patient info — no raw PHI fields. */
export interface TokenizedPatientInfo {
  readonly patientToken: string;
  readonly tenantId: string;
  readonly status: string;
  readonly careTeamSize: number;
  readonly activeCarePlan: boolean;
  readonly upcomingAppointments: number;
  readonly consentStatus: string;
  readonly lastVisitDate: string | null;
}

// ─── Dependency Interface ───────────────────────────────────────

export interface LookupPatientDeps {
  readonly findPatient: (patientToken: string, tenantId: string) => Promise<TokenizedPatientInfo | undefined>;
  readonly checkPhiAccess: (actorId: string, tenantId: string, patientToken: string) => Promise<boolean>;
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
 * Create the lookup-patient tool with injected dependencies.
 */
export function createLookupPatientTool(deps: LookupPatientDeps): AgentTool {
  return {
    name: 'lookup_patient',
    description: 'Look up a patient record by tokenized reference. Returns tokenized patient data only — never raw PHI. Requires PHI access permission.',
    parameters: lookupPatientParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = lookupPatientParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid patient lookup parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { patientToken } = parsed.data;

      // ── PHI access permission check — MANDATORY (HIPAA §164.312(a)(1)) ──
      const hasAccess = await deps.checkPhiAccess(
        context.sessionId,
        context.tenantId,
        patientToken,
      );

      if (!hasAccess) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'patient',
          resourceId: patientToken,
          action: 'lookup_patient_denied',
          details: {
            reason: 'PHI access permission denied',
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });

        return err(
          new AuthorizationError('PHI access denied — insufficient permissions for patient record'),
        );
      }

      // ── Look up patient (tokenized data only) ──
      const patient = await deps.findPatient(patientToken, context.tenantId);

      if (patient === undefined) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'patient',
          resourceId: patientToken,
          action: 'lookup_patient_not_found',
          details: { sessionId: context.sessionId },
          timestamp: new Date(),
        });

        return err(
          new NotFoundError(`Patient record not found for token: ${patientToken}`),
        );
      }

      // ── Tenant isolation check ──
      if (patient.tenantId !== context.tenantId) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'patient',
          resourceId: patientToken,
          action: 'lookup_patient_tenant_violation',
          details: {
            reason: 'Cross-tenant access attempted',
            sessionId: context.sessionId,
          },
          timestamp: new Date(),
        });

        return err(
          new AuthorizationError('Cross-tenant patient access denied'),
        );
      }

      // ── Audit log the successful access (HIPAA §164.312(b)) ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'patient',
        resourceId: patientToken,
        action: 'lookup_patient_success',
        details: {
          sessionId: context.sessionId,
          fieldsAccessed: 'tokenized_summary',
        },
        timestamp: new Date(),
      });

      return ok({
        patientToken: patient.patientToken,
        status: patient.status,
        careTeamSize: patient.careTeamSize,
        activeCarePlan: patient.activeCarePlan,
        upcomingAppointments: patient.upcomingAppointments,
        consentStatus: patient.consentStatus,
        lastVisitDate: patient.lastVisitDate,
      });
    },
  };
}
