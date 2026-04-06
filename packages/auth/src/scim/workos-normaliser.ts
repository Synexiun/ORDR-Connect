/**
 * workos-normaliser.ts — Maps WorkOS dsync.* events to SCIMHandler method calls.
 *
 * Handles 8 event types from WorkOS directory sync:
 *  - dsync.user.created / updated / deleted
 *  - dsync.group.created / updated / deleted
 *  - dsync.group.user.added / removed
 *
 * Uses a switch dispatch to route to the correct SCIMHandler method.
 */

import type { SCIMHandler } from './handler.js';
import type { SCIMPatchRequest, SCIMEmail } from './types.js';

// ── Safe field extractors (Rule 4) ────────────────────────────────────────
// Throw on missing/wrong-type required fields so the webhook handler returns
// 500 and WorkOS retries, rather than silently propagating undefined into DB.

function requireString(data: Record<string, unknown>, key: string): string {
  const val = data[key];
  if (typeof val !== 'string' || val.length === 0) {
    throw new Error(`WorkOS event missing required string field: ${key}`);
  }
  return val;
}

function optionalBoolean(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const val = data[key];
  return typeof val === 'boolean' ? val : fallback;
}

function optionalString(data: Record<string, unknown>, key: string): string {
  const val = data[key];
  return typeof val === 'string' ? val : '';
}

function requireObject(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const val = data[key];
  if (val === null || typeof val !== 'object' || Array.isArray(val)) {
    throw new Error(`WorkOS event missing required object field: ${key}`);
  }
  return val as Record<string, unknown>;
}

/**
 * WorkOS event types we care about.
 */
type WorkOSEventType =
  | 'dsync.user.created'
  | 'dsync.user.updated'
  | 'dsync.user.deleted'
  | 'dsync.group.created'
  | 'dsync.group.updated'
  | 'dsync.group.deleted'
  | 'dsync.group.user.added'
  | 'dsync.group.user.removed';

/**
 * WorkOS event envelope structure.
 */
interface WorkOSEvent {
  event: WorkOSEventType;
  data: Record<string, unknown>;
}

/**
 * Normalise a WorkOS event and dispatch to SCIMHandler.
 *
 * @param tenantId — tenant context (from JWT or webhook verification)
 * @param event — the WorkOS dsync event
 * @param handler — SCIMHandler instance
 * @throws on unknown event type
 */
export async function normaliseWorkOSEvent(
  tenantId: string,
  event: WorkOSEvent,
  handler: SCIMHandler,
): Promise<void> {
  switch (event.event) {
    case 'dsync.user.created':
      await handleUserCreated(tenantId, event.data, handler);
      break;

    case 'dsync.user.updated':
      await handleUserUpdated(tenantId, event.data, handler);
      break;

    case 'dsync.user.deleted':
      await handleUserDeleted(tenantId, event.data, handler);
      break;

    case 'dsync.group.created':
      await handleGroupCreated(tenantId, event.data, handler);
      break;

    case 'dsync.group.updated':
      await handleGroupUpdated(tenantId, event.data, handler);
      break;

    case 'dsync.group.deleted':
      await handleGroupDeleted(tenantId, event.data, handler);
      break;

    case 'dsync.group.user.added':
      await handleGroupUserAdded(tenantId, event.data, handler);
      break;

    case 'dsync.group.user.removed':
      await handleGroupUserRemoved(tenantId, event.data, handler);
      break;

    default:
      throw new Error(`Unknown WorkOS event type: ${String((event as { event?: unknown }).event)}`);
  }
}

// =========================================================================
// USER EVENT HANDLERS
// =========================================================================

