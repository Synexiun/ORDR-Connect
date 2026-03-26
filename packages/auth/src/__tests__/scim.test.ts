import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SCIMHandler,
  InMemoryUserStore,
  InMemoryGroupStore,
  InMemorySCIMTokenStore,
  verifySCIMToken,
  SCIM_SCHEMAS,
} from '../scim.js';
import type { SCIMUser, SCIMGroup, SessionRevoker } from '../scim.js';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { sha256 } from '@ordr/crypto';

// ─── Test Helpers ──────────────────────────────────────────────────

function createTestSetup() {
  const userStore = new InMemoryUserStore();
  const groupStore = new InMemoryGroupStore();
  const auditStore = new InMemoryAuditStore();
  const auditLogger = new AuditLogger(auditStore);
  const sessionRevoker: SessionRevoker = {
    revokeByUserId: vi.fn().mockResolvedValue(undefined),
  };

  const handler = new SCIMHandler({
    userStore,
    groupStore,
    sessionRevoker,
    auditLogger,
  });

  return { userStore, groupStore, auditLogger, sessionRevoker, handler };
}

function makeScimUser(overrides: Partial<SCIMUser> = {}): SCIMUser {
  return {
    schemas: [SCIM_SCHEMAS.USER],
    userName: 'alice@corp.test',
    name: { givenName: 'Alice', familyName: 'Smith' },
    emails: [{ value: 'alice@corp.test', primary: true }],
    active: true,
    externalId: 'ext-001',
    ...overrides,
  };
}

function makeScimGroup(overrides: Partial<SCIMGroup> = {}): SCIMGroup {
  return {
    schemas: [SCIM_SCHEMAS.GROUP],
    displayName: 'Engineering',
    members: [{ value: 'user-1', display: 'User 1' }],
    ...overrides,
  };
}

// ─── User Creation Tests ──────────────────────────────────────────

describe('SCIMHandler.handleCreateUser', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('creates a user from SCIM payload', async () => {
    const result = await setup.handler.handleCreateUser('tenant-001', makeScimUser());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userName).toBe('alice@corp.test');
      expect(result.data.name.givenName).toBe('Alice');
      expect(result.data.name.familyName).toBe('Smith');
      expect(result.data.active).toBe(true);
      expect(result.data.meta.resourceType).toBe('User');
      expect(result.data.schemas).toContain(SCIM_SCHEMAS.USER);
    }
  });

  it('maps SCIM attributes to ORDR user fields', async () => {
    const result = await setup.handler.handleCreateUser('tenant-001', makeScimUser({
      userName: 'bob@corp.test',
      name: { givenName: 'Bob', familyName: 'Jones' },
      emails: [{ value: 'bob@corp.test', primary: true }],
      externalId: 'ext-bob',
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userName).toBe('bob@corp.test');
      expect(result.data.emails[0]?.value).toBe('bob@corp.test');
      expect(result.data.externalId).toBe('ext-bob');
    }
  });

  it('rejects duplicate externalId', async () => {
    await setup.handler.handleCreateUser('tenant-001', makeScimUser({ externalId: 'dup-ext' }));
    const result = await setup.handler.handleCreateUser('tenant-001', makeScimUser({
      userName: 'other@corp.test',
      externalId: 'dup-ext',
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(409);
    }
  });

  it('rejects empty userName', async () => {
    const result = await setup.handler.handleCreateUser('tenant-001', makeScimUser({
      userName: '',
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('rejects empty tenant ID', async () => {
    const result = await setup.handler.handleCreateUser('', makeScimUser());
    expect(result.success).toBe(false);
  });
});

// ─── User Update Tests ────────────────────────────────────────────

describe('SCIMHandler.handleUpdateUser', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('updates user attributes from IdP push', async () => {
    const created = await setup.handler.handleCreateUser('tenant-001', makeScimUser());
    expect(created.success).toBe(true);
    if (!created.success) return;

    const updated = await setup.handler.handleUpdateUser(
      'tenant-001',
      created.data.id,
      makeScimUser({
        userName: 'alice-updated@corp.test',
        name: { givenName: 'Alice', familyName: 'Johnson' },
        emails: [{ value: 'alice-updated@corp.test', primary: true }],
      }),
    );

    expect(updated.success).toBe(true);
    if (updated.success) {
      expect(updated.data.userName).toBe('alice-updated@corp.test');
      expect(updated.data.name.familyName).toBe('Johnson');
    }
  });

  it('returns 404 for non-existent user', async () => {
    const result = await setup.handler.handleUpdateUser(
      'tenant-001',
      'no-such-user',
      makeScimUser(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(404);
    }
  });
});

// ─── User Deactivation Tests ──────────────────────────────────────

describe('SCIMHandler.handleDeactivateUser', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('deactivates a user (soft delete)', async () => {
    const created = await setup.handler.handleCreateUser('tenant-001', makeScimUser());
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.handler.handleDeactivateUser('tenant-001', created.data.id);
    expect(result.success).toBe(true);
  });

  it('revokes ALL active sessions on deactivation', async () => {
    const created = await setup.handler.handleCreateUser('tenant-001', makeScimUser());
    expect(created.success).toBe(true);
    if (!created.success) return;

    await setup.handler.handleDeactivateUser('tenant-001', created.data.id);

    expect(setup.sessionRevoker.revokeByUserId).toHaveBeenCalledWith(created.data.id);
  });

  it('returns 404 for non-existent user', async () => {
    const result = await setup.handler.handleDeactivateUser('tenant-001', 'no-such');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(404);
    }
  });
});

// ─── User List Tests ──────────────────────────────────────────────

describe('SCIMHandler.handleListUsers', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('lists users with pagination', async () => {
    await setup.handler.handleCreateUser('tenant-001', makeScimUser({ externalId: 'e1' }));
    await setup.handler.handleCreateUser('tenant-001', makeScimUser({
      userName: 'bob@corp.test',
      externalId: 'e2',
    }));

    const result = await setup.handler.handleListUsers('tenant-001', undefined, 1, 10);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalResults).toBe(2);
      expect(result.data.Resources).toHaveLength(2);
      expect(result.data.schemas).toContain(SCIM_SCHEMAS.LIST);
    }
  });

  it('supports filter by userName', async () => {
    await setup.handler.handleCreateUser('tenant-001', makeScimUser({ externalId: 'e1' }));
    await setup.handler.handleCreateUser('tenant-001', makeScimUser({
      userName: 'bob@corp.test',
      emails: [{ value: 'bob@corp.test', primary: true }],
      externalId: 'e2',
    }));

    const result = await setup.handler.handleListUsers(
      'tenant-001',
      'userName eq "bob@corp.test"',
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalResults).toBe(1);
    }
  });

  it('returns empty list for tenant with no users', async () => {
    const result = await setup.handler.handleListUsers('tenant-empty');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalResults).toBe(0);
      expect(result.data.Resources).toHaveLength(0);
    }
  });
});

