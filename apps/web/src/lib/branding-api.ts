/**
 * Branding API Helpers — white-label configuration
 *
 * All calls go to /v1/branding (managed by apps/api/src/routes/branding.ts).
 *
 * COMPLIANCE: No PHI in brand config. All mutations are audit-logged
 * server-side. Tenant isolation enforced by JWT (tenantId never from client).
 */

import { apiClient } from './api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BrandConfig {
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

export interface BrandConfigUpdate {
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string;
  accentColor?: string;
  bgColor?: string;
  textColor?: string;
  emailFromName?: string | null;
  emailFromAddress?: string | null;
  customCss?: string | null;
  footerText?: string | null;
}

export interface CustomDomainStatus {
  readonly domain: string;
  readonly tenantId: string;
  readonly sslStatus: 'pending' | 'active' | 'failed';
  readonly verifiedAt: string | null;
}

// ── Default values ────────────────────────────────────────────────────────────

export const DEFAULT_BRAND_CONFIG: BrandConfig = {
  tenantId: '',
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
};

// ── API Functions ─────────────────────────────────────────────────────────────

export async function fetchBrandConfig(): Promise<BrandConfig> {
  try {
    const res = await apiClient.get<{ data: BrandConfig }>('/v1/branding');
    return res.data;
  } catch {
    return DEFAULT_BRAND_CONFIG;
  }
}

export async function updateBrandConfig(update: BrandConfigUpdate): Promise<BrandConfig> {
  const res = await apiClient.put<{ data: BrandConfig }>('/v1/branding', update);
  return res.data;
}

export async function fetchCustomDomain(): Promise<CustomDomainStatus | null> {
  try {
    const res = await apiClient.get<{ data: CustomDomainStatus | null }>('/v1/branding/domain');
    return res.data;
  } catch {
    return null;
  }
}

export async function registerCustomDomain(domain: string): Promise<CustomDomainStatus> {
  const res = await apiClient.post<{ data: CustomDomainStatus }>('/v1/branding/domain', { domain });
  return res.data;
}

export async function removeCustomDomain(): Promise<void> {
  await apiClient.delete('/v1/branding/domain');
}
