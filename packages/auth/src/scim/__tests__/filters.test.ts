// packages/auth/src/scim/__tests__/filters.test.ts
import { describe, it, expect } from 'vitest';
import { parseSCIMFilter, buildFilterSQL } from '../filters';

describe('parseSCIMFilter', () => {
  it('parses eq operator', () => {
    expect(parseSCIMFilter('userName eq "alice@example.com"')).toEqual({
      field: 'userName',
      operator: 'eq',
      value: 'alice@example.com',
    });
  });
  it('parses ne operator', () => {
    expect(parseSCIMFilter('active ne "false"')).toEqual({
      field: 'active',
      operator: 'ne',
      value: 'false',
    });
  });
  it('parses co operator (contains)', () => {
    expect(parseSCIMFilter('displayName co "alice"')).toEqual({
      field: 'displayName',
      operator: 'co',
      value: 'alice',
    });
  });
  it('parses sw operator (starts-with)', () => {
    expect(parseSCIMFilter('emails.value sw "alice"')).toEqual({
      field: 'emails.value',
      operator: 'sw',
      value: 'alice',
    });
  });
  it('parses pr operator (present)', () => {
    expect(parseSCIMFilter('externalId pr')).toEqual({
      field: 'externalId',
      operator: 'pr',
      value: undefined,
    });
  });
  it('returns null for unsupported filter', () => {
    expect(parseSCIMFilter('unknown gt "5"')).toBeNull();
  });
});

describe('buildFilterSQL', () => {
  it('eq produces = clause', () => {
    const result = buildFilterSQL(
      { field: 'userName', operator: 'eq', value: 'alice' },
      { userName: 'user_name' },
    );
    expect(result?.clause).toBe('user_name = $1');
    expect(result?.params).toEqual(['alice']);
  });
  it('ne produces <> clause', () => {
    const result = buildFilterSQL(
      { field: 'active', operator: 'ne', value: 'false' },
      { active: 'status' },
    );
    expect(result?.clause).toBe('status <> $1');
    expect(result?.params).toEqual(['false']);
  });
  it('co produces ILIKE %val% clause', () => {
    const result = buildFilterSQL(
      { field: 'displayName', operator: 'co', value: 'alice' },
      { displayName: 'display_name' },
    );
    expect(result?.clause).toBe('display_name ILIKE $1');
    expect(result?.params).toEqual(['%alice%']);
  });
  it('sw produces ILIKE val% clause', () => {
    const result = buildFilterSQL(
      { field: 'displayName', operator: 'sw', value: 'ali' },
      { displayName: 'display_name' },
    );
    expect(result?.clause).toBe('display_name ILIKE $1');
    expect(result?.params).toEqual(['ali%']);
  });
  it('pr produces IS NOT NULL clause', () => {
    const result = buildFilterSQL(
      { field: 'externalId', operator: 'pr' },
      { externalId: 'scim_external_id' },
    );
    expect(result?.clause).toBe('scim_external_id IS NOT NULL');
    expect(result?.params).toEqual([]);
  });
  it('returns null for unmapped field', () => {
    const result = buildFilterSQL({ field: 'unknown', operator: 'eq', value: 'x' }, {});
    expect(result).toBeNull();
  });
});
