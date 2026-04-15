import { describe, it, expect, vi } from 'vitest';
import { DrizzleOrgStore } from '../drizzle-org-store.js';

// ─── Mock DB ─────────────────────────────────────────────────────────────────

function makeDb(selectRows: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnThis();
  chain.from = vi.fn().mockReturnThis();
  chain.where = vi.fn().mockReturnThis();
  chain.limit = vi.fn().mockResolvedValue(selectRows);
  chain.insert = vi.fn().mockReturnThis();
  chain.values = vi.fn().mockReturnThis();
  chain.returning = vi.fn().mockResolvedValue(selectRows.length > 0 ? [selectRows[0]] : []);
  chain.update = vi.fn().mockReturnThis();
  chain.set = vi.fn().mockReturnThis();
  chain.delete = vi.fn().mockReturnThis();
  // update/delete .where chain resolves void
  const terminalWhere = vi.fn().mockResolvedValue(undefined);
  chain.where = vi.fn().mockReturnValue({
    ...chain,
    returning: vi.fn().mockResolvedValue(selectRows),
    limit: vi.fn().mockResolvedValue(selectRows),
  });
  return chain;
}

const ORG_ROW = {
  id: 'org-1',
  tenantId: 't1',
  name: 'Acme Corp',
  parentId: null,
  slug: 'acme-corp',
  metadata: {},
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DrizzleOrgStore', () => {
  it('getById returns mapped Organization on hit', async () => {
    const db = makeDb([ORG_ROW]);
    const store = new DrizzleOrgStore(db as never);
    const result = await store.getById('t1', 'org-1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('org-1');
    expect(result?.tenantId).toBe('t1');
    expect(result?.name).toBe('Acme Corp');
    expect(result?.parentId).toBeNull();
    expect(result?.slug).toBe('acme-corp');
  });

  it('getById returns null on miss', async () => {
    const db = makeDb([]);
    const store = new DrizzleOrgStore(db as never);
    const result = await store.getById('t1', 'missing');
    expect(result).toBeNull();
  });

  it('getBySlug returns mapped Organization on hit', async () => {
    const db = makeDb([ORG_ROW]);
    const store = new DrizzleOrgStore(db as never);
    const result = await store.getBySlug('t1', 'acme-corp');
    expect(result).not.toBeNull();
    expect(result?.slug).toBe('acme-corp');
  });

  it('list returns array of Organizations', async () => {
    const db = makeDb([ORG_ROW]);
    // list calls select().from().where() which resolves to array
    db.where = vi.fn().mockResolvedValue([ORG_ROW]);
    const store = new DrizzleOrgStore(db as never);
    const result = await store.list('t1');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Acme Corp');
  });

  it('create calls db.insert and returns mapped Organization', async () => {
    const db = makeDb([ORG_ROW]);
    const store = new DrizzleOrgStore(db as never);
    const result = await store.create({
      id: 'org-1',
      tenantId: 't1',
      name: 'Acme Corp',
      parentId: null,
      slug: 'acme-corp',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result).not.toBeNull();
    expect(db.insert).toHaveBeenCalled();
  });

  it('getUsersByOrg returns empty array (no mapping table)', async () => {
    const db = makeDb();
    const store = new DrizzleOrgStore(db as never);
    const result = await store.getUsersByOrg('t1', 'org-1');
    expect(result).toEqual([]);
  });

  it('getChildOrgIds queries by parentId', async () => {
    const childRow = { id: 'org-child-1' };
    const db = makeDb([childRow]);
    db.where = vi.fn().mockResolvedValue([childRow]);
    const store = new DrizzleOrgStore(db as never);
    const result = await store.getChildOrgIds('t1', 'org-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('org-child-1');
  });
});
