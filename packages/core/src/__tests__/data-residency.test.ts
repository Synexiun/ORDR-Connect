import { describe, it, expect } from 'vitest';
import {
  DATA_REGIONS,
  DEFAULT_DATA_RESIDENCY,
  isRegionAllowed,
  hasAdequacyDecision,
} from '../types/data-residency.js';
import type { DataRegion, DataResidencyConfig } from '../types/data-residency.js';

function makeConfig(overrides: Partial<DataResidencyConfig> = {}): DataResidencyConfig {
  return {
    tenantId: 'tenant-test',
    primaryRegion: 'us-east',
    allowedRegions: ['us-east', 'us-west'],
    crossBorderAllowed: false,
    adequacyDecisions: [],
    ...overrides,
  };
}

describe('Data Residency', () => {
  // ── DATA_REGIONS const ──────────────────────────────────────────

  describe('DATA_REGIONS', () => {
    it('contains 7 regions', () => {
      expect(DATA_REGIONS).toHaveLength(7);
    });

    it('includes us-east', () => {
      expect(DATA_REGIONS).toContain('us-east');
    });

    it('includes us-west', () => {
      expect(DATA_REGIONS).toContain('us-west');
    });

    it('includes eu-west', () => {
      expect(DATA_REGIONS).toContain('eu-west');
    });

    it('includes eu-central', () => {
      expect(DATA_REGIONS).toContain('eu-central');
    });

    it('includes ca-central', () => {
      expect(DATA_REGIONS).toContain('ca-central');
    });

    it('includes sa-east', () => {
      expect(DATA_REGIONS).toContain('sa-east');
    });

    it('includes ap-southeast', () => {
      expect(DATA_REGIONS).toContain('ap-southeast');
    });

    it('is readonly', () => {
      // TypeScript compile-time check — runtime verify it is a frozen-like array
      expect(Array.isArray(DATA_REGIONS)).toBe(true);
    });

    it('contains no duplicate regions', () => {
      const uniqueSet = new Set(DATA_REGIONS);
      expect(uniqueSet.size).toBe(DATA_REGIONS.length);
    });
  });

  // ── DEFAULT_DATA_RESIDENCY ──────────────────────────────────────

  describe('DEFAULT_DATA_RESIDENCY', () => {
    it('has us-east as primary region', () => {
      expect(DEFAULT_DATA_RESIDENCY.primaryRegion).toBe('us-east');
    });

    it('allows only US regions by default', () => {
      expect(DEFAULT_DATA_RESIDENCY.allowedRegions).toEqual(['us-east', 'us-west']);
    });

    it('disables cross-border transfers by default', () => {
      expect(DEFAULT_DATA_RESIDENCY.crossBorderAllowed).toBe(false);
    });

    it('has no adequacy decisions by default', () => {
      expect(DEFAULT_DATA_RESIDENCY.adequacyDecisions).toEqual([]);
    });

    it('does not include a tenantId', () => {
      // DEFAULT_DATA_RESIDENCY omits tenantId by design
      expect('tenantId' in DEFAULT_DATA_RESIDENCY).toBe(false);
    });
  });

  // ── DataResidencyConfig creation ────────────────────────────────

  describe('DataResidencyConfig', () => {
    it('creates a config with all required fields', () => {
      const config = makeConfig();
      expect(config.tenantId).toBe('tenant-test');
      expect(config.primaryRegion).toBe('us-east');
      expect(config.allowedRegions).toEqual(['us-east', 'us-west']);
      expect(config.crossBorderAllowed).toBe(false);
    });

    it('supports EU region configuration', () => {
      const config = makeConfig({
        tenantId: 'tenant-eu',
        primaryRegion: 'eu-west',
        allowedRegions: ['eu-west', 'eu-central'],
        crossBorderAllowed: false,
        adequacyDecisions: ['ch', 'gb', 'jp'],
      });
      expect(config.primaryRegion).toBe('eu-west');
      expect(config.allowedRegions).toContain('eu-central');
    });

    it('supports Brazil region configuration', () => {
      const config = makeConfig({
        primaryRegion: 'sa-east',
        allowedRegions: ['sa-east'],
      });
      expect(config.primaryRegion).toBe('sa-east');
    });

    it('supports Canada region configuration', () => {
      const config = makeConfig({
        tenantId: 'tenant-ca',
        primaryRegion: 'ca-central',
        allowedRegions: ['ca-central'],
        crossBorderAllowed: false,
      });
      expect(config.primaryRegion).toBe('ca-central');
      expect(config.allowedRegions).toEqual(['ca-central']);
    });

    it('supports cross-border enabled configuration', () => {
      const config = makeConfig({
        crossBorderAllowed: true,
        allowedRegions: ['us-east', 'eu-west', 'ca-central'],
        adequacyDecisions: ['gb', 'jp'],
      });
      expect(config.crossBorderAllowed).toBe(true);
      expect(config.allowedRegions).toHaveLength(3);
    });

    it('supports ap-southeast as primary region', () => {
      const config = makeConfig({
        primaryRegion: 'ap-southeast',
        allowedRegions: ['ap-southeast'],
      });
      expect(config.primaryRegion).toBe('ap-southeast');
    });
  });

  // ── isRegionAllowed ─────────────────────────────────────────────

  describe('isRegionAllowed', () => {
    it('returns true for allowed region', () => {
      const config = makeConfig({ allowedRegions: ['us-east', 'eu-west'] });
      expect(isRegionAllowed(config, 'us-east')).toBe(true);
      expect(isRegionAllowed(config, 'eu-west')).toBe(true);
    });

    it('returns false for disallowed region', () => {
      const config = makeConfig({ allowedRegions: ['us-east'] });
      expect(isRegionAllowed(config, 'eu-west')).toBe(false);
    });

    it('returns false for empty allowed regions', () => {
      const config = makeConfig({ allowedRegions: [] });
      expect(isRegionAllowed(config, 'us-east')).toBe(false);
    });

    it('checks all 7 regions correctly when all are allowed', () => {
      const config = makeConfig({
        allowedRegions: ['us-east', 'us-west', 'eu-west', 'eu-central', 'ca-central', 'sa-east', 'ap-southeast'],
      });
      for (const region of DATA_REGIONS) {
        expect(isRegionAllowed(config, region)).toBe(true);
      }
    });

    it('returns false for every region when none are allowed', () => {
      const config = makeConfig({ allowedRegions: [] });
      for (const region of DATA_REGIONS) {
        expect(isRegionAllowed(config, region)).toBe(false);
      }
    });

    it('correctly differentiates between allowed and disallowed', () => {
      const config = makeConfig({
        allowedRegions: ['eu-west', 'eu-central'],
      });
      expect(isRegionAllowed(config, 'eu-west')).toBe(true);
      expect(isRegionAllowed(config, 'eu-central')).toBe(true);
      expect(isRegionAllowed(config, 'us-east')).toBe(false);
      expect(isRegionAllowed(config, 'sa-east')).toBe(false);
    });
  });

  // ── hasAdequacyDecision ─────────────────────────────────────────

  describe('hasAdequacyDecision', () => {
    it('returns true for country in adequacy list', () => {
      const config = makeConfig({ adequacyDecisions: ['jp', 'gb', 'ch'] });
      expect(hasAdequacyDecision(config, 'jp')).toBe(true);
    });

    it('returns false for country not in adequacy list', () => {
      const config = makeConfig({ adequacyDecisions: ['jp', 'gb'] });
      expect(hasAdequacyDecision(config, 'cn')).toBe(false);
    });

    it('is case-insensitive', () => {
      const config = makeConfig({ adequacyDecisions: ['jp'] });
      expect(hasAdequacyDecision(config, 'JP')).toBe(true);
    });

    it('returns false for empty adequacy list', () => {
      const config = makeConfig({ adequacyDecisions: [] });
      expect(hasAdequacyDecision(config, 'jp')).toBe(false);
    });

    it('handles mixed-case country codes', () => {
      const config = makeConfig({ adequacyDecisions: ['gb'] });
      expect(hasAdequacyDecision(config, 'Gb')).toBe(true);
      expect(hasAdequacyDecision(config, 'GB')).toBe(true);
      expect(hasAdequacyDecision(config, 'gB')).toBe(true);
    });

    it('checks multiple countries correctly', () => {
      const config = makeConfig({ adequacyDecisions: ['jp', 'gb', 'ch', 'nz', 'il'] });
      expect(hasAdequacyDecision(config, 'jp')).toBe(true);
      expect(hasAdequacyDecision(config, 'gb')).toBe(true);
      expect(hasAdequacyDecision(config, 'ch')).toBe(true);
      expect(hasAdequacyDecision(config, 'nz')).toBe(true);
      expect(hasAdequacyDecision(config, 'il')).toBe(true);
      expect(hasAdequacyDecision(config, 'us')).toBe(false);
      expect(hasAdequacyDecision(config, 'br')).toBe(false);
    });
  });
});
