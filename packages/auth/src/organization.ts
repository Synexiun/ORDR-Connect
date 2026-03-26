/**
 * Organization Hierarchy — multi-level org structure management
 *
 * SOC2 CC6.3 — Organizational access control hierarchy.
 * ISO 27001 A.6.1.1 — Information security roles and responsibilities.
 * HIPAA §164.312(a)(1) — Access control scoped to organizational units.
 *
 * Supports tree-structured organizations within a tenant:
 * - Root organizations (parentId = null)
 * - Nested child organizations (unlimited depth)
 * - User-to-org assignment for scoped access
 */

import type { Result } from '@ordr/core';
import { ok, err, AppError, ERROR_CODES } from '@ordr/core';

// ─── Types ─────────────────────────────────────────────────────────

export interface Organization {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OrgTree {
  readonly org: Organization;
  readonly children: readonly OrgTree[];
}

export interface CreateOrgInput {
  readonly name: string;
  readonly parentId?: string | null;
  readonly slug: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ─── Org Store Interface (DI) ────────────────────────────────────

export interface OrgStore {
  create(org: Organization): Promise<void>;
  getById(tenantId: string, orgId: string): Promise<Organization | null>;
  getBySlug(tenantId: string, slug: string): Promise<Organization | null>;
  list(tenantId: string, parentId?: string | null): Promise<readonly Organization[]>;
  listAll(tenantId: string): Promise<readonly Organization[]>;
  update(tenantId: string, orgId: string, fields: Partial<Pick<Organization, 'name' | 'slug' | 'metadata'>>): Promise<Organization | null>;
  delete(tenantId: string, orgId: string): Promise<void>;
  getUsersByOrg(tenantId: string, orgId: string): Promise<readonly string[]>;
  getChildOrgIds(tenantId: string, orgId: string): Promise<readonly string[]>;
}

// ─── In-Memory Org Store (Testing) ───────────────────────────────

export class InMemoryOrgStore implements OrgStore {
  private readonly orgs = new Map<string, Organization>();
  private readonly userOrgs = new Map<string, readonly string[]>();

  async create(org: Organization): Promise<void> {
    this.orgs.set(`${org.tenantId}:${org.id}`, org);
  }

  async getById(tenantId: string, orgId: string): Promise<Organization | null> {
    return this.orgs.get(`${tenantId}:${orgId}`) ?? null;
  }

  async getBySlug(tenantId: string, slug: string): Promise<Organization | null> {
    for (const org of this.orgs.values()) {
      if (org.tenantId === tenantId && org.slug === slug) {
        return org;
      }
    }
    return null;
  }

  async list(tenantId: string, parentId?: string | null): Promise<readonly Organization[]> {
    const results: Organization[] = [];
    for (const org of this.orgs.values()) {
      if (org.tenantId === tenantId) {
        if (parentId === undefined) {
          results.push(org);
        } else if (org.parentId === parentId) {
          results.push(org);
        }
      }
    }
    return results;
  }

  async listAll(tenantId: string): Promise<readonly Organization[]> {
    const results: Organization[] = [];
    for (const org of this.orgs.values()) {
      if (org.tenantId === tenantId) {
        results.push(org);
      }
    }
    return results;
  }

  async update(
    tenantId: string,
    orgId: string,
    fields: Partial<Pick<Organization, 'name' | 'slug' | 'metadata'>>,
  ): Promise<Organization | null> {
    const key = `${tenantId}:${orgId}`;
    const existing = this.orgs.get(key);
    if (!existing) return null;

    const updated: Organization = {
      ...existing,
      ...fields,
      updatedAt: new Date(),
    };
    this.orgs.set(key, updated);
    return updated;
  }

  async delete(tenantId: string, orgId: string): Promise<void> {
    this.orgs.delete(`${tenantId}:${orgId}`);
  }

  async getUsersByOrg(tenantId: string, orgId: string): Promise<readonly string[]> {
    return this.userOrgs.get(`${tenantId}:${orgId}`) ?? [];
  }

  async getChildOrgIds(tenantId: string, orgId: string): Promise<readonly string[]> {
    const results: string[] = [];
    for (const org of this.orgs.values()) {
      if (org.tenantId === tenantId && org.parentId === orgId) {
        results.push(org.id);
      }
    }
    return results;
  }

  // Test helper
  addUserToOrg(tenantId: string, orgId: string, userId: string): void {
    const key = `${tenantId}:${orgId}`;
    const existing = this.userOrgs.get(key) ?? [];
    this.userOrgs.set(key, [...existing, userId]);
  }
}

// ─── Organization Manager ─────────────────────────────────────────

export class OrganizationManager {
  private readonly store: OrgStore;

  constructor(store: OrgStore) {
    this.store = store;
  }

