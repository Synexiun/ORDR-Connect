/**
 * Customer lookup tool — tenant-isolated customer data retrieval
 *
 * SECURITY (CLAUDE.md Rules 2, 6, 9):
 * - ALL queries include tenant_id for row-level isolation
 * - PII is decrypted only for the agent context — NEVER logged
 * - Audit log records the data access (resource + accessor, no PII)
 * - Returns health score, lifecycle stage, and recent interactions
 *
 * COMPLIANCE:
 * - PHI access is logged per HIPAA §164.312(b)
 * - Only minimum necessary data is returned (principle of least privilege)
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

const lookupCustomerParamsSchema = z.object({
  customerId: z.string().min(1),
});

// ─── Customer Data Types ────────────────────────────────────────

export interface CustomerInfo {
  readonly customerId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly healthScore: number;
  readonly lifecycleStage: string;
  readonly outstandingBalance: number;
  readonly lastInteractionAt: Date | null;
  readonly recentInteractions: readonly CustomerInteraction[];
}

export interface CustomerInteraction {
  readonly id: string;
  readonly type: string;
  readonly channel: string;
  readonly summary: string;
  readonly timestamp: Date;
}

// ─── Dependency Interface ───────────────────────────────────────

export interface LookupCustomerDeps {
  readonly findCustomer: (
    customerId: string,
    tenantId: string,
  ) => Promise<CustomerInfo | undefined>;
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
 * Create the lookup-customer tool with injected dependencies.
 *
 * SECURITY: The dependency `findCustomer` handles field-level decryption
 * of PII columns. The returned data is held in agent memory only —
 * it MUST NOT be logged, serialized to disk, or sent to external services.
 */
export function createLookupCustomerTool(deps: LookupCustomerDeps): AgentTool {
  return {
    name: 'lookup_customer',
    description: 'Look up customer information by ID. Returns health score, lifecycle stage, and recent interactions. Tenant-isolated.',
    parameters: lookupCustomerParamsSchema,
    execute: async (
      params: unknown,
      context: AgentContext,
    ): Promise<Result<unknown, AppError>> => {
      // ── Validate parameters ──
      const parsed = lookupCustomerParamsSchema.safeParse(params);
      if (!parsed.success) {
        return err(
          new ValidationError('Invalid customer lookup parameters', {
            params: parsed.error.errors.map((e) => e.message),
          }),
        );
      }

      const { customerId } = parsed.data;

      // ── Tenant-isolated query ──
      const customer = await deps.findCustomer(customerId, context.tenantId);

      // ── Audit log the data access — NO PII in log ──
      await deps.auditLog({
        tenantId: context.tenantId,
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: context.sessionId,
        resource: 'customer',
        resourceId: customerId,
        action: customer !== undefined ? 'lookup_customer_success' : 'lookup_customer_not_found',
        details: {
          sessionId: context.sessionId,
          found: customer !== undefined,
        },
        timestamp: new Date(),
      });

      if (customer === undefined) {
        return err(
          new NotFoundError(`Customer ${customerId} not found in tenant ${context.tenantId}`),
        );
      }

      // ── Verify tenant isolation ──
      if (customer.tenantId !== context.tenantId) {
        // SECURITY: This should never happen if findCustomer is correctly implemented,
        // but defense-in-depth requires the check
        return err(
          new NotFoundError(`Customer ${customerId} not found in tenant ${context.tenantId}`),
        );
      }

      return ok({
        customerId: customer.customerId,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        healthScore: customer.healthScore,
        lifecycleStage: customer.lifecycleStage,
        outstandingBalance: customer.outstandingBalance,
        lastInteractionAt: customer.lastInteractionAt,
        recentInteractions: customer.recentInteractions,
      });
    },
  };
}
