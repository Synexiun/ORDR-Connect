/**
 * Theme utilities — maps BrandConfig to CSS custom properties
 *
 * SECURITY:
 * - No secrets in CSS variables (Rule 5)
 * - Custom CSS is NOT injected via this module (sanitization required)
 * - Color values are validated server-side before storage
 */

// ─── Theme Config ───────────────────────────────────────────────

export interface ThemeConfig {
  readonly '--brand-primary': string;
  readonly '--brand-accent': string;
  readonly '--brand-bg': string;
  readonly '--brand-text': string;
}

// ─── Brand Config (client-side mirror of server type) ───────────

export interface ClientBrandConfig {
  readonly tenantId: string;
  readonly customDomain: string | null;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly bgColor: string;
  readonly textColor: string;
  readonly emailFromName: string | null;
  readonly emailFromAddress: string | null;
  readonly customCss: string | null;
  readonly footerText: string | null;
}

// ─── Defaults ───────────────────────────────────────────────────

const DEFAULT_PRIMARY = '#3b82f6';
const DEFAULT_ACCENT = '#10b981';
const DEFAULT_BG = '#0f172a';
const DEFAULT_TEXT = '#e2e8f0';

/**
 * Returns the ORDR-Connect default theme config.
 */
export function getDefaultTheme(): ThemeConfig {
  return {
    '--brand-primary': DEFAULT_PRIMARY,
    '--brand-accent': DEFAULT_ACCENT,
    '--brand-bg': DEFAULT_BG,
    '--brand-text': DEFAULT_TEXT,
  };
}

/**
 * Returns the default client brand config.
 */
export function getDefaultBrandConfig(): ClientBrandConfig {
  return {
    tenantId: '',
    customDomain: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: DEFAULT_PRIMARY,
    accentColor: DEFAULT_ACCENT,
    bgColor: DEFAULT_BG,
    textColor: DEFAULT_TEXT,
    emailFromName: null,
    emailFromAddress: null,
    customCss: null,
    footerText: null,
  };
}

// ─── Conversion ─────────────────────────────────────────────────

/**
 * Maps BrandConfig fields to CSS custom property names and values.
 */
export function brandConfigToCSS(config: ClientBrandConfig): Record<string, string> {
  return {
    '--brand-primary': config.primaryColor || DEFAULT_PRIMARY,
    '--brand-accent': config.accentColor || DEFAULT_ACCENT,
    '--brand-bg': config.bgColor || DEFAULT_BG,
    '--brand-text': config.textColor || DEFAULT_TEXT,
  };
}

// ─── CSS Sanitization ───────────────────────────────────────────

/**
 * Allowlist of CSS properties considered safe for tenant custom CSS.
 * Only colors, fonts, spacing, borders, and related visual properties.
 * No layout, position, or properties that could enable UI redress attacks.
 *
 * SECURITY (Rule 4 — Input Validation):
 * - Strips <script>, javascript:, expression(), data: URIs in url()
 * - Strips @import rules (prevent external resource loading)
 * - Only allows safe CSS property names
 */
const SAFE_CSS_PROPERTIES = new Set([
  // Colors
  'color',
  'background-color',
  'background',
  'border-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'accent-color',
  'fill',
  'stroke',
  'opacity',
  // Fonts
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-transform',
  'text-decoration',
  'text-indent',
  'text-shadow',
  'white-space',
  // Spacing
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'row-gap',
  'column-gap',
  // Borders
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-style',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  // Box
  'box-shadow',
  'width',
  'max-width',
  'min-width',
  'height',
  'max-height',
  'min-height',
  // Transitions (visual only)
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'transition-delay',
  // Misc visual
  'cursor',
  'list-style',
  'list-style-type',
  'overflow',
]);

/**
 * Filters a string of CSS declarations, keeping only those whose property
 * name is in the safe allowlist. Preserves CSS comments.
 */
function filterDeclarations(raw: string): string {
  const parts = raw.split(';');
  const safe: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') continue;

    // Preserve CSS comments
    if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.endsWith('*/')) {
      safe.push(`  ${trimmed}`);
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const property = trimmed.substring(0, colonIndex).trim().toLowerCase();
      const baseProperty = property.replace(/^-(?:webkit|moz|ms|o)-/, '');
      if (SAFE_CSS_PROPERTIES.has(property) || SAFE_CSS_PROPERTIES.has(baseProperty)) {
        safe.push(`  ${trimmed};`);
      }
    }
  }

  return safe.join('\n');
}

