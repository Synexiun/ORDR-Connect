/**
 * @ordr/integrations — CRM Integration Framework
 *
 * Provider-agnostic CRM integration with OAuth 2.0, field mapping,
 * conflict resolution, and bi-directional sync.
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - OAuth tokens encrypted at rest — AES-256-GCM (CC6.1)
 * - Webhook signatures verified before processing (A.14.1.2)
 * - PHI fields detected and encrypted during sync (§164.312(e))
 * - All sync operations audit-logged (CC7.2)
 *
 * Usage:
 *   import { SalesforceAdapter, HubSpotAdapter } from '@ordr/integrations';
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  IntegrationProvider,
  SyncDirection,
  EntityType,
  SyncStatus,
  ConflictResolution,
  HealthStatus,
  OAuthCredentials,
  IntegrationConfig,
  FieldMapping,
  FieldTransform,
  EntityMapping,
  SyncEvent,
  IntegrationHealth,
  WebhookConfig,
  SyncConflict,
  PaginationParams,
  PaginatedResult,
  CrmContact,
  CrmDeal,
  CrmActivity,
  SyncQuery,
  WebhookPayload,
  RateLimitInfo,
} from './types.js';

export {
  INTEGRATION_PROVIDERS,
  SYNC_DIRECTIONS,
  ENTITY_TYPES,
  SYNC_STATUSES,
  CONFLICT_RESOLUTIONS,
  HEALTH_STATUSES,
} from './types.js';

// ─── Adapter Interface ───────────────────────────────────────────
export type {
  CRMAdapter,
  OAuthConfig,
  OAuthAuthorizationResult,
  OAuthTokenResult,
  ConnectionConfig,
  HttpClient,
  HttpResponse,
} from './adapter.js';

// ─── Salesforce Adapter ──────────────────────────────────────────
export { SalesforceAdapter } from './salesforce/adapter.js';

// ─── HubSpot Adapter ────────────────────────────────────────────
export { HubSpotAdapter } from './hubspot/adapter.js';

// ─── Credential Manager ──────────────────────────────────────────
export {
  saveCredentials,
  getCredentials,
  ensureFreshCredentials,
  IntegrationNotConnectedError,
  IntegrationTokenExpiredError,
} from './credential-manager.js';
export type {
  OAuthTokens,
  IntegrationConfigRow,
  CredentialManagerDeps,
} from './credential-manager.js';

// ─── Field Mapper ───────────────────────────────────────────────
export { applyFieldMappings, applyTransform, defaultContactMappings } from './field-mapper.js';
export type { MappingResult } from './field-mapper.js';

// ─── Conflict Resolver ──────────────────────────────────────────
export { detectConflicts, resolveConflicts } from './conflict-resolver.js';
export type {
  FieldConflict,
  ConflictDetectionResult,
  ConflictResolutionResult,
} from './conflict-resolver.js';

// ─── Sync Engine ────────────────────────────────────────────────
export { SyncEngine } from './sync-engine.js';
export type {
  ExternalRecord,
  ExistingOrdrRecord,
  OrdrRecord,
  InboundAction,
  InboundRecordResult,
  InboundSyncResult,
  OutboundRecordResult,
  OutboundSyncResult,
} from './sync-engine.js';
