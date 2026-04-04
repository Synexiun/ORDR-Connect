/**
 * CRM Credentials Middleware
 *
 * Retrieves fresh OAuth credentials for the current :provider route param
 * and stores them in c.set('crmCredentials', ...) for downstream handlers.
 *
 * SECURITY:
 * - Credentials are decrypted at request time — never stored in memory longer than needed
 * - Tokens never returned to clients, never logged
 * - IntegrationNotConnectedError → 403 (tenant admin must reconnect)
 * - IntegrationTokenExpiredError → 503 (token refresh failed; retry later)
 *
 * SOC2 CC6.1 — Credentials scoped to authenticated tenant context
 */

import type { MiddlewareHandler } from 'hono';
import type { FieldEncryptor } from '@ordr/crypto';
import type { OAuthConfig, CRMAdapter, OAuthCredentials } from '@ordr/integrations';
import {
  ensureFreshCredentials,
  IntegrationNotConnectedError,
  IntegrationTokenExpiredError,
} from '@ordr/integrations';
import type { CredentialManagerDeps } from '@ordr/integrations';
import type { Env } from '../types.js';

// ── Dependency Type ────────────────────────────────────────────────

export interface CrmCredentialsDeps {
  readonly credManagerDeps: CredentialManagerDeps;
  readonly fieldEncryptor: FieldEncryptor;
  readonly oauthConfigs: Map<string, OAuthConfig>;
  readonly adapters: Map<string, Pick<CRMAdapter, 'refreshAccessToken'>>;
}

// ── Middleware Factory ─────────────────────────────────────────────

export function withCredentials(deps: CrmCredentialsDeps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const ctx = c.get('tenantContext');
    if (!ctx) {
      return c.json({ error: 'tenant_context_required' }, 403);
    }

    const provider = c.req.param('provider');
    if (provider === undefined || provider === '') {
      return c.json({ error: 'provider_required' }, 400);
    }

    const oauthConfig = deps.oauthConfigs.get(provider);
    const adapter = deps.adapters.get(provider);
    if (!oauthConfig || !adapter) {
      return c.json({ error: 'unknown_provider' }, 404);
    }

    try {
      const credentials: OAuthCredentials = await ensureFreshCredentials(
        deps.credManagerDeps,
        ctx.tenantId,
        provider,
        adapter,
        oauthConfig,
        deps.fieldEncryptor,
      );
      c.set('crmCredentials', credentials);
      await next();
    } catch (err: unknown) {
      if (err instanceof IntegrationNotConnectedError) {
        return c.json({ error: 'integration_not_connected' }, 403);
      }
      if (err instanceof IntegrationTokenExpiredError) {
        return c.json({ error: 'integration_token_refresh_failed' }, 503);
      }
      throw err;
    }
  };
}
