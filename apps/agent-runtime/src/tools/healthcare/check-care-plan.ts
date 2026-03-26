/**
 * Check Care Plan tool — HIPAA-compliant care plan retrieval
 *
 * SECURITY (CLAUDE.md Rules 3, 6, 9):
 * - Read-only access to care plan data
 * - Returns tokenized care plan summary — no raw PHI
 * - Every access is audit-logged to WORM (HIPAA §164.312(b))
 * - Patient referenced by token only
 *
 * COMPLIANCE:
 * - HIPAA §164.312(b) — audit controls for PHI access
 * - HIPAA §164.502(b) — minimum necessary access
 * - HIPAA §164.524 — access to designated record sets
 * - SOC2 CC6.1 — logical access controls
 */

import { z } from 'zod';
import {
  type Result,
  ok,
  err,
  AppError,
  NotFoundError,
  ValidationError,
} from '@ordr/core';
import type { AgentTool, AgentContext } from '../../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const checkCarePlanParamsSchema = z.object({
  patientToken: z.string().min(1, 'Patient token is required'),
});

// ─── Output Types ───────────────────────────────────────────────

/** Tokenized care plan summary — no raw PHI fields. */
export interface TokenizedCarePlanSummary {
  readonly carePlanId: string;
  readonly patientToken: string;
  readonly status: 'active' | 'completed' | 'suspended' | 'draft';
  readonly createdDate: string;
  readonly lastUpdatedDate: string;
  readonly goalCount: number;
  readonly activeGoals: number;
  readonly completedGoals: number;
  readonly nextReviewDate: string | null;
  readonly careTeamSize: number;
  readonly primaryProviderId: string | null;
}

// ─── Dependency Interface ───────────────────────────────────────

export interface CheckCarePlanDeps {
  readonly findCarePlan: (patientToken: string, tenantId: string) => Promise<TokenizedCarePlanSummary | undefined>;
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
 * Create the check-care-plan tool with injected dependencies.
 */
export function createCheckCarePlanTool(deps: CheckCarePlanDeps): AgentTool {
  return {
    name: 'check_care_plan',
    description: 'Check the active care plan for a patient by tokenized reference. Read-only access — returns a tokenized summary with no raw PHI.',
    parameters: checkCarePlanParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = checkCarePlanParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid care plan lookup parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { patientToken } = parsed.data;

      // ── Look up care plan (tokenized data only) ──
      const carePlan = await deps.findCarePlan(patientToken, context.tenantId);

      if (carePlan === undefined) {
        await deps.auditLog({
          tenantId: context.tenantId,
          eventType: 'agent.action',
          actorType: 'agent',
          actorId: context.sessionId,
          resource: 'care_plan',
          resourceId: patientToken,
          action: 'check_care_plan_not_found',
          details: { sessionId: context.sessionId },
          timestamp: new Date(),
        });

        return err(
          new NotFoundError(`No active care plan found for patient token: ${patientToken}`),
        );
      }

      // ── Audit log the read access (HIPAA §164.312(b)) ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'care_plan',
        resourceId: carePlan.carePlanId,
        action: 'check_care_plan_success',
        details: {
          patientToken,
          carePlanStatus: carePlan.status,
          sessionId: context.sessionId,
          accessType: 'read_only',
        },
        timestamp: new Date(),
      });

      return ok({
        carePlanId: carePlan.carePlanId,
        patientToken: carePlan.patientToken,
        status: carePlan.status,
        createdDate: carePlan.createdDate,
        lastUpdatedDate: carePlan.lastUpdatedDate,
        goalCount: carePlan.goalCount,
        activeGoals: carePlan.activeGoals,
        completedGoals: carePlan.completedGoals,
        nextReviewDate: carePlan.nextReviewDate,
        careTeamSize: carePlan.careTeamSize,
        primaryProviderId: carePlan.primaryProviderId,
      });
    },
  };
}
