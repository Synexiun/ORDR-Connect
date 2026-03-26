/**
 * Tenant types — multi-tenancy core for ORDR-Connect
 *
 * Every request is scoped to a tenant. TenantContext is extracted from
 * the JWT and threaded through the entire request lifecycle.
 */

// ─── Branded Types ────────────────────────────────────────────────

declare const __tenantIdBrand: unique symbol;

/** Branded string — prevents accidental use of raw strings as tenant IDs */
export type TenantId = string & { readonly [__tenantIdBrand]: never };

export function createTenantId(id: string): TenantId {
  if (!id || id.trim().length === 0) {
    throw new Error('TenantId cannot be empty');
  }
  return id as TenantId;
}

// ─── Plan & Status ────────────────────────────────────────────────

export const TENANT_PLANS = ['free', 'starter', 'professional', 'enterprise'] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const TENANT_STATUSES = ['active', 'suspended', 'deactivated', 'pending'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

// ─── Isolation ────────────────────────────────────────────────────

export const ISOLATION_TIERS = ['shared', 'schema', 'dedicated'] as const;
export type IsolationTier = (typeof ISOLATION_TIERS)[number];

// ─── Tenant Settings ──────────────────────────────────────────────

export interface TenantSettings {
  readonly isolationTier: IsolationTier;
  readonly maxUsers: number;
  readonly maxAgents: number;
  readonly dataRetentionDays: number;
  readonly complianceFrameworks: readonly string[];
  readonly allowedRegions: readonly string[];
}

// ─── Core Interfaces ──────────────────────────────────────────────

export interface Tenant {
  readonly id: TenantId;
  readonly name: string;
  readonly slug: string;
  readonly plan: TenantPlan;
  readonly status: TenantStatus;
  readonly settings: TenantSettings;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * TenantContext — extracted from JWT, passed through request context.
 * Every service call MUST include this to enforce tenant isolation.
 */
export interface TenantContext {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}
