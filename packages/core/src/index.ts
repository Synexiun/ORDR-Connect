/**
 * @ordr/core — shared types, errors, config, and constants
 *
 * Single entry point for the core package. Every service in the
 * ORDR-Connect monorepo imports from here.
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  TenantId,
  TenantPlan,
  TenantStatus,
  IsolationTier,
  TenantSettings,
  Tenant,
  TenantContext,
} from './types/tenant.js';

export {
  createTenantId,
  TENANT_PLANS,
  TENANT_STATUSES,
  ISOLATION_TIERS,
} from './types/tenant.js';

export type {
  UserId,
  UserRole,
  UserStatus,
  PermissionAction,
  PermissionScope,
  Permission,
  User,
} from './types/user.js';

export {
  createUserId,
  USER_ROLES,
  USER_STATUSES,
  PERMISSION_ACTIONS,
  PERMISSION_SCOPES,
  hasRoleAuthority,
} from './types/user.js';

export type {
  DataClassification,
  ClassificationRequirement,
} from './types/data-classification.js';

export {
  DATA_CLASSIFICATIONS,
  CLASSIFICATION_REQUIREMENTS,
  isRestricted,
  isConfidentialOrAbove,
  isAtLeast,
  getRequirements,
} from './types/data-classification.js';

export type {
  EventMetadata,
  DomainEvent,
  EventType,
} from './types/event.js';

export {
  CUSTOMER_EVENTS,
  INTERACTION_EVENTS,
  AGENT_EVENTS,
  COMPLIANCE_EVENTS,
  AUDIT_EVENTS,
  ALL_EVENTS,
} from './types/event.js';

export type {
  AgentId,
  AgentRole,
  WellKnownAgentRole,
  AutonomyLevel,
  AgentAuditEntry,
  AgentAction,
  AgentStatus,
} from './types/agent.js';

export {
  createAgentId,
  createAgentRole,
  isWellKnownRole,
  AGENT_ROLES,
  AUTONOMY_LEVELS,
  AGENT_STATUSES,
  hasAutonomyAtLeast,
} from './types/agent.js';

export type {
  SslStatus,
  BrandConfig,
  BrandConfigUpdate,
  CustomDomainConfig,
} from './types/branding.js';

export {
  SSL_STATUSES,
  DEFAULT_BRAND_CONFIG,
} from './types/branding.js';

export type {
  DataRegion,
  DataResidencyConfig,
} from './types/data-residency.js';

export {
  DATA_REGIONS,
  DEFAULT_DATA_RESIDENCY,
  isRegionAllowed,
  hasAdequacyDecision,
} from './types/data-residency.js';

// ─── Errors ───────────────────────────────────────────────────────
export type { SafeErrorResponse, ErrorCode } from './errors.js';

export {
  ERROR_CODES,
  AppError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  ConflictError,
  RateLimitError,
  ComplianceViolationError,
  InternalError,
  isAppError,
  isOperationalError,
} from './errors.js';

// ─── Result ───────────────────────────────────────────────────────
export type { Ok, Err, Result } from './result.js';

export {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  flatMap,
} from './result.js';

// ─── Config ───────────────────────────────────────────────────────
export type {
  AppConfig,
  ParsedConfig,
  DatabaseConfig,
  RedisConfig,
  KafkaConfig,
  AuthConfig,
  EncryptionConfig,
  AIConfig,
  MonitoringConfig,
} from './config.js';

export { envSchema, loadConfig } from './config.js';

// ─── Constants ────────────────────────────────────────────────────
export {
  HASH_ALGORITHM,
  ENCRYPTION_ALGORITHM,
  MERKLE_BATCH_SIZE,
  JWT_ALGORITHM,
  ARGON2_MEMORY_COST,
  ARGON2_TIME_COST,
  ARGON2_PARALLELISM,
  IV_LENGTH_BYTES,
  AUTH_TAG_LENGTH_BYTES,
  SALT_LENGTH_BYTES,
  MAX_SESSION_IDLE_MINUTES,
  MAX_SESSION_ABSOLUTE_HOURS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MINUTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  MFA_CODE_LENGTH,
  MFA_WINDOW_SECONDS,
  API_KEY_PREFIX,
  API_KEY_LENGTH,
  RATE_LIMIT,
  AUDIT_RETENTION_YEARS,
  AUDIT_LOG_BATCH_SIZE,
  COMPLIANCE_CHECK_INTERVAL_MS,
  DATA_CLASSIFICATION,
  PAGINATION,
  AGENT,
  HTTP_HEADERS,
} from './constants.js';

// ─── Zod re-export (used by validation tests) ─────────────────────
export { z } from 'zod';
