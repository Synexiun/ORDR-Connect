import { describe, it, expect, vi } from 'vitest';
import { DrizzleTokenStore } from '../token-store';

const makeDb = (row: unknown) => ({
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(row ? [row] : []),
});

describe('DrizzleTokenStore', () => {
  it('findByToken returns tenantId + directoryId when token found', async () => {
    const db = makeDb({ tenantId: 'tenant-1', directoryId: 'dir-1' });
    const store = new DrizzleTokenStore(db as never);
    const result = await store.findByToken('hashed-token');
    expect(result).toEqual({ tenantId: 'tenant-1', directoryId: 'dir-1' });
  });

  it('findByToken returns null when token not found', async () => {
    const db = makeDb(null);
    const store = new DrizzleTokenStore(db as never);
    const result = await store.findByToken('unknown-token');
    expect(result).toBeNull();
  });

  it('findByDirectoryId returns tenantId when directory_id matches', async () => {
    const db = makeDb({ tenantId: 'tenant-1' });
    const store = new DrizzleTokenStore(db as never);
    const result = await store.findByDirectoryId('dir_01HXYZ');
    expect(result).toEqual({ tenantId: 'tenant-1' });
  });

  it('findByDirectoryId returns null when directory_id not found', async () => {
    const db = makeDb(null);
    const store = new DrizzleTokenStore(db as never);
    const result = await store.findByDirectoryId('dir_unknown');
    expect(result).toBeNull();
  });
});
