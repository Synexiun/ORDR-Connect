/**
 * Custom Role Management — tenant-specific role definitions
 *
 * SOC2 CC6.2 — Management of access rights with custom roles.
 * SOC2 CC6.3 — Role-based authorization with least privilege.
 * ISO 27001 A.9.2.3 — Management of privileged access rights.
 * HIPAA §164.312(a)(1) — Fine-grained access control.
 *
 * Custom roles extend built-in roles:
 * - Every custom role inherits from a base built-in role
 * - Permissions can be added to the base set (never beyond global)
 * - Every permission change is audit-logged (SOC2 CC6.2)
 */

import type { Result, Permission, UserRole } from '@ordr/core';
import { ok, err, AppError, ERROR_CODES } from '@ordr/core';
import { ROLE_PERMISSIONS } from './rbac.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface CustomRole {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly baseRole: UserRole;
  readonly permissions: readonly Permission[];
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateRoleInput {
  readonly name: string;
  readonly description: string;
  readonly baseRole: UserRole;
  readonly permissions: readonly Permission[];
}

export interface UserRoleAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly assignedBy: string;
  readonly assignedAt: Date;
}

// ─── Role Store Interface (DI) ───────────────────────────────────

export interface RoleStore {
  create(role: CustomRole): Promise<void>;
  getById(tenantId: string, roleId: string): Promise<CustomRole | null>;
  getByName(tenantId: string, name: string): Promise<CustomRole | null>;
  list(tenantId: string): Promise<readonly CustomRole[]>;
  update(
    tenantId: string,
    roleId: string,
    fields: Partial<Pick<CustomRole, 'name' | 'description' | 'permissions'>>,
  ): Promise<CustomRole | null>;
  delete(tenantId: string, roleId: string): Promise<void>;
  assignRole(assignment: UserRoleAssignment): Promise<void>;
  revokeRole(tenantId: string, userId: string, roleId: string): Promise<void>;
  getUserRoleIds(tenantId: string, userId: string): Promise<readonly string[]>;
  getRoleAssignmentCount(tenantId: string, roleId: string): Promise<number>;
}

// ─── Audit Logger Interface (DI) ────────────────────────────────

export interface RoleAuditLogger {
  log(input: {
    readonly tenantId: string;
    readonly eventType: string;
    readonly actorType: string;
    readonly actorId: string;
    readonly resource: string;
    readonly resourceId: string;
    readonly action: string;
    readonly details: Readonly<Record<string, unknown>>;
    readonly timestamp: Date;
  }): Promise<unknown>;
}

// ─── In-Memory Role Store (Testing) ──────────────────────────────

export class InMemoryRoleStore implements RoleStore {
  private readonly roles = new Map<string, CustomRole>();
  private readonly assignments = new Map<string, UserRoleAssignment>();
  private counter = 0;

  async create(role: CustomRole): Promise<void> {
    this.roles.set(`${role.tenantId}:${role.id}`, role);
  }

  async getById(tenantId: string, roleId: string): Promise<CustomRole | null> {
    return this.roles.get(`${tenantId}:${roleId}`) ?? null;
  }

  async getByName(tenantId: string, name: string): Promise<CustomRole | null> {
    for (const role of this.roles.values()) {
      if (role.tenantId === tenantId && role.name === name) {
        return role;
      }
    }
    return null;
  }

  async list(tenantId: string): Promise<readonly CustomRole[]> {
    const results: CustomRole[] = [];
    for (const role of this.roles.values()) {
      if (role.tenantId === tenantId) {
        results.push(role);
      }
    }
    return results;
  }

  async update(
    tenantId: string,
    roleId: string,
    fields: Partial<Pick<CustomRole, 'name' | 'description' | 'permissions'>>,
  ): Promise<CustomRole | null> {
    const key = `${tenantId}:${roleId}`;
    const existing = this.roles.get(key);
    if (!existing) return null;

    const updated: CustomRole = {
      ...existing,
      ...fields,
      updatedAt: new Date(),
    };
    this.roles.set(key, updated);
    return updated;
  }

  async delete(tenantId: string, roleId: string): Promise<void> {
    this.roles.delete(`${tenantId}:${roleId}`);
  }

  async assignRole(assignment: UserRoleAssignment): Promise<void> {
    this.assignments.set(
      `${assignment.tenantId}:${assignment.userId}:${assignment.roleId}`,
      assignment,
    );
  }

  async revokeRole(tenantId: string, userId: string, roleId: string): Promise<void> {
    this.assignments.delete(`${tenantId}:${userId}:${roleId}`);
  }

  async getUserRoleIds(tenantId: string, userId: string): Promise<readonly string[]> {
    const results: string[] = [];
    for (const [key, assignment] of this.assignments) {
      if (assignment.tenantId === tenantId && assignment.userId === userId) {
        results.push(assignment.roleId);
      }
    }
    return results;
  }

  async getRoleAssignmentCount(tenantId: string, roleId: string): Promise<number> {
    let count = 0;
    for (const assignment of this.assignments.values()) {
      if (assignment.tenantId === tenantId && assignment.roleId === roleId) {
        count += 1;
      }
    }
    return count;
  }
}

