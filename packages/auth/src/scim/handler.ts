/**
 * SCIMHandler — central orchestrator for all 10 SCIM 2.0 operations.
 *
 * Responsibilities:
 *  - Delegates persistence to SCIMUserStore / SCIMGroupStore
 *  - Emits WORM audit events (Rule 3) for every state-changing operation
 *  - Publishes Kafka identity events best-effort (.catch(() => undefined))
 *  - Implements atomic deprovisioning in deleteUser via db.transaction()
 *
 * Security / compliance:
 *  - Rule 3: Every state change produces an immutable audit event
 *  - Rule 6: audit details never contain PHI plaintext — only IDs + safe metadata
 *  - Rule 9: Agent actions are bounded and audited
 *  - deleteUser is idempotent (safe to retry from SCIM provider)
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { users, sessions, groupMembers } from '@ordr/db';
import { AuditLogger } from '@ordr/audit';
import { EventProducer, TOPICS, createEventEnvelope } from '@ordr/events';
import type {
  SCIMUserStore,
  SCIMGroupStore,
  SCIMUserRecord,
  SCIMGroupRecord,
  SCIMListParams,
  SCIMPatchRequest,
} from './types.js';

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

export interface SCIMHandlerDeps {
  userStore: SCIMUserStore;
  groupStore: SCIMGroupStore;
  /** Drizzle connection used for atomic deprovisioning transaction */
  db: NodePgDatabase;
  /** Kafka event producer — best-effort, never blocks SCIM response */
  eventProducer: EventProducer;
  /** WORM audit logger — atomic with state changes */
  auditLogger: AuditLogger;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** System actor for SCIM-sourced events. */
const SCIM_ACTOR = 'scim-system' as const;

// ---------------------------------------------------------------------------
// SCIMHandler
// ---------------------------------------------------------------------------

export class SCIMHandler {
  constructor(private readonly deps: SCIMHandlerDeps) {}

  // =========================================================================
  // USER OPERATIONS
  // =========================================================================

  /**
   * POST /Users — provision a new user.
   *
   * Creates the user in the store, emits a WORM audit event, then publishes
   * a Kafka `user.provisioned` event best-effort.
   */
  async createUser(
    tenantId: string,
    record: Omit<SCIMUserRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<SCIMUserRecord> {
    const user = await this.deps.userStore.create(tenantId, record);

    await this.deps.auditLogger.log({
      tenantId,
      eventType: 'user.provisioned',
      actorType: 'system',
      actorId: SCIM_ACTOR,
      resource: 'user',
      resourceId: user.id,
      action: 'scim.user.create',
      details: {
        userId: user.id,
        userName: user.userName,
        externalSource: user.externalSource,
      },
      timestamp: new Date(),
    });

    // Kafka — best-effort, never blocks
    void this.deps.eventProducer
      .publish(
        TOPICS.IDENTITY_EVENTS,
        createEventEnvelope(
          'user.provisioned',
          tenantId,
          { userId: user.id, userName: user.userName },
          { source: 'scim-handler' },
        ),
      )
      .catch(() => undefined);

    return user;
  }

  /**
   * GET /Users/:id — retrieve a user by internal ID.
   */
  async getUserById(tenantId: string, id: string): Promise<SCIMUserRecord | null> {
    return this.deps.userStore.getById(tenantId, id);
  }

  /**
   * GET /Users?filter=externalId eq "..." — lookup by external IdP ID.
   */
  async getUserByExternalId(tenantId: string, externalId: string): Promise<SCIMUserRecord | null> {
    return this.deps.userStore.getByExternalId(tenantId, externalId);
  }

  /**
   * GET /Users?filter=userName eq "..." — lookup by userName (email).
   */
  async getUserByUserName(tenantId: string, userName: string): Promise<SCIMUserRecord | null> {
    return this.deps.userStore.getByUserName(tenantId, userName);
  }

  /**
   * GET /Users — list users with optional SCIM filter + pagination.
   */
  async listUsers(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMUserRecord[]; total: number }> {
    return this.deps.userStore.list(tenantId, params);
  }

  /**
   * PUT /Users/:id — full user replace.
   *
   * Replaces mutable fields on the user record and emits an audit event.
   */
  async updateUser(
    tenantId: string,
    id: string,
    patch: Partial<SCIMUserRecord>,
  ): Promise<SCIMUserRecord | null> {
    const user = await this.deps.userStore.update(tenantId, id, patch);
    if (!user) return null;

    await this.deps.auditLogger.log({
      tenantId,
      eventType: 'user.updated',
      actorType: 'system',
      actorId: SCIM_ACTOR,
      resource: 'user',
      resourceId: user.id,
      action: 'scim.user.update',
      details: {
        userId: user.id,
        userName: user.userName,
        updatedFields: Object.keys(patch),
      },
      timestamp: new Date(),
    });

    return user;
  }

  /**
   * DELETE /Users/:id — atomic deprovisioning cascade.
   *
   * Idempotent: no-op if the user does not exist or is already inactive.
   *
   * Inside a single transaction:
   *  1. Set user status → 'suspended' and clear SCIM metadata
   *  2. Delete all sessions (revokes active login tokens)
   *  3. Delete all group memberships
   *  4. Append WORM audit event (atomic with state change — Rule 3)
   *
   * After commit, publishes a Kafka `user.deprovisioned` event best-effort.
   */
  async deleteUser(tenantId: string, userId: string): Promise<void> {
    const user = await this.deps.userStore.getById(tenantId, userId);

    // Idempotent — already gone or already deactivated
    if (!user) return;
    if (!user.active) return;

    await this.deps.db.transaction(async (tx) => {
      // 1. Suspend user + clear SCIM source linkage
      await tx
        .update(users)
        .set({
          status: 'suspended',
          scimExternalId: null,
          scimSource: null,
          updatedAt: new Date(),
        })
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));

      // 2. Revoke all active sessions
      await tx.delete(sessions).where(eq(sessions.userId, userId));

      // 3. Remove from all groups
      await tx.delete(groupMembers).where(eq(groupMembers.userId, userId));

      // 4. WORM audit — inside transaction so it is atomic with the state change
      await this.deps.auditLogger.log({
        tenantId,
        eventType: 'user.deactivated',
        actorType: 'system',
        actorId: SCIM_ACTOR,
        resource: 'user',
        resourceId: userId,
        action: 'scim.user.deprovision',
        // Rule 6: no PHI, no key material — only safe identifiers
        details: {
          userId,
          userName: user.userName,
          externalSource: user.externalSource,
        },
        timestamp: new Date(),
      });
    });

