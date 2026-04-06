/**
 * SCIM 2.0 module barrel — re-exports all public surface from scim/ submodules.
 *
 * SOC2 CC6.2 — Provisioning and de-provisioning of access.
 * ISO 27001 A.9.2.1 — User registration and de-registration.
 * HIPAA §164.312(a)(1) — Access control: unique user identification.
 */

// ─── Handler ──────────────────────────────────────────────────────
export { SCIMHandler } from './handler.js';
export type { SCIMHandlerDeps } from './handler.js';

// ─── Production stores ────────────────────────────────────────────
export { DrizzleUserStore } from './user-store.js';
export { DrizzleGroupStore } from './group-store.js';
export { DrizzleTokenStore } from './token-store.js';

// ─── WorkOS webhook normaliser ────────────────────────────────────
export { normaliseWorkOSEvent } from './workos-normaliser.js';

// ─── Filter parser ────────────────────────────────────────────────
export { parseSCIMFilter } from './filters.js';

// ─── Types ────────────────────────────────────────────────────────
export type {
  SCIMEmail,
  SCIMUserRecord,
  SCIMGroupRecord,
  SCIMGroupMember,
  SCIMPatchOp,
  SCIMPatchRequest,
  SCIMFilter,
  SCIMListParams,
  SCIMListResponse,
  SCIMUserStore,
  SCIMGroupStore,
  SCIMTokenStore,
} from './types.js';