async function handleUserCreated(
  tenantId: string,
  data: Record<string, unknown>,
  handler: SCIMHandler,
): Promise<void> {
  const workosId = requireString(data, 'id');
  const displayName = optionalString(data, 'display_name');
  const active = optionalBoolean(data, 'active', true);
  const workosEmails =
    (data['emails'] as Array<{ value: string; primary?: boolean }> | undefined) ?? [];

  // Find primary email or first email; default to empty string
  let primaryEmail = '';
  for (const email of workosEmails) {
    if (email.primary === true) {
      primaryEmail = email.value;
      break;
    }
  }
  if (!primaryEmail && workosEmails.length > 0) {
    primaryEmail = workosEmails[0]?.value ?? '';
  }

  // Convert WorkOS emails to SCIMEmail format
  const emails: SCIMEmail[] = workosEmails.map((e) => ({
    value: e.value,
    primary: e.primary === true,
  }));

  await handler.createUser(tenantId, {
    externalId: workosId,
    externalSource: 'workos',
    userName: primaryEmail,
    displayName,
    active,
    emails,
  });
}

async function handleUserUpdated(
  tenantId: string,
  data: Record<string, unknown>,
  handler: SCIMHandler,
): Promise<void> {
  const workosId = requireString(data, 'id');
  const displayName = optionalString(data, 'display_name');
  const active = optionalBoolean(data, 'active', true);
  const workosEmails =
    (data['emails'] as Array<{ value: string; primary?: boolean }> | undefined) ?? [];

  // Convert WorkOS emails to SCIMEmail format
  const emails: SCIMEmail[] = workosEmails.map((e) => ({
    value: e.value,
    primary: e.primary === true,
  }));

  await handler.updateUser(tenantId, workosId, {
    displayName,
    emails,
    active,
  });
}

async function handleUserDeleted(
  tenantId: string,
  data: Record<string, unknown>,
  handler: SCIMHandler,
): Promise<void> {
  const workosId = requireString(data, 'id');
  await handler.deleteUser(tenantId, workosId);
}

// =========================================================================
// GROUP EVENT HANDLERS
// =========================================================================

async function handleGroupCreated(
  tenantId: string,
  data: Record<string, unknown>,
  handler: SCIMHandler,
): Promise<void> {
  const workosId = requireString(data, 'id');
  const displayName = requireString(data, 'display_name');
  const memberIds = (data['users'] as Array<{ id: string }> | undefined)?.map((u) => u.id) ?? [];

  await handler.createGroup(
    tenantId,
    {
      displayName,
      externalId: workosId,
      externalSource: 'workos',
    },
    memberIds,
  );
}

async function handleGroupUpdated(
  tenantId: string,
  data: Record<string, unknown>,
  handler: SCIMHandler,
): Promise<void> {
  const workosId = requireString(data, 'id');
  const displayName = requireString(data, 'display_name');
  const memberIds = (data['users'] as Array<{ id: string }> | undefined)?.map((u) => u.id) ?? [];

  await handler.updateGroup(
    tenantId,
    workosId,
    {
      displayName,
      externalId: workosId,
    },
    memberIds,
  );
}

async function handleGroupDeleted(
  tenantId: string,
  data: Record<string, unknown>,
  handler: SCIMHandler,
): Promise<void> {
  const workosId = requireString(data, 'id');
  await handler.deleteGroup(tenantId, workosId);
}

async function handleGroupUserAdded(
  tenantId: string,
  data: Record<string, unknown>,
  handler: SCIMHandler,
): Promise<void> {
  const groupData = requireObject(data, 'group');
  const userData = requireObject(data, 'user');
  const groupId = requireString(groupData, 'id');
  const userId = requireString(userData, 'id');

  const patch: SCIMPatchRequest = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    Operations: [
      {
        op: 'add',
        path: 'members',
        value: [{ value: userId }],
      },
    ],
  };

  await handler.patchGroup(tenantId, groupId, patch);
}

async function handleGroupUserRemoved(
  tenantId: string,
  data: Record<string, unknown>,
  handler: SCIMHandler,
): Promise<void> {
  const groupData = requireObject(data, 'group');
  const userData = requireObject(data, 'user');
  const groupId = requireString(groupData, 'id');
  const userId = requireString(userData, 'id');

  const patch: SCIMPatchRequest = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    Operations: [
      {
        op: 'remove',
        path: 'members',
        value: [{ value: userId }],
      },
    ],
  };

  await handler.patchGroup(tenantId, groupId, patch);
}
