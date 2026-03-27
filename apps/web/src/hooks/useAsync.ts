/**
 * useAsync — Stateful async operation hook with loading/error tracking.
 *
 * Provides a consistent pattern for async data fetching with:
 * - Loading state management
 * - Error capture without swallowing
 * - Manual refetch trigger
 * - Stable fn reference via ref (no dependency array needed)
 *
 * COMPLIANCE: No sensitive data handled — pure control-flow utility.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────────

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

type UseAsyncResult<T> = AsyncState<T> & { readonly refetch: () => void };

// ─── Hook ────────────────────────────────────────────────────────

/**
 * Executes an async function and tracks its state.
 *
 * Re-executes whenever `deps` changes (same semantics as `useEffect`).
 * Use `refetch()` to re-execute manually without changing deps.
 *
 * @example
 * ```tsx
 * const { data, loading, error, refetch } = useAsync(
 *   () => fetchCustomers({ page, search }),
 *   [page, search],
 * );
 * ```
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): UseAsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const execute = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef
      .current()
      .then((data) => {
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        setState((s) => ({
          ...s,
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      });
  }, deps);

  useEffect(() => {
    execute();
  }, [execute]);

  return { ...state, refetch: execute };
}
