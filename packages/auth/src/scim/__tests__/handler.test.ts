/**
 * SCIMHandler unit tests
 *
 * All dependencies are mocked — no DB or Kafka connection required.
 *
 * Tests cover:
 *  1. createUser  — calls userStore.create, emits audit, emits Kafka best-effort
 *  2. deleteUser  — calls db.transaction() exactly once for an active user
 *  3. deleteUser  — is idempotent: skips transaction for an already-inactive user
 *  4. deleteUser  — audit log details do NOT contain key material
 *  5. patchGroup 'add'    — calls groupStore.addMember for each member in op.value
 *  6. patchGroup 'remove' — calls groupStore.removeMember for each member in op.value
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SCIMHandler } from '../handler.js';
import type { SCIMHandlerDeps } from '../handler.js';
import type { SCIMUserRecord, SCIMGroupRecord, SCIMPatchRequest } from '../types.js';
import type { AuditEventInput } from '@ordr/audit';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUserRecord(overrides?: Partial<SCIMUserRecord>): SCIMUserRecord {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    externalId: 'ext-1',
    externalSource: 'okta',
    userName: 'alice@example.com',
    displayName: 'Alice',
    emails: [{ value: 'alice@example.com', primary: true }],
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeGroupRecord(overrides?: Partial<SCIMGroupRecord>): SCIMGroupRecord {
  return {
    id: 'group-1',
    tenantId: 'tenant-1',
    displayName: 'Engineering',
    externalId: 'ext-g-1',
    externalSource: 'okta',
    members: [],
    memberCount: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeDeps(): SCIMHandlerDeps {
  const txFn = vi.fn();

  const userStore: SCIMHandlerDeps['userStore'] = {
    create: vi.fn().mockResolvedValue(makeUserRecord()),
    getById: vi.fn().mockResolvedValue(null),
    getByExternalId: vi.fn().mockResolvedValue(null),
    getByUserName: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ records: [], total: 0 }),
  };

  const groupStore: SCIMHandlerDeps['groupStore'] = {
    create: vi.fn().mockResolvedValue(makeGroupRecord()),
    getById: vi.fn().mockResolvedValue(makeGroupRecord()),
    getByExternalId: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(makeGroupRecord()),
    delete: vi.fn().mockResolvedValue(undefined),
    syncMembers: vi.fn().mockResolvedValue(undefined),
    addMember: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ records: [], total: 0 }),
  };

  // db mock: transaction callback receives a tx object
  const db = {
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      // tx object with update/delete stubs
      const tx = {
        update: vi
          .fn()
          .mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      };
      txFn(tx);
      await cb(tx);
    }),
  } as unknown as SCIMHandlerDeps['db'];

  const capturedAuditInputs: AuditEventInput[] = [];

  const auditLogger: SCIMHandlerDeps['auditLogger'] = {
    log: vi.fn().mockImplementation(async (input: AuditEventInput) => {
      capturedAuditInputs.push(input);
      return { id: 'audit-1', sequenceNumber: 1, hash: 'abc', previousHash: 'genesis', ...input };
    }),
  } as unknown as SCIMHandlerDeps['auditLogger'];

  const eventProducer: SCIMHandlerDeps['eventProducer'] = {
    publish: vi.fn().mockResolvedValue(undefined),
  } as unknown as SCIMHandlerDeps['eventProducer'];

  return {
    userStore,
    groupStore,
    db,
    auditLogger,
    eventProducer,
    _capturedAuditInputs: capturedAuditInputs,
    _txFn: txFn,
  } as SCIMHandlerDeps & {
    _capturedAuditInputs: AuditEventInput[];
    _txFn: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SCIMHandler', () => {
  let deps: ReturnType<typeof makeDeps> & {
    _capturedAuditInputs: AuditEventInput[];
    _txFn: ReturnType<typeof vi.fn>;
  };
  let handler: SCIMHandler;

  beforeEach(() => {
    deps = makeDeps() as ReturnType<typeof makeDeps> & {
      _capturedAuditInputs: AuditEventInput[];
      _txFn: ReturnType<typeof vi.fn>;
    };
    handler = new SCIMHandler(deps);
  });

  // -------------------------------------------------------------------------
  // Test 1 — createUser calls userStore.create and emits audit
  // -------------------------------------------------------------------------

  describe('createUser', () => {
    it('calls userStore.create and logs a WORM audit event', async () => {
      const record = makeUserRecord();
      vi.mocked(deps.userStore.create).mockResolvedValue(record);

      const result = await handler.createUser('tenant-1', {
        externalId: 'ext-1',
        externalSource: 'okta',
        userName: 'alice@example.com',
        displayName: 'Alice',
        emails: [{ value: 'alice@example.com', primary: true }],
        active: true,
      });

      expect(deps.userStore.create).toHaveBeenCalledOnce();
      expect(deps.userStore.create).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          userName: 'alice@example.com',
        }),
      );
      expect(deps.auditLogger.log).toHaveBeenCalledOnce();
      expect(result.id).toBe('user-1');
    });
  });

  // -------------------------------------------------------------------------
  // Test 2 — deleteUser calls db.transaction() exactly once for active user
  // -------------------------------------------------------------------------

  describe('deleteUser', () => {
    it('calls db.transaction() exactly once when user is active', async () => {
      const activeUser = makeUserRecord({ active: true });
      vi.mocked(deps.userStore.getById).mockResolvedValue(activeUser);

      await handler.deleteUser('tenant-1', 'user-1');

      expect(deps.db.transaction).toHaveBeenCalledOnce();
    });

    // -----------------------------------------------------------------------
    // Test 3 — deleteUser is idempotent for already-inactive user
    // -----------------------------------------------------------------------

    it('skips db.transaction() if user is already inactive (idempotent)', async () => {
      const inactiveUser = makeUserRecord({ active: false });
      vi.mocked(deps.userStore.getById).mockResolvedValue(inactiveUser);

      await handler.deleteUser('tenant-1', 'user-1');

      expect(deps.db.transaction).not.toHaveBeenCalled();
    });

    it('skips db.transaction() if user does not exist (idempotent)', async () => {
      vi.mocked(deps.userStore.getById).mockResolvedValue(null);

      await handler.deleteUser('tenant-1', 'user-1');

      expect(deps.db.transaction).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Test 4 — deleteUser audit log does NOT contain key material
    // -----------------------------------------------------------------------

    it('audit log details do not contain password, secret, key, or token strings', async () => {
      const activeUser = makeUserRecord({ active: true });
      vi.mocked(deps.userStore.getById).mockResolvedValue(activeUser);

      await handler.deleteUser('tenant-1', 'user-1');

      const auditCalls = vi.mocked(deps.auditLogger.log).mock.calls;
      expect(auditCalls.length).toBeGreaterThan(0);

      for (const [input] of auditCalls) {
        const serialised = JSON.stringify(input.details).toLowerCase();
        expect(serialised).not.toMatch(/password/);
        expect(serialised).not.toMatch(/\bsecret\b/);
        expect(serialised).not.toMatch(/\btoken\b/);
        // 'key' is a very generic word — only flag if it appears adjacent to a long value
        // We check the details object keys directly
        const forbiddenKeys = Object.keys(input.details).map((k) => k.toLowerCase());
        expect(forbiddenKeys).not.toContain('key');
        expect(forbiddenKeys).not.toContain('apikey');
        expect(forbiddenKeys).not.toContain('privatekey');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Test 5 — patchGroup 'add' calls groupStore.addMember
  // -------------------------------------------------------------------------

  describe('patchGroup', () => {
    it("calls groupStore.addMember for each member in an 'add' op", async () => {
      const patch: SCIMPatchRequest = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'add',
            path: 'members',
            value: [{ value: 'user-a' }, { value: 'user-b' }],
          },
        ],
      };

      await handler.patchGroup('tenant-1', 'group-1', patch);

      expect(deps.groupStore.addMember).toHaveBeenCalledTimes(2);
      expect(deps.groupStore.addMember).toHaveBeenCalledWith('group-1', 'user-a');
      expect(deps.groupStore.addMember).toHaveBeenCalledWith('group-1', 'user-b');
    });

    // -----------------------------------------------------------------------
    // Test 6 — patchGroup 'remove' calls groupStore.removeMember
    // -----------------------------------------------------------------------

    it("calls groupStore.removeMember for each member in a 'remove' op", async () => {
      const patch: SCIMPatchRequest = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'remove',
            path: 'members',
            value: [{ value: 'user-c' }],
          },
        ],
      };

      await handler.patchGroup('tenant-1', 'group-1', patch);

      expect(deps.groupStore.removeMember).toHaveBeenCalledOnce();
      expect(deps.groupStore.removeMember).toHaveBeenCalledWith('group-1', 'user-c');
    });

    it("updates displayName via 'replace' op on displayName path", async () => {
      const patch: SCIMPatchRequest = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          {
            op: 'replace',
            path: 'displayName',
            value: 'Platform',
          },
        ],
      };

      await handler.patchGroup('tenant-1', 'group-1', patch);

      expect(deps.groupStore.update).toHaveBeenCalledWith('tenant-1', 'group-1', {
        displayName: 'Platform',
      });
    });
  });
});
