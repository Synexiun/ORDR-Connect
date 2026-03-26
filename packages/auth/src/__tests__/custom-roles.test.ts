import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomRoleManager, InMemoryRoleStore } from '../custom-roles.js';
import type { CreateRoleInput, RoleAuditLogger } from '../custom-roles.js';
import type { Permission } from '@ordr/core';

// ─── Test Helpers ──────────────────────────────────────────────────

function createTestSetup() {
  const store = new InMemoryRoleStore();
  const auditLogger: RoleAuditLogger = {
    log: vi.fn().mockResolvedValue(undefined),
  };
  const manager = new CustomRoleManager(store, auditLogger);

  return { store, auditLogger, manager };
}

function makeRoleInput(overrides: Partial<CreateRoleInput> = {}): CreateRoleInput {
  return {
    name: 'Support Lead',
    description: 'Extended support permissions',
    baseRole: 'agent',
    permissions: [
      { resource: 'customers', action: 'read', scope: 'team' },
      { resource: 'customers', action: 'update', scope: 'team' },
    ],
    ...overrides,
  };
}

// ─── Role Creation Tests ──────────────────────────────────────────

describe('CustomRoleManager.createRole', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('creates a custom role', async () => {
    const result = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Support Lead');
      expect(result.data.baseRole).toBe('agent');
      expect(result.data.permissions).toHaveLength(2);
      expect(result.data.tenantId).toBe('tenant-001');
      expect(result.data.createdBy).toBe('admin-001');
    }
  });

  it('audit logs role creation (SOC2 CC6.2)', async () => {
    await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());

    expect(setup.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-001',
        eventType: 'role.created',
        actorId: 'admin-001',
        resource: 'role',
        action: 'create',
      }),
    );
  });

  it('rejects duplicate name within tenant', async () => {
    await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    const result = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(409);
    }
  });

  it('allows same name in different tenants', async () => {
    const r1 = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    const r2 = await setup.manager.createRole('tenant-002', 'admin-002', makeRoleInput());

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('rejects empty name', async () => {
    const result = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput({
      name: '',
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('rejects name over 100 characters', async () => {
    const result = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput({
      name: 'x'.repeat(101),
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });
});

// ─── Permission Validation Tests ──────────────────────────────────

describe('CustomRoleManager permission validation', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('accepts valid permissions', async () => {
    const result = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput({
      permissions: [
        { resource: 'customers', action: 'read', scope: 'tenant' },
        { resource: 'reports', action: 'execute', scope: 'team' },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it('rejects invalid resource', async () => {
    const result = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput({
      permissions: [
        { resource: 'nonexistent', action: 'read', scope: 'own' } as Permission,
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
      expect(result.error.message).toContain('nonexistent');
    }
  });

  it('rejects invalid action', async () => {
    const result = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput({
      permissions: [
        { resource: 'customers', action: 'destroy' as Permission['action'], scope: 'own' },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('rejects invalid scope', async () => {
    const result = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput({
      permissions: [
        { resource: 'customers', action: 'read', scope: 'universe' as Permission['scope'] },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });
});

// ─── CRUD Tests ───────────────────────────────────────────────────

describe('CustomRoleManager CRUD', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('gets a role by ID', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.manager.getRole('tenant-001', created.data.id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Support Lead');
    }
  });

  it('lists roles for a tenant', async () => {
    await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput({
      name: 'Manager Plus',
    }));

    const result = await setup.manager.listRoles('tenant-001');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('updates a role', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.manager.updateRole(
      'tenant-001',
      created.data.id,
      'admin-001',
      { name: 'Updated Name', description: 'Updated desc' },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Name');
      expect(result.data.description).toBe('Updated desc');
    }
  });

  it('deletes a role with no assignments', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.manager.deleteRole('tenant-001', created.data.id, 'admin-001');
    expect(result.success).toBe(true);
  });

  it('fails to delete a role with active assignments', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    await setup.manager.assignRole('tenant-001', 'user-001', created.data.id, 'admin-001');

    const result = await setup.manager.deleteRole('tenant-001', created.data.id, 'admin-001');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(409);
    }
  });
});

// ─── Assign/Revoke Tests ──────────────────────────────────────────

describe('CustomRoleManager assign/revoke', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('assigns a role to a user', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.manager.assignRole(
      'tenant-001',
      'user-001',
      created.data.id,
      'admin-001',
    );
    expect(result.success).toBe(true);
  });

  it('audit logs role assignment (SOC2 CC6.2)', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    await setup.manager.assignRole('tenant-001', 'user-001', created.data.id, 'admin-001');

    expect(setup.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'role.assigned',
        actorId: 'admin-001',
        action: 'assign',
      }),
    );
  });

  it('rejects duplicate assignment', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    await setup.manager.assignRole('tenant-001', 'user-001', created.data.id, 'admin-001');
    const result = await setup.manager.assignRole('tenant-001', 'user-001', created.data.id, 'admin-001');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(409);
    }
  });

  it('revokes a role from a user', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    await setup.manager.assignRole('tenant-001', 'user-001', created.data.id, 'admin-001');
    const result = await setup.manager.revokeRole(
      'tenant-001',
      'user-001',
      created.data.id,
      'admin-001',
    );
    expect(result.success).toBe(true);
  });

  it('audit logs role revocation (SOC2 CC6.2)', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    await setup.manager.assignRole('tenant-001', 'user-001', created.data.id, 'admin-001');
    await setup.manager.revokeRole('tenant-001', 'user-001', created.data.id, 'admin-001');

    expect(setup.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'role.revoked',
        action: 'revoke',
      }),
    );
  });

  it('fails to revoke non-assigned role', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput());
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.manager.revokeRole(
      'tenant-001',
      'user-001',
      created.data.id,
      'admin-001',
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(404);
    }
  });
});

// ─── Merged Permissions Tests ─────────────────────────────────────

describe('CustomRoleManager.getUserPermissions', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('returns built-in permissions for user with no custom roles', async () => {
    const result = await setup.manager.getUserPermissions('tenant-001', 'user-001', 'agent');
    expect(result.success).toBe(true);
    if (result.success) {
      // Agent has default permissions from ROLE_PERMISSIONS
      expect(result.data.length).toBeGreaterThan(0);
    }
  });

  it('merges built-in and custom role permissions', async () => {
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput({
      permissions: [
        { resource: 'reports', action: 'read', scope: 'team' },
        { resource: 'reports', action: 'execute', scope: 'team' },
      ],
    }));
    expect(created.success).toBe(true);
    if (!created.success) return;

    await setup.manager.assignRole('tenant-001', 'user-001', created.data.id, 'admin-001');

    const result = await setup.manager.getUserPermissions('tenant-001', 'user-001', 'agent');
    expect(result.success).toBe(true);
    if (result.success) {
      // Should include both built-in agent permissions AND custom role permissions
      const reportPerms = result.data.filter((p) => p.resource === 'reports');
      expect(reportPerms.length).toBeGreaterThan(0);
    }
  });

  it('deduplicates overlapping permissions', async () => {
    // Create a role with a permission that already exists in the agent defaults
    const created = await setup.manager.createRole('tenant-001', 'admin-001', makeRoleInput({
      permissions: [
        { resource: 'customers', action: 'read', scope: 'own' }, // Already in agent defaults
      ],
    }));
    expect(created.success).toBe(true);
    if (!created.success) return;

    await setup.manager.assignRole('tenant-001', 'user-001', created.data.id, 'admin-001');

    const result = await setup.manager.getUserPermissions('tenant-001', 'user-001', 'agent');
    expect(result.success).toBe(true);
    if (result.success) {
      // Should not have duplicate customers:read:own
      const customerReadOwn = result.data.filter(
        (p) => p.resource === 'customers' && p.action === 'read' && p.scope === 'own',
      );
      expect(customerReadOwn).toHaveLength(1);
    }
  });
});
