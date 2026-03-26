/**
 * Hono environment types — typed context variables for Developer Portal
 *
 * All middleware and route handlers access these via c.get() / c.set().
 * Zero `any` — every context variable is explicitly typed.
 */

/**
 * Developer context — set by API key auth middleware.
 * Contains the authenticated developer's identity and limits.
 */
export interface DeveloperContext {
  readonly developerId: string;
  readonly email: string;
  readonly tier: 'free' | 'pro' | 'enterprise';
  readonly rateLimitRpm: number;
  readonly status: 'active' | 'suspended' | 'revoked';
}

/**
 * Hono `Env` type parameter for the Developer Portal.
 */
export interface Env {
  Variables: {
    /** UUID v4 correlation ID — set by request-id middleware */
    requestId: string;
    /** Authenticated developer context — set by api-key-auth middleware */
    developerContext: DeveloperContext | undefined;
  };
}
