/**
 * CRM Integration Types — ORDR-Connect Integration Framework
 *
 * SOC2 CC6.1 — Access control for integration data.
 * ISO 27001 A.8.2.3 — Handling of external data assets.
 * HIPAA §164.312(e) — Transmission security for PHI crossing system boundaries.
 *
 * All CRM credentials are encrypted at rest (AES-256-GCM).
 * PHI fields are detected and encrypted during sync mapping.
 * OAuth tokens are short-lived; refresh tokens encrypted at rest.
 */

// ─── Integration Provider ───────────────────────────────────────

export const INTEGRATION_PROVIDERS = ['salesforce', 'hubspot', 'custom'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

// ─── Sync Direction ─────────────────────────────────────────────

export const SYNC_DIRECTIONS = ['inbound', 'outbound', 'bidirectional'] as const;
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number];

// ─── Entity Types ───────────────────────────────────────────────

export const ENTITY_TYPES = ['contact', 'deal', 'activity'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// ─── Sync Status ────────────────────────────────────────────────

export const SYNC_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

// ─── Conflict Resolution ────────────────────────────────────────

export const CONFLICT_RESOLUTIONS = [
  'source_wins',
  'target_wins',
  'most_recent',
  'manual',
] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

// ─── Integration Health ─────────────────────────────────────────

export const HEALTH_STATUSES = ['healthy', 'degraded', 'disconnected', 'error'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

// ─── OAuth Credentials ──────────────────────────────────────────

/** RESTRICTED — encrypted at rest (AES-256-GCM). Never logged. */
export interface OAuthCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly expiresAt: Date;
  readonly scope: string;
  readonly instanceUrl?: string | undefined;
}

// ─── Integration Config ─────────────────────────────────────────

export interface IntegrationConfig {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: IntegrationProvider;
  /** RESTRICTED — encrypted JSONB containing OAuthCredentials */
  readonly credentials: string;
  readonly fieldMappings: readonly FieldMapping[];
  readonly syncDirection: SyncDirection;
  readonly isActive: boolean;
  readonly lastSyncAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Field Mapping ──────────────────────────────────────────────

export interface FieldMapping {
  readonly ordrField: string;
  readonly externalField: string;
  readonly direction: SyncDirection;
  readonly transform?: FieldTransform | undefined;
  readonly isPhi: boolean;
}

export interface FieldTransform {
  readonly type: 'date_format' | 'lowercase' | 'uppercase' | 'trim' | 'custom';
  readonly config?: Readonly<Record<string, string>> | undefined;
}

// ─── Entity Mapping ─────────────────────────────────────────────

export interface EntityMapping {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: IntegrationProvider;
  readonly entityType: EntityType;
  readonly ordrEntityId: string;
  readonly externalEntityId: string;
  readonly lastSyncedAt: Date;
}

// ─── Sync Event ─────────────────────────────────────────────────

export interface SyncEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: IntegrationProvider;
  readonly direction: SyncDirection;
  readonly entityType: EntityType;
  readonly recordsProcessed: number;
  readonly recordsCreated: number;
  readonly recordsUpdated: number;
  readonly recordsFailed: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly status: SyncStatus;
  readonly error: string | null;
}

// ─── Integration Health ─────────────────────────────────────────

export interface IntegrationHealth {
  readonly provider: IntegrationProvider;
  readonly status: HealthStatus;
  readonly lastCheckedAt: Date;
  readonly latencyMs: number | null;
  readonly rateLimitRemaining: number | null;
  readonly rateLimitResetAt: Date | null;
  readonly message: string | null;
}

// ─── Webhook Config ─────────────────────────────────────────────

export interface WebhookConfig {
  readonly provider: IntegrationProvider;
  readonly endpointUrl: string;
  readonly secret: string;
  readonly events: readonly string[];
  readonly isActive: boolean;
}

// ─── Sync Conflict ──────────────────────────────────────────────

export interface SyncConflict {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: IntegrationProvider;
  readonly entityType: EntityType;
  readonly ordrEntityId: string;
  readonly externalEntityId: string;
  /** RESTRICTED — encrypted JSONB */
  readonly ordrData: string;
  /** RESTRICTED — encrypted JSONB */
  readonly externalData: string;
  readonly resolution: ConflictResolution | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

// ─── Pagination ─────────────────────────────────────────────────

export interface PaginationParams {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface PaginatedResult<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly total: number;
}

// ─── CRM Record Types (normalized) ─────────────────────────────

export interface CrmContact {
  readonly externalId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly company: string | null;
  readonly title: string | null;
  readonly lastModified: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CrmDeal {
  readonly externalId: string;
  readonly name: string;
  readonly amount: number | null;
  readonly currency: string;
  readonly stage: string;
  readonly probability: number | null;
  readonly closeDate: Date | null;
  readonly contactExternalId: string | null;
  readonly lastModified: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CrmActivity {
  readonly externalId: string;
  readonly type: 'task' | 'event' | 'call' | 'email' | 'note';
  readonly subject: string;
  readonly description: string | null;
  readonly contactExternalId: string | null;
  readonly dealExternalId: string | null;
  readonly dueDate: Date | null;
  readonly completedAt: Date | null;
  readonly lastModified: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ─── Sync Query ─────────────────────────────────────────────────

export interface SyncQuery {
  readonly modifiedAfter?: Date | undefined;
  readonly modifiedBefore?: Date | undefined;
  readonly externalIds?: readonly string[] | undefined;
}

// ─── Webhook Payload ────────────────────────────────────────────

export interface WebhookPayload {
  readonly provider: IntegrationProvider;
  readonly eventType: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly timestamp: Date;
}

// ─── Rate Limit Info ────────────────────────────────────────────

export interface RateLimitInfo {
  readonly remaining: number;
  readonly limit: number;
  readonly resetAt: Date;
}