  /**
   * Creates a new organization within a tenant.
   * Validates slug uniqueness within the tenant.
   */
  async createOrganization(
    tenantId: string,
    input: CreateOrgInput,
  ): Promise<Result<Organization, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    if (!input.name || input.name.trim().length === 0) {
      return err(new AppError('Organization name is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    if (!input.slug || input.slug.trim().length === 0) {
      return err(new AppError('Organization slug is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    // Validate slug format
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
      return err(new AppError(
        'Slug must be lowercase alphanumeric with hyphens only',
        ERROR_CODES.VALIDATION_FAILED,
        400,
      ));
    }

    // Check slug uniqueness within tenant
    const existing = await this.store.getBySlug(tenantId, input.slug);
    if (existing) {
      return err(new AppError(
        'Organization with this slug already exists in this tenant',
        ERROR_CODES.CONFLICT,
        409,
      ));
    }

    // Validate parent exists if specified
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const parent = await this.store.getById(tenantId, parentId);
      if (!parent) {
        return err(new AppError('Parent organization not found', ERROR_CODES.NOT_FOUND, 404));
      }
    }

    const now = new Date();
    const org: Organization = {
      id: `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      name: input.name,
      parentId,
      slug: input.slug,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    await this.store.create(org);
    return ok(org);
  }

  /**
   * Gets an organization by ID.
   */
  async getOrganization(
    tenantId: string,
    orgId: string,
  ): Promise<Result<Organization, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const org = await this.store.getById(tenantId, orgId);
    if (!org) {
      return err(new AppError('Organization not found', ERROR_CODES.NOT_FOUND, 404));
    }

    return ok(org);
  }

  /**
   * Lists organizations for a tenant, optionally filtered by parent.
   */
  async listOrganizations(
    tenantId: string,
    parentId?: string,
  ): Promise<Result<readonly Organization[], AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const orgs = await this.store.list(tenantId, parentId);
    return ok(orgs);
  }

  /**
   * Updates an organization's mutable fields.
   */
  async updateOrganization(
    tenantId: string,
    orgId: string,
    updates: Partial<Pick<Organization, 'name' | 'slug' | 'metadata'>>,
  ): Promise<Result<Organization, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const existing = await this.store.getById(tenantId, orgId);
    if (!existing) {
      return err(new AppError('Organization not found', ERROR_CODES.NOT_FOUND, 404));
    }

    // Check slug uniqueness if slug is being updated
    if (updates.slug && updates.slug !== existing.slug) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(updates.slug)) {
        return err(new AppError(
          'Slug must be lowercase alphanumeric with hyphens only',
          ERROR_CODES.VALIDATION_FAILED,
          400,
        ));
      }

      const slugConflict = await this.store.getBySlug(tenantId, updates.slug);
      if (slugConflict) {
        return err(new AppError(
          'Organization with this slug already exists in this tenant',
          ERROR_CODES.CONFLICT,
          409,
        ));
      }
    }

    const updated = await this.store.update(tenantId, orgId, updates);
    if (!updated) {
      return err(new AppError('Failed to update organization', ERROR_CODES.INTERNAL_ERROR, 500));
    }

    return ok(updated);
  }

  /**
   * Deletes an organization. Fails if the org has children.
   */
  async deleteOrganization(
    tenantId: string,
    orgId: string,
  ): Promise<Result<void, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const existing = await this.store.getById(tenantId, orgId);
    if (!existing) {
      return err(new AppError('Organization not found', ERROR_CODES.NOT_FOUND, 404));
    }

    // Check for children
    const children = await this.store.getChildOrgIds(tenantId, orgId);
    if (children.length > 0) {
      return err(new AppError(
        'Cannot delete organization with child organizations',
        ERROR_CODES.CONFLICT,
        409,
      ));
    }

    await this.store.delete(tenantId, orgId);
    return ok(undefined);
  }

  /**
   * Builds the full org hierarchy tree from a root org.
   */
  async getOrgHierarchy(
    tenantId: string,
    rootOrgId: string,
  ): Promise<Result<OrgTree, AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const rootOrg = await this.store.getById(tenantId, rootOrgId);
    if (!rootOrg) {
      return err(new AppError('Root organization not found', ERROR_CODES.NOT_FOUND, 404));
    }

    // Load all orgs for the tenant and build tree in memory
    const allOrgs = await this.store.listAll(tenantId);
    const tree = this.buildTree(rootOrg, allOrgs);

    return ok(tree);
  }

  /**
   * Gets all user IDs for an org, optionally including children.
   */
  async getUsersByOrg(
    tenantId: string,
    orgId: string,
    includeChildren?: boolean,
  ): Promise<Result<readonly string[], AppError>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(new AppError('Tenant ID is required', ERROR_CODES.VALIDATION_FAILED, 400));
    }

    const org = await this.store.getById(tenantId, orgId);
    if (!org) {
      return err(new AppError('Organization not found', ERROR_CODES.NOT_FOUND, 404));
    }

    const directUsers = await this.store.getUsersByOrg(tenantId, orgId);

    if (!includeChildren) {
      return ok(directUsers);
    }

    // Recursively collect users from child orgs
    const allUsers = [...directUsers];
    const childOrgIds = await this.store.getChildOrgIds(tenantId, orgId);

    for (const childId of childOrgIds) {
      const childResult = await this.getUsersByOrg(tenantId, childId, true);
      if (childResult.success) {
        allUsers.push(...childResult.data);
      }
    }

    // Deduplicate
    const unique = [...new Set(allUsers)];
    return ok(unique);
  }

  // ─── Internal Helpers ─────────────────────────────────────────────

  private buildTree(
    root: Organization,
    allOrgs: readonly Organization[],
  ): OrgTree {
    const children = allOrgs
      .filter((o) => o.parentId === root.id)
      .map((child) => this.buildTree(child, allOrgs));

    return { org: root, children };
  }
}
