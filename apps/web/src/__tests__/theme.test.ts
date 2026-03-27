/**
 * Theme Utility Tests
 *
 * Tests CSS property mapping, default values, theme application,
 * and ThemeProvider behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDefaultTheme,
  getDefaultBrandConfig,
  brandConfigToCSS,
  applyTheme,
  sanitizeCSS,
  type ClientBrandConfig,
} from '../lib/theme';

// ─── Default Theme ──────────────────────────────────────────────

describe('getDefaultTheme', () => {
  it('returns an object with CSS custom property keys', () => {
    const theme = getDefaultTheme();
    expect(theme).toHaveProperty('--brand-primary');
    expect(theme).toHaveProperty('--brand-accent');
    expect(theme).toHaveProperty('--brand-bg');
    expect(theme).toHaveProperty('--brand-text');
  });

  it('returns correct default primary color', () => {
    const theme = getDefaultTheme();
    expect(theme['--brand-primary']).toBe('#3b82f6');
  });

  it('returns correct default accent color', () => {
    const theme = getDefaultTheme();
    expect(theme['--brand-accent']).toBe('#10b981');
  });

  it('returns correct default background color', () => {
    const theme = getDefaultTheme();
    expect(theme['--brand-bg']).toBe('#0f172a');
  });

  it('returns correct default text color', () => {
    const theme = getDefaultTheme();
    expect(theme['--brand-text']).toBe('#e2e8f0');
  });

  it('returns exactly 4 CSS properties', () => {
    const theme = getDefaultTheme();
    expect(Object.keys(theme)).toHaveLength(4);
  });
});

// ─── Default Brand Config ───────────────────────────────────────

describe('getDefaultBrandConfig', () => {
  it('returns all required fields', () => {
    const config = getDefaultBrandConfig();
    expect(config.tenantId).toBe('');
    expect(config.primaryColor).toBe('#3b82f6');
    expect(config.accentColor).toBe('#10b981');
    expect(config.bgColor).toBe('#0f172a');
    expect(config.textColor).toBe('#e2e8f0');
  });

  it('returns null for optional URL fields', () => {
    const config = getDefaultBrandConfig();
    expect(config.logoUrl).toBeNull();
    expect(config.faviconUrl).toBeNull();
    expect(config.customDomain).toBeNull();
  });

  it('returns null for optional text fields', () => {
    const config = getDefaultBrandConfig();
    expect(config.emailFromName).toBeNull();
    expect(config.emailFromAddress).toBeNull();
    expect(config.customCss).toBeNull();
    expect(config.footerText).toBeNull();
  });
});

// ─── brandConfigToCSS ───────────────────────────────────────────

describe('brandConfigToCSS', () => {
  const customConfig: ClientBrandConfig = {
    tenantId: 'tenant-001',
    customDomain: null,
    logoUrl: 'https://example.com/logo.png',
    faviconUrl: null,
    primaryColor: '#ff0000',
    accentColor: '#00ff00',
    bgColor: '#000000',
    textColor: '#ffffff',
    emailFromName: null,
    emailFromAddress: null,
    customCss: null,
    footerText: null,
  };

  it('maps primaryColor to --brand-primary', () => {
    const css = brandConfigToCSS(customConfig);
    expect(css['--brand-primary']).toBe('#ff0000');
  });

  it('maps accentColor to --brand-accent', () => {
    const css = brandConfigToCSS(customConfig);
    expect(css['--brand-accent']).toBe('#00ff00');
  });

  it('maps bgColor to --brand-bg', () => {
    const css = brandConfigToCSS(customConfig);
    expect(css['--brand-bg']).toBe('#000000');
  });

  it('maps textColor to --brand-text', () => {
    const css = brandConfigToCSS(customConfig);
    expect(css['--brand-text']).toBe('#ffffff');
  });

  it('falls back to defaults for empty color strings', () => {
    const emptyConfig: ClientBrandConfig = {
      ...customConfig,
      primaryColor: '',
      accentColor: '',
      bgColor: '',
      textColor: '',
    };

    const css = brandConfigToCSS(emptyConfig);
    expect(css['--brand-primary']).toBe('#3b82f6');
    expect(css['--brand-accent']).toBe('#10b981');
    expect(css['--brand-bg']).toBe('#0f172a');
    expect(css['--brand-text']).toBe('#e2e8f0');
  });

  it('returns exactly 4 CSS properties', () => {
    const css = brandConfigToCSS(customConfig);
    expect(Object.keys(css)).toHaveLength(4);
  });

  it('does not include non-color fields in output', () => {
    const css = brandConfigToCSS(customConfig);
    expect(css).not.toHaveProperty('logoUrl');
    expect(css).not.toHaveProperty('tenantId');
    expect(css).not.toHaveProperty('footerText');
  });
});

// ─── applyTheme ─────────────────────────────────────────────────

describe('applyTheme', () => {
  let setPropertySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setPropertySpy = vi.spyOn(document.documentElement.style, 'setProperty');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any favicon links added during tests
    const faviconLinks = document.querySelectorAll('link[rel="icon"]');
    faviconLinks.forEach((el) => {
      el.remove();
    });
  });

  const testConfig: ClientBrandConfig = {
    tenantId: 'tenant-001',
    customDomain: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: '#ff0000',
    accentColor: '#00ff00',
    bgColor: '#000000',
    textColor: '#ffffff',
    emailFromName: null,
    emailFromAddress: null,
    customCss: null,
    footerText: null,
  };

  it('sets --brand-primary CSS property on document root', () => {
    applyTheme(testConfig);
    expect(setPropertySpy).toHaveBeenCalledWith('--brand-primary', '#ff0000');
  });

  it('sets --brand-accent CSS property on document root', () => {
    applyTheme(testConfig);
    expect(setPropertySpy).toHaveBeenCalledWith('--brand-accent', '#00ff00');
  });

  it('sets --brand-bg CSS property on document root', () => {
    applyTheme(testConfig);
    expect(setPropertySpy).toHaveBeenCalledWith('--brand-bg', '#000000');
  });

  it('sets --brand-text CSS property on document root', () => {
    applyTheme(testConfig);
    expect(setPropertySpy).toHaveBeenCalledWith('--brand-text', '#ffffff');
  });

  it('sets exactly 4 CSS properties', () => {
    applyTheme(testConfig);
    expect(setPropertySpy).toHaveBeenCalledTimes(4);
  });

  it('creates a favicon link element when faviconUrl is provided', () => {
    const configWithFavicon: ClientBrandConfig = {
      ...testConfig,
      faviconUrl: 'https://example.com/favicon.ico',
    };

    applyTheme(configWithFavicon);

    const faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(faviconLink).not.toBeNull();
    expect(faviconLink?.href).toContain('favicon.ico');
  });

  it('updates existing favicon link when one exists', () => {
    // Create an existing favicon
    const existing = document.createElement('link');
    existing.rel = 'icon';
    existing.href = '/old-favicon.ico';
    document.head.appendChild(existing);

    const configWithFavicon: ClientBrandConfig = {
      ...testConfig,
      faviconUrl: 'https://example.com/new-favicon.ico',
    };

    applyTheme(configWithFavicon);

    const links = document.querySelectorAll('link[rel="icon"]');
    expect(links).toHaveLength(1);
    expect((links[0] as HTMLLinkElement).href).toContain('new-favicon.ico');
  });

  it('does not modify favicon when faviconUrl is null', () => {
    applyTheme(testConfig);

    const faviconLink = document.querySelector('link[rel="icon"]');
    expect(faviconLink).toBeNull();
  });
});

// ─── sanitizeCSS ────────────────────────────────────────────────

describe('sanitizeCSS', () => {
  it('returns empty string for null-like input', () => {
    expect(sanitizeCSS('')).toBe('');
    expect(sanitizeCSS('   ')).toBe('');
  });

  it('strips <script> tags', () => {
    const input = '.header { color: red; }\n<script>alert("xss")</script>';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('</script');
    expect(result).not.toContain('alert');
  });

  it('strips <script> tags case-insensitively', () => {
    const input = '<SCRIPT>alert("xss")</SCRIPT>\n.body { color: blue; }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('SCRIPT');
    expect(result).not.toContain('alert');
  });

  it('strips javascript: URIs', () => {
    const input = '.link { background: javascript:void(0); }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('javascript:');
  });

  it('strips javascript: URIs case-insensitively', () => {
    const input = '.link { background: JAVASCRIPT:void(0); }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('JAVASCRIPT:');
    expect(result).not.toContain('javascript:');
  });

  it('strips expression()', () => {
    const input = '.ie-hack { width: expression(document.body.clientWidth); }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('expression');
    expect(result).not.toContain('document.body');
  });

  it('strips url() with data: URIs', () => {
    const input = '.bg { background: url(data:image/svg+xml;base64,PHN2Zz4=); }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('data:');
  });

  it('strips @import rules', () => {
    const input = '@import url("https://evil.com/styles.css");\n.header { color: red; }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('@import');
    expect(result).not.toContain('evil.com');
    expect(result).toContain('color: red');
  });

  it('strips @import with single quotes', () => {
    const input = "@import 'https://evil.com/hack.css';";
    const result = sanitizeCSS(input);
    expect(result).not.toContain('@import');
  });

  it('strips -moz-binding', () => {
    const input = '.xbl { -moz-binding: url("https://evil.com/xbl.xml#binding"); }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('-moz-binding');
  });

  it('strips behavior property', () => {
    const input = '.htc { behavior: url("hack.htc"); }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('behavior');
  });

  it('allows safe color properties', () => {
    const input = '.text { color: #ff0000; }';
    const result = sanitizeCSS(input);
    expect(result).toContain('color: #ff0000');
  });

  it('allows safe font properties', () => {
    const input = '.text { font-family: Arial, sans-serif; }';
    const result = sanitizeCSS(input);
    expect(result).toContain('font-family: Arial, sans-serif');
  });

  it('allows safe spacing properties', () => {
    const input = '.box { margin: 10px; padding: 20px; }';
    const result = sanitizeCSS(input);
    expect(result).toContain('margin: 10px');
    expect(result).toContain('padding: 20px');
  });

  it('allows safe border properties', () => {
    const input = '.card { border-radius: 8px; border: 1px solid #ccc; }';
    const result = sanitizeCSS(input);
    expect(result).toContain('border-radius: 8px');
    expect(result).toContain('border: 1px solid #ccc');
  });

  it('allows background-color', () => {
    const input = '.bg { background-color: #000; }';
    const result = sanitizeCSS(input);
    expect(result).toContain('background-color: #000');
  });

  it('strips unsafe properties like position', () => {
    const input = '.overlay { position: fixed; z-index: 99999; }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('position');
    expect(result).not.toContain('z-index');
  });

  it('strips unsafe properties like display', () => {
    const input = '.hidden { display: none; visibility: hidden; }';
    const result = sanitizeCSS(input);
    expect(result).not.toContain('display');
    expect(result).not.toContain('visibility');
  });

  it('preserves CSS selectors and braces', () => {
    const input = '.header {\n  color: red;\n}';
    const result = sanitizeCSS(input);
    expect(result).toContain('.header {');
    expect(result).toContain('}');
    expect(result).toContain('color: red');
  });

  it('preserves CSS comments', () => {
    const input = '/* Brand overrides */\n.main { color: blue; }';
    const result = sanitizeCSS(input);
    expect(result).toContain('/* Brand overrides */');
  });

  it('handles multiple dangerous patterns in one input', () => {
    const input = [
      '@import url("hack.css");',
      '<script>alert(1)</script>',
      '.safe { color: green; }',
      '.unsafe { position: absolute; }',
      '.bg { background: javascript:void(0); }',
    ].join('\n');

    const result = sanitizeCSS(input);
    expect(result).not.toContain('@import');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('position');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('color: green');
  });

  it('allows vendor-prefixed safe properties', () => {
    const input = '.animated { -webkit-transition: color 0.3s; }';
    const result = sanitizeCSS(input);
    expect(result).toContain('-webkit-transition');
  });

  it('handles box-shadow property', () => {
    const input = '.card { box-shadow: 0 2px 4px rgba(0,0,0,0.1); }';
    const result = sanitizeCSS(input);
    expect(result).toContain('box-shadow');
  });

  it('handles text-shadow property', () => {
    const input = '.title { text-shadow: 1px 1px 2px black; }';
    const result = sanitizeCSS(input);
    expect(result).toContain('text-shadow');
  });
});

