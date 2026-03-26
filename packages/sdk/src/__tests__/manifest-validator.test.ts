/**
 * Tests for AgentManifest validation
 *
 * COMPLIANCE: Validates Rule 4 (input validation), Rule 8 (license compliance),
 * and Rule 9 (agent safety boundaries).
 */

import { describe, it, expect } from 'vitest';
import { isOk, isErr, ValidationError } from '@ordr/core';
import {
  validateManifest,
  checkManifest,
  agentManifestSchema,
  OSI_APPROVED_LICENSES,
  PLATFORM_BUDGET_LIMITS,
  MIN_CONFIDENCE_THRESHOLD,
} from '../manifest-validator.js';
import type { AgentManifest } from '../types.js';

// ─── Helper: Valid Manifest ────────────────────────────────────

function makeValidManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    name: 'test-agent',
    version: '1.0.0',
    description: 'A test agent for validation',
    author: 'test@example.com',
    license: 'MIT',
    requiredTools: ['lookup_customer'],
    complianceRequirements: ['hipaa'],
    permissions: ['internal'],
    entryPoint: 'default',
    minConfidenceThreshold: 0.8,
    maxBudget: {
      maxTokens: 50_000,
      maxCostCents: 100,
      maxActions: 20,
    },
    ...overrides,
  };
}

// ─── Valid Manifests ───────────────────────────────────────────

