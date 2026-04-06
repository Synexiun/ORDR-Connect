import { describe, it, expect } from 'vitest';
import type { SCIMUserRecord, SCIMGroupRecord, SCIMPatchOp } from '../types';

describe('SCIM types', () => {
  it('SCIMUserRecord has externalId and active fields', () => {
    const user: SCIMUserRecord = {
      id: 'u1',
      tenantId: 't1',
      externalId: 'ext-1',
      userName: 'alice@example.com',
      displayName: 'Alice',
      emails: [{ value: 'alice@example.com', primary: true }],
      active: true,
      externalSource: 'workos',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(user.externalId).toBe('ext-1');
    expect(user.active).toBe(true);
  });

  it('SCIMGroupRecord has externalId and members array', () => {
    const group: SCIMGroupRecord = {
      id: 'g1',
      tenantId: 't1',
      displayName: 'Admins',
      externalId: 'ext-g1',
      externalSource: 'workos',
      members: [{ value: 'u1', display: 'Alice' }],
      memberCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(group.members).toHaveLength(1);
    expect(group.memberCount).toBe(1);
  });

  it('SCIMPatchOp discriminates add/remove/replace', () => {
    const addOp: SCIMPatchOp = { op: 'add', path: 'members', value: [{ value: 'u1' }] };
    const removeOp: SCIMPatchOp = { op: 'remove', path: 'members', value: [{ value: 'u1' }] };
    expect(addOp.op).toBe('add');
    expect(removeOp.op).toBe('remove');
  });
});