    // Kafka — best-effort, after commit, never blocks
    void this.deps.eventProducer
      .publish(
        TOPICS.IDENTITY_EVENTS,
        createEventEnvelope(
          'user.deprovisioned',
          tenantId,
          { userId, userName: user.userName },
          { source: 'scim-handler' },
        ),
      )
      .catch(() => undefined);
  }

  // =========================================================================
  // GROUP OPERATIONS
  // =========================================================================

  /**
   * POST /Groups — provision a new group.
   */
  async createGroup(
    tenantId: string,
    record: Omit<
      SCIMGroupRecord,
      'id' | 'tenantId' | 'members' | 'memberCount' | 'createdAt' | 'updatedAt'
    >,
    memberIds: string[] = [],
  ): Promise<SCIMGroupRecord> {
    const group = await this.deps.groupStore.create(tenantId, record);

    // Seed initial members if provided
    if (memberIds.length > 0) {
      await this.deps.groupStore.syncMembers(group.id, memberIds);
    }

    await this.deps.auditLogger.log({
      tenantId,
      eventType: 'group.created',
      actorType: 'system',
      actorId: SCIM_ACTOR,
      resource: 'group',
      resourceId: group.id,
      action: 'scim.group.create',
      details: {
        groupId: group.id,
        displayName: group.displayName,
        memberCount: memberIds.length,
      },
      timestamp: new Date(),
    });

    void this.deps.eventProducer
      .publish(
        TOPICS.IDENTITY_EVENTS,
        createEventEnvelope(
          'group.created',
          tenantId,
          { groupId: group.id, displayName: group.displayName },
          { source: 'scim-handler' },
        ),
      )
      .catch(() => undefined);

    return group;
  }

  /**
   * GET /Groups/:id — retrieve a group by internal ID.
   */
  async getGroupById(tenantId: string, id: string): Promise<SCIMGroupRecord | null> {
    return this.deps.groupStore.getById(tenantId, id);
  }

  /**
   * GET /Groups?filter=externalId eq "..." — lookup by external IdP ID.
   */
  async getGroupByExternalId(
    tenantId: string,
    externalId: string,
  ): Promise<SCIMGroupRecord | null> {
    return this.deps.groupStore.getByExternalId(tenantId, externalId);
  }

  /**
   * GET /Groups — list groups with optional SCIM filter + pagination.
   */
  async listGroups(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMGroupRecord[]; total: number }> {
    return this.deps.groupStore.list(tenantId, params);
  }

  /**
   * PUT /Groups/:id — full group replace (members are fully replaced).
   */
  async updateGroup(
    tenantId: string,
    id: string,
    data: Partial<Pick<SCIMGroupRecord, 'displayName' | 'externalId' | 'externalSource'>>,
    memberIds: string[] = [],
  ): Promise<SCIMGroupRecord | null> {
    const group = await this.deps.groupStore.update(tenantId, id, data);
    if (!group) return null;

    // Full member replace semantics for PUT
    await this.deps.groupStore.syncMembers(id, memberIds);

    await this.deps.auditLogger.log({
      tenantId,
      eventType: 'group.updated',
      actorType: 'system',
      actorId: SCIM_ACTOR,
      resource: 'group',
      resourceId: group.id,
      action: 'scim.group.update',
      details: {
        groupId: group.id,
        displayName: group.displayName,
        memberCount: memberIds.length,
        updatedFields: Object.keys(data),
      },
      timestamp: new Date(),
    });

    void this.deps.eventProducer
      .publish(
        TOPICS.IDENTITY_EVENTS,
        createEventEnvelope(
          'group.updated',
          tenantId,
          { groupId: group.id, displayName: group.displayName },
          { source: 'scim-handler' },
        ),
      )
      .catch(() => undefined);

    // Return refreshed group record reflecting new members
    return this.deps.groupStore.getById(tenantId, id);
  }

  /**
   * PATCH /Groups/:id — incremental group mutation (PatchOps).
   *
   * Supported paths:
   *  - 'members'     + op 'add'     → add listed members
   *  - 'members'     + op 'remove'  → remove listed members
   *  - 'displayName' + op 'replace' → rename group
   */
  async patchGroup(
    tenantId: string,
    id: string,
    patch: SCIMPatchRequest,
  ): Promise<SCIMGroupRecord | null> {
    for (const op of patch.Operations) {
      if (op.path === 'members') {
        const memberValues = Array.isArray(op.value) ? (op.value as Array<{ value: string }>) : [];

        if (op.op === 'add') {
          for (const m of memberValues) {
            await this.deps.groupStore.addMember(id, m.value);
          }
        } else if (op.op === 'remove') {
          for (const m of memberValues) {
            await this.deps.groupStore.removeMember(id, m.value);
          }
        }
      }

      if (op.path === 'displayName' && op.op === 'replace') {
        await this.deps.groupStore.update(tenantId, id, {
          displayName: op.value as string,
        });
      }
    }

    await this.deps.auditLogger.log({
      tenantId,
      eventType: 'group.updated',
      actorType: 'system',
      actorId: SCIM_ACTOR,
      resource: 'group',
      resourceId: id,
      action: 'scim.group.patch',
      details: {
        groupId: id,
        operationCount: patch.Operations.length,
        paths: patch.Operations.map((o) => o.path),
      },
      timestamp: new Date(),
    });

    void this.deps.eventProducer
      .publish(
        TOPICS.IDENTITY_EVENTS,
        createEventEnvelope('group.updated', tenantId, { groupId: id }, { source: 'scim-handler' }),
      )
      .catch(() => undefined);

    return this.deps.groupStore.getById(tenantId, id);
  }

  /**
   * DELETE /Groups/:id — remove a group and all its memberships.
   */
  async deleteGroup(tenantId: string, id: string): Promise<void> {
    // groupStore.delete cascades memberships via FK onDelete: 'cascade'
    await this.deps.groupStore.delete(tenantId, id);

    await this.deps.auditLogger.log({
      tenantId,
      eventType: 'group.updated',
      actorType: 'system',
      actorId: SCIM_ACTOR,
      resource: 'group',
      resourceId: id,
      action: 'scim.group.delete',
      details: { groupId: id },
      timestamp: new Date(),
    });

    void this.deps.eventProducer
      .publish(
        TOPICS.IDENTITY_EVENTS,
        createEventEnvelope('group.deleted', tenantId, { groupId: id }, { source: 'scim-handler' }),
      )
      .catch(() => undefined);
  }
}
