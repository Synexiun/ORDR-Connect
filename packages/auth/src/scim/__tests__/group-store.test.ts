import { describe, it, expect, vi } from 'vitest';
import { DrizzleGroupStore } from '../group-store';

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal chainable DB mock.
 *
 * The mock models a fluent Drizzle query builder where every method returns
 * `this` until the final awaitable (offset / returning / execute).
 */
function makeDb(
  opts: {
    groupRows?: unknown[];
    memberRows?: unknown[];
    countValue?: number;
    insertRows?: unknown[];
  } = {},
) {
  const { groupRows = [], memberRows = [], countValue = 0, insertRows = [] } = opts;

  // Each select() call returns a fresh chainable that resolves with specific data.
  // We need select to work for both group queries and member queries.
  // We track call order to decide which to return.
  let selectCallCount = 0;

  const memberChain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(memberRows),
  };

  const countChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: countValue }]),
  };

  const groupSelectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(groupRows),
  };

  const singleGroupChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(groupRows),
  };

  const select = vi.fn().mockImplementation(() => {
    selectCallCount++;
    // 1st call: group query, 2nd+ call: count or member queries
    if (selectCallCount === 1) return singleGroupChain;
    if (selectCallCount === 2) return memberChain;
    return countChain;
  });

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue([]),
    returning: vi.fn().mockResolvedValue(insertRows.length > 0 ? [insertRows[0]] : []),
  };

  const insert = vi.fn().mockReturnValue(insertChain);

  const deleteChain = {
    where: vi.fn().mockResolvedValue([]),
  };

  const deleteFn = vi.fn().mockReturnValue(deleteChain);

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  const updateChainReturning = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(groupRows),
  };

  const update = vi.fn().mockReturnValue(updateChainReturning);

  const txMock = {
    select: vi.fn().mockReturnValue(memberChain),
    insert: vi.fn().mockReturnValue(insertChain),
    delete: vi.fn().mockReturnValue(deleteChain),
    update: vi.fn().mockReturnValue(updateChain),
  };

  const transaction = vi
    .fn()
    .mockImplementation(async (fn: (tx: typeof txMock) => Promise<void>) => {
      await fn(txMock);
    });

  return {
    select,
    insert,
    delete: deleteFn,
    update,
    transaction,
    // Expose internals for assertions
    _txMock: txMock,
    _insertChain: insertChain,
    _deleteChain: deleteChain,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-01T00:00:00Z');

const groupRow = {
  id: 'g1',
  tenantId: 't1',
  displayName: 'Engineering',
  scimExternalId: 'ext-g1',
  scimSource: 'workos',
  createdAt: NOW,
  updatedAt: NOW,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DrizzleGroupStore', () => {
  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('inserts a group and returns SCIMGroupRecord with members:[] and memberCount:0', async () => {
      const db = makeDb({ insertRows: [groupRow] });
      // insert().returning() resolves with the new row
      db._insertChain.returning.mockResolvedValue([groupRow]);
      // After insert, loadMembers selects [] members
      db.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      });

      const store = new DrizzleGroupStore(db as never);
      const result = await store.create('t1', {
        displayName: 'Engineering',
        externalId: 'ext-g1',
        externalSource: 'workos',
      });

      expect(db.insert).toHaveBeenCalled();
      expect(result.id).toBe('g1');
      expect(result.tenantId).toBe('t1');
      expect(result.displayName).toBe('Engineering');
      expect(result.externalId).toBe('ext-g1');
      expect(result.externalSource).toBe('workos');
      expect(result.members).toEqual([]);
      expect(result.memberCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // syncMembers
  // -------------------------------------------------------------------------
  describe('syncMembers', () => {
    it('calls db.transaction() exactly once', async () => {
      const db = makeDb();
      const store = new DrizzleGroupStore(db as never);
      await store.syncMembers('g1', ['u1', 'u2']);
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('deletes existing members then inserts new ones inside transaction', async () => {
      const db = makeDb();
      const store = new DrizzleGroupStore(db as never);
      await store.syncMembers('g1', ['u1', 'u2']);

      const tx = db._txMock;
      expect(tx.delete).toHaveBeenCalled();
      expect(tx.insert).toHaveBeenCalled();
    });

    it('only deletes (no insert) when userIds is empty', async () => {
      const db = makeDb();
      const store = new DrizzleGroupStore(db as never);
      await store.syncMembers('g1', []);

      const tx = db._txMock;
      expect(tx.delete).toHaveBeenCalled();
      expect(tx.insert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  describe('delete', () => {
    it('calls the database delete operation', async () => {
      const db = makeDb({ groupRows: [groupRow] });
      // getById path: select → where resolves with [groupRow]
      db.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([groupRow]),
      });
      const store = new DrizzleGroupStore(db as never);
      await store.delete('t1', 'g1');
      expect(db.delete).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // addMember
  // -------------------------------------------------------------------------
  describe('addMember', () => {
    it('inserts without crashing on duplicate (uses onConflictDoNothing)', async () => {
      const db = makeDb();
      const store = new DrizzleGroupStore(db as never);
      // Should not throw
      await expect(store.addMember('g1', 'u1')).resolves.toBeUndefined();
      expect(db.insert).toHaveBeenCalled();
      expect(db._insertChain.onConflictDoNothing).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // removeMember
  // -------------------------------------------------------------------------
  describe('removeMember', () => {
    it('deletes the specific member', async () => {
      const db = makeDb();
      const store = new DrizzleGroupStore(db as never);
      await store.removeMember('g1', 'u1');
      expect(db.delete).toHaveBeenCalled();
      expect(db._deleteChain.where).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  describe('list', () => {
    it('returns records array and total count', async () => {
      let selectCallCount = 0;
      const db = makeDb();

      // list uses: 1) group list query, 2) count query, then per-group member queries
      db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // Group rows query (with limit/offset)
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            offset: vi.fn().mockResolvedValue([groupRow]),
          };
        }
        if (selectCallCount === 2) {
          // Count query
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          };
        }
        // Member queries for each group
        return {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
        };
      });

      const store = new DrizzleGroupStore(db as never);
      const result = await store.list('t1', { startIndex: 1, count: 10 });

      expect(result.total).toBe(1);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.id).toBe('g1');
      expect(result.records[0]!.members).toEqual([]);
    });
  });
});
