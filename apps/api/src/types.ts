/**
 * Hono environment types — typed context variables for ORDR-Connect API
 *
 * All middleware and route handlers access these via c.get() / c.set().
 * Zero `any` — every context variable is explicitly typed.
 */

import type { TenantContext } from '@ordr/core';

/**
 * Hono `Env` type parameter. Defines the shape of context variables
 * available to all middleware and route handlers.
 */
export interface Env {
  Variables: {
    /** UUID v4 correlation ID — set by request-id middleware */
    requestId: string;
    /** Authenticated tenant context — set by auth middleware */
    tenantContext: TenantContext | undefined;
  };
}
