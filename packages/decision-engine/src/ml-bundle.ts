/**
 * @ordr/decision-engine — ML Model Bundle (externalised weights)
 *
 * Bridges the current v0.2.0-linear hand-tuned models toward real trained
 * models without waiting for ONNX Runtime integration. Weights live in a
 * signed JSON bundle with SHA-256 self-hash for tamper detection. Loading
 * the bundle is optional — absence falls back to the hand-tuned models
 * already in `ml-scorer.ts`.
 *
 * Bundle lifecycle:
 *   1. Data science team trains new weights off production data snapshots.
 *   2. Weights written to a bundle JSON file with trained_at, training-data
 *      hash, and auditor-approval ID.
 *   3. The bundle's canonical (sorted-key) content is hashed; the hash is
 *      stamped back into the `sha256` field.
 *   4. Bundle is signed (out-of-band — cosign / KMS) and shipped to the
 *      decision-engine boot path via `ML_BUNDLE_PATH`.
 *   5. `loadMLBundle` reads, parses, validates schema, verifies integrity,
 *      and produces `BundledLinearModel` instances that plug into MLScorer.
 *
 * Rule 9 compliance (Agent Safety / AI Governance):
 *   - Weights are external config — their hash is auditable independent of
 *     the code deployment.
 *   - Integrity mismatch returns a typed InternalError — caller (bootstrap)
 *     decides whether to fall back to hand-tuned models or fail-closed.
 *   - Every bundled model carries `bundleVersion` + `bundleSha256` on the
 *     instance so Decision audit entries can reference the exact weights
 *     used for any prediction.
 *   - Schema is strict (additional properties rejected) — no silent drift.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { type Result, ok, err, InternalError, ValidationError } from '@ordr/core';
import type { MLFeatureVector, MLModel } from './types.js';

// ─── Schema ──────────────────────────────────────────────────────

const transformSchema = z
  .object({
    offset: z.number().optional(),
    cap: z.number().positive().optional(),
    divide: z.number().positive().optional(),
    normalizeFromNegOneToOne: z.boolean().optional(),
  })
  .strict();

const modelEntrySchema = z
  .object({
    version: z.string().min(1),
    intercept: z.number(),
    weights: z.record(z.string().min(1), z.number()),
    transforms: z.record(z.string().min(1), transformSchema).optional(),
  })
  .strict();

const SHA256_PREFIX_RE = /^sha256:[a-f0-9]{64}$/;

const bundleSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+/, 'version must be semver'),
    trainedAt: z.string().datetime(),
    trainingDataHash: z
      .string()
      .regex(SHA256_PREFIX_RE, 'trainingDataHash must be a sha256:<hex> string'),
    auditorApprovalId: z.string().min(1).nullable(),
    sha256: z.string().regex(SHA256_PREFIX_RE, 'sha256 must be a sha256:<hex> string'),
    models: z.record(z.string().min(1), modelEntrySchema),
  })
  .strict();

export type MLModelBundle = z.infer<typeof bundleSchema>;
export type MLModelEntry = z.infer<typeof modelEntrySchema>;
export type MLFeatureTransform = z.infer<typeof transformSchema>;

// ─── Math ────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp01(x: number): number {
  return Math.min(1.0, Math.max(0.0, x));
}

// ─── Model ───────────────────────────────────────────────────────

/**
 * Linear model whose weights come from an external bundle rather than code.
 *
 * Behaviour is identical to the hand-tuned models in ml-scorer.ts — a
 * transformed feature vector is multiplied by per-feature weights, summed
 * with the intercept, passed through sigmoid, and clamped to [0, 1].
 */
export class BundledLinearModel implements MLModel {
  readonly name: string;
  readonly version: string;
  readonly bundleVersion: string;
  readonly bundleSha256: string;
  private readonly intercept: number;
  private readonly weights: ReadonlyMap<string, number>;
  private readonly transforms: ReadonlyMap<string, MLFeatureTransform>;

