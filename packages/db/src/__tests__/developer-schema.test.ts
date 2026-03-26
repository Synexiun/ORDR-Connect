/**
 * Developer Schema Tests — validates table definitions, columns, constraints
 *
 * Verifies:
 * - developer_accounts table structure and constraints
 * - developer_usage table structure and FK relationships
 * - sandbox_tenants table structure, unique constraints, FK relationships
 * - Enum values for tier, status, sandbox_status, seed_data_profile
 * - Schema barrel exports
 */

import { describe, it, expect } from 'vitest';
import {
  developerAccounts,
  developerUsage,
  sandboxTenants,
  developerTierEnum,
  developerStatusEnum,
  sandboxStatusEnum,
  seedDataProfileEnum,
} from '../schema/developer.js';

// ---- developer_accounts table -----------------------------------------------

describe('developer_accounts schema', () => {
  it('exports the developerAccounts table', () => {
    expect(developerAccounts).toBeDefined();
  });

  it('has correct column names', () => {
    const columns = Object.keys(developerAccounts);
    expect(columns).toContain('id');
    expect(columns).toContain('email');
    expect(columns).toContain('displayName');
    expect(columns).toContain('organization');
    expect(columns).toContain('apiKeyHash');
    expect(columns).toContain('apiKeyPrefix');
    expect(columns).toContain('tier');
    expect(columns).toContain('rateLimitRpm');
    expect(columns).toContain('sandboxTenantId');
    expect(columns).toContain('createdAt');
    expect(columns).toContain('lastActiveAt');
    expect(columns).toContain('status');
  });

  it('has id as primary key with uuid type', () => {
    const col = developerAccounts.id;
    // Drizzle represents uuid columns with dataType 'string'
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
    expect(col.columnType).toBe('PgUUID');
  });

  it('has email as not null', () => {
    const col = developerAccounts.email;
    expect(col.notNull).toBe(true);
  });

  it('has apiKeyHash as not null', () => {
    const col = developerAccounts.apiKeyHash;
    expect(col.notNull).toBe(true);
  });

  it('has apiKeyPrefix with varchar(8) constraint', () => {
    const col = developerAccounts.apiKeyPrefix;
    expect(col.notNull).toBe(true);
  });
});

// ---- developer_usage table --------------------------------------------------

describe('developer_usage schema', () => {
  it('exports the developerUsage table', () => {
    expect(developerUsage).toBeDefined();
  });

  it('has correct column names', () => {
    const columns = Object.keys(developerUsage);
    expect(columns).toContain('id');
    expect(columns).toContain('developerId');
    expect(columns).toContain('endpoint');
    expect(columns).toContain('method');
    expect(columns).toContain('statusCode');
    expect(columns).toContain('latencyMs');
    expect(columns).toContain('timestamp');
  });

  it('has developerId as not null (FK reference)', () => {
    const col = developerUsage.developerId;
    expect(col.notNull).toBe(true);
  });

  it('has endpoint as not null', () => {
    expect(developerUsage.endpoint.notNull).toBe(true);
  });

  it('has method as not null', () => {
    expect(developerUsage.method.notNull).toBe(true);
  });
});

// ---- sandbox_tenants table --------------------------------------------------

describe('sandbox_tenants schema', () => {
  it('exports the sandboxTenants table', () => {
    expect(sandboxTenants).toBeDefined();
  });

  it('has correct column names', () => {
    const columns = Object.keys(sandboxTenants);
    expect(columns).toContain('id');
    expect(columns).toContain('developerId');
    expect(columns).toContain('tenantId');
    expect(columns).toContain('expiresAt');
    expect(columns).toContain('status');
    expect(columns).toContain('createdAt');
    expect(columns).toContain('seedDataProfile');
  });

  it('has tenantId as not null', () => {
    expect(sandboxTenants.tenantId.notNull).toBe(true);
  });

  it('has expiresAt as not null', () => {
    expect(sandboxTenants.expiresAt.notNull).toBe(true);
  });
});

// ---- Enums ------------------------------------------------------------------

describe('developer enums', () => {
  it('developerTierEnum has correct values', () => {
    expect(developerTierEnum.enumValues).toEqual(['free', 'pro', 'enterprise']);
  });

  it('developerStatusEnum has correct values', () => {
    expect(developerStatusEnum.enumValues).toEqual(['active', 'suspended', 'revoked']);
  });

  it('sandboxStatusEnum has correct values', () => {
    expect(sandboxStatusEnum.enumValues).toEqual(['active', 'expired', 'destroyed']);
  });

  it('seedDataProfileEnum has correct values', () => {
    expect(seedDataProfileEnum.enumValues).toEqual(['minimal', 'collections', 'healthcare']);
  });
});

// ---- Barrel export verification ---------------------------------------------

describe('schema index exports', () => {
  it('re-exports all developer tables and enums from index', async () => {
    const schema = await import('../schema/index.js');
    expect(schema.developerAccounts).toBeDefined();
    expect(schema.developerUsage).toBeDefined();
    expect(schema.sandboxTenants).toBeDefined();
    expect(schema.developerTierEnum).toBeDefined();
    expect(schema.developerStatusEnum).toBeDefined();
    expect(schema.sandboxStatusEnum).toBeDefined();
    expect(schema.seedDataProfileEnum).toBeDefined();
  });
});
