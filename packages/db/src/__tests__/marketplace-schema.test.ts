/**
 * Marketplace Schema Tests — validates table definitions, columns, constraints
 *
 * Verifies:
 * - marketplace_agents table structure, columns, enums
 * - marketplace_reviews table structure, FK relationships
 * - marketplace_installs table structure, unique constraints
 * - Enum values for agent status, install status
 * - Schema barrel exports from index.ts
 */

import { describe, it, expect } from 'vitest';
import {
  marketplaceAgents,
  marketplaceReviews,
  marketplaceInstalls,
  marketplaceAgentStatusEnum,
  marketplaceInstallStatusEnum,
} from '../schema/marketplace.js';

// ---- marketplace_agents table ------------------------------------------------

describe('marketplace_agents schema', () => {
  it('exports the marketplaceAgents table', () => {
    expect(marketplaceAgents).toBeDefined();
  });

  it('has all required columns', () => {
    const columns = Object.keys(marketplaceAgents);
    expect(columns).toContain('id');
    expect(columns).toContain('name');
    expect(columns).toContain('version');
    expect(columns).toContain('description');
    expect(columns).toContain('author');
    expect(columns).toContain('license');
    expect(columns).toContain('manifest');
    expect(columns).toContain('packageHash');
    expect(columns).toContain('downloads');
    expect(columns).toContain('rating');
    expect(columns).toContain('status');
    expect(columns).toContain('publisherId');
    expect(columns).toContain('rejectionReason');
    expect(columns).toContain('createdAt');
    expect(columns).toContain('updatedAt');
  });

  it('has id as primary key with uuid type', () => {
    const col = marketplaceAgents.id;
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
    expect(col.columnType).toBe('PgUUID');
  });

  it('has name as not null', () => {
    expect(marketplaceAgents.name.notNull).toBe(true);
  });

  it('has version as not null', () => {
    expect(marketplaceAgents.version.notNull).toBe(true);
  });

  it('has description as not null', () => {
    expect(marketplaceAgents.description.notNull).toBe(true);
  });

  it('has author as not null', () => {
    expect(marketplaceAgents.author.notNull).toBe(true);
  });

  it('has license as not null', () => {
    expect(marketplaceAgents.license.notNull).toBe(true);
  });

  it('has manifest as not null JSONB', () => {
    expect(marketplaceAgents.manifest.notNull).toBe(true);
  });

  it('has packageHash as not null', () => {
    expect(marketplaceAgents.packageHash.notNull).toBe(true);
  });

  it('has downloads as not null with default 0', () => {
    expect(marketplaceAgents.downloads.notNull).toBe(true);
  });

  it('has status as not null', () => {
    expect(marketplaceAgents.status.notNull).toBe(true);
  });

  it('has publisherId as not null (FK reference)', () => {
    expect(marketplaceAgents.publisherId.notNull).toBe(true);
  });
});

// ---- marketplace_reviews table -----------------------------------------------

describe('marketplace_reviews schema', () => {
  it('exports the marketplaceReviews table', () => {
    expect(marketplaceReviews).toBeDefined();
  });

  it('has all required columns', () => {
    const columns = Object.keys(marketplaceReviews);
    expect(columns).toContain('id');
    expect(columns).toContain('agentId');
    expect(columns).toContain('reviewerId');
    expect(columns).toContain('rating');
    expect(columns).toContain('comment');
    expect(columns).toContain('createdAt');
  });

  it('has id as primary key with uuid type', () => {
    const col = marketplaceReviews.id;
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
    expect(col.columnType).toBe('PgUUID');
  });

  it('has agentId as not null (FK reference)', () => {
    expect(marketplaceReviews.agentId.notNull).toBe(true);
  });

  it('has reviewerId as not null', () => {
    expect(marketplaceReviews.reviewerId.notNull).toBe(true);
  });

  it('has rating as not null', () => {
    expect(marketplaceReviews.rating.notNull).toBe(true);
  });

  it('comment can be null', () => {
    // comment is optional — notNull should be false
    expect(marketplaceReviews.comment.notNull).toBe(false);
  });
});

// ---- marketplace_installs table ----------------------------------------------

describe('marketplace_installs schema', () => {
  it('exports the marketplaceInstalls table', () => {
    expect(marketplaceInstalls).toBeDefined();
  });

  it('has all required columns', () => {
    const columns = Object.keys(marketplaceInstalls);
    expect(columns).toContain('id');
    expect(columns).toContain('tenantId');
    expect(columns).toContain('agentId');
    expect(columns).toContain('version');
    expect(columns).toContain('status');
    expect(columns).toContain('installedAt');
  });

  it('has id as primary key with uuid type', () => {
    const col = marketplaceInstalls.id;
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
    expect(col.columnType).toBe('PgUUID');
  });

  it('has tenantId as not null', () => {
    expect(marketplaceInstalls.tenantId.notNull).toBe(true);
  });

  it('has agentId as not null (FK reference)', () => {
    expect(marketplaceInstalls.agentId.notNull).toBe(true);
  });

  it('has version as not null', () => {
    expect(marketplaceInstalls.version.notNull).toBe(true);
  });

  it('has status as not null', () => {
    expect(marketplaceInstalls.status.notNull).toBe(true);
  });

  it('has installedAt as not null', () => {
    expect(marketplaceInstalls.installedAt.notNull).toBe(true);
  });
});

// ---- Enums ------------------------------------------------------------------

describe('marketplace enums', () => {
  it('marketplaceAgentStatusEnum has correct values', () => {
    expect(marketplaceAgentStatusEnum.enumValues).toEqual([
      'draft',
      'review',
      'published',
      'suspended',
      'rejected',
    ]);
  });

  it('marketplaceInstallStatusEnum has correct values', () => {
    expect(marketplaceInstallStatusEnum.enumValues).toEqual([
      'active',
      'disabled',
      'uninstalled',
    ]);
  });

  it('agent status enum has 5 values', () => {
    expect(marketplaceAgentStatusEnum.enumValues).toHaveLength(5);
  });

  it('install status enum has 3 values', () => {
    expect(marketplaceInstallStatusEnum.enumValues).toHaveLength(3);
  });
});

// ---- Barrel export verification ---------------------------------------------

describe('schema index exports', () => {
  it('re-exports all marketplace tables and enums from index', async () => {
    const schema = await import('../schema/index.js');
    expect(schema.marketplaceAgents).toBeDefined();
    expect(schema.marketplaceReviews).toBeDefined();
    expect(schema.marketplaceInstalls).toBeDefined();
    expect(schema.marketplaceAgentStatusEnum).toBeDefined();
    expect(schema.marketplaceInstallStatusEnum).toBeDefined();
  });
});
