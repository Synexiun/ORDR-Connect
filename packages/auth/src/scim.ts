/**
 * SCIM 2.0 Provisioning — Automated user lifecycle management
 *
 * SOC2 CC6.2 — Provisioning and de-provisioning of access.
 * ISO 27001 A.9.2.1 — User registration and de-registration.
 * HIPAA §164.312(a)(1) — Access control: unique user identification.
 *
 * SECURITY INVARIANTS:
 * - SCIM endpoints use dedicated bearer tokens (NOT JWT).
 * - SCIM tokens are SHA-256 hashed before storage — raw tokens never persisted.
 * - User deactivation via SCIM revokes ALL active sessions immediately.
 * - Every provisioning action is audit-logged.
 * - Tenant isolation enforced on all operations.
 */

import type { Result } from '@ordr/core';
import { ok, err, AppError, ERROR_CODES } from '@ordr/core';
import type { AuditLogger } from '@ordr/audit';
import { sha256 } from '@ordr/crypto';

// ─── SCIM Schema Constants ────────────────────────────────────────

export const SCIM_SCHEMAS = {
  USER: 'urn:ietf:params:scim:schemas:core:2.0:User',
  GROUP: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  LIST: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  PATCH_OP: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  ERROR: 'urn:ietf:params:scim:api:messages:2.0:Error',
} as const;

// ─── SCIM Types ───────────────────────────────────────────────────

export interface SCIMUserName {
  readonly givenName: string;
  readonly familyName: string;
}

export interface SCIMUserEmail {
  readonly value: string;
  readonly primary: boolean;
}

export interface SCIMUser {
  readonly schemas: readonly string[];
  readonly userName: string;
  readonly name: SCIMUserName;
  readonly emails: readonly SCIMUserEmail[];
  readonly active: boolean;
  readonly externalId: string;
}

export interface SCIMUserMeta {
  readonly resourceType: 'User';
  readonly created: string;
  readonly lastModified: string;
}

export interface SCIMUserResponse extends SCIMUser {
  readonly id: string;
  readonly meta: SCIMUserMeta;
}

export interface SCIMGroupMember {
  readonly value: string;
  readonly display: string;
}

export interface SCIMGroup {
  readonly schemas: readonly string[];
  readonly displayName: string;
  readonly members: readonly SCIMGroupMember[];
}

export interface SCIMGroupMeta {
  readonly resourceType: 'Group';
  readonly created: string;
  readonly lastModified: string;
}

export interface SCIMGroupResponse extends SCIMGroup {
  readonly id: string;
  readonly meta: SCIMGroupMeta;
}

export interface SCIMListResponse {
  readonly schemas: readonly string[];
  readonly totalResults: number;
  readonly startIndex: number;
  readonly itemsPerPage: number;
  readonly Resources: readonly (SCIMUserResponse | SCIMGroupResponse)[];
}

// ─── User Store Interface (DI) ───────────────────────────────────

export interface SCIMUserRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly name: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly externalId: string;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserStore {
  create(
    tenantId: string,
    user: {
      readonly email: string;
      readonly name: string;
      readonly firstName: string;
      readonly lastName: string;
      readonly externalId: string;
    },
  ): Promise<SCIMUserRecord>;

  getById(tenantId: string, userId: string): Promise<SCIMUserRecord | null>;

  getByExternalId(tenantId: string, externalId: string): Promise<SCIMUserRecord | null>;

  list(
    tenantId: string,
    options?: {
      readonly startIndex?: number;
      readonly count?: number;
      readonly filter?: string;
    },
  ): Promise<{ readonly users: readonly SCIMUserRecord[]; readonly totalCount: number }>;

  update(
    tenantId: string,
    userId: string,
    fields: Partial<{
      readonly email: string;
      readonly name: string;
      readonly firstName: string;
      readonly lastName: string;
      readonly active: boolean;
    }>,
  ): Promise<SCIMUserRecord | null>;

  deactivate(tenantId: string, userId: string): Promise<void>;
}

