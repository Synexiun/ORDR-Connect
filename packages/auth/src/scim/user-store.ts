/**
 * DrizzleUserStore — Drizzle ORM implementation of SCIMUserStore.
 *
 * IMPORTANT: SCIM filter translation uses Drizzle typed operators exclusively.
 * Rule 4 — never sql.raw() with user-supplied values (SQL injection prevention).
 *
 * Schema notes (packages/db/src/schema/users.ts):
 *  - `users.name`          → SCIMUserRecord.displayName
 *  - `users.email`         → SCIMUserRecord.userName  (no separate userName column)
 *  - `users.status`        → 'active' | 'suspended' | 'deactivated' (no 'inactive')
 *  - `users.scimExternalId`→ SCIMUserRecord.externalId
 *  - `users.scimSource`    → SCIMUserRecord.externalSource
 *  - `passwordHash`/`role` are notNull; SCIM-provisioned rows use locked placeholders.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, ilike, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import { users } from '@ordr/db';
import type { SCIMUserRecord, SCIMUserStore, SCIMListParams, SCIMFilter } from './types.js';

/** Sentinel password hash for SCIM-provisioned accounts (never usable for local login). */
const SCIM_LOCKED_HASH = 'SCIM_LOCKED';

/**
 * Translates a SCIMFilter to a Drizzle typed SQL expression.
 *
 * Rule 4 compliance: All values flow through Drizzle's parameterized operators
 * (eq, ne, ilike, isNotNull) — never via sql.raw() with user-supplied values.
 *
 * Schema mapping:
 *  - 'userName'    → users.email   (email is the SCIM userName for this schema)
 *  - 'displayName' → users.name
 *  - 'emails.value'→ users.email
 *  - 'active'      → users.status  ('true' → 'active', 'false' → 'suspended')
 *  - 'externalId'  → users.scimExternalId
 */
function scimFilterToUserSQL(filter: SCIMFilter): SQL | null {
  const v = filter.value ?? '';

  switch (filter.field) {
    case 'userName':
    case 'emails.value':
      switch (filter.operator) {
        case 'eq':
          return eq(users.email, v);
        case 'ne':
          return ne(users.email, v);
        case 'co':
          return ilike(users.email, `%${v}%`);
        case 'sw':
          return ilike(users.email, `${v}%`);
        case 'pr':
          return isNotNull(users.email);
      }
      break;

    case 'displayName':
      switch (filter.operator) {
        case 'eq':
          return eq(users.name, v);
        case 'ne':
          return ne(users.name, v);
        case 'co':
          return ilike(users.name, `%${v}%`);
        case 'sw':
          return ilike(users.name, `${v}%`);
        case 'pr':
          return isNotNull(users.name);
      }
      break;

    case 'active':
      // Map boolean string to status enum; 'true' → 'active', 'false' → 'suspended'
      switch (filter.operator) {
        case 'eq':
          return eq(users.status, v === 'true' ? 'active' : 'suspended');
        case 'ne':
          return ne(users.status, v === 'true' ? 'active' : 'suspended');
        case 'pr':
          return isNotNull(users.status);
        default:
          break;
      }
      break;

    case 'externalId':
      switch (filter.operator) {
        case 'eq':
          return eq(users.scimExternalId, v);
        case 'ne':
          return ne(users.scimExternalId, v);
        case 'co':
          return ilike(users.scimExternalId, `%${v}%`);
        case 'sw':
          return ilike(users.scimExternalId, `${v}%`);
        case 'pr':
          return isNotNull(users.scimExternalId);
      }
      break;
  }

  return null;
}

/**
 * Map a DB row to a SCIMUserRecord.
 *
 * - `row.email`         → userName (SCIM userName is email in this schema)
 * - `row.name`          → displayName
 * - `row.status`        → active  ('active' → true, everything else → false)
 * - `row.scimExternalId`→ externalId
 */
function rowToRecord(row: typeof users.$inferSelect): SCIMUserRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    externalId: row.scimExternalId ?? null,
    externalSource: row.scimSource ?? null,
    userName: row.email,
    displayName: row.name,
    emails: [{ value: row.email, primary: true }],
    active: row.status === 'active',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleUserStore implements SCIMUserStore {
  constructor(private readonly db: NodePgDatabase) {}

  async create(
    tenantId: string,
    record: Omit<SCIMUserRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<SCIMUserRecord> {
    // Use the primary email as both the stored email and userName.
    // For SCIM-provisioned users: passwordHash is locked (not usable for local login),
    // role defaults to 'agent' (least privilege).
    const primaryEmail = record.emails[0]?.value ?? record.userName;

    const rows = await this.db
      .insert(users)
      .values({
        tenantId,
        email: primaryEmail,
        name: record.displayName,
        passwordHash: SCIM_LOCKED_HASH,
        role: 'agent',
        status: record.active ? 'active' : 'suspended',
        scimExternalId: record.externalId ?? null,
        scimSource: record.externalSource ?? null,
      })
      .returning();

    // insert().returning() always returns one row when the insert succeeds.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return rowToRecord(rows[0]!);
  }

  async getById(tenantId: string, id: string): Promise<SCIMUserRecord | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));

    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async getByExternalId(tenantId: string, externalId: string): Promise<SCIMUserRecord | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.scimExternalId, externalId)));

    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async getByUserName(tenantId: string, userName: string): Promise<SCIMUserRecord | null> {
    // userName in SCIM maps to email in this schema.
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, userName)));

    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<SCIMUserRecord>,
  ): Promise<SCIMUserRecord | null> {
    const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

    if (patch.displayName !== undefined) set.name = patch.displayName;
    if (patch.active !== undefined) set.status = patch.active ? 'active' : 'suspended';
    if (patch.externalId !== undefined) set.scimExternalId = patch.externalId ?? null;
    if (patch.externalSource !== undefined) set.scimSource = patch.externalSource ?? null;
    if (patch.emails !== undefined && patch.emails.length > 0) {
      const newEmail = patch.emails[0]?.value;
      // email is notNull in schema — only update if a non-empty value is provided.
      if (newEmail !== undefined && newEmail !== '') set.email = newEmail;
    }

    const rows = await this.db
      .update(users)
      .set(set)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)))
      .returning();

    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async list(
    tenantId: string,
    params: SCIMListParams,
  ): Promise<{ records: SCIMUserRecord[]; total: number }> {
    const offset = Math.max(0, params.startIndex - 1);

    const conditions: SQL[] = [eq(users.tenantId, tenantId)];
    if (params.filter) {
      const filterExpr = scimFilterToUserSQL(params.filter);
      if (filterExpr) conditions.push(filterExpr);
    }

    const whereClause = and(...conditions);

    const [rows, countRows] = await Promise.all([
      this.db.select().from(users).where(whereClause).limit(params.count).offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(whereClause),
    ]);

    return {
      records: rows.map(rowToRecord),
      total: countRows[0]?.count ?? 0,
    };
  }
}
