/**
 * useCommandPalette — Static navigation commands + debounced live search
 *
 * Provides the full command list for the CommandPalette component:
 * - "Navigate" group: route links for every top-level page
 * - "Live search" group: type-ahead results from /api/v1/search/suggest
 *
 * SECURITY:
 * - Query strings are opaque — no PHI in search keys (HIPAA §164.312)
 * - All results are tenant-scoped server-side (SOC2 CC6.1)
 * - Search errors are silently dropped — no error propagation to UI (Rule 7)
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchApi } from '../lib/search-api';
import type { ReactNode } from 'react';

// ─── Types ────────────────────────────────────────────────────────

interface Command {
  id: string;
  label: string;
  icon?: ReactNode;
  action: () => void;
  group?: string;
}

// ─── Navigation route definitions ────────────────────────────────

interface NavEntry {
  path: string;
  label: string;
  group: string;
}

const NAV_ENTRIES: readonly NavEntry[] = [
  { path: '/dashboard', label: 'Dashboard', group: 'Navigate' },
  { path: '/customers', label: 'Customers', group: 'Navigate' },
  { path: '/interactions', label: 'Interactions', group: 'Navigate' },
  { path: '/tickets', label: 'Tickets', group: 'Navigate' },
  { path: '/agents', label: 'Agent Activity', group: 'Navigate' },
  { path: '/analytics', label: 'Analytics', group: 'Navigate' },
  { path: '/reports', label: 'Reports', group: 'Navigate' },
  { path: '/compliance', label: 'Compliance', group: 'Navigate' },
  { path: '/workflows', label: 'Workflows', group: 'Navigate' },
  { path: '/integrations', label: 'Integrations', group: 'Navigate' },
  { path: '/marketplace', label: 'Marketplace', group: 'Navigate' },
  { path: '/audit-log', label: 'Audit Log', group: 'Navigate' },
  { path: '/notifications', label: 'Notifications', group: 'Navigate' },
  { path: '/settings', label: 'Settings', group: 'Navigate' },
  { path: '/help', label: 'Help Center', group: 'Navigate' },
  { path: '/developer', label: 'Developer Console', group: 'Navigate' },
  { path: '/healthcare', label: 'Healthcare Dashboard', group: 'Navigate' },
  { path: '/partner', label: 'Partner Dashboard', group: 'Navigate' },
  { path: '/profile', label: 'My Profile', group: 'Navigate' },
  { path: '/team', label: 'Team Management', group: 'Navigate' },
  { path: '/scheduler', label: 'Scheduler Monitor', group: 'Navigate' },
] as const;

// ─── Entity type → path resolver ─────────────────────────────────

function searchResultPath(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'contact':
      return `/customers/${entityId}`;
    case 'ticket':
      return `/tickets/${entityId}`;
    default:
      return '/search';
  }
}

// ─── Hook ────────────────────────────────────────────────────────

interface UseCommandPaletteReturn {
  /** Static navigation commands — always present */
  commands: Command[];
  /** Async search results — updated as user types */
  asyncResults: Command[];
  /** Call with the current query string to trigger debounced search */
  onQueryChange: (q: string) => void;
}

const DEBOUNCE_MS = 200;
const MIN_SEARCH_LENGTH = 2;

export function useCommandPalette(): UseCommandPaletteReturn {
  const navigate = useNavigate();
  const [asyncResults, setAsyncResults] = useState<Command[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commands: Command[] = useMemo(
    () =>
      NAV_ENTRIES.map((entry) => ({
        id: `nav-${entry.path}`,
        label: entry.label,
        group: entry.group,
        action: () => {
          void navigate(entry.path);
        },
      })),
    [navigate],
  );

  const onQueryChange = useCallback(
    (q: string) => {
      // Clear pending debounce
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }

      if (q.trim().length < MIN_SEARCH_LENGTH) {
        setAsyncResults([]);
        return;
      }

      debounceRef.current = setTimeout(() => {
        void searchApi.suggest(q).then(
          (suggestions) => {
            setAsyncResults(
              suggestions.map((s) => ({
                id: `search-${s.id}`,
                label: s.label,
                group: 'Search Results',
                action: () => {
                  void navigate(searchResultPath(s.entityType, s.entityId ?? s.id));
                },
              })),
            );
          },
          () => {
            // Search failure is non-critical — silently clear results (Rule 7)
            setAsyncResults([]);
          },
        );
      }, DEBOUNCE_MS);
    },
    [navigate],
  );

  return { commands, asyncResults, onQueryChange };
}
