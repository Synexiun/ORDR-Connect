/**
 * Payment status tool — tenant-isolated payment record lookup
 *
 * SECURITY (CLAUDE.md Rules 2, 6, 9):
 * - ALL queries include tenant_id for row-level isolation
 * - Returns ONLY amounts and dates — no PII in return payload
 * - Audit log records the data access (resource + accessor, no PII)
 *
 * COMPLIANCE:
 * - No PII is returned — only financial amounts, dates, and statuses
 * - Payment data access is logged per SOC2 CC6.1
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
import type { AgentTool, AgentContext } from '../types.js';

// ─── Tool Parameter Schema ──────────────────────────────────────

const checkPaymentParamsSchema = z.object({
  customerId: z.string().min(1),
});

// ─── Payment Data Types ─────────────────────────────────────────

export interface PaymentInfo {
  readonly customerId: string;
  readonly tenantId: string;
  readonly outstandingBalance: number;
  readonly lastPaymentDate: Date | null;
  readonly lastPaymentAmount: number | null;
  readonly paymentPlanActive: boolean;
  readonly paymentPlanMonthlyAmount: number | null;
  readonly paymentPlanRemainingPayments: number | null;
  readonly daysPastDue: number;
  readonly totalPaidToDate: number;
}

// ─── Dependency Interface ───────────────────────────────────────

export interface CheckPaymentDeps {
  readonly findPaymentInfo: (
    customerId: string,
    tenantId: string,
  ) => Promise<PaymentInfo | undefined>;
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
 * Create the check-payment tool with injected dependencies.
 *
 * Returns financial data only — amounts and dates.
 * No PII (names, emails, phone numbers) is included in the response.
 */
export function createCheckPaymentTool(deps: CheckPaymentDeps): AgentTool {
  return {
    name: 'check_payment',
    description: 'Check payment status for a customer. Returns outstanding balance, last payment date, and payment plan status. No PII in response.',
    parameters: checkPaymentParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = checkPaymentParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid payment check parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { customerId } = parsed.data;

      // ── Tenant-isolated query ──
      const paymentInfo = await deps.findPaymentInfo(customerId, context.tenantId);

      // ── Audit log — NO PII ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'payment',
        resourceId: customerId,
        action: paymentInfo !== undefined ? 'check_payment_success' : 'check_payment_not_found',
        details: {
          sessionId: context.sessionId,
          found: paymentInfo !== undefined,
        },
        timestamp: new Date(),
      });

      if (paymentInfo === undefined) {
        return err(
          new NotFoundError(`Payment info not found for customer ${customerId} in tenant ${context.tenantId}`),
        );
      }

      // ── Verify tenant isolation ──
      if (paymentInfo.tenantId !== context.tenantId) {
        return err(
          new NotFoundError(`Payment info not found for customer ${customerId} in tenant ${context.tenantId}`),
        );
      }

      // ── Return financial data only — no PII ──
      return ok({
        outstandingBalance: paymentInfo.outstandingBalance,
        lastPaymentDate: paymentInfo.lastPaymentDate,
        lastPaymentAmount: paymentInfo.lastPaymentAmount,
        paymentPlanActive: paymentInfo.paymentPlanActive,
        paymentPlanMonthlyAmount: paymentInfo.paymentPlanMonthlyAmount,
        paymentPlanRemainingPayments: paymentInfo.paymentPlanRemainingPayments,
        daysPastDue: paymentInfo.daysPastDue,
        totalPaidToDate: paymentInfo.totalPaidToDate,
      });
    },
  };
}
