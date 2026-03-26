/**
 * Branding types — white-label configuration for ORDR-Connect tenants
 *
 * SOC2 CC6.1 — tenant-scoped brand configuration.
 * ISO 27001 A.14.1.2 — custom domain security requirements.
 *
 * BrandConfig is the canonical type for all brand customization.
 * DEFAULT_BRAND_CONFIG provides ORDR-Connect fallback values.
 *
 * SECURITY:
 * - No PHI/PII in brand config
 * - Custom CSS is sanitized before injection (application layer)
 * - Custom domains require TLS 1.3 verification
 */

// ─── SSL Status ─────────────────────────────────────────────────

export const SSL_STATUSES = ['pending', 'active', 'failed'] as const;
export type SslStatus = (typeof SSL_STATUSES)[number];

// ─── Brand Config ───────────────────────────────────────────────

export interface BrandConfig {
  readonly id: string;
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
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Default Brand Config ───────────────────────────────────────

export const DEFAULT_BRAND_CONFIG: Omit<BrandConfig, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'> = {
  customDomain: null,
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#3b82f6',
  accentColor: '#10b981',
  bgColor: '#0f172a',
  textColor: '#e2e8f0',
  emailFromName: null,
  emailFromAddress: null,
  customCss: null,
  footerText: null,
} as const;

// ─── Brand Config Update ────────────────────────────────────────

/**
 * Partial update type for brand config.
 * Excludes system-managed fields (id, tenantId, timestamps).
 */
export type BrandConfigUpdate = Partial<
  Omit<BrandConfig, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
>;

// ─── Custom Domain Config ───────────────────────────────────────

export interface CustomDomainConfig {
  readonly domain: string;
  readonly tenantId: string;
  readonly sslStatus: SslStatus;
  readonly verifiedAt: Date | null;
}
