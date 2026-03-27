/**
 * ThemeProvider Component Tests
 *
 * Validates:
 * - Renders children correctly
 * - Fetches branding on mount
 * - Applies theme from API response
 * - Falls back to defaults on API error
 * - useBranding() returns current brand config
 * - Dynamic favicon updates
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, useBranding } from '../components/ThemeProvider';
import * as themeModule from '../lib/theme';
import type { ClientBrandConfig } from '../lib/theme';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
  },
  setAccessToken: vi.fn(),
  getAccessToken: vi.fn(),
  setOnUnauthorized: vi.fn(),
}));

// ─── Fixtures ────────────────────────────────────────────────────

const CUSTOM_BRAND: ClientBrandConfig = {
  tenantId: 'tenant-001',
  customDomain: 'app.acme.com',
  logoUrl: 'https://acme.com/logo.png',
  faviconUrl: 'https://acme.com/favicon.ico',
  primaryColor: '#ff0000',
  accentColor: '#00ff00',
  bgColor: '#111111',
  textColor: '#eeeeee',
  emailFromName: 'Acme Support',
  emailFromAddress: 'support@acme.com',
  customCss: '.header { color: red; }',
  footerText: 'Powered by Acme',
};

// ─── Helper Component ────────────────────────────────────────────

function BrandConsumer(): ReturnType<typeof createElement> {
  const { brand, isLoading } = useBranding();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'loading' }, String(isLoading)),
    createElement('span', { 'data-testid': 'primary' }, brand.primaryColor),
    createElement('span', { 'data-testid': 'tenant' }, brand.tenantId),
    brand.logoUrl !== null ? createElement('span', { 'data-testid': 'logo' }, brand.logoUrl) : null,
    brand.footerText !== null
      ? createElement('span', { 'data-testid': 'footer' }, brand.footerText)
      : null,
  );
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Clean up DOM
  const faviconLinks = document.querySelectorAll('link[rel="icon"]');
  faviconLinks.forEach((el) => {
    el.remove();
  });
  const customStyles = document.querySelectorAll('style[data-ordr-custom]');
  customStyles.forEach((el) => {
    el.remove();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('ThemeProvider', () => {
  it('renders children', () => {
    mockGet.mockResolvedValue({ success: true, data: themeModule.getDefaultBrandConfig() });

    render(
      createElement(ThemeProvider, null, createElement('div', { 'data-testid': 'child' }, 'Hello')),
    );

    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.getByTestId('child').textContent).toBe('Hello');
  });

  it('fetches branding on mount', async () => {
    mockGet.mockResolvedValue({ success: true, data: themeModule.getDefaultBrandConfig() });

    render(createElement(ThemeProvider, null, createElement('div', null, 'content')));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/v1/branding',
        expect.objectContaining({ signal: expect.anything() as unknown }),
      );
    });
  });

  it('applies theme from API response', async () => {
    mockGet.mockResolvedValue({ success: true, data: CUSTOM_BRAND });
    const applyThemeSpy = vi.spyOn(themeModule, 'applyTheme');

    render(createElement(ThemeProvider, null, createElement(BrandConsumer)));

    await waitFor(() => {
      expect(applyThemeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ primaryColor: '#ff0000' }),
      );
    });
  });

  it('falls back to defaults on API error', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const applyThemeSpy = vi.spyOn(themeModule, 'applyTheme');

    render(createElement(ThemeProvider, null, createElement(BrandConsumer)));

    await waitFor(() => {
      // Should still call applyTheme with defaults
      expect(applyThemeSpy).toHaveBeenCalled();
    });

    // Consumer should show defaults
    await waitFor(() => {
      expect(screen.getByTestId('primary').textContent).toBe('#3b82f6');
    });
  });

  it('useBranding() returns current brand config after fetch', async () => {
    mockGet.mockResolvedValue({ success: true, data: CUSTOM_BRAND });

    render(createElement(ThemeProvider, null, createElement(BrandConsumer)));

    await waitFor(() => {
      expect(screen.getByTestId('primary').textContent).toBe('#ff0000');
    });
    expect(screen.getByTestId('tenant').textContent).toBe('tenant-001');
  });

  it('useBranding() returns defaults before fetch completes', () => {
    // Never resolve the promise
    mockGet.mockReturnValue(new Promise(() => {}));

    render(createElement(ThemeProvider, null, createElement(BrandConsumer)));

    expect(screen.getByTestId('primary').textContent).toBe('#3b82f6');
    expect(screen.getByTestId('loading').textContent).toBe('true');
  });

  it('sets isLoading to false after fetch completes', async () => {
    mockGet.mockResolvedValue({ success: true, data: CUSTOM_BRAND });

    render(createElement(ThemeProvider, null, createElement(BrandConsumer)));

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });

  it('sets isLoading to false after fetch error', async () => {
    mockGet.mockRejectedValue(new Error('fail'));

    render(createElement(ThemeProvider, null, createElement(BrandConsumer)));

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });

  it('provides logo URL from API response', async () => {
    mockGet.mockResolvedValue({ success: true, data: CUSTOM_BRAND });

    render(createElement(ThemeProvider, null, createElement(BrandConsumer)));

    await waitFor(() => {
      expect(screen.getByTestId('logo').textContent).toBe('https://acme.com/logo.png');
    });
  });

  it('provides footer text from API response', async () => {
    mockGet.mockResolvedValue({ success: true, data: CUSTOM_BRAND });

    render(createElement(ThemeProvider, null, createElement(BrandConsumer)));

    await waitFor(() => {
      expect(screen.getByTestId('footer').textContent).toBe('Powered by Acme');
    });
  });

  it('handles API returning success: false gracefully', async () => {
    mockGet.mockResolvedValue({ success: false, data: null });

    render(createElement(ThemeProvider, null, createElement(BrandConsumer)));

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    // Should keep defaults since success was false
    expect(screen.getByTestId('primary').textContent).toBe('#3b82f6');
  });

  it('renders multiple children', () => {
    mockGet.mockResolvedValue({ success: true, data: themeModule.getDefaultBrandConfig() });

    render(
      createElement(
        ThemeProvider,
        null,
        createElement('div', { 'data-testid': 'first' }, 'A'),
        createElement('div', { 'data-testid': 'second' }, 'B'),
      ),
    );

    expect(screen.getByTestId('first').textContent).toBe('A');
    expect(screen.getByTestId('second').textContent).toBe('B');
  });

  it('updates favicon dynamically via applyTheme', async () => {
    mockGet.mockResolvedValue({ success: true, data: CUSTOM_BRAND });

    render(createElement(ThemeProvider, null, createElement('div', null, 'content')));

    await waitFor(() => {
      const faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      expect(faviconLink).not.toBeNull();
      expect(faviconLink?.href).toContain('favicon.ico');
    });
  });

  it('aborts fetch on unmount', () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      createElement(ThemeProvider, null, createElement('div', null, 'content')),
    );

    // Verify the signal was passed
    expect(mockGet).toHaveBeenCalledWith(
      '/v1/branding',
      expect.objectContaining({ signal: expect.anything() as unknown }),
    );

    // Unmount should not throw
    unmount();
  });
});
