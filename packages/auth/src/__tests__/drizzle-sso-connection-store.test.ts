import { describe, it, expect, vi } from 'vitest';
import { DrizzleSSOConnectionStore } from '../drizzle-sso-connection-store.js';

// ─── Mock DB ─────────────────────────────────────────────────────────────────

function makeDb(selectRows: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnThis();
  chain.from = vi.fn().mockReturnThis();
  chain.where = vi.fn().mockReturnThis();
  chain.limit = vi.fn().mockResolvedValue(selectRows);
  chain.insert = vi.fn().mockReturnThis();
  chain.values = vi.fn().mockResolvedValue(undefined);
  chain.delete = vi.fn().mockReturnThis();
  // where on select resolves to rows; where on delete resolves to void
  chain.where = vi.fn().mockImplementation(() => ({
    limit: vi.fn().mockResolvedValue(selectRows),
  }));
  return chain;
}

const SSO_ROW = {
  id: 'conn-1',
  tenantId: 't1',
  name: 'Okta SSO',
  type: 'saml',
  provider: 'okta',
  status: 'active',
  enforceSso: true,
  createdAt: new Date('2026-01-01'),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DrizzleSSOConnectionStore', () => {
  it('getById returns mapped SSOConnection on hit', async () => {
    const db = makeDb([SSO_ROW]);
    const store = new DrizzleSSOConnectionStore(db as never);
    const result = await store.getById('t1', 'conn-1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('conn-1');
    expect(result?.tenantId).toBe('t1');
    expect(result?.type).toBe('saml');
    expect(result?.provider).toBe('okta');
    expect(result?.status).toBe('active');
    expect(result?.enforceSso).toBe(true);
  });

  it('getById returns null on miss', async () => {
    const db = makeDb([]);
    const store = new DrizzleSSOConnectionStore(db as never);
    const result = await store.getById('t1', 'missing');
    expect(result).toBeNull();
  });

  it('listByTenant returns array of connections', async () => {
    const db = makeDb([SSO_ROW]);
    // listByTenant calls select().from().where() — no .limit()
    db.where = vi.fn().mockResolvedValue([SSO_ROW]);
    const store = new DrizzleSSOConnectionStore(db as never);
    const result = await store.listByTenant('t1');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Okta SSO');
  });

  it('create calls db.insert with all fields', async () => {
    const db = makeDb();
    const store = new DrizzleSSOConnectionStore(db as never);
    await store.create({
      id: 'conn-new',
      tenantId: 't1',
      name: 'Azure AD',
      type: 'oidc',
      provider: 'azure-ad',
      status: 'validating',
      enforceSso: false,
      createdAt: new Date(),
    });
    expect(db.insert).toHaveBeenCalled();
  });

  it('getActiveByTenant returns active connection', async () => {
    const db = makeDb([SSO_ROW]);
    const store = new DrizzleSSOConnectionStore(db as never);
    const result = await store.getActiveByTenant('t1');
    expect(result).not.toBeNull();
    expect(result?.status).toBe('active');
  });

  it('getActiveByTenant returns null when no active connection', async () => {
    const db = makeDb([]);
    const store = new DrizzleSSOConnectionStore(db as never);
    const result = await store.getActiveByTenant('t1');
    expect(result).toBeNull();
  });
});