  constructor(
    name: string,
    entry: MLModelEntry,
    bundleMeta: { readonly version: string; readonly sha256: string },
  ) {
    this.name = name;
    this.version = entry.version;
    this.bundleVersion = bundleMeta.version;
    this.bundleSha256 = bundleMeta.sha256;
    this.intercept = entry.intercept;
    this.weights = new Map(Object.entries(entry.weights));
    this.transforms = new Map(Object.entries(entry.transforms ?? {}));
  }

  predict(features: MLFeatureVector): Promise<number> {
    let logit = this.intercept;
    for (const [feature, weight] of this.weights) {
      const raw = features[feature] ?? 0;
      const transformed = this.applyTransform(feature, raw);
      logit += weight * transformed;
    }
    return Promise.resolve(clamp01(sigmoid(logit)));
  }

  private applyTransform(feature: string, raw: number): number {
    const t = this.transforms.get(feature);
    if (t === undefined) {
      return raw;
    }
    let v = raw;
    if (t.offset !== undefined) {
      v = v + t.offset;
    }
    if (t.cap !== undefined) {
      v = Math.min(t.cap, v);
    }
    if (t.divide !== undefined) {
      v = v / t.divide;
    }
    if (t.normalizeFromNegOneToOne === true) {
      v = (v + 1) / 2;
    }
    return v;
  }
}

// ─── Loader ──────────────────────────────────────────────────────

export interface BundleLoadResult {
  readonly bundle: MLModelBundle;
  readonly models: ReadonlyMap<string, MLModel>;
}

/**
 * Read a bundle file from disk, validate, verify integrity, and return
 * a Map of model-name → MLModel ready for MLScorer.
 */
export async function loadMLBundle(path: string): Promise<Result<BundleLoadResult>> {
  let raw: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from bootstrap config (ML_BUNDLE_PATH env), not user input
    raw = await readFile(path, 'utf8');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(new InternalError(`Failed to read ML bundle at ${path}: ${message}`));
  }
  return parseMLBundle(raw);
}

/**
 * Parse and validate bundle content. Separated from disk IO so tests and
 * in-memory bundle sources (e.g., signed S3 object body) can reuse the
 * schema + integrity logic without touching the filesystem.
 */
export function parseMLBundle(raw: string): Result<BundleLoadResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(
      new ValidationError('ML bundle is not valid JSON', { bundle: [`parse failed: ${message}`] }),
    );
  }

  const result = bundleSchema.safeParse(parsed);
  if (!result.success) {
    return err(
      new ValidationError('ML bundle failed schema validation', {
        bundle: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      }),
    );
  }
  const bundle = result.data;

  const computed = computeBundleHash(bundle);
  if (computed !== bundle.sha256) {
    return err(
      new InternalError(
        `ML bundle integrity check failed: expected ${bundle.sha256}, computed ${computed}`,
      ),
    );
  }

  const models = new Map<string, MLModel>();
  for (const [modelName, entry] of Object.entries(bundle.models)) {
    models.set(
      modelName,
      new BundledLinearModel(modelName, entry, {
        version: bundle.version,
        sha256: bundle.sha256,
      }),
    );
  }
  return ok({ bundle, models });
}

// ─── Integrity ───────────────────────────────────────────────────

/**
 * Compute the canonical SHA-256 hash of a bundle, excluding the `sha256`
 * field itself. Exposed for bundle-signing tooling.
 */
export function computeBundleHash(bundle: MLModelBundle): string {
  // Exclude the sha256 field — it holds the hash we're computing.
  const { sha256: _ignored, ...rest } = bundle;
  void _ignored;
  const canonical = canonicaliseForHash(rest);
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}

/**
 * Stable stringify with sorted object keys at every depth. Arrays keep
 * their order. Ensures the same logical bundle always produces the same
 * byte sequence regardless of key insertion order.
 */
function canonicaliseForHash(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const entries = Object.entries(v as Record<string, unknown>);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const sorted: Record<string, unknown> = {};
      for (const [k, val] of entries) {
        sorted[k] = val;
      }
      return sorted;
    }
    return v;
  });
}