// ─── Group Store Interface (DI) ──────────────────────────────────

export interface SCIMGroupRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly displayName: string;
  readonly members: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GroupStore {
  create(
    tenantId: string,
    group: {
      readonly displayName: string;
      readonly members: readonly string[];
    },
  ): Promise<SCIMGroupRecord>;

  getById(tenantId: string, groupId: string): Promise<SCIMGroupRecord | null>;

  list(tenantId: string): Promise<readonly SCIMGroupRecord[]>;

  update(
    tenantId: string,
    groupId: string,
    fields: Partial<{
      readonly displayName: string;
      readonly members: readonly string[];
    }>,
  ): Promise<SCIMGroupRecord | null>;
}

// ─── Session Revoker Interface (DI) ──────────────────────────────

export interface SessionRevoker {
  revokeByUserId(userId: string): Promise<void>;
}

// ─── SCIM Token Verification ─────────────────────────────────────

export interface SCIMTokenRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly tokenHash: string;
  readonly description: string;
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
}

export interface SCIMTokenStore {
  getByHash(tokenHash: string): Promise<SCIMTokenRecord | null>;
  updateLastUsed(tokenId: string): Promise<void>;
}

/**
 * Verifies a SCIM bearer token.
 * Tokens are SHA-256 hashed and looked up by hash (never raw).
 *
 * @returns tenantId if valid, null otherwise
 */
export async function verifySCIMToken(
  token: string,
  tokenStore: SCIMTokenStore,
): Promise<string | null> {
  if (!token || token.trim().length === 0) {
    return null;
  }

  const tokenHash = sha256(token);
  const record = await tokenStore.getByHash(tokenHash);

  if (!record) {
    return null;
  }

  // Check expiration
  if (record.expiresAt !== null && record.expiresAt.getTime() < Date.now()) {
    return null;
  }

  // Update last used
  await tokenStore.updateLastUsed(record.id);

  return record.tenantId;
}

// ─── In-Memory Stores (Testing) ──────────────────────────────────

export class InMemoryUserStore implements UserStore {
  private readonly users = new Map<string, SCIMUserRecord>();
  private counter = 0;

  create(
    tenantId: string,
    user: {
      readonly email: string;
      readonly name: string;
      readonly firstName: string;
      readonly lastName: string;
      readonly externalId: string;
    },
  ): Promise<SCIMUserRecord> {
    this.counter += 1;
    const id = `scim-user-${String(this.counter)}`;
    const now = new Date();
    const record: SCIMUserRecord = {
      id,
      tenantId,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      externalId: user.externalId,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(`${tenantId}:${id}`, record);
    return Promise.resolve(record);
  }

  getById(tenantId: string, userId: string): Promise<SCIMUserRecord | null> {
    return Promise.resolve(this.users.get(`${tenantId}:${userId}`) ?? null);
  }

  getByExternalId(tenantId: string, externalId: string): Promise<SCIMUserRecord | null> {
    for (const user of this.users.values()) {
      if (user.tenantId === tenantId && user.externalId === externalId) {
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }

  list(
    tenantId: string,
    options?: {
      readonly startIndex?: number;
      readonly count?: number;
      readonly filter?: string;
    },
  ): Promise<{ readonly users: readonly SCIMUserRecord[]; readonly totalCount: number }> {
    let allUsers = Array.from(this.users.values()).filter((u) => u.tenantId === tenantId);

    // Basic filter support: userName eq "value"
    if (options?.filter !== undefined && options.filter.length > 0) {
      const match = /^userName\s+eq\s+"([^"]+)"$/i.exec(options.filter);
      const matchValue = match?.[1];
      if (matchValue !== undefined && matchValue.length > 0) {
        const filterValue = matchValue;
        allUsers = allUsers.filter((u) => u.email === filterValue);
      }
    }

    const totalCount = allUsers.length;
    const startIndex = options?.startIndex ?? 1;
    const count = options?.count ?? 100;
    const startOffset = Math.max(0, startIndex - 1);
    const paged = allUsers.slice(startOffset, startOffset + count);

    return Promise.resolve({ users: paged, totalCount });
  }

  update(
    tenantId: string,
    userId: string,
    fields: Partial<{
      readonly email: string;
      readonly name: string;
      readonly firstName: string;
      readonly lastName: string;
      readonly active: boolean;
    }>,
  ): Promise<SCIMUserRecord | null> {
    const key = `${tenantId}:${userId}`;
    const existing = this.users.get(key);
    if (!existing) return Promise.resolve(null);

    const updated: SCIMUserRecord = {
      ...existing,
      ...fields,
      updatedAt: new Date(),
    };
    this.users.set(key, updated);
    return Promise.resolve(updated);
  }

  deactivate(tenantId: string, userId: string): Promise<void> {
    const key = `${tenantId}:${userId}`;
    const existing = this.users.get(key);
    if (existing) {
      this.users.set(key, { ...existing, active: false, updatedAt: new Date() });
    }
    return Promise.resolve();
  }
}

export class InMemoryGroupStore implements GroupStore {
  private readonly groups = new Map<string, SCIMGroupRecord>();
  private counter = 0;

