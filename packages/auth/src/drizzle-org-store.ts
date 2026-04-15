/**
 * DrizzleOrgStore — PostgreSQL-backed organization persistence.
 *
 * Implements the OrgStore interface for OrganizationManager using Drizzle ORM.
 * All queries are tenant-scoped — no cross-tenant reads.
 *
 * SOC2 CC6.1 — Tenant isolation via tenantId filter on every query.
 * ISO 27001 A.8.3.1 — Organizational data persistence.
 */

import { eq, and, isNull } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import type { Organization, OrgStore } from './organization.js';

// ─── Row mapper ──────────────────────────────────────────────────────────────

function rowToOrganization(row: typeof schema.organizations.$inferSelect): Organization {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    parentId: row.parentId ?? null,
    slug: row.slug,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── DrizzleOrgStore ─────────────────────────────────────────────────────────

export class DrizzleOrgStore implements OrgStore {
  constructor(private readonly db: OrdrDatabase) {}

  async create(org: Organization): Promise<void> {
    await this.db.insert(schema.organizations).values({
      id: org.id,
      tenantId: org.tenantId,
      name: org.name,
      parentId: org.parentId ?? null,
      slug: org.slug,
      metadata: org.metadata as unknown,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    });
  }

  async getById(tenantId: string, orgId: string): Promise<Organization | null> {
    const rows = await this.db
      .select()
      .from(schema.organizations)
      .where(and(eq(schema.organizations.tenantId, tenantId), eq(schema.organizations.id, orgId)))
      .limit(1);
    return rows[0] !== undefined ? rowToOrganization(rows[0]) : null;
  }

  async getBySlug(tenantId: string, slug: string): Promise<Organization | null> {
    const rows = await this.db
      .select()
      .from(schema.organizations)
      .where(and(eq(schema.organizations.tenantId, tenantId), eq(schema.organizations.slug, slug)))
      .limit(1);
    return rows[0] !== undefined ? rowToOrganization(rows[0]) : null;
  }

  async list(tenantId: string, parentId?: string | null): Promise<readonly Organization[]> {
    const conditions = [eq(schema.organizations.tenantId, tenantId)];
    if (parentId !== undefined) {
      conditions.push(
        parentId === null
          ? isNull(schema.organizations.parentId)
          : eq(schema.organizations.parentId, parentId),
      );
    }
    const rows = await this.db
      .select()
      .from(schema.organizations)
      .where(and(...conditions));
    return rows.map(rowToOrganization);
  }

  async listAll(tenantId: string): Promise<readonly Organization[]> {
    const rows = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.tenantId, tenantId));
    return rows.map(rowToOrganization);
  }

  async update(
    tenantId: string,
    orgId: string,
    fields: Partial<Pick<Organization, 'name' | 'slug' | 'metadata'>>,
  ): Promise<Organization | null> {
    const set: Partial<typeof schema.organizations.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (fields.name !== undefined) set.name = fields.name;
    if (fields.slug !== undefined) set.slug = fields.slug;
    if (fields.metadata !== undefined) set.metadata = fields.metadata as unknown;

    await this.db
      .update(schema.organizations)
      .set(set)
      .where(and(eq(schema.organizations.tenantId, tenantId), eq(schema.organizations.id, orgId)));

    return this.getById(tenantId, orgId);
  }

  async delete(tenantId: string, orgId: string): Promise<void> {
    await this.db
      .delete(schema.organizations)
      .where(and(eq(schema.organizations.tenantId, tenantId), eq(schema.organizations.id, orgId)));
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- returns empty: no user-org mapping table yet
  async getUsersByOrg(_tenantId: string, _orgId: string): Promise<readonly string[]> {
    // TODO: implement when user-organization mapping table is added
    return [];
  }

  async getChildOrgIds(tenantId: string, orgId: string): Promise<readonly string[]> {
    const rows = await this.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(
        and(eq(schema.organizations.tenantId, tenantId), eq(schema.organizations.parentId, orgId)),
      );
    return rows.map((r) => r.id);
  }
}