// ─── applyTheme with customCss ──────────────────────────────────

describe('applyTheme with customCss', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    const customStyles = document.querySelectorAll('style[data-ordr-custom]');
    customStyles.forEach((el) => {
      el.remove();
    });
    const faviconLinks = document.querySelectorAll('link[rel="icon"]');
    faviconLinks.forEach((el) => {
      el.remove();
    });
  });

  const testConfig: ClientBrandConfig = {
    tenantId: 'tenant-001',
    customDomain: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: '#ff0000',
    accentColor: '#00ff00',
    bgColor: '#000000',
    textColor: '#ffffff',
    emailFromName: null,
    emailFromAddress: null,
    customCss: null,
    footerText: null,
  };

  it('injects sanitized customCss into a style element', () => {
    const config: ClientBrandConfig = {
      ...testConfig,
      customCss: '.header { color: red; }',
    };

    applyTheme(config);

    const styleEl = document.querySelector<HTMLStyleElement>('style[data-ordr-custom]');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain('color: red');
  });

  it('does not create style element when customCss is null', () => {
    applyTheme(testConfig);

    const styleEl = document.querySelector('style[data-ordr-custom]');
    expect(styleEl).toBeNull();
  });

  it('updates existing custom style element on re-apply', () => {
    const config1: ClientBrandConfig = {
      ...testConfig,
      customCss: '.v1 { color: red; }',
    };
    const config2: ClientBrandConfig = {
      ...testConfig,
      customCss: '.v2 { color: blue; }',
    };

    applyTheme(config1);
    applyTheme(config2);

    const styles = document.querySelectorAll('style[data-ordr-custom]');
    expect(styles).toHaveLength(1);
    expect((styles[0] as HTMLStyleElement).textContent).toContain('color: blue');
  });

  it('strips dangerous content from customCss before injection', () => {
    const config: ClientBrandConfig = {
      ...testConfig,
      customCss: '<script>alert("xss")</script>\n.safe { color: green; }',
    };

    applyTheme(config);

    const styleEl = document.querySelector<HTMLStyleElement>('style[data-ordr-custom]');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).not.toContain('<script');
    expect(styleEl?.textContent).toContain('color: green');
  });
});