  create(
    tenantId: string,
    group: {
      readonly displayName: string;
      readonly members: readonly string[];
    },
  ): Promise<SCIMGroupRecord> {
    this.counter += 1;
    const id = `scim-group-${String(this.counter)}`;
    const now = new Date();
    const record: SCIMGroupRecord = {
      id,
      tenantId,
      displayName: group.displayName,
      members: group.members,
      createdAt: now,
      updatedAt: now,
    };
    this.groups.set(`${tenantId}:${id}`, record);
    return Promise.resolve(record);
  }

  getById(tenantId: string, groupId: string): Promise<SCIMGroupRecord | null> {
    return Promise.resolve(this.groups.get(`${tenantId}:${groupId}`) ?? null);
  }

  list(tenantId: string): Promise<readonly SCIMGroupRecord[]> {
    const results: SCIMGroupRecord[] = [];
    for (const group of this.groups.values()) {
      if (group.tenantId === tenantId) {
        results.push(group);
      }
    }
    return Promise.resolve(results);
  }

  update(
    tenantId: string,
    groupId: string,
    fields: Partial<{
      readonly displayName: string;
      readonly members: readonly string[];
    }>,
  ): Promise<SCIMGroupRecord | null> {
    const key = `${tenantId}:${groupId}`;
    const existing = this.groups.get(key);
    if (!existing) return Promise.resolve(null);

    const updated: SCIMGroupRecord = {
      ...existing,
      ...fields,
      updatedAt: new Date(),
    };
    this.groups.set(key, updated);
    return Promise.resolve(updated);
  }
}

export class InMemorySCIMTokenStore implements SCIMTokenStore {
  private readonly tokens = new Map<string, SCIMTokenRecord>();

  addToken(record: SCIMTokenRecord): void {
    this.tokens.set(record.tokenHash, record);
  }

  getByHash(tokenHash: string): Promise<SCIMTokenRecord | null> {
    return Promise.resolve(this.tokens.get(tokenHash) ?? null);
  }

  updateLastUsed(_tokenId: string): Promise<void> {
    // No-op for testing
    return Promise.resolve();
  }
}

// ─── SCIM Handler ─────────────────────────────────────────────────

export interface SCIMHandlerDeps {
  readonly userStore: UserStore;
  readonly groupStore: GroupStore;
  readonly sessionRevoker: SessionRevoker;
  readonly auditLogger: AuditLogger;
}

export class SCIMHandler {
  private readonly userStore: UserStore;
  private readonly groupStore: GroupStore;
  private readonly sessionRevoker: SessionRevoker;
  private readonly auditLogger: AuditLogger;

  constructor(deps: SCIMHandlerDeps) {
    this.userStore = deps.userStore;
    this.groupStore = deps.groupStore;
    this.sessionRevoker = deps.sessionRevoker;
    this.auditLogger = deps.auditLogger;
  }

