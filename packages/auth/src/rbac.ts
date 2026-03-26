/**
 * Role-Based Access Control — RBAC enforcement for ORDR-Connect
 *
 * SOC2 CC6.3 — Role-based authorization and least privilege.
 * ISO 27001 A.9.2.3 — Management of privileged access rights.
 * HIPAA §164.312(a)(1) — Access control: unique user identification,
 *   emergency access, automatic logoff, encryption/decryption.
 *
 * Hierarchy: super_admin > tenant_admin > manager > agent > viewer
 *
 * Scope enforcement:
 * - global: super_admin only — across all tenants
 * - tenant: full tenant access
 * - team: resources owned by team members
 * - own: only the user's own resources
 */

import type { UserRole, Permission, PermissionAction, PermissionScope, TenantContext } from '@ordr/core';

// ─── Role Hierarchy ────────────────────────────────────────────────

/**
 * Numeric weight for each role. Higher value = more authority.
 * Used for hierarchical role comparisons.
 */
export const ROLE_HIERARCHY: Readonly<Record<UserRole, number>> = {
  super_admin: 100,
  tenant_admin: 80,
  manager: 60,
  agent: 40,
  viewer: 20,
} as const;

// ─── Resources ─────────────────────────────────────────────────────

const ALL_RESOURCES = [
  'customers',
  'interactions',
  'agents',
  'users',
  'tenants',
  'billing',
  'audit',
  'compliance',
  'settings',
  'reports',
  'api_keys',
] as const;

type Resource = (typeof ALL_RESOURCES)[number];

// ─── Permission Builder ────────────────────────────────────────────

function perm(resource: Resource, action: PermissionAction, scope: PermissionScope): Permission {
  return { resource, action, scope } as const;
}

function crudPermissions(resource: Resource, scope: PermissionScope): readonly Permission[] {
  return [
    perm(resource, 'create', scope),
    perm(resource, 'read', scope),
    perm(resource, 'update', scope),
    perm(resource, 'delete', scope),
  ] as const;
}

function readOnly(resource: Resource, scope: PermissionScope): Permission {
  return perm(resource, 'read', scope);
}

// ─── Role → Permission Mapping ─────────────────────────────────────

/**
 * Default permissions for each role. These are the baseline — tenants
 * can further restrict (but never expand beyond) these defaults.
 */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  super_admin: ALL_RESOURCES.flatMap((r) => [
    ...crudPermissions(r, 'global'),
    perm(r, 'execute', 'global'),
  ]),

  tenant_admin: ALL_RESOURCES.flatMap((r) => [
    ...crudPermissions(r, 'tenant'),
    perm(r, 'execute', 'tenant'),
  ]),

  manager: [
    ...crudPermissions('customers', 'team'),
    ...crudPermissions('interactions', 'team'),
    ...crudPermissions('agents', 'team'),
    readOnly('users', 'team'),
    readOnly('reports', 'team'),
    readOnly('audit', 'team'),
    readOnly('compliance', 'team'),
    perm('reports', 'execute', 'team'),
  ],

  agent: [
    readOnly('customers', 'own'),
    perm('customers', 'create', 'own'),
    perm('customers', 'update', 'own'),
    readOnly('interactions', 'own'),
    perm('interactions', 'create', 'own'),
    perm('interactions', 'update', 'own'),
  ],

  viewer: [
    readOnly('customers', 'tenant'),
    readOnly('interactions', 'tenant'),
    readOnly('reports', 'tenant'),
  ],
} as const;

// ─── Scope Hierarchy ───────────────────────────────────────────────

const SCOPE_HIERARCHY: Readonly<Record<PermissionScope, number>> = {
  global: 100,
  tenant: 80,
  team: 60,
  own: 40,
} as const;

// ─── Access Control Functions ──────────────────────────────────────

/**
 * Checks whether the given user role is equal to or outranks the required role.
 *
 * @param userRole - The role held by the user
 * @param requiredRole - The minimum role required
 * @returns true if userRole >= requiredRole in the hierarchy
 */
export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Checks whether the user's permission set includes a permission that
 * satisfies the required resource, action, and (at minimum) the required scope.
 *
 * A permission with a broader scope (e.g., `tenant`) satisfies a narrower
 * requirement (e.g., `own`).
 *
 * @param userPermissions - Array of permissions the user holds
 * @param required - The specific permission being checked
 * @returns true if any held permission satisfies the requirement
 */
export function hasPermission(
  userPermissions: readonly Permission[],
  required: Permission,
): boolean {
  return userPermissions.some(
    (p) =>
      p.resource === required.resource &&
      p.action === required.action &&
      SCOPE_HIERARCHY[p.scope] >= SCOPE_HIERARCHY[required.scope],
  );
}

/**
 * Full RBAC access check combining role hierarchy, permission matching,
 * and scope enforcement.
 *
 * Scope rules:
 * - `global`: Only super_admin — no further checks needed
 * - `tenant`: User must belong to the same tenant
 * - `team`: User must share the tenant (team checks delegated to service layer)
 * - `own`: User must be the resource owner (if resourceOwnerId is provided)
 *
 * @param context - The authenticated user's TenantContext
 * @param resource - The resource being accessed (e.g., "customers")
 * @param action - The action being performed (e.g., "read", "update")
 * @param resourceOwnerId - Optional: the userId that owns the target resource
 * @returns true if access is granted
 */
export function checkAccess(
  context: TenantContext,
  resource: string,
  action: string,
  resourceOwnerId?: string,
): boolean {
  // Build the required permission — we check from narrowest to broadest scope
  const scopesToCheck: readonly PermissionScope[] = ['global', 'tenant', 'team', 'own'] as const;

  for (const scope of scopesToCheck) {
    const required: Permission = {
      resource,
      action: action as PermissionAction,
      scope,
    };

    // Parse the user's role from context (first role is primary)
    const userRole = (context.roles[0] ?? 'viewer') as UserRole;

    // Get the default permissions for this role
    const roleDefaults = ROLE_PERMISSIONS[userRole] ?? [];

    // Combine role defaults with any explicit permissions from context
    const contextPermissions: readonly Permission[] = context.permissions.map((p) => {
      if (typeof p === 'string') {
        // Handle string-form permissions like "customers:read:tenant"
        const [res, act, sc] = p.split(':') as [string, PermissionAction, PermissionScope];
        return { resource: res ?? '', action: act ?? 'read', scope: sc ?? 'own' };
      }
      return p as unknown as Permission;
    });

    const allPermissions = [...roleDefaults, ...contextPermissions];

    if (hasPermission(allPermissions, required)) {
      // Scope enforcement: check ownership for 'own' scope
      if (scope === 'own' && resourceOwnerId !== undefined) {
        return context.userId === resourceOwnerId;
      }
      return true;
    }
  }

  return false;
}
