import type { SCIMFilter } from './types';

// RFC 3986 compatible SCIM filter regex: field operator [value]
// Supports operators: eq, ne, co, sw, pr
// eslint-disable-next-line security/detect-unsafe-regex -- known safe pattern for SCIM syntax
const FILTER_REGEX = /^(\S+)\s+(eq|ne|co|sw|pr)(?:\s+"([^"]*)")?$/;

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- return type intentionally includes null
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
    value,
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- SCIMFilter is correctly typed
  const col = fieldMap[filter.field];
  if (col === undefined) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access -- SCIMFilter properties are correctly typed
  const operator = filter.operator;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access -- SCIMFilter properties are correctly typed
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
