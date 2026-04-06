/**
 * workos-normaliser.test.ts — Unit tests for WorkOS event normaliser.
 *
 * Tests the mapping of 8 WorkOS dsync.* events to SCIMHandler method calls.
 * Uses vi.fn() mocks for handler methods.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SCIMHandler } from '../handler.js';
import { normaliseWorkOSEvent } from '../workos-normaliser.js';

describe('WorkOS Event Normaliser', () => {
  let handler: Partial<SCIMHandler>;
  const tenantId = 'tenant-123';

  beforeEach(() => {
    handler = {
      createUser: vi.fn(),
      updateUser: vi.fn(),
      deleteUser: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      deleteGroup: vi.fn(),
      patchGroup: vi.fn(),
    };
  });

  // =========================================================================
  // USER EVENTS
  // =========================================================================

  it('maps dsync.user.created to handler.createUser', async () => {
    const event = {
      event: 'dsync.user.created',
      data: {
        id: 'user-workos-123',
        emails: [{ value: 'alice@example.com', primary: true }],
        display_name: 'Alice Smith',
        active: true,
      },
    };

    await normaliseWorkOSEvent(tenantId, event, handler as SCIMHandler);

    expect(handler.createUser).toHaveBeenCalledOnce();
    expect(handler.createUser).toHaveBeenCalledWith(tenantId, {
      externalId: 'user-workos-123',
      externalSource: 'workos',
      userName: 'alice@example.com',
      displayName: 'Alice Smith',
      active: true,
      emails: [{ value: 'alice@example.com', primary: true }],
    });
  });

  it('maps dsync.user.updated to handler.updateUser', async () => {
    const event = {
      event: 'dsync.user.updated',
      data: {
        id: 'user-workos-123',
        emails: [{ value: 'alice.new@example.com', primary: true }],
        display_name: 'Alice Updated',
        active: false,
      },
    };

    await normaliseWorkOSEvent(tenantId, event, handler as SCIMHandler);

    expect(handler.updateUser).toHaveBeenCalledOnce();
    expect(handler.updateUser).toHaveBeenCalledWith(tenantId, 'user-workos-123', {
      displayName: 'Alice Updated',
      emails: [{ value: 'alice.new@example.com', primary: true }],
      active: false,
    });
  });

  it('maps dsync.user.deleted to handler.deleteUser', async () => {
    const event = {
      event: 'dsync.user.deleted',
      data: {
        id: 'user-workos-123',
      },
    };

    await normaliseWorkOSEvent(tenantId, event, handler as SCIMHandler);

    expect(handler.deleteUser).toHaveBeenCalledOnce();
    expect(handler.deleteUser).toHaveBeenCalledWith(tenantId, 'user-workos-123');
  });

  // =========================================================================
  // GROUP EVENTS
  // =========================================================================

  it('maps dsync.group.created to handler.createGroup', async () => {
    const event = {
      event: 'dsync.group.created',
      data: {
        id: 'group-workos-456',
        display_name: 'Engineering',
        member_ids: ['user-123', 'user-456'],
      },
    };

    await normaliseWorkOSEvent(tenantId, event, handler as SCIMHandler);

    expect(handler.createGroup).toHaveBeenCalledOnce();
    expect(handler.createGroup).toHaveBeenCalledWith(
      tenantId,
      {
        displayName: 'Engineering',
        externalId: 'group-workos-456',
        externalSource: 'workos',
      },
      ['user-123', 'user-456'],
    );
  });

  it('maps dsync.group.updated to handler.updateGroup', async () => {
    const event = {
      event: 'dsync.group.updated',
      data: {
        id: 'group-workos-456',
        display_name: 'Engineering Team',
        member_ids: ['user-123', 'user-789'],
      },
    };

    await normaliseWorkOSEvent(tenantId, event, handler as SCIMHandler);

    expect(handler.updateGroup).toHaveBeenCalledOnce();
    expect(handler.updateGroup).toHaveBeenCalledWith(
      tenantId,
      'group-workos-456',
      {
        displayName: 'Engineering Team',
        externalId: 'group-workos-456',
      },
      ['user-123', 'user-789'],
    );
  });

  it('maps dsync.group.deleted to handler.deleteGroup', async () => {
    const event = {
      event: 'dsync.group.deleted',
      data: {
        id: 'group-workos-456',
      },
    };

    await normaliseWorkOSEvent(tenantId, event, handler as SCIMHandler);

    expect(handler.deleteGroup).toHaveBeenCalledOnce();
    expect(handler.deleteGroup).toHaveBeenCalledWith(tenantId, 'group-workos-456');
  });

  it('maps dsync.group.user.added to handler.patchGroup with add operation', async () => {
    const event = {
      event: 'dsync.group.user.added',
      data: {
        group: { id: 'group-workos-456' },
        user: { id: 'user-new-999' },
      },
    };

    await normaliseWorkOSEvent(tenantId, event, handler as SCIMHandler);

    expect(handler.patchGroup).toHaveBeenCalledOnce();
    expect(handler.patchGroup).toHaveBeenCalledWith(tenantId, 'group-workos-456', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        {
          op: 'add',
          path: 'members',
          value: [{ value: 'user-new-999' }],
        },
      ],
    });
  });

  it('maps dsync.group.user.removed to handler.patchGroup with remove operation', async () => {
    const event = {
      event: 'dsync.group.user.removed',
      data: {
        group: { id: 'group-workos-456' },
        user: { id: 'user-old-888' },
      },
    };

    await normaliseWorkOSEvent(tenantId, event, handler as SCIMHandler);

    expect(handler.patchGroup).toHaveBeenCalledOnce();
    expect(handler.patchGroup).toHaveBeenCalledWith(tenantId, 'group-workos-456', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        {
          op: 'remove',
          path: 'members',
          value: [{ value: 'user-old-888' }],
        },
      ],
    });
  });
});
