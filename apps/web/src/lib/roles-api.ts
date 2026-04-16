/**
 * Roles API Service — custom RBAC/ABAC role management
 *
 * Typed wrappers over /api/v1/roles endpoints.
 *
 * SOC2 CC6.2 — Management of access rights (audit-logged).
 * SOC2 CC6.3 — Role-based authorization with least privilege.
 * ISO 27001 A.9.2.3 — Management of privileged access rights.
 * HIPAA §164.312(a)(1) — Fine-grained access control.
 *
 * SECURITY: No PHI in role data (Rule 6). Tenant isolation from JWT (Rule 2).
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type BaseRole = 'super_admin' | 'tenant_admin' | 'manager' | 'agent' | 'viewer';

export type PermAction = 'create' | 'read' | 'update' | 'delete' | 'execute';

export type PermScope = 'own' | 'team' | 'tenant' | 'global';

export interface Permission {
  readonly resource: string;
  readonly action: PermAction;
  readonly scope: PermScope;
}

export interface CustomRole {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly baseRole: BaseRole;
  readonly permissions: Permission[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateRoleBody {
  name: string;
  description?: string;
  baseRole: BaseRole;
  permissions: Permission[];
}

export interface UpdateRoleBody {
  name?: string;
  description?: string;
  permissions?: Permission[];
}

// ── API ────────────────────────────────────────────────────────────

export const rolesApi = {
  list(): Promise<CustomRole[]> {
    return apiClient.get<{ success: boolean; data: CustomRole[] }>('/v1/roles').then((r) => r.data);
  },

  get(id: string): Promise<CustomRole> {
    return apiClient
      .get<{ success: boolean; data: CustomRole }>(`/v1/roles/${id}`)
      .then((r) => r.data);
  },

  create(body: CreateRoleBody): Promise<CustomRole> {
    return apiClient
      .post<{ success: boolean; data: CustomRole }>('/v1/roles', body)
      .then((r) => r.data);
  },

  update(id: string, body: UpdateRoleBody): Promise<CustomRole> {
    return apiClient
      .patch<{ success: boolean; data: CustomRole }>(`/v1/roles/${id}`, body)
      .then((r) => r.data);
  },

  remove(id: string): Promise<void> {
    return apiClient.delete<{ success: boolean }>(`/v1/roles/${id}`).then(() => undefined);
  },

  assign(id: string, userId: string): Promise<void> {
    return apiClient
      .post<{ success: boolean }>(`/v1/roles/${id}/assign`, { userId })
      .then(() => undefined);
  },

  revoke(id: string, userId: string): Promise<void> {
    return apiClient
      .post<{ success: boolean }>(`/v1/roles/${id}/revoke`, { userId })
      .then(() => undefined);
  },
};
