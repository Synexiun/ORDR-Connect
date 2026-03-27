import { type ReactNode, useState, useCallback } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './Button';

// --- Column definition ---

type SortDirection = 'asc' | 'desc';

interface ColumnDef<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
}

// --- Pagination ---

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

interface TableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  pagination?: PaginationState;
  onPageChange?: (page: number) => void;
  onSort?: (key: string, direction: SortDirection) => void;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  loading?: boolean;
  className?: string;
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  pagination,
  onPageChange,
  onSort,
  onRowClick,
  emptyMessage = 'No data available',
  loading = false,
  className,
}: TableProps<T>): ReactNode {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const handleSort = useCallback(
    (key: string) => {
      const newDir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc';
      setSortKey(key);
      setSortDir(newDir);
      onSort?.(key, newDir);
    },
    [sortKey, sortDir, onSort],
  );

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.pageSize) : 0;

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" role="grid">
          <thead>
            <tr className="border-b border-border bg-surface-tertiary/50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-secondary',
                    col.sortable === true && 'cursor-pointer select-none hover:text-content',
                    col.className,
                  )}
                  onClick={
                    col.sortable === true
                      ? () => {
                          handleSort(col.key);
                        }
                      : undefined
                  }
                  aria-sort={
                    sortKey === col.key
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  role={col.sortable === true ? 'columnheader button' : 'columnheader'}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable === true && sortKey === col.key && (
                      <span className="text-content-tertiary" aria-hidden="true">
                        {sortDir === 'asc' ? '\u25B2' : '\u25BC'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-content-secondary"
                >
                  <span
                    className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-content-secondary border-t-transparent"
                    role="status"
                    aria-label="Loading"
                  />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-content-secondary"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  className={cn(
                    'bg-surface-secondary transition-colors',
                    onRowClick !== undefined && 'cursor-pointer hover:bg-surface-tertiary/50',
                  )}
                  onClick={
                    onRowClick !== undefined
                      ? () => {
                          onRowClick(row);
                        }
                      : undefined
                  }
                  role={onRowClick ? 'row button' : 'row'}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn('px-4 py-3', col.className)}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-xs text-content-secondary">
            Showing {(pagination.page - 1) * pagination.pageSize + 1}
            {'\u2013'}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange?.(pagination.page - 1)}
              aria-label="Previous page"
            >
              Prev
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (pagination.page <= 3) {
                pageNum = i + 1;
              } else if (pagination.page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = pagination.page - 2 + i;
              }
              return (
                <Button
                  key={pageNum}
                  variant={pagination.page === pageNum ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => onPageChange?.(pageNum)}
                  aria-label={`Page ${pageNum}`}
                  aria-current={pagination.page === pageNum ? 'page' : undefined}
                >
                  {pageNum}
                </Button>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              disabled={pagination.page >= totalPages}
              onClick={() => onPageChange?.(pagination.page + 1)}
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
