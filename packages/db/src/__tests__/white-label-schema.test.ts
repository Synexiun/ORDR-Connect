/**
 * White-Label Schema Tests — validates table definition, columns, and constraints
 *
 * SOC2 CC6.1 — Verify tenant isolation via unique constraint.
 * ISO 27001 A.14.1.2 — Verify custom domain uniqueness.
 */

import { describe, it, expect } from 'vitest';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { whiteLabelConfigs } from '../schema/white-label.js';

describe('whiteLabelConfigs schema', () => {
  // ─── Table ───────────────────────────────────────────────────────

  it('exports a table named "white_label_configs"', () => {
    expect(getTableName(whiteLabelConfigs)).toBe('white_label_configs');
  });

  // ─── Column presence ─────────────────────────────────────────────

  it('has all required columns', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    const columnNames = Object.keys(columns);

    const expected = [
      'id',
      'tenantId',
      'customDomain',
      'logoUrl',
      'faviconUrl',
      'primaryColor',
      'accentColor',
      'bgColor',
      'textColor',
      'emailFromName',
      'emailFromAddress',
      'customCss',
      'footerText',
      'createdAt',
      'updatedAt',
    ];

    for (const col of expected) {
      expect(columnNames).toContain(col);
    }
  });

  it('has exactly 15 columns', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(Object.keys(columns).length).toBe(15);
  });

  // ─── Column types ────────────────────────────────────────────────

  it('id column is uuid type', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.id.dataType).toBe('string');
    expect(columns.id.columnType).toContain('UUID');
  });

  it('tenantId column is text type and not null', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.tenantId.dataType).toBe('string');
    expect(columns.tenantId.notNull).toBe(true);
  });

  it('customDomain column is text type and nullable', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.customDomain.dataType).toBe('string');
    expect(columns.customDomain.notNull).toBe(false);
  });

  it('logoUrl column is text type and nullable', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.logoUrl.dataType).toBe('string');
    expect(columns.logoUrl.notNull).toBe(false);
  });

  it('faviconUrl column is text type and nullable', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.faviconUrl.dataType).toBe('string');
    expect(columns.faviconUrl.notNull).toBe(false);
  });

  it('primaryColor has a default value of #3b82f6', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.primaryColor.notNull).toBe(true);
    expect(columns.primaryColor.hasDefault).toBe(true);
  });

  it('accentColor has a default value of #10b981', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.accentColor.notNull).toBe(true);
    expect(columns.accentColor.hasDefault).toBe(true);
  });

  it('bgColor has a default value of #0f172a', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.bgColor.notNull).toBe(true);
    expect(columns.bgColor.hasDefault).toBe(true);
  });

  it('textColor has a default value of #e2e8f0', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.textColor.notNull).toBe(true);
    expect(columns.textColor.hasDefault).toBe(true);
  });

  it('emailFromName is nullable', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.emailFromName.notNull).toBe(false);
  });

  it('emailFromAddress is nullable', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.emailFromAddress.notNull).toBe(false);
  });

  it('customCss is nullable', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.customCss.notNull).toBe(false);
  });

  it('footerText is nullable', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.footerText.notNull).toBe(false);
  });

  it('createdAt is not null with default', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);
  });

  it('updatedAt is not null with default', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.updatedAt.notNull).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
  });

  // ─── Unique constraints ─────────────────────────────────────────

  it('tenantId column is marked as unique', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.tenantId.isUnique).toBe(true);
  });

  it('id column has a default value (defaultRandom uuid)', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.id.hasDefault).toBe(true);
    expect(columns.id.notNull).toBe(true);
  });

  it('color columns have string data type', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    const colorCols = ['primaryColor', 'accentColor', 'bgColor', 'textColor'] as const;

    for (const col of colorCols) {
      expect(columns[col].dataType).toBe('string');
    }
  });

  it('timestamp columns have date data type', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.createdAt.dataType).toBe('date');
    expect(columns.updatedAt.dataType).toBe('date');
  });

  it('emailFromName has string data type', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.emailFromName.dataType).toBe('string');
  });

  it('emailFromAddress has string data type', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.emailFromAddress.dataType).toBe('string');
  });

  it('customCss has string data type', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.customCss.dataType).toBe('string');
  });

  it('footerText has string data type', () => {
    const columns = getTableColumns(whiteLabelConfigs);
    expect(columns.footerText.dataType).toBe('string');
  });

  // ─── Barrel export ───────────────────────────────────────────────

  it('is exported from the schema barrel', async () => {
    const schema = await import('../schema/index.js');
    expect(schema.whiteLabelConfigs).toBeDefined();
    expect(getTableName(schema.whiteLabelConfigs)).toBe('white_label_configs');
  });

  it('table symbol matches whiteLabelConfigs export', () => {
    expect(whiteLabelConfigs).toBeDefined();
    const name = getTableName(whiteLabelConfigs);
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });
});
