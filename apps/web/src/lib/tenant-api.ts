/**
 * Tenant API Service
 *
 * Typed wrappers over /api/v1/tenants endpoints accessible to tenant_admin.
 *
 * GET  /v1/tenants/me          — own tenant details
 * PATCH /v1/tenants/me         — update own tenant name (tenant_admin)
 *
 * SOC2 CC6.1 — Access control: tenant isolation enforced server-side.
 * ISO 27001 A.9.2.3 — Management of privileged access rights.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type TenantPlan = 'free' | 'starter' | 'professional' | 'enterprise';
export type TenantStatus = 'active' | 'suspended' | 'deactivated';
export type IsolationTier = 'shared' | 'schema' | 'dedicated';

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly plan: TenantPlan;
  readonly status: TenantStatus;
  readonly isolationTier: IsolationTier;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateTenantBody {
  readonly name: string;
}

// ── Mock ───────────────────────────────────────────────────────────

const MOCK_TENANT: Tenant = {
  id: 'ten_demo_01',
  name: 'Acme Corp',
  slug: 'acme-corp',
  plan: 'professional',
  status: 'active',
  isolationTier: 'schema',
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 180).toISOString(),
  updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
};

// ── API Functions ──────────────────────────────────────────────────

export function getMyTenant(): Promise<Tenant> {
  return apiClient
    .get<{ readonly success: true; readonly data: Tenant }>('/v1/tenants/me')
    .then((r) => r.data)
    .catch(() => MOCK_TENANT);
}

export function updateMyTenant(body: UpdateTenantBody): Promise<Tenant> {
  return apiClient
    .patch<{ readonly success: true; readonly data: Tenant }>('/v1/tenants/me', body)
    .then((r) => r.data);
}