  /**
   * Creates a user from a SCIM payload.
   * Maps SCIM attributes to ORDR user fields.
   */
  async handleCreateUser(tenantId: string, scimUser: SCIMUser): Promise<Result<SCIMUserResponse>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    if (!scimUser.userName || scimUser.userName.trim().length === 0) {
      return err(new AppError('userName is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Check for duplicate externalId
    if (scimUser.externalId) {
      const existing = await this.userStore.getByExternalId(tenantId, scimUser.externalId);
      if (existing) {
        return err(
          new AppError('User with this externalId already exists', ERROR_CODES.CONFLICT, 409),
        );
      }
    }

    const primaryEmail = scimUser.emails.find((e) => e.primary)?.value ?? scimUser.userName;
    const fullName = `${scimUser.name.givenName} ${scimUser.name.familyName}`.trim();

    const record = await this.userStore.create(tenantId, {
      email: primaryEmail,
      name: fullName,
      firstName: scimUser.name.givenName,
      lastName: scimUser.name.familyName,
      externalId: scimUser.externalId,
    });

    // Audit log the provisioning
    await this.auditLogger.log({
      tenantId,
      eventType: 'user.provisioned',
      actorType: 'system',
      actorId: 'scim',
      resource: 'user',
      resourceId: record.id,
      action: 'create',
      details: { method: 'scim', externalId: scimUser.externalId },
      timestamp: new Date(),
    });

    return ok(this.toSCIMUserResponse(record));
  }

  /**
   * Updates a user from SCIM push.
   */
  async handleUpdateUser(
    tenantId: string,
    userId: string,
    scimUser: SCIMUser,
  ): Promise<Result<SCIMUserResponse>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const existing = await this.userStore.getById(tenantId, userId);
    if (!existing) {
      return err(new AppError('User not found', ERROR_CODES.NOT_FOUND, 404));
    }

    const primaryEmail = scimUser.emails.find((e) => e.primary)?.value ?? scimUser.userName;
    const fullName = `${scimUser.name.givenName} ${scimUser.name.familyName}`.trim();

    const updated = await this.userStore.update(tenantId, userId, {
      email: primaryEmail,
      name: fullName,
      firstName: scimUser.name.givenName,
      lastName: scimUser.name.familyName,
      active: scimUser.active,
    });

    if (!updated) {
      return err(new AppError('Failed to update user', ERROR_CODES.INTERNAL_ERROR, 500));
    }

    // Audit log
    await this.auditLogger.log({
      tenantId,
      eventType: 'user.updated',
      actorType: 'system',
      actorId: 'scim',
      resource: 'user',
      resourceId: userId,
      action: 'update',
      details: { method: 'scim' },
      timestamp: new Date(),
    });

    return ok(this.toSCIMUserResponse(updated));
  }

  /**
   * Deactivates a user (NOT delete — soft deactivate for audit compliance).
   * Revokes ALL active sessions immediately.
   */
  async handleDeactivateUser(tenantId: string, userId: string): Promise<Result<void>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const existing = await this.userStore.getById(tenantId, userId);
    if (!existing) {
      return err(new AppError('User not found', ERROR_CODES.NOT_FOUND, 404));
    }

    // Deactivate the user
    await this.userStore.deactivate(tenantId, userId);

    // CRITICAL: Revoke ALL active sessions immediately
    await this.sessionRevoker.revokeByUserId(userId);

    // Audit log
    await this.auditLogger.log({
      tenantId,
      eventType: 'user.deactivated',
      actorType: 'system',
      actorId: 'scim',
      resource: 'user',
      resourceId: userId,
      action: 'deactivate',
      details: { method: 'scim', sessionsRevoked: true },
      timestamp: new Date(),
    });

    return ok(undefined);
  }

