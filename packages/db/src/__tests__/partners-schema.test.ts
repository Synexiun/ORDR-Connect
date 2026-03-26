/**
 * Partner Schema Tests — validates table definitions, columns, constraints
 *
 * Verifies:
 * - partners table structure, columns, enums
 * - partner_payouts table structure, FK relationships
 * - Enum values for partner tier, status, payout status
 * - Revenue share constraints (column exists, not null)
 * - Schema barrel exports from index.ts
 */

import { describe, it, expect } from 'vitest';
import {
  partners,
  partnerPayouts,
  partnerTierEnum,
  partnerStatusEnum,
  partnerPayoutStatusEnum,
} from '../schema/partners.js';

// ---- partners table ---------------------------------------------------------

describe('partners schema', () => {
  it('exports the partners table', () => {
    expect(partners).toBeDefined();
  });

  it('has all required columns', () => {
    const columns = Object.keys(partners);
    expect(columns).toContain('id');
    expect(columns).toContain('name');
    expect(columns).toContain('email');
    expect(columns).toContain('company');
    expect(columns).toContain('tier');
    expect(columns).toContain('status');
    expect(columns).toContain('revenueSharePct');
    expect(columns).toContain('apiKeyHash');
    expect(columns).toContain('createdAt');
    expect(columns).toContain('updatedAt');
  });

  it('has id as primary key with uuid type', () => {
    const col = partners.id;
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
    expect(col.columnType).toBe('PgUUID');
  });

  it('has name as not null', () => {
    expect(partners.name.notNull).toBe(true);
  });

  it('has email as not null', () => {
    expect(partners.email.notNull).toBe(true);
  });

  it('has company as not null', () => {
    expect(partners.company.notNull).toBe(true);
  });

  it('has tier as not null', () => {
    expect(partners.tier.notNull).toBe(true);
  });

  it('has status as not null', () => {
    expect(partners.status.notNull).toBe(true);
  });

  it('has revenueSharePct as not null', () => {
    expect(partners.revenueSharePct.notNull).toBe(true);
  });

  it('apiKeyHash can be null (optional until activated)', () => {
    expect(partners.apiKeyHash.notNull).toBe(false);
  });

  it('has createdAt as not null', () => {
    expect(partners.createdAt.notNull).toBe(true);
  });

  it('has updatedAt as not null', () => {
    expect(partners.updatedAt.notNull).toBe(true);
  });
});

// ---- partner_payouts table --------------------------------------------------

describe('partner_payouts schema', () => {
  it('exports the partnerPayouts table', () => {
    expect(partnerPayouts).toBeDefined();
  });

  it('has all required columns', () => {
    const columns = Object.keys(partnerPayouts);
    expect(columns).toContain('id');
    expect(columns).toContain('partnerId');
    expect(columns).toContain('amountCents');
    expect(columns).toContain('currency');
    expect(columns).toContain('periodStart');
    expect(columns).toContain('periodEnd');
    expect(columns).toContain('status');
    expect(columns).toContain('paidAt');
    expect(columns).toContain('createdAt');
  });

  it('has id as primary key with uuid type', () => {
    const col = partnerPayouts.id;
    expect(col.dataType).toBe('string');
    expect(col.notNull).toBe(true);
    expect(col.columnType).toBe('PgUUID');
  });

  it('has partnerId as not null (FK reference)', () => {
    expect(partnerPayouts.partnerId.notNull).toBe(true);
  });

  it('has amountCents as not null', () => {
    expect(partnerPayouts.amountCents.notNull).toBe(true);
  });

  it('has currency as not null', () => {
    expect(partnerPayouts.currency.notNull).toBe(true);
  });

  it('has periodStart as not null', () => {
    expect(partnerPayouts.periodStart.notNull).toBe(true);
  });

  it('has periodEnd as not null', () => {
    expect(partnerPayouts.periodEnd.notNull).toBe(true);
  });

  it('has status as not null', () => {
    expect(partnerPayouts.status.notNull).toBe(true);
  });

  it('paidAt can be null (unpaid payouts)', () => {
    expect(partnerPayouts.paidAt.notNull).toBe(false);
  });
});

// ---- Enums ------------------------------------------------------------------

describe('partner enums', () => {
  it('partnerTierEnum has correct values', () => {
    expect(partnerTierEnum.enumValues).toEqual([
      'silver',
      'gold',
      'platinum',
    ]);
  });

  it('partnerStatusEnum has correct values', () => {
    expect(partnerStatusEnum.enumValues).toEqual([
      'pending',
      'active',
      'suspended',
    ]);
  });

  it('partnerPayoutStatusEnum has correct values', () => {
    expect(partnerPayoutStatusEnum.enumValues).toEqual([
      'pending',
      'processing',
      'paid',
      'failed',
    ]);
  });

  it('partner tier enum has 3 values', () => {
    expect(partnerTierEnum.enumValues).toHaveLength(3);
  });

  it('partner status enum has 3 values', () => {
    expect(partnerStatusEnum.enumValues).toHaveLength(3);
  });

  it('partner payout status enum has 4 values', () => {
    expect(partnerPayoutStatusEnum.enumValues).toHaveLength(4);
  });
});

// ---- Barrel export verification ---------------------------------------------

describe('schema index exports', () => {
  it('re-exports all partner tables and enums from index', async () => {
    const schema = await import('../schema/index.js');
    expect(schema.partners).toBeDefined();
    expect(schema.partnerPayouts).toBeDefined();
    expect(schema.partnerTierEnum).toBeDefined();
    expect(schema.partnerStatusEnum).toBeDefined();
    expect(schema.partnerPayoutStatusEnum).toBeDefined();
  });
});
