import { describe, it, expect, beforeEach } from 'vitest';
import { OrganizationManager, InMemoryOrgStore } from '../organization.js';

// ─── Test Helpers ──────────────────────────────────────────────────

function createTestSetup() {
  const store = new InMemoryOrgStore();
  const manager = new OrganizationManager(store);
  return { store, manager };
}

// ─── CRUD Tests ───────────────────────────────────────────────────

describe('OrganizationManager CRUD', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('creates a root organization', async () => {
    const result = await setup.manager.createOrganization('tenant-001', {
      name: 'Acme Corp',
      slug: 'acme-corp',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Acme Corp');
      expect(result.data.slug).toBe('acme-corp');
      expect(result.data.parentId).toBeNull();
      expect(result.data.tenantId).toBe('tenant-001');
    }
  });

  it('creates a child organization', async () => {
    const parent = await setup.manager.createOrganization('tenant-001', {
      name: 'Parent',
      slug: 'parent',
    });
    expect(parent.success).toBe(true);
    if (!parent.success) return;

    const child = await setup.manager.createOrganization('tenant-001', {
      name: 'Child',
      slug: 'child',
      parentId: parent.data.id,
    });
    expect(child.success).toBe(true);
    if (child.success) {
      expect(child.data.parentId).toBe(parent.data.id);
    }
  });

  it('gets an organization by ID', async () => {
    const created = await setup.manager.createOrganization('tenant-001', {
      name: 'Test Org',
      slug: 'test-org',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.manager.getOrganization('tenant-001', created.data.id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Test Org');
    }
  });

  it('returns 404 for non-existent org', async () => {
    const result = await setup.manager.getOrganization('tenant-001', 'no-such');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(404);
    }
  });

  it('lists organizations for a tenant', async () => {
    await setup.manager.createOrganization('tenant-001', { name: 'Org 1', slug: 'org-1' });
    await setup.manager.createOrganization('tenant-001', { name: 'Org 2', slug: 'org-2' });

    const result = await setup.manager.listOrganizations('tenant-001');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('updates an organization', async () => {
    const created = await setup.manager.createOrganization('tenant-001', {
      name: 'Old Name',
      slug: 'old-name',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.manager.updateOrganization(
      'tenant-001',
      created.data.id,
      { name: 'New Name' },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('New Name');
      expect(result.data.slug).toBe('old-name'); // Unchanged
    }
  });

  it('deletes an organization without children', async () => {
    const created = await setup.manager.createOrganization('tenant-001', {
      name: 'To Delete',
      slug: 'to-delete',
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.manager.deleteOrganization('tenant-001', created.data.id);
    expect(result.success).toBe(true);

    const lookup = await setup.manager.getOrganization('tenant-001', created.data.id);
    expect(lookup.success).toBe(false);
  });

  it('fails to delete an organization with children', async () => {
    const parent = await setup.manager.createOrganization('tenant-001', {
      name: 'Parent',
      slug: 'parent',
    });
    expect(parent.success).toBe(true);
    if (!parent.success) return;

    await setup.manager.createOrganization('tenant-001', {
      name: 'Child',
      slug: 'child',
      parentId: parent.data.id,
    });

    const result = await setup.manager.deleteOrganization('tenant-001', parent.data.id);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(409);
    }
  });
});

// ─── Slug Uniqueness Tests ────────────────────────────────────────

describe('OrganizationManager slug uniqueness', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('rejects duplicate slug within same tenant', async () => {
    await setup.manager.createOrganization('tenant-001', {
      name: 'First',
      slug: 'engineering',
    });

    const result = await setup.manager.createOrganization('tenant-001', {
      name: 'Second',
      slug: 'engineering',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(409);
    }
  });

  it('rejects invalid slug format', async () => {
    const result = await setup.manager.createOrganization('tenant-001', {
      name: 'Bad Slug',
      slug: 'UPPERCASE',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('accepts valid slug format', async () => {
    const result = await setup.manager.createOrganization('tenant-001', {
      name: 'Good Slug',
      slug: 'valid-slug-123',
    });
    expect(result.success).toBe(true);
  });
});

// ─── Hierarchy Tests ──────────────────────────────────────────────

describe('OrganizationManager hierarchy', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('builds a full org hierarchy tree', async () => {
    const root = await setup.manager.createOrganization('tenant-001', {
      name: 'Root',
      slug: 'root',
    });
    expect(root.success).toBe(true);
    if (!root.success) return;

    const childA = await setup.manager.createOrganization('tenant-001', {
      name: 'Child A',
      slug: 'child-a',
      parentId: root.data.id,
    });
    expect(childA.success).toBe(true);

    const childB = await setup.manager.createOrganization('tenant-001', {
      name: 'Child B',
      slug: 'child-b',
      parentId: root.data.id,
    });
    expect(childB.success).toBe(true);

    const result = await setup.manager.getOrgHierarchy('tenant-001', root.data.id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.org.name).toBe('Root');
      expect(result.data.children).toHaveLength(2);
    }
  });

  it('returns 404 for hierarchy of non-existent root', async () => {
    const result = await setup.manager.getOrgHierarchy('tenant-001', 'no-such');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(404);
    }
  });
});

// ─── getUsersByOrg Tests ──────────────────────────────────────────

describe('OrganizationManager.getUsersByOrg', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('returns direct users for an org', async () => {
    const org = await setup.manager.createOrganization('tenant-001', {
      name: 'Team A',
      slug: 'team-a',
    });
    expect(org.success).toBe(true);
    if (!org.success) return;

    setup.store.addUserToOrg('tenant-001', org.data.id, 'user-1');
    setup.store.addUserToOrg('tenant-001', org.data.id, 'user-2');

    const result = await setup.manager.getUsersByOrg('tenant-001', org.data.id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data).toContain('user-1');
      expect(result.data).toContain('user-2');
    }
  });

  it('includes users from child orgs when includeChildren=true', async () => {
    const parent = await setup.manager.createOrganization('tenant-001', {
      name: 'Parent',
      slug: 'parent',
    });
    expect(parent.success).toBe(true);
    if (!parent.success) return;

    const child = await setup.manager.createOrganization('tenant-001', {
      name: 'Child',
      slug: 'child',
      parentId: parent.data.id,
    });
    expect(child.success).toBe(true);
    if (!child.success) return;

    setup.store.addUserToOrg('tenant-001', parent.data.id, 'user-parent');
    setup.store.addUserToOrg('tenant-001', child.data.id, 'user-child');

    const result = await setup.manager.getUsersByOrg('tenant-001', parent.data.id, true);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toContain('user-parent');
      expect(result.data).toContain('user-child');
    }
  });

  it('returns 404 for non-existent org', async () => {
    const result = await setup.manager.getUsersByOrg('tenant-001', 'no-such');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(404);
    }
  });
});