/**
 * Sanitizes raw CSS to prevent injection attacks.
 *
 * Strips:
 * - <script> tags and javascript: URIs
 * - expression() (IE CSS expressions)
 * - url() with data: URIs (can embed executable content)
 * - @import rules (external resource loading prevention)
 * - Any CSS property not on the safe allowlist
 *
 * Returns sanitized CSS string.
 */
export function sanitizeCSS(raw: string): string {
  if (!raw || raw.trim().length === 0) {
    return '';
  }

  let css = raw;

  // 1. Strip <script> tags and content (case-insensitive)
  css = css.replace(/<script[\s\S]*?<\/script>/gi, '');
  css = css.replace(/<script[^>]*>/gi, '');
  css = css.replace(/<\/script>/gi, '');

  // 2. Strip javascript: URIs (case-insensitive, with optional whitespace)
  css = css.replace(/javascript\s*:/gi, '');

  // 3. Strip expression() — IE CSS expressions (case-insensitive)
  css = css.replace(/expression\s*\([^)]*\)/gi, '');

  // 4. Strip url() with data: URIs (prevent embedded executable content)
  css = css.replace(/url\s*\(\s*['"]?\s*data\s*:[^)]*\)/gi, '');

  // 5. Strip @import rules (prevent external resource loading)
  css = css.replace(/@import\s+[^;]*;?/gi, '');

  // 6. Strip -moz-binding (XBL binding attacks)
  css = css.replace(/-moz-binding\s*:[^;]*/gi, '');

  // 7. Strip behavior: (IE HTC behavior)
  css = css.replace(/behavior\s*:[^;]*/gi, '');

  // 8. Filter to safe properties only
  // Extract individual declarations and only keep those with allowed property names.
  // Handles both multi-line and single-line CSS rules.
  const output: string[] = [];

  // Split into tokens: selectors, braces, declarations, comments
  // Use a regex to match rule blocks and standalone declarations
  const ruleBlockRegex = /([^{}]*)\{([^}]*)\}/g;
  let hasBlocks = false;
  let match: RegExpExecArray | null;

  // Work on a copy for regex iteration
  const cssInput = css;

  match = ruleBlockRegex.exec(cssInput);
  while (match !== null) {
    hasBlocks = true;
    const selector = (match[1] ?? '').trim();
    const declarations = match[2] ?? '';

    // Filter declarations within the block
    const filteredDecls = filterDeclarations(declarations);
    if (filteredDecls.length > 0) {
      output.push(`${selector} {\n${filteredDecls}\n}`);
    }

    match = ruleBlockRegex.exec(cssInput);
  }

  // Handle CSS without blocks (just declarations or comments)
  if (!hasBlocks) {
    const filteredDecls = filterDeclarations(css);
    if (filteredDecls.length > 0) {
      output.push(filteredDecls);
    }
  }

  return output.join('\n\n').trim();
}

// ─── Application ────────────────────────────────────────────────

/**
 * Applies brand config as CSS custom properties on the document root element.
 * Safe to call in browser environments only.
 *
 * If customCss is present, it is sanitized before injection.
 */
export function applyTheme(config: ClientBrandConfig): void {
  if (typeof document === 'undefined') {
    return;
  }

  const cssVars = brandConfigToCSS(config);
  const root = document.documentElement;

  for (const [property, value] of Object.entries(cssVars)) {
    root.style.setProperty(property, value);
  }

  // Update favicon if provided
  if (config.faviconUrl !== null && config.faviconUrl !== '') {
    const existingLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (existingLink) {
      existingLink.href = config.faviconUrl;
    } else {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = config.faviconUrl;
      document.head.appendChild(link);
    }
  }

  // Apply sanitized custom CSS if present
  if (config.customCss !== null && config.customCss !== '') {
    const sanitized = sanitizeCSS(config.customCss);
    if (sanitized.length > 0) {
      const existingStyle = document.querySelector<HTMLStyleElement>('style[data-ordr-custom]');
      if (existingStyle) {
        existingStyle.textContent = sanitized;
      } else {
        const style = document.createElement('style');
        style.setAttribute('data-ordr-custom', 'true');
        style.textContent = sanitized;
        document.head.appendChild(style);
      }
    }
  }
}
