/**
 * useInterval — Safe interval hook that clears on unmount and handles delay changes.
 *
 * COMPLIANCE: No sensitive data handled here — pure timing utility.
 */

import { useEffect, useRef } from 'react';

/**
 * Runs `callback` every `delay` milliseconds.
 * Pass `null` for delay to pause the interval.
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);
  // Keep ref current so the callback closure always sees fresh state
  savedCallback.current = callback;

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => {
      savedCallback.current();
    }, delay);
    return () => {
      clearInterval(id);
    };
  }, [delay]);
}