// ─── Allowed Resources & Actions ─────────────────────────────────

const ALLOWED_RESOURCES = [
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
  'organizations',
  'roles',
] as const;

const ALLOWED_ACTIONS = ['create', 'read', 'update', 'delete', 'execute'] as const;
const ALLOWED_SCOPES = ['own', 'team', 'tenant', 'global'] as const;

type AllowedResource = (typeof ALLOWED_RESOURCES)[number];
type AllowedAction = (typeof ALLOWED_ACTIONS)[number];
type AllowedScope = (typeof ALLOWED_SCOPES)[number];

// ─── Custom Role Manager ──────────────────────────────────────────

export class CustomRoleManager {
  private readonly store: RoleStore;
  private readonly auditLogger: RoleAuditLogger;

  constructor(store: RoleStore, auditLogger: RoleAuditLogger) {
    this.store = store;
    this.auditLogger = auditLogger;
  }

  /**
   * Creates a custom role within a tenant.
   * Validates no duplicate names and permissions are from the allowed set.
   */
  async createRole(
    tenantId: string,
    createdBy: string,
    input: CreateRoleInput,
  ): Promise<Result<CustomRole, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    if (!input.name || input.name.trim().length === 0) {
      return err(new AppError('Role name is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    if (input.name.length > 100) {
      return err(new AppError('Role name must be 100 characters or fewer', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Check for duplicate name within tenant
    const existing = await this.store.getByName(tenantId, input.name);
    if (existing) {
      return err(new AppError(
        'A role with this name already exists in this tenant',
        ERROR_CODES.CONFLICT,
        409,
      ));
    }

    // Validate base role
    const validBaseRoles: readonly UserRole[] = [
      'super_admin', 'tenant_admin', 'manager', 'agent', 'viewer',
    ];
    if (!validBaseRoles.includes(input.baseRole)) {
      return err(new AppError('Invalid base role', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Validate permissions
    const permError = this.validatePermissions(input.permissions);
    if (permError) {
      return err(permError);
    }

    const now = new Date();
    const role: CustomRole = {
      id: `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      name: input.name,
      description: input.description,
      baseRole: input.baseRole,
      permissions: input.permissions,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.create(role);

    // Audit log (SOC2 CC6.2)
    await this.auditLogger.log({
      tenantId,
      eventType: 'role.created',
      actorType: 'user',
      actorId: createdBy,
      resource: 'role',
      resourceId: role.id,
      action: 'create',
      details: {
        name: input.name,
        baseRole: input.baseRole,
        permissionCount: input.permissions.length,
      },
      timestamp: now,
    });

    return ok(role);
  }

  /**
   * Gets a custom role by ID.
   */
  async getRole(
    tenantId: string,
    roleId: string,
  ): Promise<Result<CustomRole, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const role = await this.store.getById(tenantId, roleId);
    if (!role) {
      return err(new AppError('Custom role not found', ERROR_CODES.NOT_FOUND, 404));
    }

    return ok(role);
  }

  /**
   * Lists all custom roles for a tenant.
   */
  async listRoles(
    tenantId: string,
  ): Promise<Result<readonly CustomRole[], AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const roles = await this.store.list(tenantId);
    return ok(roles);
  }

  /**
   * Updates a custom role's mutable fields.
   */
  async updateRole(
    tenantId: string,
    roleId: string,
    actorId: string,
    updates: Partial<Pick<CustomRole, 'name' | 'description' | 'permissions'>>,
  ): Promise<Result<CustomRole, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const existing = await this.store.getById(tenantId, roleId);
    if (!existing) {
      return err(new AppError('Custom role not found', ERROR_CODES.NOT_FOUND, 404));
    }

    // Check name uniqueness if name is being changed
    if (updates.name && updates.name !== existing.name) {
      const nameConflict = await this.store.getByName(tenantId, updates.name);
      if (nameConflict) {
        return err(new AppError(
          'A role with this name already exists in this tenant',
          ERROR_CODES.CONFLICT,
          409,
        ));
      }
    }

    // Validate permissions if being updated
    if (updates.permissions) {
      const permError = this.validatePermissions(updates.permissions);
      if (permError) {
        return err(permError);
      }
    }

    const updated = await this.store.update(tenantId, roleId, updates);
    if (!updated) {
      return err(new AppError('Failed to update role', ERROR_CODES.INTERNAL_ERROR, 500));
    }

    // Audit log (SOC2 CC6.2)
    await this.auditLogger.log({
      tenantId,
      eventType: 'role.updated',
      actorType: 'user',
      actorId,
      resource: 'role',
      resourceId: roleId,
      action: 'update',
      details: {
        updatedFields: Object.keys(updates),
        permissionsChanged: updates.permissions !== undefined,
      },
      timestamp: new Date(),
    });

    return ok(updated);
  }

  /**
   * Deletes a custom role. Fails if role is still assigned to users.
   */
  async deleteRole(
    tenantId: string,
    roleId: string,
    actorId: string,
  ): Promise<Result<void, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const existing = await this.store.getById(tenantId, roleId);
    if (!existing) {
      return err(new AppError('Custom role not found', ERROR_CODES.NOT_FOUND, 404));
    }

    // Check for active assignments
    const assignmentCount = await this.store.getRoleAssignmentCount(tenantId, roleId);
    if (assignmentCount > 0) {
      return err(new AppError(
        'Cannot delete role that is still assigned to users',
        ERROR_CODES.CONFLICT,
        409,
      ));
    }

    await this.store.delete(tenantId, roleId);

    // Audit log (SOC2 CC6.2)
    await this.auditLogger.log({
      tenantId,
      eventType: 'role.deleted',
      actorType: 'user',
      actorId,
      resource: 'role',
      resourceId: roleId,
      action: 'delete',
      details: { name: existing.name },
      timestamp: new Date(),
    });

    return ok(undefined);
  }

  /**
   * Assigns a custom role to a user.
   */
  async assignRole(
    tenantId: string,
    userId: string,
    roleId: string,
    assignedBy: string,
  ): Promise<Result<void, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Verify role exists
    const role = await this.store.getById(tenantId, roleId);
    if (!role) {
      return err(new AppError('Custom role not found', ERROR_CODES.NOT_FOUND, 404));
    }

    // Check if already assigned
    const existingRoleIds = await this.store.getUserRoleIds(tenantId, userId);
    if (existingRoleIds.includes(roleId)) {
      return err(new AppError('Role is already assigned to this user', ERROR_CODES.CONFLICT, 409));
    }

    const assignment: UserRoleAssignment = {
      id: `assign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      userId,
      roleId,
      assignedBy,
      assignedAt: new Date(),
    };

    await this.store.assignRole(assignment);

    // Audit log (SOC2 CC6.2) — EVERY permission change logged
    await this.auditLogger.log({
      tenantId,
      eventType: 'role.assigned',
      actorType: 'user',
      actorId: assignedBy,
      resource: 'user_role',
      resourceId: `${userId}:${roleId}`,
      action: 'assign',
      details: {
        userId,
        roleId,
        roleName: role.name,
      },
      timestamp: new Date(),
    });

    return ok(undefined);
  }

  /**
   * Revokes a custom role from a user.
   */
  async revokeRole(
    tenantId: string,
    userId: string,
    roleId: string,
    revokedBy: string,
  ): Promise<Result<void, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Verify role exists
    const role = await this.store.getById(tenantId, roleId);
    if (!role) {
      return err(new AppError('Custom role not found', ERROR_CODES.NOT_FOUND, 404));
    }

    // Check if assigned
    const existingRoleIds = await this.store.getUserRoleIds(tenantId, userId);
    if (!existingRoleIds.includes(roleId)) {
      return err(new AppError('Role is not assigned to this user', ERROR_CODES.NOT_FOUND, 404));
    }

    await this.store.revokeRole(tenantId, userId, roleId);

    // Audit log (SOC2 CC6.2) — EVERY permission change logged
    await this.auditLogger.log({
      tenantId,
      eventType: 'role.revoked',
      actorType: 'user',
      actorId: revokedBy,
      resource: 'user_role',
      resourceId: `${userId}:${roleId}`,
      action: 'revoke',
      details: {
        userId,
        roleId,
        roleName: role.name,
      },
      timestamp: new Date(),
    });

    return ok(undefined);
  }

  /**
   * Gets the merged permission set for a user (built-in + custom roles).
   */
  async getUserPermissions(
    tenantId: string,
    userId: string,
    builtInRole: UserRole,
  ): Promise<Result<readonly Permission[], AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Start with built-in role permissions
    const builtInPermissions = ROLE_PERMISSIONS[builtInRole] ?? [];
    const allPermissions = [...builtInPermissions];

    // Add custom role permissions
    const customRoleIds = await this.store.getUserRoleIds(tenantId, userId);

    for (const roleId of customRoleIds) {
      const role = await this.store.getById(tenantId, roleId);
      if (role) {
        for (const perm of role.permissions) {
          // Add only if not already present
          const exists = allPermissions.some(
            (p) => p.resource === perm.resource &&
                   p.action === perm.action &&
                   p.scope === perm.scope,
          );
          if (!exists) {
            allPermissions.push(perm);
          }
        }
      }
    }

    return ok(allPermissions);
  }

  // ─── Validation Helpers ───────────────────────────────────────────

  private validatePermissions(permissions: readonly Permission[]): AppError | null {
    for (const perm of permissions) {
      if (!ALLOWED_RESOURCES.includes(perm.resource as AllowedResource)) {
        return new AppError(
          `Invalid resource: ${perm.resource}`,
          ERROR_CODES.VALIDATION_FAILED,
          400,
        );
      }

      if (!ALLOWED_ACTIONS.includes(perm.action as AllowedAction)) {
        return new AppError(
          `Invalid action: ${perm.action}`,
          ERROR_CODES.VALIDATION_FAILED,
          400,
        );
      }

      if (!ALLOWED_SCOPES.includes(perm.scope as AllowedScope)) {
        return new AppError(
          `Invalid scope: ${perm.scope}`,
          ERROR_CODES.VALIDATION_FAILED,
          400,
        );
      }
    }

    return null;
  }
}
