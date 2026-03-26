import { describe, it, expect } from 'vitest';
import type { UserRole, Permission, TenantContext, TenantId } from '@ordr/core';
import {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  hasRole,
  hasPermission,
  checkAccess,
} from '../rbac.js';

// ─── Test Helpers ──────────────────────────────────────────────────

function makeContext(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 'tenant-001' as TenantId,
    userId: 'user-001',
    roles: ['agent'],
    permissions: [],
    ...overrides,
  };
}

function perm(resource: string, action: Permission['action'], scope: Permission['scope']): Permission {
  return { resource, action, scope };
}

// ─── Role Hierarchy Tests ──────────────────────────────────────────

describe('ROLE_HIERARCHY', () => {
  it('should define numeric weights for all roles', () => {
    expect(ROLE_HIERARCHY.super_admin).toBe(100);
    expect(ROLE_HIERARCHY.tenant_admin).toBe(80);
    expect(ROLE_HIERARCHY.manager).toBe(60);
    expect(ROLE_HIERARCHY.agent).toBe(40);
    expect(ROLE_HIERARCHY.viewer).toBe(20);
  });

  it('should have strictly descending authority', () => {
    expect(ROLE_HIERARCHY.super_admin).toBeGreaterThan(ROLE_HIERARCHY.tenant_admin);
    expect(ROLE_HIERARCHY.tenant_admin).toBeGreaterThan(ROLE_HIERARCHY.manager);
    expect(ROLE_HIERARCHY.manager).toBeGreaterThan(ROLE_HIERARCHY.agent);
    expect(ROLE_HIERARCHY.agent).toBeGreaterThan(ROLE_HIERARCHY.viewer);
  });
});

describe('hasRole', () => {
  it('super_admin outranks all roles', () => {
    const roles: UserRole[] = ['super_admin', 'tenant_admin', 'manager', 'agent', 'viewer'];
    for (const role of roles) {
      expect(hasRole('super_admin', role)).toBe(true);
    }
  });

  it('tenant_admin outranks manager, agent, viewer', () => {
    expect(hasRole('tenant_admin', 'manager')).toBe(true);
    expect(hasRole('tenant_admin', 'agent')).toBe(true);
    expect(hasRole('tenant_admin', 'viewer')).toBe(true);
  });

  it('tenant_admin does NOT outrank super_admin', () => {
    expect(hasRole('tenant_admin', 'super_admin')).toBe(false);
  });

  it('manager outranks agent and viewer', () => {
    expect(hasRole('manager', 'agent')).toBe(true);
    expect(hasRole('manager', 'viewer')).toBe(true);
  });

  it('manager does NOT outrank tenant_admin or super_admin', () => {
    expect(hasRole('manager', 'tenant_admin')).toBe(false);
    expect(hasRole('manager', 'super_admin')).toBe(false);
  });

  it('agent outranks viewer only', () => {
    expect(hasRole('agent', 'viewer')).toBe(true);
    expect(hasRole('agent', 'manager')).toBe(false);
  });

  it('viewer does NOT outrank any other role', () => {
    expect(hasRole('viewer', 'agent')).toBe(false);
    expect(hasRole('viewer', 'manager')).toBe(false);
    expect(hasRole('viewer', 'tenant_admin')).toBe(false);
    expect(hasRole('viewer', 'super_admin')).toBe(false);
  });

  it('each role equals itself', () => {
    const roles: UserRole[] = ['super_admin', 'tenant_admin', 'manager', 'agent', 'viewer'];
    for (const role of roles) {
      expect(hasRole(role, role)).toBe(true);
    }
  });
});

// ─── Permission Checking Tests ─────────────────────────────────────

