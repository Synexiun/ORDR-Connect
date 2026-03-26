/**
 * @ordr/auth — Authentication, authorization, and session management
 *
 * SOC2 / ISO 27001 / HIPAA compliant auth primitives.
 *
 * - RS256 JWT token management (jose library)
 * - Role-Based Access Control with scope enforcement
 * - Session management with HIPAA idle timeout
 * - API key authentication
 * - Password policy enforcement
 * - Sliding window rate limiting
 * - Framework-agnostic middleware types
 */

// ─── JWT ───────────────────────────────────────────────────────────
export type {
  JwtConfig,
  AccessTokenPayload,
  RefreshTokenPayload,
} from './jwt.js';

export {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  loadKeyPair,
} from './jwt.js';

// ─── RBAC ──────────────────────────────────────────────────────────
export {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  hasRole,
  hasPermission,
  checkAccess,
} from './rbac.js';

// ─── Session Management ────────────────────────────────────────────
export type {
  StoredSession,
  SessionMetadata,
  SessionStore,
} from './session.js';

export { SessionManager } from './session.js';

// ─── API Key ───────────────────────────────────────────────────────
export type {
  ApiKeyCreateResult,
  ApiKeyRecord,
} from './api-key.js';

export {
  createApiKey,
  verifyApiKey,
  extractApiKeyPrefix,
  isApiKeyExpired,
} from './api-key.js';

// ─── Middleware ─────────────────────────────────────────────────────
export type {
  AuthResult,
  AuthSuccess,
  AuthFailure,
  AuthHeaders,
  ApiKeyVerifier,
} from './middleware.js';

export {
  authenticateRequest,
  requireRole,
  requirePermission,
  requireTenant,
} from './middleware.js';

// ─── Password Policy ───────────────────────────────────────────────
export type {
  PasswordPolicy,
  PasswordValidationResult,
} from './password-policy.js';

export {
  DEFAULT_PASSWORD_POLICY,
  validatePassword,
  isPasswordExpired,
} from './password-policy.js';

// ─── Rate Limiting ─────────────────────────────────────────────────
export type {
  RateLimitConfig,
  RateLimitResult,
  RateLimiter,
} from './rate-limiter.js';

export {
  AUTH_RATE_LIMIT,
  API_RATE_LIMIT,
  PHI_ACCESS_RATE_LIMIT,
  InMemoryRateLimiter,
} from './rate-limiter.js';

// ─── SSO ──────────────────────────────────────────────────────────
export type {
  SSOProfile,
  SSOConnection,
  SSOConnectionConfig,
  SSOConnectionType,
  SSOProvider,
  SSOConnectionStatus,
  SSOManagerConfig,
  WorkOSClient,
  SSOConnectionStore,
} from './sso.js';

export {
  SSOManager,
  InMemorySSOClient,
  InMemorySSOConnectionStore,
} from './sso.js';

// ─── SCIM ─────────────────────────────────────────────────────────
export type {
  SCIMUser,
  SCIMUserName,
  SCIMUserEmail,
  SCIMUserResponse,
  SCIMUserMeta,
  SCIMGroup,
  SCIMGroupMember,
  SCIMGroupResponse,
  SCIMGroupMeta,
  SCIMListResponse,
  SCIMUserRecord,
  SCIMGroupRecord,
  UserStore,
  GroupStore,
  SessionRevoker,
  SCIMTokenRecord,
  SCIMTokenStore,
  SCIMHandlerDeps,
} from './scim.js';

export {
  SCIM_SCHEMAS,
  SCIMHandler,
  verifySCIMToken,
  InMemoryUserStore,
  InMemoryGroupStore,
  InMemorySCIMTokenStore,
} from './scim.js';

// ─── Organization ─────────────────────────────────────────────────
export type {
  Organization,
  OrgTree,
  CreateOrgInput,
  OrgStore,
} from './organization.js';

export {
  OrganizationManager,
  InMemoryOrgStore,
} from './organization.js';

// ─── Custom Roles ─────────────────────────────────────────────────
export type {
  CustomRole,
  CreateRoleInput,
  UserRoleAssignment,
  RoleStore,
  RoleAuditLogger,
} from './custom-roles.js';

export {
  CustomRoleManager,
  InMemoryRoleStore,
} from './custom-roles.js';