// ─── Get User Tests ───────────────────────────────────────────────

describe('SCIMHandler.handleGetUser', () => {
  it('gets a user by ID', async () => {
    const setup = createTestSetup();
    const created = await setup.handler.handleCreateUser('tenant-001', makeScimUser());
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await setup.handler.handleGetUser('tenant-001', created.data.id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(created.data.id);
      expect(result.data.userName).toBe('alice@corp.test');
    }
  });
});

// ─── Group Tests ──────────────────────────────────────────────────

describe('SCIMHandler group management', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('creates a group from SCIM payload', async () => {
    const result = await setup.handler.handleCreateGroup('tenant-001', makeScimGroup());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe('Engineering');
      expect(result.data.schemas).toContain(SCIM_SCHEMAS.GROUP);
      expect(result.data.meta.resourceType).toBe('Group');
    }
  });

  it('updates a group', async () => {
    const created = await setup.handler.handleCreateGroup('tenant-001', makeScimGroup());
    expect(created.success).toBe(true);
    if (!created.success) return;

    const updated = await setup.handler.handleUpdateGroup(
      'tenant-001',
      created.data.id,
      makeScimGroup({ displayName: 'Platform' }),
    );
    expect(updated.success).toBe(true);
    if (updated.success) {
      expect(updated.data.displayName).toBe('Platform');
    }
  });

  it('returns 404 when updating non-existent group', async () => {
    const result = await setup.handler.handleUpdateGroup(
      'tenant-001',
      'no-such',
      makeScimGroup(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(404);
    }
  });

  it('rejects group creation with empty displayName', async () => {
    const result = await setup.handler.handleCreateGroup('tenant-001', makeScimGroup({
      displayName: '',
    }));
    expect(result.success).toBe(false);
  });
});

// ─── SCIM Token Verification Tests ───────────────────────────────

describe('verifySCIMToken', () => {
  it('verifies a valid token', async () => {
    const store = new InMemorySCIMTokenStore();
    const rawToken = 'scim-bearer-token-12345';
    const tokenHash = sha256(rawToken);

    store.addToken({
      id: 'token-001',
      tenantId: 'tenant-001',
      tokenHash,
      description: 'Test token',
      expiresAt: null,
      lastUsedAt: null,
    });

    const result = await verifySCIMToken(rawToken, store);
    expect(result).toBe('tenant-001');
  });

  it('returns null for invalid token', async () => {
    const store = new InMemorySCIMTokenStore();
    const result = await verifySCIMToken('bad-token', store);
    expect(result).toBeNull();
  });

  it('returns null for expired token', async () => {
    const store = new InMemorySCIMTokenStore();
    const rawToken = 'expired-token';
    const tokenHash = sha256(rawToken);

    store.addToken({
      id: 'token-exp',
      tenantId: 'tenant-001',
      tokenHash,
      description: 'Expired',
      expiresAt: new Date(Date.now() - 60_000), // Expired 1 minute ago
      lastUsedAt: null,
    });

    const result = await verifySCIMToken(rawToken, store);
    expect(result).toBeNull();
  });

  it('returns null for empty token', async () => {
    const store = new InMemorySCIMTokenStore();
    const result = await verifySCIMToken('', store);
    expect(result).toBeNull();
  });
});