describe('hasPermission', () => {
  it('should match exact resource + action + scope', () => {
    const permissions: Permission[] = [
      perm('customers', 'read', 'tenant'),
    ];

    expect(hasPermission(permissions, perm('customers', 'read', 'tenant'))).toBe(true);
  });

  it('should NOT match wrong resource', () => {
    const permissions: Permission[] = [
      perm('customers', 'read', 'tenant'),
    ];

    expect(hasPermission(permissions, perm('interactions', 'read', 'tenant'))).toBe(false);
  });

  it('should NOT match wrong action', () => {
    const permissions: Permission[] = [
      perm('customers', 'read', 'tenant'),
    ];

    expect(hasPermission(permissions, perm('customers', 'update', 'tenant'))).toBe(false);
  });

  it('should allow broader scope to satisfy narrower scope requirement', () => {
    const permissions: Permission[] = [
      perm('customers', 'read', 'tenant'), // tenant scope
    ];

    // Tenant scope satisfies 'own' scope requirement
    expect(hasPermission(permissions, perm('customers', 'read', 'own'))).toBe(true);
    // Tenant scope satisfies 'team' scope requirement
    expect(hasPermission(permissions, perm('customers', 'read', 'team'))).toBe(true);
  });

  it('should NOT allow narrower scope to satisfy broader scope requirement', () => {
    const permissions: Permission[] = [
      perm('customers', 'read', 'own'), // own scope only
    ];

    // Own scope does NOT satisfy 'tenant' scope requirement
    expect(hasPermission(permissions, perm('customers', 'read', 'tenant'))).toBe(false);
    // Own scope does NOT satisfy 'global' scope requirement
    expect(hasPermission(permissions, perm('customers', 'read', 'global'))).toBe(false);
  });

  it('global scope satisfies all scope requirements', () => {
    const permissions: Permission[] = [
      perm('customers', 'read', 'global'),
    ];

    expect(hasPermission(permissions, perm('customers', 'read', 'global'))).toBe(true);
    expect(hasPermission(permissions, perm('customers', 'read', 'tenant'))).toBe(true);
    expect(hasPermission(permissions, perm('customers', 'read', 'team'))).toBe(true);
    expect(hasPermission(permissions, perm('customers', 'read', 'own'))).toBe(true);
  });

  it('should check against all permissions in the array', () => {
    const permissions: Permission[] = [
      perm('customers', 'read', 'tenant'),
      perm('interactions', 'create', 'own'),
      perm('reports', 'execute', 'team'),
    ];

    expect(hasPermission(permissions, perm('customers', 'read', 'own'))).toBe(true);
    expect(hasPermission(permissions, perm('interactions', 'create', 'own'))).toBe(true);
    expect(hasPermission(permissions, perm('reports', 'execute', 'own'))).toBe(true);
  });

  it('should return false for empty permissions array', () => {
    expect(hasPermission([], perm('customers', 'read', 'own'))).toBe(false);
  });
});

// ─── ROLE_PERMISSIONS Tests ────────────────────────────────────────

describe('ROLE_PERMISSIONS', () => {
  it('super_admin has permissions for all resources with global scope', () => {
    const superPerms = ROLE_PERMISSIONS.super_admin;
    expect(superPerms.length).toBeGreaterThan(0);

    // Check that every permission is global scope
    for (const p of superPerms) {
      expect(p.scope).toBe('global');
    }
  });

  it('tenant_admin has permissions for all resources with tenant scope', () => {
    const tenantPerms = ROLE_PERMISSIONS.tenant_admin;
    expect(tenantPerms.length).toBeGreaterThan(0);

    for (const p of tenantPerms) {
      expect(p.scope).toBe('tenant');
    }
  });

  it('manager has team-scoped permissions for customers, interactions, agents', () => {
    const managerPerms = ROLE_PERMISSIONS.manager;
    const resources = new Set(managerPerms.map((p) => p.resource));

    expect(resources.has('customers')).toBe(true);
    expect(resources.has('interactions')).toBe(true);
    expect(resources.has('agents')).toBe(true);
  });

  it('agent has own-scoped permissions for customers and interactions', () => {
    const agentPerms = ROLE_PERMISSIONS.agent;
    const resources = new Set(agentPerms.map((p) => p.resource));

    expect(resources.has('customers')).toBe(true);
    expect(resources.has('interactions')).toBe(true);
    // Agent should NOT have access to tenants, billing, settings, etc.
    expect(resources.has('tenants')).toBe(false);
    expect(resources.has('billing')).toBe(false);
  });

  it('agent cannot delete resources', () => {
    const agentPerms = ROLE_PERMISSIONS.agent;
    const deletePerms = agentPerms.filter((p) => p.action === 'delete');
    expect(deletePerms).toHaveLength(0);
  });

  it('viewer can only read', () => {
    const viewerPerms = ROLE_PERMISSIONS.viewer;

    for (const p of viewerPerms) {
      expect(p.action).toBe('read');
    }
  });

  it('viewer cannot write (create, update, delete)', () => {
    const viewerPerms = ROLE_PERMISSIONS.viewer;
    const writePerms = viewerPerms.filter(
      (p) => p.action === 'create' || p.action === 'update' || p.action === 'delete',
    );
    expect(writePerms).toHaveLength(0);
  });
});

