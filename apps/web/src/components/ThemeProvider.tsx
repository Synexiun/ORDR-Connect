/**
 * ThemeProvider — React context provider for white-label branding
 *
 * Fetches the current tenant's brand config from /v1/branding on mount,
 * applies CSS custom properties to :root, and provides a useBranding()
 * hook for components to access brand values (logo URL, name, etc.).
 *
 * SECURITY:
 * - No PHI/PII in brand config (Rule 6)
 * - Falls back to ORDR-Connect defaults if API fails (Rule 7 — graceful degradation)
 * - No secrets stored in React context (Rule 5)
 */

import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import { apiClient } from '../lib/api';
import { applyTheme, getDefaultBrandConfig, type ClientBrandConfig } from '../lib/theme';

// ─── Context ────────────────────────────────────────────────────

interface BrandingContextValue {
  readonly brand: ClientBrandConfig;
  readonly isLoading: boolean;
}

const BrandingContext = createContext<BrandingContextValue>({
  brand: getDefaultBrandConfig(),
  isLoading: true,
});

// ─── API Response Type ──────────────────────────────────────────

interface BrandingApiResponse {
  readonly success: boolean;
  readonly data: ClientBrandConfig;
}

// ─── Provider ───────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [brand, setBrand] = useState<ClientBrandConfig>(getDefaultBrandConfig);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchBranding(): Promise<void> {
      try {
        const response = await apiClient.get<BrandingApiResponse>('/v1/branding', {
          signal: controller.signal,
        });

        if (response.success) {
          setBrand(response.data);
          applyTheme(response.data);
        }
      } catch {
        // Graceful degradation: use defaults on failure (Rule 7)
        applyTheme(getDefaultBrandConfig());
      } finally {
        setIsLoading(false);
      }
    }

    void fetchBranding();

    return () => {
      controller.abort();
    };
  }, []);

  const value = useMemo<BrandingContextValue>(() => ({ brand, isLoading }), [brand, isLoading]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

// ─── Hook ───────────────────────────────────────────────────────

/**
 * Access the current tenant's brand configuration.
 * Returns defaults while loading or on error.
 */
export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}
