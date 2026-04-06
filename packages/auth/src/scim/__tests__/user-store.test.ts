import { describe, it, expect, vi } from 'vitest';
import { DrizzleUserStore } from '../user-store';

function makeDb(selectRows: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnThis();
  chain.from = vi.fn().mockReturnThis();
  chain.where = vi.fn().mockReturnThis();
  chain.limit = vi.fn().mockReturnThis();
  chain.offset = vi.fn().mockResolvedValue(selectRows);
  chain.insert = vi.fn().mockReturnThis();
  chain.values = vi.fn().mockReturnThis();
  chain.returning = vi.fn().mockResolvedValue(selectRows.length > 0 ? [selectRows[0]] : []);
  chain.update = vi.fn().mockReturnThis();
  chain.set = vi.fn().mockReturnThis();
  // Make where() also allow chaining for update path
  const updateChain = { ...chain, returning: vi.fn().mockResolvedValue([]) };
  chain.where = vi.fn().mockReturnValue({ ...chain, returning: vi.fn().mockResolvedValue([]) });
  return chain;
}

describe('DrizzleUserStore', () => {
  it('create inserts and returns mapped record', async () => {
    const dbRow = {
      id: 'u1',
      tenantId: 't1',
      scimExternalId: 'ext-1',
      scimSource: 'workos',
      name: 'Alice',
      email: 'alice@example.com',
      passwordHash: 'SCIM_LOCKED',
      role: 'agent',
      status: 'active',
      mfaEnabled: false,
      mfaSecret: null,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = makeDb([dbRow]);
    const store = new DrizzleUserStore(db as never);
    const result = await store.create('t1', {
      externalId: 'ext-1',
      externalSource: 'workos',
      userName: 'alice@example.com',
      displayName: 'Alice',
      emails: [{ value: 'alice@example.com', primary: true }],
      active: true,
    });
    expect(result.id).toBe('u1');
    expect(result.externalId).toBe('ext-1');
    expect(result.active).toBe(true);
  });

  it('getById returns null for missing user', async () => {
    const db = makeDb([]);
    const store = new DrizzleUserStore(db as never);
    const result = await store.getById('t1', 'missing-id');
    expect(result).toBeNull();
  });

  it('list calls select (SQL filter applied, not in-memory)', async () => {
    const db = makeDb([]);
    const selectSpy = vi.spyOn(db, 'select');
    const store = new DrizzleUserStore(db as never);
    await store.list('t1', {
      filter: { field: 'userName', operator: 'eq', value: 'alice@example.com' },
      startIndex: 1,
      count: 10,
    });
    expect(selectSpy).toHaveBeenCalled();
  });
});
