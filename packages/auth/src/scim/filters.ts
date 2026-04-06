import type { SCIMFilter } from './types.js';

// RFC 3986 compatible SCIM filter regex: field operator [value]
// Supports operators: eq, ne, co, sw, pr
// eslint-disable-next-line security/detect-unsafe-regex -- known safe pattern for SCIM syntax
const FILTER_REGEX = /^(\S+)\s+(eq|ne|co|sw|pr)(?:\s+"([^"]*)")?$/;

export function parseSCIMFilter(filterStr: string): SCIMFilter | null {
  const match = FILTER_REGEX.exec(filterStr.trim());
  if (!match) {
    return null;
  }

  const [, field, operator, value] = match;
  if (field === undefined || field === '' || operator === undefined || operator === '') return null;
  return {
    field,
    operator: operator as 'eq' | 'ne' | 'co' | 'sw' | 'pr',
    ...(value !== undefined ? { value } : {}),
  };
}
