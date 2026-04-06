// packages/auth/src/scim/__tests__/filters.test.ts
import { describe, it, expect } from 'vitest';
import { parseSCIMFilter } from '../filters';

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
