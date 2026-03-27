/**
 * Synexiun Kernel Constants — TypeScript port of synex_kernel/constants.py
 *
 * These values must remain in sync with the Core authority server.
 * Do not modify without coordinating with the Synexiun kernel team.
 */

// --- Limb identity ---

/** ORDR-Connect's registered limb ID in the Synexiun ecosystem. */
export const ORDR_LIMB_ID = 'synexcom-ordr-001';

/** Core identity for the data diode target (upward communication destination). */
export const CORE_ID = 'synexiun-core';

// --- Timing ---

/** How often to emit a health beacon to Core (milliseconds). Matches kernel default. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** How often to emit an audit chain snapshot (milliseconds). */
export const AUDIT_REPORT_INTERVAL_MS = 60_000;

/** How often to emit a budget report (milliseconds). */
export const BUDGET_REPORT_INTERVAL_MS = 300_000;

/** Maximum clock skew allowed for request timestamps (milliseconds). */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000; // 5 minutes

// --- Budget ---

/** Budget level below which status transitions to DRAINING. */
export const BUDGET_DEGRADED_THRESHOLD = 0.1;

// --- Health degradation thresholds ---

/** Consecutive beacon failures before emitting a WARNING log. */
export const CONSECUTIVE_FAIL_WARN = 3;

/** Consecutive beacon failures before transitioning to DEGRADED status. */
export const CONSECUTIVE_FAIL_DEGRADE = 10;

// --- Audit ---

/** Genesis hash — first entry in an empty chain. */
export const GENESIS_HASH = '0'.repeat(64);
