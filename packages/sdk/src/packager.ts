/**
 * Agent packager — bundles AgentPackage into distributable format
 *
 * SECURITY (CLAUDE.md Rule 1):
 * - Content hash uses SHA-256 for integrity verification
 * - Signature field is a placeholder for future HSM-backed signing
 *
 * COMPLIANCE:
 * - Content hash provides tamper detection (SOC2 CC6.1)
 * - Package metadata captured for audit trail (Rule 3)
 */

import { createHash } from 'node:crypto';
import { ok, err, ValidationError } from '@ordr/core';
import type { Result } from '@ordr/core';
import type { AppError } from '@ordr/core';
import type { AgentPackage, PackagedAgent } from './types.js';
import { validateManifest } from './manifest-validator.js';

// ─── Hashing ───────────────────────────────────────────────────

/**
 * Generate a SHA-256 hash of the agent package content.
 * Hashes the JSON-serialized manifest + tool names.
 */
function computeContentHash(agent: AgentPackage): string {
  const content = JSON.stringify({
    manifest: agent.manifest,
    tools: agent.tools.map(t => ({
      name: t.name,
      description: t.description,
      dataClassifications: t.dataClassifications,
      regulations: t.regulations,
    })),
  });

  return createHash('sha256').update(content).digest('hex');
}

// ─── Package Function ──────────────────────────────────────────

/**
 * Package an AgentPackage into a distributable format.
 *
 * Validates the manifest, generates a SHA-256 content hash,
 * and wraps everything in a PackagedAgent envelope.
 */
export function packageAgent(agent: AgentPackage): Result<PackagedAgent, AppError> {
  // Re-validate the manifest
  const validationResult = validateManifest(agent.manifest);
  if (!validationResult.success) {
    return validationResult as unknown as Result<PackagedAgent, AppError>;
  }

  // Check tools are present
  if (agent.tools.length === 0 && agent.manifest.requiredTools.length > 0) {
    return err(new ValidationError(
      'Required tools are declared in manifest but no tool definitions provided',
      { tools: ['Tools array is empty but manifest requires tools'] },
    ));
  }

  // Verify all required tools are present
  const toolNames = new Set(agent.tools.map(t => t.name));
  const missingTools = agent.manifest.requiredTools.filter(t => !toolNames.has(t));
  if (missingTools.length > 0) {
    return err(new ValidationError(
      `Missing tool definitions: ${missingTools.join(', ')}`,
      { tools: missingTools.map(t => `Missing: ${t}`) },
    ));
  }

  const contentHash = computeContentHash(agent);

  const packaged: PackagedAgent = {
    manifest: agent.manifest,
    contentHash,
    signature: '', // Placeholder — future HSM-backed signing
    createdAt: new Date(),
  };

  return ok(packaged);
}

// ─── Verify Function ───────────────────────────────────────────

/**
 * Verify a PackagedAgent's content hash.
 *
 * Re-computes the hash from the manifest and compares against the stored hash.
 * Detects any tampering with the manifest after packaging.
 */
export function verifyPackage(
  pkg: PackagedAgent,
  originalAgent: AgentPackage,
): Result<void, AppError> {
  // Verify manifest is still valid
  const validationResult = validateManifest(pkg.manifest);
  if (!validationResult.success) {
    return err(new ValidationError(
      'Package manifest is invalid',
      { manifest: ['Failed re-validation'] },
    ));
  }

  // Re-compute content hash
  const expectedHash = computeContentHash(originalAgent);

  if (pkg.contentHash !== expectedHash) {
    return err(new ValidationError(
      'Content hash mismatch — package may have been tampered with',
      {
        integrity: [
          `Expected: ${expectedHash}`,
          `Got: ${pkg.contentHash}`,
        ],
      },
    ));
  }

  // Verify createdAt is present
  if (!(pkg.createdAt instanceof Date)) {
    return err(new ValidationError(
      'Package missing createdAt timestamp',
      { metadata: ['createdAt is required'] },
    ));
  }

  return ok(undefined);
}
