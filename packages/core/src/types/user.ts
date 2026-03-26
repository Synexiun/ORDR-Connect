/**
 * User types — identity and access control for ORDR-Connect
 *
 * RBAC model: UserRole determines base permissions. Fine-grained access
 * is controlled via Permission tuples (resource, action, scope).
 */

import type { TenantId } from './tenant.js';

// ─── Branded Types ────────────────────────────────────────────────

declare const __userIdBrand: unique symbol;

/** Branded string — prevents accidental use of raw strings as user IDs */
export type UserId = string & { readonly [__userIdBrand]: never };

export function createUserId(id: string): UserId {
  if (!id || id.trim().length === 0) {
    throw new Error('UserId cannot be empty');
  }
  return id as UserId;
}

// ─── Role & Status ────────────────────────────────────────────────

export const USER_ROLES = [
  'super_admin',
  'tenant_admin',
  'manager',
  'agent',
  'viewer',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// ─── Permission Model ─────────────────────────────────────────────

export const PERMISSION_ACTIONS = ['create', 'read', 'update', 'delete', 'execute'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_SCOPES = ['own', 'team', 'tenant', 'global'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export interface Permission {
  readonly resource: string;
  readonly action: PermissionAction;
  readonly scope: PermissionScope;
}

// ─── User Interface ───────────────────────────────────────────────

export interface User {
  readonly id: UserId;
  readonly tenantId: TenantId;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly mfaEnabled: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
}

// ─── Role Hierarchy ───────────────────────────────────────────────

const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 100,
  tenant_admin: 80,
  manager: 60,
  agent: 40,
  viewer: 20,
} as const;

/** Returns true if roleA has equal or higher authority than roleB */
export function hasRoleAuthority(roleA: UserRole, roleB: UserRole): boolean {
  return ROLE_HIERARCHY[roleA] >= ROLE_HIERARCHY[roleB];
}
