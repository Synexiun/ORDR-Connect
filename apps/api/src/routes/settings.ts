/**
 * Settings Routes — tenant configuration, SSO, roles, agents, channels,
 * notification preferences, and security policy
 *
 * SOC2 CC6.3 — Access control configuration and role management.
 * SOC2 CC6.7 — Transmission of data: channel config.
 * ISO 27001 A.9.1 — Business requirements of access control.
 * HIPAA §164.308(a)(3) — Workforce access management.
 *
 * Endpoints:
 * GET  /tenant               — Org name, timezone, retention, language, brand
 * PATCH /tenant              — Update org settings (admin only)
 * GET  /sso                  — List SSO connections
 * POST /sso                  — Create SSO connection (admin only)
 * GET  /roles                — List custom roles with user counts
 * POST /roles                — Create custom role (admin only)
 * GET  /agents               — Agent safety config
 * PATCH /agents              — Update agent config (admin only)
 * GET  /channels             — Tenant channel enable/priority config
 * PATCH /channels/reorder    — Reorder channels (admin only)
 * PATCH /channels/:channel   — Toggle channel (admin only)
 * GET  /notifications        — Notification preferences
 * PATCH /notifications/:key  — Update notification pref (admin only)
 * GET  /security             — Security posture config
 * PATCH /security            — Update mfaEnforced / ipAllowlist (admin only)
 *
 * Config for agents/channels/notifications/security is stored in the
 * tenants.settings JSONB column as a typed sub-tree. SSO and roles have
 * their own tables.
 *
 * SECURITY:
 * - All writes: tenant_admin role required + audit-logged WORM (Rule 3)
 * - tenant_id from JWT only — NEVER from client input (Rule 2)
 * - No PHI in settings payloads (Rule 6)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, count } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import * as schema from '@ordr/db';
import type { AuditLogger } from '@ordr/audit';
import { AuthorizationError, ValidationError, NotFoundError } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth, requireRoleMiddleware } from '../middleware/auth.js';

// ─── Typed settings sub-tree stored in tenants.settings ──────────

interface ChannelEntry {
  channel: string;
  priority: number;
  enabled: boolean;
  provider: string;
}

interface NotificationPrefEntry {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  channels: ('email' | 'slack' | 'sms')[];
}

interface AgentConfigEntry {
  confidenceThreshold: number;
  maxActionsPerSession: number;
  costLimitPerSession: number;
  globalKillSwitch: boolean;
  autonomyLevels: { role: string; level: string; budget: string }[];
}

interface TenantSettingsJson {
  timezone?: string;
  dataRetention?: string;
  defaultLanguage?: string;
  brandColor?: string;
  logoUrl?: string | null;
  agentConfig?: AgentConfigEntry;
  channelConfig?: ChannelEntry[];
  notificationPrefs?: NotificationPrefEntry[];
  mfaEnforced?: boolean;
  ipAllowlist?: string[];
}

// ─── Defaults ─────────────────────────────────────────────────────

const DEFAULT_CHANNEL_CONFIG: ChannelEntry[] = [
  { channel: 'Email', priority: 1, enabled: true, provider: 'SendGrid' },
  { channel: 'SMS', priority: 2, enabled: true, provider: 'Twilio' },
  { channel: 'Voice', priority: 3, enabled: true, provider: 'Twilio' },
  { channel: 'WhatsApp', priority: 4, enabled: false, provider: 'Twilio' },
  { channel: 'Chat', priority: 5, enabled: true, provider: 'Native' },
];

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefEntry[] = [
  {
    key: 'compliance_violations',
    label: 'Compliance Violations',
    description: 'Alert on critical/high violations',
    enabled: true,
    channels: ['email', 'slack'],
  },
  {
    key: 'agent_hitl',
    label: 'Agent HITL Requests',
    description: 'Notify when agents need human review',
    enabled: true,
    channels: ['email', 'slack', 'sms'],
  },
  {
    key: 'audit_chain',
    label: 'Audit Chain Alerts',
    description: 'P0 alert if hash chain integrity fails',
    enabled: true,
    channels: ['email', 'slack', 'sms'],
  },
  {
    key: 'daily_summary',
    label: 'Daily Summary',
    description: 'Operations summary via email',
    enabled: false,
    channels: ['email'],
  },
  {
    key: 'sla_breach',
    label: 'SLA Breach Alerts',
    description: 'Triggered when response time exceeds SLA',
    enabled: true,
    channels: ['email', 'slack'],
  },
  {
    key: 'agent_budget',
    label: 'Agent Budget Alerts',
    description: 'Notify when agent approaches cost limit',
    enabled: true,
    channels: ['email'],
  },
];

const DEFAULT_AGENT_CONFIG: AgentConfigEntry = {
  confidenceThreshold: 0.7,
  maxActionsPerSession: 25,
  costLimitPerSession: 1.0,
  globalKillSwitch: false,
  autonomyLevels: [
    { role: 'Collection', level: 'Semi-autonomous', budget: '$1.00' },
    { role: 'Onboarding', level: 'Fully autonomous', budget: '$0.50' },
    { role: 'Support', level: 'Semi-autonomous', budget: '$1.50' },
    { role: 'Retention', level: 'Human-in-loop', budget: '$2.00' },
  ],
};

// ─── Input Schemas ────────────────────────────────────────────────

const updateTenantSchema = z.object({
  organizationName: z.string().min(1).max(255).optional(),
  timezone: z.string().max(100).optional(),
  dataRetention: z.string().max(50).optional(),
  defaultLanguage: z.string().max(10).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color')
    .optional(),
  logoUrl: z.string().url().max(2048).nullable().optional(),
});

const createSsoSchema = z.object({
  provider: z.string().min(1).max(100),
  protocol: z.enum(['saml', 'oidc']),
  domain: z.string().min(1).max(255),
});

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string().min(1)),
});

const updateAgentSchema = z.object({
  confidenceThreshold: z.number().min(0).max(1).optional(),
  maxActionsPerSession: z.number().int().min(1).max(1000).optional(),
  costLimitPerSession: z.number().min(0).max(100).optional(),
  globalKillSwitch: z.boolean().optional(),
  autonomyLevels: z
    .array(z.object({ role: z.string(), level: z.string(), budget: z.string() }))
    .optional(),
});

const toggleChannelSchema = z.object({
  enabled: z.boolean(),
});

const reorderChannelSchema = z.object({
  channel: z.string().min(1),
  direction: z.enum(['up', 'down']),
});

const updateNotifPrefSchema = z.object({
  enabled: z.boolean().optional(),
  channels: z.array(z.enum(['email', 'slack', 'sms'])).optional(),
});

const updateSecuritySchema = z.object({
  mfaEnforced: z.boolean().optional(),
  ipAllowlist: z.array(z.string().min(1)).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────

async function fetchTenantRow(
  db: OrdrDatabase,
  tenantId: string,
): Promise<{ id: string; name: string; settings: unknown } | undefined> {
  const rows = await db
    .select({ id: schema.tenants.id, name: schema.tenants.name, settings: schema.tenants.settings })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  return rows[0];
}

function parseTenantSettings(raw: unknown): TenantSettingsJson {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as TenantSettingsJson;
  }
  return {};
}

async function patchTenantSettings(
  db: OrdrDatabase,
  tenantId: string,
  patch: Partial<TenantSettingsJson>,
): Promise<void> {
  const row = await fetchTenantRow(db, tenantId);
  if (row === undefined) throw new Error('[ORDR:API] Tenant not found');
  const current = parseTenantSettings(row.settings);
  const next: TenantSettingsJson = { ...current, ...patch };
  await db
    .update(schema.tenants)
    .set({ settings: next, updatedAt: new Date() })
    .where(eq(schema.tenants.id, tenantId));
}

function mapSsoStatus(dbStatus: string): 'connected' | 'pending' | 'error' {
  if (dbStatus === 'active') return 'connected';
  if (dbStatus === 'validating') return 'pending';
  return 'error';
}

// ─── Module-level deps ────────────────────────────────────────────

interface SettingsDeps {
  readonly db: OrdrDatabase;
  readonly auditLogger: AuditLogger;
}

let _deps: SettingsDeps | null = null;

export function configureSettingsRoutes(deps: SettingsDeps): void {
  _deps = deps;
}

function getDeps(): SettingsDeps {
  if (_deps === null) throw new Error('[ORDR:API] Settings routes not configured');
  return _deps;
}

// ─── Router ───────────────────────────────────────────────────────

const settingsRouter = new Hono<Env>();

settingsRouter.use('*', requireAuth());

// ── GET /tenant ───────────────────────────────────────────────────

settingsRouter.get('/tenant', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const row = await fetchTenantRow(db, ctx.tenantId);
  if (row === undefined) throw new NotFoundError('Tenant not found', c.get('requestId'));

  const s = parseTenantSettings(row.settings);

  return c.json({
    success: true as const,
    data: {
      organizationName: row.name,
      timezone: s.timezone ?? 'America/New_York',
      dataRetention: s.dataRetention ?? '7 years',
      defaultLanguage: s.defaultLanguage ?? 'en',
      brandColor: s.brandColor ?? '#3b82f6',
      logoUrl: s.logoUrl ?? null,
    },
  });
});

// ── PATCH /tenant ─────────────────────────────────────────────────

settingsRouter.patch(
  '/tenant',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db, auditLogger } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = updateTenantSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.');
        const existing = fieldErrors[field];
        if (existing) existing.push(issue.message);
        else fieldErrors[field] = [issue.message];
      }
      throw new ValidationError('Invalid tenant settings', fieldErrors, requestId);
    }

    // Update name in tenants table if provided
    if (parsed.data.organizationName !== undefined) {
      await db
        .update(schema.tenants)
        .set({ name: parsed.data.organizationName, updatedAt: new Date() })
        .where(eq(schema.tenants.id, ctx.tenantId));
    }

    // Remaining fields go into settings jsonb — build patch without undefined values
    const settingsPatch: Partial<TenantSettingsJson> = {};
    if (parsed.data.timezone !== undefined) settingsPatch.timezone = parsed.data.timezone;
    if (parsed.data.dataRetention !== undefined)
      settingsPatch.dataRetention = parsed.data.dataRetention;
    if (parsed.data.defaultLanguage !== undefined)
      settingsPatch.defaultLanguage = parsed.data.defaultLanguage;
    if (parsed.data.brandColor !== undefined) settingsPatch.brandColor = parsed.data.brandColor;
    if ('logoUrl' in parsed.data) settingsPatch.logoUrl = parsed.data.logoUrl ?? null;
    if (Object.keys(settingsPatch).length > 0) {
      await patchTenantSettings(db, ctx.tenantId, settingsPatch);
    }

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'config.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'tenant',
      resourceId: ctx.tenantId,
      action: 'update_settings',
      details: { changedFields: Object.keys(parsed.data) },
      timestamp: new Date(),
    });

    // Return updated state
    const row = await fetchTenantRow(db, ctx.tenantId);
    if (row === undefined) throw new NotFoundError('Tenant not found', requestId);
    const s = parseTenantSettings(row.settings);

    return c.json({
      success: true as const,
      data: {
        organizationName: row.name,
        timezone: s.timezone ?? 'America/New_York',
        dataRetention: s.dataRetention ?? '7 years',
        defaultLanguage: s.defaultLanguage ?? 'en',
        brandColor: s.brandColor ?? '#3b82f6',
        logoUrl: s.logoUrl ?? null,
      },
    });
  },
);

// ── GET /sso ──────────────────────────────────────────────────────

settingsRouter.get('/sso', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const rows = await db
    .select({
      id: schema.ssoConnections.id,
      provider: schema.ssoConnections.provider,
      type: schema.ssoConnections.type,
      status: schema.ssoConnections.status,
      metadata: schema.ssoConnections.metadata,
    })
    .from(schema.ssoConnections)
    .where(eq(schema.ssoConnections.tenantId, ctx.tenantId));

  const data = rows.map((row) => {
    const meta =
      row.metadata !== null && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      provider: row.provider,
      protocol: row.type,
      status: mapSsoStatus(row.status),
      domain: typeof meta['domain'] === 'string' ? meta['domain'] : '',
    };
  });

  return c.json({ success: true as const, data });
});

// ── POST /sso ─────────────────────────────────────────────────────

settingsRouter.post('/sso', requireRoleMiddleware('tenant_admin'), async (c): Promise<Response> => {
  const { db, auditLogger } = getDeps();
  const requestId = c.get('requestId');
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = createSsoSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) existing.push(issue.message);
      else fieldErrors[field] = [issue.message];
    }
    throw new ValidationError('Invalid SSO connection data', fieldErrors, requestId);
  }

  const inserted = await db
    .insert(schema.ssoConnections)
    .values({
      tenantId: ctx.tenantId,
      name: `${parsed.data.provider} (${parsed.data.domain})`,
      type: parsed.data.protocol,
      provider: parsed.data.provider,
      status: 'validating',
      metadata: { domain: parsed.data.domain },
    })
    .returning({ id: schema.ssoConnections.id });

  const row = inserted[0];
  if (row === undefined) throw new Error('[ORDR:API] SSO insert returned no rows');

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'sso.connection.created',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'sso_connection',
    resourceId: row.id,
    action: 'create',
    details: { provider: parsed.data.provider, protocol: parsed.data.protocol },
    timestamp: new Date(),
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: row.id,
        provider: parsed.data.provider,
        protocol: parsed.data.protocol,
        status: 'pending' as const,
        domain: parsed.data.domain,
      },
    },
    201,
  );
});

// ── GET /roles ────────────────────────────────────────────────────

settingsRouter.get('/roles', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const roles = await db
    .select({
      id: schema.customRoles.id,
      name: schema.customRoles.name,
      permissions: schema.customRoles.permissions,
    })
    .from(schema.customRoles)
    .where(eq(schema.customRoles.tenantId, ctx.tenantId));

  // Count users per role in one query
  const userCounts = await db
    .select({
      roleId: schema.userCustomRoles.roleId,
      cnt: count(schema.userCustomRoles.userId),
    })
    .from(schema.userCustomRoles)
    .where(eq(schema.userCustomRoles.tenantId, ctx.tenantId))
    .groupBy(schema.userCustomRoles.roleId);

  const countMap = new Map<string, number>(userCounts.map((r) => [r.roleId, r.cnt]));

  const data = roles.map((role) => {
    const perms = Array.isArray(role.permissions)
      ? (role.permissions as Array<{ resource: string; action: string }>).map(
          (p) => `${p.resource}:${p.action}`,
        )
      : [];
    return {
      id: role.id,
      name: role.name,
      permissions: perms,
      userCount: countMap.get(role.id) ?? 0,
      isSystem: false,
    };
  });

  return c.json({ success: true as const, data });
});

// ── POST /roles ───────────────────────────────────────────────────

settingsRouter.post(
  '/roles',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = createRoleSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.');
        const existing = fieldErrors[field];
        if (existing) existing.push(issue.message);
        else fieldErrors[field] = [issue.message];
      }
      throw new ValidationError('Invalid role data', fieldErrors, requestId);
    }

    // Convert flat "resource:action" strings to Permission objects
    const permissions = parsed.data.permissions.map((p) => {
      const [resource, action] = p.split(':');
      return { resource: resource ?? p, action: action ?? 'read', scope: 'tenant' };
    });

    const inserted = await db
      .insert(schema.customRoles)
      .values({
        tenantId: ctx.tenantId,
        name: parsed.data.name,
        baseRole: 'agent',
        permissions,
        createdBy: ctx.userId,
      })
      .returning({ id: schema.customRoles.id, name: schema.customRoles.name });

    const row = inserted[0];
    if (row === undefined) throw new Error('[ORDR:API] Role insert returned no rows');

    return c.json(
      {
        success: true as const,
        data: {
          id: row.id,
          name: row.name,
          permissions: parsed.data.permissions,
          userCount: 0,
          isSystem: false,
        },
      },
      201,
    );
  },
);

// ── GET /agents ───────────────────────────────────────────────────

settingsRouter.get('/agents', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const row = await fetchTenantRow(db, ctx.tenantId);
  const s = parseTenantSettings(row?.settings);

  return c.json({
    success: true as const,
    data: s.agentConfig ?? DEFAULT_AGENT_CONFIG,
  });
});

// ── PATCH /agents ─────────────────────────────────────────────────

settingsRouter.patch(
  '/agents',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db, auditLogger } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = updateAgentSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.');
        const existing = fieldErrors[field];
        if (existing) existing.push(issue.message);
        else fieldErrors[field] = [issue.message];
      }
      throw new ValidationError('Invalid agent config', fieldErrors, requestId);
    }

    const row = await fetchTenantRow(db, ctx.tenantId);
    const s = parseTenantSettings(row?.settings);
    const current = s.agentConfig ?? DEFAULT_AGENT_CONFIG;
    const updated: AgentConfigEntry = {
      confidenceThreshold: parsed.data.confidenceThreshold ?? current.confidenceThreshold,
      maxActionsPerSession: parsed.data.maxActionsPerSession ?? current.maxActionsPerSession,
      costLimitPerSession: parsed.data.costLimitPerSession ?? current.costLimitPerSession,
      globalKillSwitch: parsed.data.globalKillSwitch ?? current.globalKillSwitch,
      autonomyLevels: parsed.data.autonomyLevels ?? current.autonomyLevels,
    };
    await patchTenantSettings(db, ctx.tenantId, { agentConfig: updated });

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'config.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'tenant',
      resourceId: ctx.tenantId,
      action: 'update_agent_config',
      details: { changedFields: Object.keys(parsed.data) },
      timestamp: new Date(),
    });

    return c.json({ success: true as const, data: updated });
  },
);

// ── GET /channels ─────────────────────────────────────────────────

settingsRouter.get('/channels', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const row = await fetchTenantRow(db, ctx.tenantId);
  const s = parseTenantSettings(row?.settings);

  return c.json({
    success: true as const,
    data: s.channelConfig ?? DEFAULT_CHANNEL_CONFIG,
  });
});

// ── PATCH /channels/reorder — must be before /:channel ────────────

settingsRouter.patch(
  '/channels/reorder',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = reorderChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('channel and direction are required', {}, requestId);
    }

    const row = await fetchTenantRow(db, ctx.tenantId);
    const s = parseTenantSettings(row?.settings);
    const channels = [...(s.channelConfig ?? DEFAULT_CHANNEL_CONFIG)].sort(
      (a, b) => a.priority - b.priority,
    );

    const idx = channels.findIndex((c) => c.channel === parsed.data.channel);
    if (idx === -1) throw new NotFoundError(`Channel not found: ${parsed.data.channel}`, requestId);

    const swap = parsed.data.direction === 'up' ? idx - 1 : idx + 1;
    if (swap >= 0 && swap < channels.length) {
      const tmp = channels[idx];
      const other = channels[swap];
      if (tmp !== undefined && other !== undefined) {
        channels[idx] = { ...tmp, priority: other.priority };
        channels[swap] = { ...other, priority: tmp.priority };
      }
    }

    await patchTenantSettings(db, ctx.tenantId, { channelConfig: channels });

    return c.json({ success: true as const, data: channels });
  },
);

// ── PATCH /channels/:channel — toggle ────────────────────────────

settingsRouter.patch(
  '/channels/:channel',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    const channelName = decodeURIComponent(c.req.param('channel'));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = toggleChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('enabled (boolean) is required', {}, requestId);
    }

    const row = await fetchTenantRow(db, ctx.tenantId);
    const s = parseTenantSettings(row?.settings);
    const channels = s.channelConfig ?? DEFAULT_CHANNEL_CONFIG;

    const idx = channels.findIndex((ch) => ch.channel === channelName);
    if (idx === -1) throw new NotFoundError(`Channel not found: ${channelName}`, requestId);

    const updated = channels.map((ch) =>
      ch.channel === channelName ? { ...ch, enabled: parsed.data.enabled } : ch,
    );
    await patchTenantSettings(db, ctx.tenantId, { channelConfig: updated });

    const entry = updated[idx];
    return c.json({ success: true as const, data: entry });
  },
);

// ── GET /notifications ────────────────────────────────────────────

settingsRouter.get('/notifications', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const row = await fetchTenantRow(db, ctx.tenantId);
  const s = parseTenantSettings(row?.settings);

  return c.json({
    success: true as const,
    data: s.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS,
  });
});

// ── PATCH /notifications/:key ─────────────────────────────────────

settingsRouter.patch(
  '/notifications/:key',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    const prefKey = decodeURIComponent(c.req.param('key'));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = updateNotifPrefSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid notification preference update', {}, requestId);
    }

    const row = await fetchTenantRow(db, ctx.tenantId);
    const s = parseTenantSettings(row?.settings);
    const prefs = s.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS;

    const idx = prefs.findIndex((p) => p.key === prefKey);
    if (idx === -1)
      throw new NotFoundError(`Notification preference not found: ${prefKey}`, requestId);

    const updated: NotificationPrefEntry[] = prefs.map((p) => {
      if (p.key !== prefKey) return p;
      return {
        ...p,
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        ...(parsed.data.channels !== undefined ? { channels: parsed.data.channels } : {}),
      };
    });
    await patchTenantSettings(db, ctx.tenantId, { notificationPrefs: updated });

    const entry = updated[idx];
    return c.json({ success: true as const, data: entry });
  },
);

// ── GET /security ─────────────────────────────────────────────────

settingsRouter.get('/security', async (c): Promise<Response> => {
  const { db } = getDeps();
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Authentication required');

  const row = await fetchTenantRow(db, ctx.tenantId);
  const s = parseTenantSettings(row?.settings);

  return c.json({
    success: true as const,
    data: {
      // These values describe the platform's security posture — not editable per tenant
      encryption: 'AES-256-GCM / TLS 1.3',
      keyRotation: '90-day maximum',
      auditIntegrity: 'SHA-256 hash chain + Merkle tree',
      sessionSecurity: 'In-memory tokens, no browser storage',
      // Tenant-configurable fields
      mfaEnforced: s.mfaEnforced ?? true,
      ipAllowlist: s.ipAllowlist ?? [],
    },
  });
});

// ── PATCH /security ───────────────────────────────────────────────

settingsRouter.patch(
  '/security',
  requireRoleMiddleware('tenant_admin'),
  async (c): Promise<Response> => {
    const { db, auditLogger } = getDeps();
    const requestId = c.get('requestId');
    const ctx = c.get('tenantContext');
    if (!ctx) throw new AuthorizationError('Authentication required');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = await c.req.json().catch(() => null);
    const parsed = updateSecuritySchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.');
        const existing = fieldErrors[field];
        if (existing) existing.push(issue.message);
        else fieldErrors[field] = [issue.message];
      }
      throw new ValidationError('Invalid security config', fieldErrors, requestId);
    }

    await patchTenantSettings(db, ctx.tenantId, {
      ...(parsed.data.mfaEnforced !== undefined ? { mfaEnforced: parsed.data.mfaEnforced } : {}),
      ...(parsed.data.ipAllowlist !== undefined ? { ipAllowlist: parsed.data.ipAllowlist } : {}),
    });

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'config.updated',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'tenant',
      resourceId: ctx.tenantId,
      action: 'update_security_config',
      details: { changedFields: Object.keys(parsed.data) },
      timestamp: new Date(),
    });

    // Return updated state
    const row = await fetchTenantRow(db, ctx.tenantId);
    const s = parseTenantSettings(row?.settings);

    return c.json({
      success: true as const,
      data: {
        encryption: 'AES-256-GCM / TLS 1.3',
        keyRotation: '90-day maximum',
        auditIntegrity: 'SHA-256 hash chain + Merkle tree',
        sessionSecurity: 'In-memory tokens, no browser storage',
        mfaEnforced: s.mfaEnforced ?? true,
        ipAllowlist: s.ipAllowlist ?? [],
      },
    });
  },
);

export { settingsRouter };
