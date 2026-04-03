/**
 * Search — Full-text search across contacts, deals, tickets, and activities.
 *
 * Tenant-scoped server-side; no cross-tenant results possible.
 *
 * SOC2 CC6.1 — Results are tenant-scoped by server.
 * HIPAA §164.312 — Search queries are opaque strings; no PHI in URL params.
 * ISO 27001 A.12.4.1 — All search requests correlated by requestId in audit log.
 *
 * COMPLIANCE: Never display raw entity IDs that could be correlated with PHI.
 * Display only displayTitle and displaySubtitle from server-rendered result.
 */

import { type ReactNode, useState, useCallback, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { Input } from '../components/ui/Input';
import { PageHeader } from '../components/layout/PageHeader';
import {
  AlertCircle,
  Search as SearchIcon,
  FileText,
  Users,
  Ticket,
  Activity,
} from '../components/icons';
import {
  searchApi,
  type SearchResult,
  type SearchResults,
  type SearchableEntityType,
} from '../lib/search-api';
import { useToast } from '../hooks/useToast';

// ── Helpers ───────────────────────────────────────────────────────

type BadgeVariant = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

const entityBadge: Record<SearchableEntityType, BadgeVariant> = {
  contact: 'info',
  deal: 'success',
  ticket: 'warning',
  activity: 'neutral',
};

const entityIcon: Record<SearchableEntityType, ReactNode> = {
  contact: <Users className="h-3.5 w-3.5" />,
  deal: <FileText className="h-3.5 w-3.5" />,
  ticket: <Ticket className="h-3.5 w-3.5" />,
  activity: <Activity className="h-3.5 w-3.5" />,
};

const ENTITY_FILTERS: { value: SearchableEntityType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'contact', label: 'Contacts' },
  { value: 'deal', label: 'Deals' },
  { value: 'ticket', label: 'Tickets' },
  { value: 'activity', label: 'Activities' },
];

// ── Sub-components ────────────────────────────────────────────────

interface ResultRowProps {
  result: SearchResult;
}

function ResultRow({ result }: ResultRowProps): ReactNode {
  return (
    <div className="flex items-start gap-3 rounded-lg p-3 hover:bg-surface-secondary">
      <div className="mt-0.5 flex-shrink-0 rounded-lg bg-surface-tertiary p-1.5">
        {entityIcon[result.entityType]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-content">{result.displayTitle}</p>
          <Badge variant={entityBadge[result.entityType]} size="sm">
            {result.entityType}
          </Badge>
        </div>
        {result.displaySubtitle !== undefined && result.displaySubtitle !== '' && (
          <p className="mt-0.5 truncate text-xs text-content-secondary">{result.displaySubtitle}</p>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────

export function Search(): ReactNode {
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState<SearchableEntityType | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const executeSearch = useCallback(
    async (q: string, filter: SearchableEntityType | 'all'): Promise<void> => {
      if (q.trim() === '') return;
      setLoading(true);
      setError(null);
      try {
        const opts = filter !== 'all' ? { entityTypes: [filter] as SearchableEntityType[] } : {};
        const data = await searchApi.search(q.trim(), opts);
        setResults(data);
        setSearched(true);
      } catch {
        setError('Failed to search');
        toast('Search failed', 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const handleSubmit = useCallback(
    (e: { preventDefault(): void }): void => {
      e.preventDefault();
      void executeSearch(query, entityFilter);
    },
    [executeSearch, query, entityFilter],
  );

  const handleFilterChange = useCallback(
    (filter: SearchableEntityType | 'all'): void => {
      setEntityFilter(filter);
      if (searched && query.trim() !== '') {
        void executeSearch(query, filter);
      }
    },
    [executeSearch, query, searched],
  );

  // ── Render ────────────────────────────────────────────────────

  const hasResults = results !== null && results.results.length > 0;
  const hasQuery = query.trim() !== '';

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Search"
        subtitle="Full-text search across contacts, deals, tickets, and activities"
      />

      {/* ── Search Form ── */}
      <Card className="p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-tertiary" />
            <Input
              ref={inputRef}
              type="search"
              placeholder="Search contacts, deals, tickets, activities…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              className="pl-9"
              aria-label="Search query"
            />
          </div>
          <Button type="submit" variant="primary" disabled={!hasQuery || loading}>
            {loading ? <Spinner size="sm" /> : 'Search'}
          </Button>
        </form>

        {/* Entity type filter */}
        <div
          className="mt-3 flex flex-wrap gap-1.5"
          role="group"
          aria-label="Filter by entity type"
        >
          {ENTITY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                handleFilterChange(f.value);
              }}
              className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
                entityFilter === f.value
                  ? 'bg-brand-accent text-[#060608]'
                  : 'bg-surface-secondary text-content-secondary hover:bg-surface-tertiary'
              }`}
              aria-pressed={entityFilter === f.value}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Card>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" label="Searching" />
        </div>
      )}

      {/* ── Error ── */}
      {!loading && error !== null && (
        <Card className="flex items-center gap-3 p-5 text-red-600 dark:text-red-400">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </Card>
      )}

      {/* ── Empty prompt (not yet searched) ── */}
      {!loading && error === null && !searched && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <SearchIcon className="h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-content-secondary">Enter a query to search</p>
          <p className="text-xs text-content-tertiary">
            Search across all entity types or filter by type
          </p>
        </div>
      )}

      {/* ── No results ── */}
      {!loading &&
        error === null &&
        searched &&
        results !== null &&
        results.results.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <SearchIcon className="h-8 w-8 text-gray-300" />
            <p className="text-sm text-content-secondary">No results found</p>
          </div>
        )}

      {/* ── Results ── */}
      {!loading && error === null && hasResults && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-content-secondary">
              <span className="font-semibold text-content">{results.total}</span> result
              {results.total !== 1 ? 's' : ''}
              {results.took > 0 && (
                <span className="ml-1 text-content-tertiary">({results.took}ms)</span>
              )}
            </p>
          </div>
          <Card className="divide-y divide-border p-0">
            {results.results.map((result) => (
              <ResultRow key={result.id} result={result} />
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