// ─── checkAccess (Full RBAC) Tests ─────────────────────────────────

describe('checkAccess', () => {
  it('super_admin can access any resource', () => {
    const ctx = makeContext({ roles: ['super_admin'] });

    expect(checkAccess(ctx, 'customers', 'read')).toBe(true);
    expect(checkAccess(ctx, 'billing', 'delete')).toBe(true);
    expect(checkAccess(ctx, 'tenants', 'create')).toBe(true);
    expect(checkAccess(ctx, 'compliance', 'execute')).toBe(true);
  });

  it('tenant_admin can access all resources within tenant', () => {
    const ctx = makeContext({ roles: ['tenant_admin'] });

    expect(checkAccess(ctx, 'customers', 'read')).toBe(true);
    expect(checkAccess(ctx, 'customers', 'create')).toBe(true);
    expect(checkAccess(ctx, 'customers', 'delete')).toBe(true);
    expect(checkAccess(ctx, 'users', 'create')).toBe(true);
  });

  it('agent can read and update customers they own', () => {
    const ctx = makeContext({
      roles: ['agent'],
      userId: 'agent-001',
    });

    expect(checkAccess(ctx, 'customers', 'read')).toBe(true);
    expect(checkAccess(ctx, 'customers', 'create')).toBe(true);
    expect(checkAccess(ctx, 'customers', 'update')).toBe(true);
  });

  it('agent cannot access other agent resources when ownership enforced', () => {
    const ctx = makeContext({
      roles: ['agent'],
      userId: 'agent-001',
    });

    // Agent has 'own' scope — when checking with a different owner, should fail
    // The checkAccess function checks ownership for 'own' scope when resourceOwnerId is provided
    expect(checkAccess(ctx, 'customers', 'update', 'agent-002')).toBe(false);
  });

  it('agent can access own resources when ownership matches', () => {
    const ctx = makeContext({
      roles: ['agent'],
      userId: 'agent-001',
    });

    expect(checkAccess(ctx, 'customers', 'update', 'agent-001')).toBe(true);
  });

  it('viewer cannot create or update resources', () => {
    const ctx = makeContext({ roles: ['viewer'] });

    expect(checkAccess(ctx, 'customers', 'create')).toBe(false);
    expect(checkAccess(ctx, 'customers', 'update')).toBe(false);
    expect(checkAccess(ctx, 'customers', 'delete')).toBe(false);
  });

  it('viewer can read customers and interactions', () => {
    const ctx = makeContext({ roles: ['viewer'] });

    expect(checkAccess(ctx, 'customers', 'read')).toBe(true);
    expect(checkAccess(ctx, 'interactions', 'read')).toBe(true);
  });

  it('agent cannot access billing or settings', () => {
    const ctx = makeContext({ roles: ['agent'] });

    expect(checkAccess(ctx, 'billing', 'read')).toBe(false);
    expect(checkAccess(ctx, 'settings', 'read')).toBe(false);
  });

  it('manager can manage team resources', () => {
    const ctx = makeContext({ roles: ['manager'] });

    expect(checkAccess(ctx, 'customers', 'create')).toBe(true);
    expect(checkAccess(ctx, 'customers', 'read')).toBe(true);
    expect(checkAccess(ctx, 'customers', 'update')).toBe(true);
    expect(checkAccess(ctx, 'customers', 'delete')).toBe(true);
    expect(checkAccess(ctx, 'interactions', 'create')).toBe(true);
    expect(checkAccess(ctx, 'agents', 'read')).toBe(true);
  });
});