  /**
   * Lists users for a tenant with SCIM pagination.
   */
  async handleListUsers(
    tenantId: string,
    filter?: string,
    startIndex?: number,
    count?: number,
  ): Promise<Result<SCIMListResponse>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const opts = {
      startIndex: startIndex ?? 1,
      count: count ?? 100,
      ...(filter !== undefined ? { filter } : {}),
    };
    const result = await this.userStore.list(tenantId, opts);

    const response: SCIMListResponse = {
      schemas: [SCIM_SCHEMAS.LIST],
      totalResults: result.totalCount,
      startIndex: startIndex ?? 1,
      itemsPerPage: result.users.length,
      Resources: result.users.map((u) => this.toSCIMUserResponse(u)),
    };

    return ok(response);
  }

  /**
   * Gets a single user by ID.
   */
  async handleGetUser(tenantId: string, userId: string): Promise<Result<SCIMUserResponse>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const user = await this.userStore.getById(tenantId, userId);
    if (!user) {
      return err(new AppError('User not found', ERROR_CODES.NOT_FOUND, 404));
    }

    return ok(this.toSCIMUserResponse(user));
  }

  /**
   * Creates a group from SCIM payload.
   */
  async handleCreateGroup(
    tenantId: string,
    scimGroup: SCIMGroup,
  ): Promise<Result<SCIMGroupResponse>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    if (!scimGroup.displayName || scimGroup.displayName.trim().length === 0) {
      return err(new AppError('displayName is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const memberIds = scimGroup.members.map((m) => m.value);

    const record = await this.groupStore.create(tenantId, {
      displayName: scimGroup.displayName,
      members: memberIds,
    });

    // Audit log
    await this.auditLogger.log({
      tenantId,
      eventType: 'group.created',
      actorType: 'system',
      actorId: 'scim',
      resource: 'group',
      resourceId: record.id,
      action: 'create',
      details: { method: 'scim', displayName: scimGroup.displayName },
      timestamp: new Date(),
    });

    return ok(this.toSCIMGroupResponse(record));
  }

  /**
   * Updates a group from SCIM push.
   */
  async handleUpdateGroup(
    tenantId: string,
    groupId: string,
    scimGroup: SCIMGroup,
  ): Promise<Result<SCIMGroupResponse>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const existing = await this.groupStore.getById(tenantId, groupId);
    if (!existing) {
      return err(new AppError('Group not found', ERROR_CODES.NOT_FOUND, 404));
    }

    const memberIds = scimGroup.members.map((m) => m.value);

    const updated = await this.groupStore.update(tenantId, groupId, {
      displayName: scimGroup.displayName,
      members: memberIds,
    });

    if (!updated) {
      return err(new AppError('Failed to update group', ERROR_CODES.INTERNAL_ERROR, 500));
    }

    // Audit log
    await this.auditLogger.log({
      tenantId,
      eventType: 'group.updated',
      actorType: 'system',
      actorId: 'scim',
      resource: 'group',
      resourceId: groupId,
      action: 'update',
      details: { method: 'scim' },
      timestamp: new Date(),
    });

    return ok(this.toSCIMGroupResponse(updated));
  }

  // ─── Response Builders ────────────────────────────────────────────

  private toSCIMUserResponse(record: SCIMUserRecord): SCIMUserResponse {
    return {
      schemas: [SCIM_SCHEMAS.USER],
      id: record.id,
      userName: record.email,
      name: {
        givenName: record.firstName,
        familyName: record.lastName,
      },
      emails: [{ value: record.email, primary: true }],
      active: record.active,
      externalId: record.externalId,
      meta: {
        resourceType: 'User',
        created: record.createdAt.toISOString(),
        lastModified: record.updatedAt.toISOString(),
      },
    };
  }

  private toSCIMGroupResponse(record: SCIMGroupRecord): SCIMGroupResponse {
    return {
      schemas: [SCIM_SCHEMAS.GROUP],
      id: record.id,
      displayName: record.displayName,
      members: record.members.map((m) => ({ value: m, display: m })),
      meta: {
        resourceType: 'Group',
        created: record.createdAt.toISOString(),
        lastModified: record.updatedAt.toISOString(),
      },
    };
  }
}
