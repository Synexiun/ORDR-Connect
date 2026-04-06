/**
 * DrizzleGroupStore — Drizzle ORM implementation of SCIMGroupStore.
 *
 * Rule 4 compliance: All queries use parameterized Drizzle operators (eq, and,
 * ilike, isNotNull) — never sql.raw() with user-supplied values.
 *
 * Schema notes:
 *  - groups.displayName       → SCIMGroupRecord.displayName
 *  - groups.scimExternalId    → SCIMGroupRecord.externalId
 *  - groups.scimSource        → SCIMGroupRecord.externalSource
 *  - groupMembers.addedBy     → default 'scim' for SCIM-provisioned memberships
 *  - users.name               → SCIMGroupMember.display
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, ilike, isNotNull, sql, type SQL } from 'drizzle-orm';
import { groups, groupMembers, users } from '@ordr/db';
import type {
  SCIMGroupRecord,
  SCIMGroupStore,
  SCIMGroupMember,
  SCIMListParams,
  SCIMFilter,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type GroupRow = typeof groups.$inferSelect;

// ---------------------------------------------------------------------------
// SCIM filter → SQL
// ---------------------------------------------------------------------------

/**
 * Translates a SCIMFilter to a Drizzle typed SQL expression for the groups table.
 *
 * Rule 4 compliance: All values flow through Drizzle's parameterized operators.
 */
function scimFilterToGroupSQL(filter: SCIMFilter): SQL | null {
  const v = filter.value ?? '';

  switch (filter.field) {
    case 'displayName':
      switch (filter.operator) {
        case 'eq':
          return eq(groups.displayName, v);
        case 'ne':
          return sql`${groups.displayName} != ${v}`;
        case 'co':
          return ilike(groups.displayName, `%${v}%`);
        case 'sw':
          return ilike(groups.displayName, `${v}%`);
        case 'pr':
          return isNotNull(groups.displayName);
      }
      break;

    case 'externalId':
      switch (filter.operator) {
        case 'eq':
          return eq(groups.scimExternalId, v);
        case 'ne':
          return sql`${groups.scimExternalId} != ${v}`;
        case 'co':
          return ilike(groups.scimExternalId, `%${v}%`);
        case 'sw':
          return ilike(groups.scimExternalId, `${v}%`);
        case 'pr':
          return isNotNull(groups.scimExternalId);
      }
      break;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Row → Record mapping
// ---------------------------------------------------------------------------

/**
 * Maps a DB group row + member list to a SCIMGroupRecord.
 */
function rowToRecord(row: GroupRow, members: SCIMGroupMember[]): SCIMGroupRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    displayName: row.displayName,
    externalId: row.scimExternalId ?? null,
    externalSource: row.scimSource ?? null,
    members,
    memberCount: members.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// DrizzleGroupStore
// ---------------------------------------------------------------------------

export class DrizzleGroupStore implements SCIMGroupStore {
  constructor(private readonly db: NodePgDatabase) {}

  // -------------------------------------------------------------------------
  // Private helper: load members for a group
  // -------------------------------------------------------------------------

  private async loadMembers(groupId: string): Promise<SCIMGroupMember[]> {
    const rows = await this.db
      .select({
        userId: groupMembers.userId,
        displayName: users.name,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, groupId));

    return rows.map((r) => ({
      value: r.userId,
      display: r.displayName,
    }));
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(
    tenantId: string,
    record: Omit<
      SCIMGroupRecord,
      'id' | 'tenantId' | 'members' | 'memberCount' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<SCIMGroupRecord> {
    const rows = await this.db
      .insert(groups)
      .values({
        tenantId,
        displayName: record.displayName,
        scimExternalId: record.externalId ?? null,
        scimSource: record.externalSource ?? null,
      })
      .returning();

    // insert().returning() always returns one row on success.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = rows[0]!;
    const members = await this.loadMembers(row.id);
    return rowToRecord(row, members);
  }

  // -------------------------------------------------------------------------
  // getById
  // -------------------------------------------------------------------------

  async getById(tenantId: string, id: string): Promise<SCIMGroupRecord | null> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, id)));

    if (!rows[0]) return null;
    const members = await this.loadMembers(rows[0].id);
    return rowToRecord(rows[0], members);
  }

  // -------------------------------------------------------------------------
  // getByExternalId
  // -------------------------------------------------------------------------

  async getByExternalId(tenantId: string, externalId: string): Promise<SCIMGroupRecord | null> {
    const rows = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.scimExternalId, externalId)));

    if (!rows[0]) return null;
    const members = await this.loadMembers(rows[0].id);
    return rowToRecord(rows[0], members);
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<SCIMGroupRecord, 'displayName' | 'externalId' | 'externalSource'>>,
  ): Promise<SCIMGroupRecord | null> {
    const set: Partial<typeof groups.$inferInsert> = { updatedAt: new Date() };

    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.externalId !== undefined) set.scimExternalId = patch.externalId ?? null;
    if (patch.externalSource !== undefined) set.scimSource = patch.externalSource ?? null;

    const rows = await this.db
      .update(groups)
      .set(set)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, id)))
      .returning();

    if (!rows[0]) return null;
    const members = await this.loadMembers(rows[0].id);
    return rowToRecord(rows[0], members);
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(tenantId: string, id: string): Promise<void> {
    await this.db.delete(groups).where(and(eq(groups.tenantId, tenantId), eq(groups.id, id)));
  }

  // -------------------------------------------------------------------------
  // syncMembers — full-replace semantics (PUT /Groups/:id)
  //
  // CRITICAL: Uses db.transaction() to atomically delete all existing members
  // then insert new ones. This guarantees consistency under concurrent requests.
  // -------------------------------------------------------------------------

  async syncMembers(groupId: string, userIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Step 1: delete all existing memberships for this group.
      await tx.delete(groupMembers).where(eq(groupMembers.groupId, groupId));

      // Step 2: insert new memberships (only if there are any).
      if (userIds.length > 0) {
        await tx.insert(groupMembers).values(
          userIds.map((userId) => ({
            groupId,
            userId,
            addedBy: 'scim',
          })),
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // addMember
  // -------------------------------------------------------------------------

  async addMember(groupId: string, userId: string): Promise<void> {
    await this.db
      .insert(groupMembers)
      .values({ groupId, userId, addedBy: 'scim' })
      .onConflictDoNothing();
  }

  // -------------------------------------------------------------------------
  // removeMember
  // -------------------------------------------------------------------------

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  async list(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMGroupRecord[]; total: number }> {
    const offset = Math.max(0, params.startIndex - 1);

    const conditions: SQL[] = [eq(groups.tenantId, tenantId)];
    if (params.filter) {
      const filterExpr = scimFilterToGroupSQL(params.filter);
      if (filterExpr) conditions.push(filterExpr);
    }

    const whereClause = and(...conditions);

    // Run group list query and count query in parallel.
    const [rows, countRows] = await Promise.all([
      this.db.select().from(groups).where(whereClause).limit(params.count).offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(groups)
        .where(whereClause),
    ]);

    // Load members for each group (sequential; groups lists are typically small).
    const records = await Promise.all(
      rows.map(async (row) => {
        const members = await this.loadMembers(row.id);
        return rowToRecord(row, members);
      }),
    );

    return {
      records,
      total: countRows[0]?.count ?? 0,
    };
  }
}
