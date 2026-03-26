/**
 * Constants — security, compliance, and operational defaults for ORDR-Connect
 *
 * These values are derived from SOC2, ISO 27001, and HIPAA requirements.
 * Change with care — many are compliance-critical.
 */

// ─── Cryptography ─────────────────────────────────────────────────

export const HASH_ALGORITHM = 'sha256' as const;
export const ENCRYPTION_ALGORITHM = 'aes-256-gcm' as const;
export const MERKLE_BATCH_SIZE = 1000 as const;
export const JWT_ALGORITHM = 'RS256' as const;
export const ARGON2_MEMORY_COST = 65536 as const;
export const ARGON2_TIME_COST = 3 as const;
export const ARGON2_PARALLELISM = 4 as const;
export const IV_LENGTH_BYTES = 16 as const;
export const AUTH_TAG_LENGTH_BYTES = 16 as const;
export const SALT_LENGTH_BYTES = 32 as const;

// ─── Session & Auth ───────────────────────────────────────────────

/** HIPAA requires idle timeout <= 15 minutes */
export const MAX_SESSION_IDLE_MINUTES = 15 as const;
export const MAX_SESSION_ABSOLUTE_HOURS = 12 as const;
export const MAX_FAILED_LOGIN_ATTEMPTS = 5 as const;
export const LOCKOUT_DURATION_MINUTES = 30 as const;
export const PASSWORD_MIN_LENGTH = 12 as const;
export const PASSWORD_MAX_LENGTH = 128 as const;
export const MFA_CODE_LENGTH = 6 as const;
export const MFA_WINDOW_SECONDS = 30 as const;

// ─── API Keys ─────────────────────────────────────────────────────

export const API_KEY_PREFIX = 'ordr_' as const;
export const API_KEY_LENGTH = 48 as const;

// ─── Rate Limiting ────────────────────────────────────────────────

export const RATE_LIMIT = {
  /** General API — requests per window */
  DEFAULT_WINDOW_MS: 60_000,
  DEFAULT_MAX_REQUESTS: 100,

  /** Auth endpoints — stricter */
  AUTH_WINDOW_MS: 300_000,
  AUTH_MAX_REQUESTS: 10,

  /** AI agent endpoints — cost-aware */
  AGENT_WINDOW_MS: 60_000,
  AGENT_MAX_REQUESTS: 20,

  /** Webhook endpoints */
  WEBHOOK_WINDOW_MS: 60_000,
  WEBHOOK_MAX_REQUESTS: 200,

  /** Export/bulk operations */
  EXPORT_WINDOW_MS: 3_600_000,
  EXPORT_MAX_REQUESTS: 5,
} as const;

// ─── Audit & Compliance ───────────────────────────────────────────

/** SOC2 / ISO 27001 require minimum 7-year retention */
export const AUDIT_RETENTION_YEARS = 7 as const;
export const AUDIT_LOG_BATCH_SIZE = 100 as const;
export const COMPLIANCE_CHECK_INTERVAL_MS = 300_000 as const;

// ─── Data Classification ──────────────────────────────────────────

export const DATA_CLASSIFICATION = {
  PUBLIC: 'public',
  INTERNAL: 'internal',
  CONFIDENTIAL: 'confidential',
  RESTRICTED: 'restricted',
} as const;

// ─── Pagination ───────────────────────────────────────────────────

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 1,
} as const;

// ─── Agent Safety ─────────────────────────────────────────────────

export const AGENT = {
  /** Minimum confidence score to auto-execute without human approval */
  MIN_AUTO_EXECUTE_CONFIDENCE: 0.85,
  /** Actions below this confidence get flagged for review */
  LOW_CONFIDENCE_THRESHOLD: 0.5,
  /** Maximum actions per agent per minute */
  MAX_ACTIONS_PER_MINUTE: 30,
  /** Maximum concurrent agent tasks per tenant */
  MAX_CONCURRENT_PER_TENANT: 10,
} as const;

// ─── HTTP ─────────────────────────────────────────────────────────

export const HTTP_HEADERS = {
  CORRELATION_ID: 'x-correlation-id',
  TENANT_ID: 'x-tenant-id',
  REQUEST_ID: 'x-request-id',
  RATE_LIMIT_REMAINING: 'x-ratelimit-remaining',
  RATE_LIMIT_RESET: 'x-ratelimit-reset',
} as const;
