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

export interface FilterSQLResult {
  clause: string;
  params: string[];
}

export function buildFilterSQL(
  filter: SCIMFilter,
  fieldMap: Record<string, string>,
  paramOffset = 1,
): FilterSQLResult | null {
  const col = fieldMap[filter.field];
  if (col === undefined) {
    return null;
  }

  const operator = filter.operator;

  const filterValue = filter.value ?? '';

  switch (operator) {
    case 'eq': {
      const result: FilterSQLResult = {
        clause: `${col} = $${paramOffset}`,
        params: [filterValue] as string[],
      };
      return result;
    }
    case 'ne': {
      const result: FilterSQLResult = {
        clause: `${col} <> $${paramOffset}`,
        params: [filterValue] as string[],
      };
      return result;
    }
    case 'co': {
      const result: FilterSQLResult = {
        clause: `${col} ILIKE $${paramOffset}`,
        params: [`%${filterValue}%`] as string[],
      };
      return result;
    }
    case 'sw': {
      const result: FilterSQLResult = {
        clause: `${col} ILIKE $${paramOffset}`,
        params: [`${filterValue}%`] as string[],
      };
      return result;
    }
    case 'pr': {
      const result: FilterSQLResult = {
        clause: `${col} IS NOT NULL`,
        params: [] as string[],
      };
      return result;
    }
  }
  return null;
}