// ─── ThemeProvider and useBranding ──────────────────────────────

describe('ThemeProvider integration', () => {
  it('getDefaultBrandConfig provides valid input for applyTheme', () => {
    const config = getDefaultBrandConfig();

    // Should not throw
    expect(() => {
      applyTheme(config);
    }).not.toThrow();
  });

  it('brandConfigToCSS output matches getDefaultTheme for default config', () => {
    const config = getDefaultBrandConfig();
    const css = brandConfigToCSS(config);
    const defaults = getDefaultTheme();

    expect(css['--brand-primary']).toBe(defaults['--brand-primary']);
    expect(css['--brand-accent']).toBe(defaults['--brand-accent']);
    expect(css['--brand-bg']).toBe(defaults['--brand-bg']);
    expect(css['--brand-text']).toBe(defaults['--brand-text']);
  });

  it('applyTheme with getDefaultBrandConfig sets default CSS values', () => {
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');

    applyTheme(getDefaultBrandConfig());

    expect(spy).toHaveBeenCalledWith('--brand-primary', '#3b82f6');
    expect(spy).toHaveBeenCalledWith('--brand-accent', '#10b981');
    expect(spy).toHaveBeenCalledWith('--brand-bg', '#0f172a');
    expect(spy).toHaveBeenCalledWith('--brand-text', '#e2e8f0');

    spy.mockRestore();
  });
});