describe('validateManifest — valid cases', () => {
  it('should accept a fully valid manifest', () => {
    const result = validateManifest(makeValidManifest());
    expect(isOk(result)).toBe(true);
  });

  it('should accept manifest with no tools required', () => {
    const result = validateManifest(makeValidManifest({ requiredTools: [] }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept manifest with multiple compliance requirements', () => {
    const result = validateManifest(makeValidManifest({
      complianceRequirements: ['hipaa', 'fdcpa', 'tcpa'],
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept manifest with all data classifications', () => {
    const result = validateManifest(makeValidManifest({
      permissions: ['public', 'internal', 'confidential', 'restricted'],
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept minimum confidence threshold of 0.7', () => {
    const result = validateManifest(makeValidManifest({
      minConfidenceThreshold: 0.7,
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept maximum confidence threshold of 1.0', () => {
    const result = validateManifest(makeValidManifest({
      minConfidenceThreshold: 1.0,
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept all OSI-approved licenses', () => {
    for (const license of OSI_APPROVED_LICENSES) {
      const result = validateManifest(makeValidManifest({ license }));
      expect(isOk(result)).toBe(true);
    }
  });

  it('should accept manifest with semver pre-release version', () => {
    const result = validateManifest(makeValidManifest({
      version: '1.0.0-beta.1',
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept manifest with empty compliance requirements', () => {
    const result = validateManifest(makeValidManifest({
      complianceRequirements: [],
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept manifest with empty permissions', () => {
    const result = validateManifest(makeValidManifest({
      permissions: [],
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should return the validated manifest data on success', () => {
    const input = makeValidManifest();
    const result = validateManifest(input);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.name).toBe('test-agent');
      expect(result.data.version).toBe('1.0.0');
    }
  });

  it('should accept name with hyphens', () => {
    const result = validateManifest(makeValidManifest({ name: 'my-custom-agent' }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept single-character name', () => {
    const result = validateManifest(makeValidManifest({ name: 'a' }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept name at exactly 64 characters', () => {
    const name = 'a' + 'b'.repeat(63);
    const result = validateManifest(makeValidManifest({ name }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept budget at exact platform limits', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: PLATFORM_BUDGET_LIMITS.maxTokens,
        maxCostCents: PLATFORM_BUDGET_LIMITS.maxCostCents,
        maxActions: PLATFORM_BUDGET_LIMITS.maxActions,
      },
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept manifest with all known regulations', () => {
    const result = validateManifest(makeValidManifest({
      complianceRequirements: ['hipaa', 'fdcpa', 'tcpa', 'gdpr', 'ccpa', 'fec', 'respa'],
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept version 0.0.1', () => {
    const result = validateManifest(makeValidManifest({ version: '0.0.1' }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept version with large numbers', () => {
    const result = validateManifest(makeValidManifest({ version: '99.99.99' }));
    expect(isOk(result)).toBe(true);
  });
});

// ─── Name Validation ───────────────────────────────────────────

describe('validateManifest — name validation', () => {
  it('should reject empty name', () => {
    const result = validateManifest(makeValidManifest({ name: '' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject uppercase in name', () => {
    const result = validateManifest(makeValidManifest({ name: 'TestAgent' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject underscores in name (hyphens only)', () => {
    const result = validateManifest(makeValidManifest({ name: 'test_agent' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject spaces in name', () => {
    const result = validateManifest(makeValidManifest({ name: 'test agent' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject name starting with number', () => {
    const result = validateManifest(makeValidManifest({ name: '1agent' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject name exceeding 64 characters', () => {
    const result = validateManifest(makeValidManifest({ name: 'a' + 'b'.repeat(64) }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject special characters in name', () => {
    const result = validateManifest(makeValidManifest({ name: 'agent@v1' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject name starting with hyphen', () => {
    const result = validateManifest(makeValidManifest({ name: '-agent' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject name with dots', () => {
    const result = validateManifest(makeValidManifest({ name: 'agent.v1' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject name with slashes', () => {
    const result = validateManifest(makeValidManifest({ name: 'scope/agent' }));
    expect(isErr(result)).toBe(true);
  });
});

// ─── Version Validation ────────────────────────────────────────

describe('validateManifest — version validation', () => {
  it('should reject non-semver version', () => {
    const result = validateManifest(makeValidManifest({ version: 'v1' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject version with only major.minor', () => {
    const result = validateManifest(makeValidManifest({ version: '1.0' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject version with letters', () => {
    const result = validateManifest(makeValidManifest({ version: 'abc' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject empty version', () => {
    const result = validateManifest(makeValidManifest({ version: '' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject version with v prefix', () => {
    const result = validateManifest(makeValidManifest({ version: 'v1.0.0' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject version with only major', () => {
    const result = validateManifest(makeValidManifest({ version: '1' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject version with trailing dot', () => {
    const result = validateManifest(makeValidManifest({ version: '1.0.0.' }));
    expect(isErr(result)).toBe(true);
  });
});

// ─── License Validation ────────────────────────────────────────

describe('validateManifest — license validation', () => {
  it('should reject non-OSI license', () => {
    const result = validateManifest(makeValidManifest({ license: 'Proprietary' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject empty license', () => {
    const result = validateManifest(makeValidManifest({ license: '' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject license with wrong casing', () => {
    const result = validateManifest(makeValidManifest({ license: 'mit' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject BUSL-1.1 (not OSI approved)', () => {
    const result = validateManifest(makeValidManifest({ license: 'BUSL-1.1' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject Creative Commons BY-NC (not OSI)', () => {
    const result = validateManifest(makeValidManifest({ license: 'CC-BY-NC-4.0' }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject Elastic License', () => {
    const result = validateManifest(makeValidManifest({ license: 'Elastic-2.0' }));
    expect(isErr(result)).toBe(true);
  });
});

// ─── Confidence Threshold ──────────────────────────────────────

describe('validateManifest — confidence threshold', () => {
  it('should reject confidence below 0.7', () => {
    const result = validateManifest(makeValidManifest({
      minConfidenceThreshold: 0.5,
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject confidence of 0', () => {
    const result = validateManifest(makeValidManifest({
      minConfidenceThreshold: 0,
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject confidence above 1.0', () => {
    const result = validateManifest(makeValidManifest({
      minConfidenceThreshold: 1.5,
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject negative confidence', () => {
    const result = validateManifest(makeValidManifest({
      minConfidenceThreshold: -0.1,
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject confidence of 0.69 (just below threshold)', () => {
    const result = validateManifest(makeValidManifest({
      minConfidenceThreshold: 0.69,
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should accept confidence of exactly 0.7', () => {
    const result = validateManifest(makeValidManifest({
      minConfidenceThreshold: 0.7,
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept confidence of 0.85', () => {
    const result = validateManifest(makeValidManifest({
      minConfidenceThreshold: 0.85,
    }));
    expect(isOk(result)).toBe(true);
  });
});

// ─── Budget Validation ─────────────────────────────────────────

describe('validateManifest — budget validation', () => {
  it('should reject maxTokens exceeding platform limit', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: PLATFORM_BUDGET_LIMITS.maxTokens + 1,
        maxCostCents: 100,
        maxActions: 20,
      },
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject maxCostCents exceeding platform limit', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: 50_000,
        maxCostCents: PLATFORM_BUDGET_LIMITS.maxCostCents + 1,
        maxActions: 20,
      },
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject maxActions exceeding platform limit', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: 50_000,
        maxCostCents: 100,
        maxActions: PLATFORM_BUDGET_LIMITS.maxActions + 1,
      },
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject zero maxTokens', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: 0,
        maxCostCents: 100,
        maxActions: 20,
      },
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject negative maxActions', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: 50_000,
        maxCostCents: 100,
        maxActions: -1,
      },
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject zero maxCostCents', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: 50_000,
        maxCostCents: 0,
        maxActions: 20,
      },
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject negative maxTokens', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: -100,
        maxCostCents: 100,
        maxActions: 20,
      },
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject non-integer maxTokens', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: 50_000.5,
        maxCostCents: 100,
        maxActions: 20,
      },
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should accept minimal valid budget (1 each)', () => {
    const result = validateManifest(makeValidManifest({
      maxBudget: {
        maxTokens: 1,
        maxCostCents: 1,
        maxActions: 1,
      },
    }));
    expect(isOk(result)).toBe(true);
  });
});

// ─── Compliance Requirements ───────────────────────────────────

describe('validateManifest — compliance requirements', () => {
  it('should reject unknown regulation', () => {
    const result = validateManifest(makeValidManifest({
      complianceRequirements: ['unknown_regulation' as never],
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should accept all known regulations', () => {
    const result = validateManifest(makeValidManifest({
      complianceRequirements: ['hipaa', 'fdcpa', 'tcpa', 'gdpr', 'ccpa', 'fec', 'respa'],
    }));
    expect(isOk(result)).toBe(true);
  });

  it('should reject misspelled regulation', () => {
    const result = validateManifest(makeValidManifest({
      complianceRequirements: ['hippa' as never],
    }));
    expect(isErr(result)).toBe(true);
  });

  it('should reject uppercase regulation', () => {
    const result = validateManifest(makeValidManifest({
      complianceRequirements: ['HIPAA' as never],
    }));
    expect(isErr(result)).toBe(true);
  });
});

// ─── Data Classifications ──────────────────────────────────────

describe('validateManifest — data classifications', () => {
  it('should accept public classification', () => {
    const result = validateManifest(makeValidManifest({ permissions: ['public'] }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept internal classification', () => {
    const result = validateManifest(makeValidManifest({ permissions: ['internal'] }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept confidential classification', () => {
    const result = validateManifest(makeValidManifest({ permissions: ['confidential'] }));
    expect(isOk(result)).toBe(true);
  });

  it('should accept restricted classification', () => {
    const result = validateManifest(makeValidManifest({ permissions: ['restricted'] }));
    expect(isOk(result)).toBe(true);
  });

  it('should reject unknown classification', () => {
    const result = validateManifest(makeValidManifest({
      permissions: ['top_secret' as never],
    }));
    expect(isErr(result)).toBe(true);
  });
});

// ─── Missing Required Fields ───────────────────────────────────

describe('validateManifest — missing fields', () => {
  it('should reject null input', () => {
    const result = validateManifest(null);
    expect(isErr(result)).toBe(true);
  });

  it('should reject undefined input', () => {
    const result = validateManifest(undefined);
    expect(isErr(result)).toBe(true);
  });

  it('should reject empty object', () => {
    const result = validateManifest({});
    expect(isErr(result)).toBe(true);
  });

  it('should reject missing description', () => {
    const { description: _, ...rest } = makeValidManifest();
    const result = validateManifest(rest);
    expect(isErr(result)).toBe(true);
  });

  it('should reject missing author', () => {
    const { author: _, ...rest } = makeValidManifest();
    const result = validateManifest(rest);
    expect(isErr(result)).toBe(true);
  });

  it('should reject missing version', () => {
    const { version: _, ...rest } = makeValidManifest();
    const result = validateManifest(rest);
    expect(isErr(result)).toBe(true);
  });

  it('should reject missing name', () => {
    const { name: _, ...rest } = makeValidManifest();
    const result = validateManifest(rest);
    expect(isErr(result)).toBe(true);
  });

  it('should reject missing license', () => {
    const { license: _, ...rest } = makeValidManifest();
    const result = validateManifest(rest);
    expect(isErr(result)).toBe(true);
  });

  it('should reject missing maxBudget', () => {
    const { maxBudget: _, ...rest } = makeValidManifest();
    const result = validateManifest(rest);
    expect(isErr(result)).toBe(true);
  });

  it('should reject extra properties (strict mode)', () => {
    const manifest = { ...makeValidManifest(), extraField: 'should not be here' };
    const result = validateManifest(manifest);
    expect(isErr(result)).toBe(true);
  });

  it('should reject extra properties in maxBudget (strict mode)', () => {
    const manifest = makeValidManifest();
    const result = validateManifest({
      ...manifest,
      maxBudget: { ...manifest.maxBudget, extraProp: true },
    });
    expect(isErr(result)).toBe(true);
  });

  it('should reject non-object input (number)', () => {
    const result = validateManifest(42);
    expect(isErr(result)).toBe(true);
  });

  it('should reject non-object input (string)', () => {
    const result = validateManifest('not-an-object');
    expect(isErr(result)).toBe(true);
  });

  it('should reject non-object input (array)', () => {
    const result = validateManifest([1, 2, 3]);
    expect(isErr(result)).toBe(true);
  });
});

// ─── Error Structure ───────────────────────────────────────────

describe('validateManifest — error structure', () => {
  it('should return ValidationError on failure', () => {
    const result = validateManifest({});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  it('should include field-level errors', () => {
    const result = validateManifest({ name: '' });
    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error instanceof ValidationError) {
      expect(Object.keys(result.error.fieldErrors).length).toBeGreaterThan(0);
    }
  });
});

// ─── checkManifest ─────────────────────────────────────────────

describe('checkManifest', () => {
  it('should return valid: true for a valid manifest', () => {
    const result = checkManifest(makeValidManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should warn when no compliance requirements declared', () => {
    const result = checkManifest(makeValidManifest({
      complianceRequirements: [],
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('compliance'))).toBe(true);
  });

  it('should warn when restricted data access is declared', () => {
    const result = checkManifest(makeValidManifest({
      permissions: ['restricted'],
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('restricted'))).toBe(true);
  });

  it('should return errors for invalid manifest', () => {
    const result = checkManifest({ name: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should return both warnings for no compliance + restricted access', () => {
    const result = checkManifest(makeValidManifest({
      complianceRequirements: [],
      permissions: ['restricted'],
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(2);
  });

  it('should return no warnings for well-configured manifest', () => {
    const result = checkManifest(makeValidManifest({
      complianceRequirements: ['hipaa'],
      permissions: ['internal'],
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should return errors with field context', () => {
    const result = checkManifest({ name: 'UPPERCASE', version: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('name') || e.includes('version'))).toBe(true);
  });

  it('should expose MIN_CONFIDENCE_THRESHOLD constant', () => {
    expect(MIN_CONFIDENCE_THRESHOLD).toBe(0.7);
  });

  it('should expose PLATFORM_BUDGET_LIMITS', () => {
    expect(PLATFORM_BUDGET_LIMITS.maxTokens).toBe(1_000_000);
    expect(PLATFORM_BUDGET_LIMITS.maxCostCents).toBe(10_000);
    expect(PLATFORM_BUDGET_LIMITS.maxActions).toBe(500);
  });

  it('should expose agentManifestSchema', () => {
    expect(agentManifestSchema).toBeDefined();
    expect(typeof agentManifestSchema.parse).toBe('function');
  });

  it('should expose OSI_APPROVED_LICENSES with known entries', () => {
    expect(OSI_APPROVED_LICENSES).toContain('MIT');
    expect(OSI_APPROVED_LICENSES).toContain('Apache-2.0');
    expect(OSI_APPROVED_LICENSES).toContain('ISC');
  });
});
