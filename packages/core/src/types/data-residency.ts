/**
 * Data Residency Configuration — region-aware data governance
 *
 * SOC2 CC6.7 — Data location and jurisdictional controls.
 * ISO 27001 A.8.10 — Information deletion / data sovereignty.
 * GDPR Art. 44–49 — Cross-border data transfer restrictions.
 * PIPEDA / LGPD — Regional compliance triggers.
 *
 * Every tenant MUST have a data residency configuration that determines
 * which regions their data may reside in and what cross-border rules apply.
 */

/** Supported data storage regions. */
export const DATA_REGIONS = [
  'us-east',
  'us-west',
  'eu-west',
  'eu-central',
  'ca-central',
  'sa-east',
  'ap-southeast',
] as const;

export type DataRegion = (typeof DATA_REGIONS)[number];

/**
 * Per-tenant data residency configuration.
 * Controls where data is stored and what transfer rules apply.
 */
export interface DataResidencyConfig {
  readonly tenantId: string;
  readonly primaryRegion: DataRegion;
  readonly allowedRegions: ReadonlyArray<DataRegion>;
  readonly crossBorderAllowed: boolean;
  readonly adequacyDecisions: ReadonlyArray<string>;
}

/** Default residency configuration — US-only, no cross-border transfers. */
export const DEFAULT_DATA_RESIDENCY: Readonly<Omit<DataResidencyConfig, 'tenantId'>> = {
  primaryRegion: 'us-east',
  allowedRegions: ['us-east', 'us-west'],
  crossBorderAllowed: false,
  adequacyDecisions: [],
} as const;

/**
 * Checks if a target region is allowed for a given residency configuration.
 */
export function isRegionAllowed(
  config: DataResidencyConfig,
  targetRegion: DataRegion,
): boolean {
  return config.allowedRegions.includes(targetRegion);
}

/**
 * Checks if a country code has an adequacy decision in this configuration.
 */
export function hasAdequacyDecision(
  config: DataResidencyConfig,
  countryCode: string,
): boolean {
  return config.adequacyDecisions.includes(countryCode.toLowerCase());
}
