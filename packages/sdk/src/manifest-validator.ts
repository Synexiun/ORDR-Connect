/**
 * Manifest validator — Zod-based strict validation for AgentManifest
 *
 * SECURITY (CLAUDE.md Rule 4):
 * - All external input validated with strict JSON Schema (additionalProperties: false)
 * - Agent names are format-validated to prevent injection
 * - Versions must be valid semver
 *
 * COMPLIANCE (Rule 8 + Rule 9):
 * - License must be OSI-approved
 * - Confidence threshold >= 0.7 (HITL boundary)
 * - Budget caps within platform limits
 * - All declared regulations must exist
 */

import { z } from 'zod';
import { ok, err, ValidationError } from '@ordr/core';
import type { Result } from '@ordr/core';
import type { AppError } from '@ordr/core';
import type { AgentManifest } from './types.js';

// ─── Constants ─────────────────────────────────────────────────

/** OSI-approved licenses accepted by the platform. */
export const OSI_APPROVED_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'Unlicense',
  'CC0-1.0',
] as const;

/** Known regulatory frameworks. */
const KNOWN_REGULATIONS = [
  'hipaa',
  'fdcpa',
  'tcpa',
  'gdpr',
  'ccpa',
  'fec',
  'respa',
] as const;

/** Platform budget limits — hard caps. */
export const PLATFORM_BUDGET_LIMITS = {
  maxTokens: 1_000_000,
  maxCostCents: 10_000,
  maxActions: 500,
} as const;

/** Minimum confidence threshold per CLAUDE.md Rule 9. */
export const MIN_CONFIDENCE_THRESHOLD = 0.7 as const;

// ─── Zod Schema ────────────────────────────────────────────────

/** Semver pattern — major.minor.patch with optional pre-release. */
const semverPattern = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;

/** Agent name pattern — lowercase alphanumeric + hyphens, 1-64 chars. */
const namePattern = /^[a-z][a-z0-9-]{0,63}$/;

/** Data classification values. */
const dataClassifications = ['public', 'internal', 'confidential', 'restricted'] as const;

/**
 * Strict Zod schema for AgentManifest.
 * additionalProperties behavior enforced by z.object().strict().
 */
export const agentManifestSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(64, 'Name must be 64 characters or less')
    .regex(namePattern, 'Name must be lowercase alphanumeric + hyphens, starting with a letter'),

  version: z.string()
    .regex(semverPattern, 'Version must be valid semver (e.g., 1.0.0)'),

  description: z.string()
    .min(1, 'Description is required')
    .max(500, 'Description must be 500 characters or less'),

  author: z.string()
    .min(1, 'Author is required')
    .max(255, 'Author must be 255 characters or less'),

  license: z.string()
    .refine(
      (val) => (OSI_APPROVED_LICENSES as readonly string[]).includes(val),
      { message: 'License must be OSI-approved (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, etc.)' },
    ),

  requiredTools: z.array(z.string().min(1).max(128))
    .min(0)
    .max(50, 'Maximum 50 tools allowed'),

  complianceRequirements: z.array(
    z.string().refine(
      (val) => (KNOWN_REGULATIONS as readonly string[]).includes(val),
      { message: 'Unknown regulation' },
    ),
  ),

  permissions: z.array(z.enum(dataClassifications))
    .min(0)
    .max(4),

  entryPoint: z.string()
    .min(1, 'Entry point is required')
    .max(128),

  minConfidenceThreshold: z.number()
    .min(MIN_CONFIDENCE_THRESHOLD, `Confidence threshold must be >= ${String(MIN_CONFIDENCE_THRESHOLD)}`)
    .max(1.0, 'Confidence threshold must be <= 1.0'),

  maxBudget: z.object({
    maxTokens: z.number()
      .int()
      .positive('maxTokens must be positive')
      .max(PLATFORM_BUDGET_LIMITS.maxTokens, `maxTokens exceeds platform limit (${String(PLATFORM_BUDGET_LIMITS.maxTokens)})`),
    maxCostCents: z.number()
      .int()
      .positive('maxCostCents must be positive')
      .max(PLATFORM_BUDGET_LIMITS.maxCostCents, `maxCostCents exceeds platform limit (${String(PLATFORM_BUDGET_LIMITS.maxCostCents)})`),
    maxActions: z.number()
      .int()
      .positive('maxActions must be positive')
      .max(PLATFORM_BUDGET_LIMITS.maxActions, `maxActions exceeds platform limit (${String(PLATFORM_BUDGET_LIMITS.maxActions)})`),
  }).strict(),
}).strict();

// ─── Validation Function ───────────────────────────────────────

/**
 * Validate an AgentManifest against the strict Zod schema.
 * Returns Result<AgentManifest, AppError> — never throws.
 */
export function validateManifest(input: unknown): Result<AgentManifest, AppError> {
  const parsed = agentManifestSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      const key = path || '_root';
      if (fieldErrors[key] === undefined) {
        fieldErrors[key] = [];
      }
      fieldErrors[key].push(issue.message);
    }

    return err(new ValidationError(
      'Agent manifest validation failed',
      fieldErrors,
    ));
  }

  // Cast the validated data — Zod already enforced types
  return ok(parsed.data as unknown as AgentManifest);
}

/**
 * Quick check if a manifest is valid (returns boolean + details).
 */
export function checkManifest(input: unknown): {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
} {
  const result = validateManifest(input);
  if (result.success) {
    const warnings: string[] = [];
    const manifest = result.data;

    // Warn if no compliance requirements declared
    if (manifest.complianceRequirements.length === 0) {
      warnings.push('No compliance requirements declared — agent may be limited in deployment');
    }

    // Warn if accessing restricted data
    if (manifest.permissions.includes('restricted')) {
      warnings.push('Agent declares restricted data access — additional review required');
    }

    return { valid: true, errors: [], warnings };
  }

  const appError = result.error;
  const errors: string[] = [];

  if (appError instanceof ValidationError && Object.keys(appError.fieldErrors).length > 0) {
    for (const [field, msgs] of Object.entries(appError.fieldErrors)) {
      for (const msg of msgs) {
        errors.push(`${field}: ${msg}`);
      }
    }
  } else {
    errors.push(appError.message);
  }

  return { valid: false, errors, warnings: [] };
}
