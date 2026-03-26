/**
 * Data classification types — compliance-first data handling
 *
 * SOC2 / ISO 27001 / HIPAA require all data to be classified and
 * handled according to its sensitivity level.
 */

// ─── Classification Levels ────────────────────────────────────────

export const DATA_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

/** Numeric ranking for comparison — higher = more sensitive */
const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
} as const;

// ─── Requirements per Classification ──────────────────────────────

export interface ClassificationRequirement {
  readonly encryptAtRest: boolean;
  readonly encryptInTransit: boolean;
  readonly fieldLevelEncryption: boolean;
  readonly accessLogging: boolean;
  readonly auditTrail: boolean;
  readonly retentionYears: number;
  readonly mfaRequired: boolean;
  readonly allowedExportFormats: readonly string[];
  readonly maxAccessTier: string;
}

export const CLASSIFICATION_REQUIREMENTS: Record<DataClassification, ClassificationRequirement> = {
  public: {
    encryptAtRest: false,
    encryptInTransit: true,
    fieldLevelEncryption: false,
    accessLogging: false,
    auditTrail: false,
    retentionYears: 1,
    mfaRequired: false,
    allowedExportFormats: ['csv', 'json', 'pdf'],
    maxAccessTier: 'viewer',
  },
  internal: {
    encryptAtRest: true,
    encryptInTransit: true,
    fieldLevelEncryption: false,
    accessLogging: true,
    auditTrail: false,
    retentionYears: 3,
    mfaRequired: false,
    allowedExportFormats: ['csv', 'json', 'pdf'],
    maxAccessTier: 'agent',
  },
  confidential: {
    encryptAtRest: true,
    encryptInTransit: true,
    fieldLevelEncryption: true,
    accessLogging: true,
    auditTrail: true,
    retentionYears: 7,
    mfaRequired: true,
    allowedExportFormats: ['pdf'],
    maxAccessTier: 'manager',
  },
  restricted: {
    encryptAtRest: true,
    encryptInTransit: true,
    fieldLevelEncryption: true,
    accessLogging: true,
    auditTrail: true,
    retentionYears: 10,
    mfaRequired: true,
    allowedExportFormats: [],
    maxAccessTier: 'tenant_admin',
  },
} as const;

// ─── Helper Functions ─────────────────────────────────────────────

/** Returns true if classification is 'restricted' */
export function isRestricted(classification: DataClassification): boolean {
  return classification === 'restricted';
}

/** Returns true if classification is 'confidential' or 'restricted' */
export function isConfidentialOrAbove(classification: DataClassification): boolean {
  return CLASSIFICATION_RANK[classification] >= CLASSIFICATION_RANK['confidential'];
}

/** Returns true if classA is at least as sensitive as classB */
export function isAtLeast(
  classA: DataClassification,
  classB: DataClassification,
): boolean {
  return CLASSIFICATION_RANK[classA] >= CLASSIFICATION_RANK[classB];
}

/** Get the requirements for a given classification */
export function getRequirements(classification: DataClassification): ClassificationRequirement {
  return CLASSIFICATION_REQUIREMENTS[classification];
}
