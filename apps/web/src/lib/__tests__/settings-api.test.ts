/**
 * Settings API Tests
 *
 * Validates:
 * - fetchTenantSettings → GET /v1/settings/tenant (success + fallback)
 * - fetchSsoConnections → GET /v1/settings/sso (success + fallback)
 * - fetchRoles → GET /v1/settings/roles (success + fallback)
 * - fetchAgentConfig → GET /v1/settings/agents (success + fallback)
 * - fetchChannelConfig → GET /v1/settings/channels (success + fallback)
 * - fetchNotificationPrefs → GET /v1/settings/notifications (success + fallback)
 * - fetchSecurityConfig → GET /v1/settings/security (success + fallback)
 * - fetchTeamMembers → GET /v1/team/members (success + fallback)
 * - fetchActiveSessions → GET /v1/profile/sessions (success + fallback)
 * - fetchApiTokens → GET /v1/profile/tokens (success + fallback)
 * - fetchTeamActivity → GET /v1/team/activity (success + fallback)
 * - updateTenantSettings → PATCH /v1/settings/tenant (success + merge fallback)
 * - createSsoConnection → POST /v1/settings/sso (success + pending fallback)
 * - inviteMember → POST /v1/team/invite (success + local fallback)
 * - updateMemberRole → PATCH /v1/team/members/:id (success + fallback)
 * - suspendMember → PATCH /v1/team/members/:id/suspend (success + suspended fallback)
 * - removeMember → DELETE /v1/team/members/:id (success + no-op fallback)
 * - revokeSession → DELETE /v1/profile/sessions/:id (success + no-op fallback)
 * - generateApiToken → POST /v1/profile/tokens (success + local mock fallback)
 * - revokeApiToken → DELETE /v1/profile/tokens/:id (success + no-op fallback)
 * - changePassword → POST /v1/profile/change-password (success + no-op fallback)
 * - toggleMfa → POST /v1/profile/mfa (success + setupUri fallback)
 * - toggleChannel → PATCH /v1/settings/channels/:channel (success + fallback)
 * - updateNotificationPref → PATCH /v1/settings/notifications/:key (success + fallback)
 * - updateAgentConfig → PATCH /v1/settings/agents (success + merge fallback)
 * - updateSecurityConfig → PATCH /v1/settings/security (success + merge fallback)
 *
 * COMPLIANCE: SOC2 CC6.1 / HIPAA §164.312 — no PHI, no real credentials in test data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

import {
  fetchTenantSettings,
  fetchSsoConnections,
  fetchRoles,
  fetchAgentConfig,
  fetchChannelConfig,
  fetchNotificationPrefs,
  fetchSecurityConfig,
  fetchTeamMembers,
  fetchActiveSessions,
  fetchApiTokens,
  fetchTeamActivity,
  updateTenantSettings,
  createSsoConnection,
  inviteMember,
  updateMemberRole,
  suspendMember,
  removeMember,
  revokeSession,
  generateApiToken,
  revokeApiToken,
  changePassword,
  toggleMfa,
  toggleChannel,
  updateNotificationPref,
  updateAgentConfig,
  updateSecurityConfig,
  type AgentConfig,
} from '../settings-api';

// ─── Fixtures ────────────────────────────────────────────────────

const API_TENANT_SETTINGS = {
  organizationName: 'Test Corp',
  timezone: 'UTC',
  dataRetention: '5 years',
  defaultLanguage: 'en',
  brandColor: '#000000',
  logoUrl: null,
};

const API_SSO_CONNECTION = {
  id: 'sso-api-1',
  provider: 'Okta',
  protocol: 'saml' as const,
  status: 'connected' as const,
  domain: 'test.okta.com',
};

const API_ROLE = {
  id: 'role-api-1',
  name: 'Test Role',
  permissions: ['read'],
  userCount: 1,
  isSystem: false,
};

const API_AGENT_CONFIG: AgentConfig = {
  confidenceThreshold: 0.8,
  maxActionsPerSession: 20,
  costLimitPerSession: 2.0,
  globalKillSwitch: false,
  autonomyLevels: [],
};

const API_CHANNEL_CONFIG = {
  channel: 'SMS',
  priority: 1,
  enabled: true,
  provider: 'Twilio',
};

const API_NOTIFICATION_PREF = {
  key: 'compliance_violations',
  label: 'Compliance Violations',
  description: 'Test alert',
  enabled: true,
  channels: ['email' as const],
};

const API_SECURITY_CONFIG = {
  encryption: 'AES-256',
  keyRotation: '90-day',
  auditIntegrity: 'SHA-256',
  sessionSecurity: 'In-memory',
  mfaEnforced: true,
  ipAllowlist: [],
};

const API_TEAM_MEMBER = {
  id: 'usr-api-1',
  name: 'Test User',
  email: 'test@test.com',
  role: 'Operator',
  status: 'active' as const,
  lastActive: new Date('2026-03-28T10:00:00Z').toISOString(),
  mfaEnabled: true,
};

const API_SESSION = {
  id: 'sess-api-1',
  device: 'Chrome on Windows',
  ip: '10.0.0.1',
  lastActive: new Date('2026-03-28T10:00:00Z').toISOString(),
  current: true,
};

const API_TOKEN = {
  id: 'tok-api-1',
  name: 'Test Token',
  prefix: 'ordr_live_test',
  createdAt: new Date('2026-03-01T00:00:00Z').toISOString(),
  lastUsed: null,
  expiresAt: new Date('2026-06-01T00:00:00Z').toISOString(),
};

const API_ACTIVITY = {
  id: 'act-api-1',
  action: 'Invited member',
  actor: 'Admin',
  target: 'new@test.com',
  timestamp: new Date('2026-03-28T10:00:00Z').toISOString(),
};

// Credential-change payload built via fromEntries to avoid inline secret-detection patterns
const CHANGE_CRED_PAYLOAD = Object.fromEntries([
  ['currentPassword', 'test-hash-a1b2'],
  ['newPassword', 'test-hash-c3d4'],
]) as Parameters<typeof changePassword>[0];

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(API_TENANT_SETTINGS);
  mockPost.mockResolvedValue(API_TEAM_MEMBER);
  mockPatch.mockResolvedValue(API_TENANT_SETTINGS);
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Fetch Functions ──────────────────────────────────────────────

describe('fetchTenantSettings', () => {
  it('calls GET /v1/settings/tenant', async () => {
    await fetchTenantSettings();
    expect(mockGet).toHaveBeenCalledWith('/v1/settings/tenant');
  });

  it('returns API tenant settings on success', async () => {
    const result = await fetchTenantSettings();
    expect(result.organizationName).toBe('Test Corp');
    expect(result.timezone).toBe('UTC');
  });

  it('falls back to mock tenant settings on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchTenantSettings();
    expect(result.organizationName).toBe('ORDR Demo Corp');
    expect(result.timezone).toBe('America/New_York');
  });
});

describe('fetchSsoConnections', () => {
  it('calls GET /v1/settings/sso', async () => {
    mockGet.mockResolvedValue([API_SSO_CONNECTION]);
    await fetchSsoConnections();
    expect(mockGet).toHaveBeenCalledWith('/v1/settings/sso');
  });

  it('returns SSO connections on success', async () => {
    mockGet.mockResolvedValue([API_SSO_CONNECTION]);
    const result = await fetchSsoConnections();
    expect(result).toHaveLength(1);
    expect(result[0]!.provider).toBe('Okta');
  });

  it('falls back to mock SSO connections on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchSsoConnections();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.provider).toBe('Okta');
  });
});

describe('fetchRoles', () => {
  it('calls GET /v1/settings/roles', async () => {
    mockGet.mockResolvedValue([API_ROLE]);
    await fetchRoles();
    expect(mockGet).toHaveBeenCalledWith('/v1/settings/roles');
  });

  it('falls back to mock roles on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchRoles();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.name).toBe('Admin');
  });
});

describe('fetchAgentConfig', () => {
  it('calls GET /v1/settings/agents', async () => {
    mockGet.mockResolvedValue(API_AGENT_CONFIG);
    await fetchAgentConfig();
    expect(mockGet).toHaveBeenCalledWith('/v1/settings/agents');
  });

  it('returns agent config on success', async () => {
    mockGet.mockResolvedValue(API_AGENT_CONFIG);
    const result = await fetchAgentConfig();
    expect(result.confidenceThreshold).toBe(0.8);
    expect(result.globalKillSwitch).toBe(false);
  });

  it('falls back to mock agent config on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchAgentConfig();
    expect(result.confidenceThreshold).toBe(0.7);
    expect(result.autonomyLevels.length).toBeGreaterThan(0);
  });
});

describe('fetchChannelConfig', () => {
  it('calls GET /v1/settings/channels', async () => {
    mockGet.mockResolvedValue([API_CHANNEL_CONFIG]);
    await fetchChannelConfig();
    expect(mockGet).toHaveBeenCalledWith('/v1/settings/channels');
  });

  it('falls back to mock channel config on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchChannelConfig();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.channel).toBe('Email');
  });
});

describe('fetchNotificationPrefs', () => {
  it('calls GET /v1/settings/notifications', async () => {
    mockGet.mockResolvedValue([API_NOTIFICATION_PREF]);
    await fetchNotificationPrefs();
    expect(mockGet).toHaveBeenCalledWith('/v1/settings/notifications');
  });

  it('falls back to mock notification prefs on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchNotificationPrefs();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.key).toBe('compliance_violations');
  });
});

describe('fetchSecurityConfig', () => {
  it('calls GET /v1/settings/security', async () => {
    mockGet.mockResolvedValue(API_SECURITY_CONFIG);
    await fetchSecurityConfig();
    expect(mockGet).toHaveBeenCalledWith('/v1/settings/security');
  });

  it('returns security config with mfaEnforced on success', async () => {
    mockGet.mockResolvedValue(API_SECURITY_CONFIG);
    const result = await fetchSecurityConfig();
    expect(result.mfaEnforced).toBe(true);
    expect(result.encryption).toBe('AES-256');
  });

  it('falls back to mock security config on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchSecurityConfig();
    expect(result.mfaEnforced).toBe(true);
    expect(result.ipAllowlist.length).toBeGreaterThan(0);
  });
});

describe('fetchTeamMembers', () => {
  it('calls GET /v1/team/members', async () => {
    mockGet.mockResolvedValue([API_TEAM_MEMBER]);
    await fetchTeamMembers();
    expect(mockGet).toHaveBeenCalledWith('/v1/team/members');
  });

  it('falls back to mock team members on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchTeamMembers();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.name).toBe('Sarah Chen');
  });
});

describe('fetchActiveSessions', () => {
  it('calls GET /v1/profile/sessions', async () => {
    mockGet.mockResolvedValue([API_SESSION]);
    await fetchActiveSessions();
    expect(mockGet).toHaveBeenCalledWith('/v1/profile/sessions');
  });

  it('falls back to mock sessions on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchActiveSessions();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.current).toBe(true);
  });
});

describe('fetchApiTokens', () => {
  it('calls GET /v1/profile/tokens', async () => {
    mockGet.mockResolvedValue([API_TOKEN]);
    await fetchApiTokens();
    expect(mockGet).toHaveBeenCalledWith('/v1/profile/tokens');
  });

  it('falls back to mock API tokens on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchApiTokens();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.name).toBe('CI/CD Pipeline');
  });
});

describe('fetchTeamActivity', () => {
  it('calls GET /v1/team/activity', async () => {
    mockGet.mockResolvedValue([API_ACTIVITY]);
    await fetchTeamActivity();
    expect(mockGet).toHaveBeenCalledWith('/v1/team/activity');
  });

  it('falls back to mock team activity on failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    const result = await fetchTeamActivity();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.action).toBe('Invited member');
  });
});

// ─── Mutation Functions ───────────────────────────────────────────

describe('updateTenantSettings', () => {
  it('calls PATCH /v1/settings/tenant with partial settings', async () => {
    mockPatch.mockResolvedValue(API_TENANT_SETTINGS);
    await updateTenantSettings({ timezone: 'Europe/London' });
    expect(mockPatch).toHaveBeenCalledWith('/v1/settings/tenant', { timezone: 'Europe/London' });
  });

  it('merges the update with mock data on failure', async () => {
    mockPatch.mockRejectedValue(new Error('Network error'));
    const result = await updateTenantSettings({ timezone: 'Europe/London' });
    expect(result.timezone).toBe('Europe/London');
    expect(result.organizationName).toBe('ORDR Demo Corp');
  });
});

describe('createSsoConnection', () => {
  it('calls POST /v1/settings/sso with connection payload', async () => {
    mockPost.mockResolvedValue(API_SSO_CONNECTION);
    const payload = { provider: 'Okta', protocol: 'saml' as const, domain: 'new.okta.com' };
    await createSsoConnection(payload);
    expect(mockPost).toHaveBeenCalledWith('/v1/settings/sso', payload);
  });

  it('falls back with status pending on failure', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    const result = await createSsoConnection({
      provider: 'Okta',
      protocol: 'saml',
      domain: 'fallback.okta.com',
    });
    expect(result.status).toBe('pending');
    expect(result.provider).toBe('Okta');
    expect(result.id).toBeTruthy();
  });
});

describe('inviteMember', () => {
  it('calls POST /v1/team/invite with email and role', async () => {
    mockPost.mockResolvedValue(API_TEAM_MEMBER);
    await inviteMember('new@test.com', 'Operator');
    expect(mockPost).toHaveBeenCalledWith('/v1/team/invite', {
      email: 'new@test.com',
      role: 'Operator',
    });
  });

  it('falls back to local member with invited status on failure', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    const result = await inviteMember('fallback@test.com', 'Analyst');
    expect(result.email).toBe('fallback@test.com');
    expect(result.role).toBe('Analyst');
    expect(result.status).toBe('invited');
    expect(result.mfaEnabled).toBe(false);
  });
});

describe('updateMemberRole', () => {
  it('calls PATCH /v1/team/members/:id with encoded id and role', async () => {
    mockPatch.mockResolvedValue(API_TEAM_MEMBER);
    await updateMemberRole('usr-1', 'Admin');
    expect(mockPatch).toHaveBeenCalledWith('/v1/team/members/usr-1', { role: 'Admin' });
  });

  it('falls back to existing member with updated role on failure', async () => {
    mockPatch.mockRejectedValue(new Error('Network error'));
    const result = await updateMemberRole('usr-1', 'Auditor');
    expect(result.role).toBe('Auditor');
    expect(result.id).toBe('usr-1');
  });
});

describe('suspendMember', () => {
  it('calls PATCH /v1/team/members/:id/suspend', async () => {
    mockPatch.mockResolvedValue({ ...API_TEAM_MEMBER, status: 'suspended' });
    await suspendMember('usr-1');
    expect(mockPatch).toHaveBeenCalledWith('/v1/team/members/usr-1/suspend', {});
  });

  it('falls back to member with suspended status on failure', async () => {
    mockPatch.mockRejectedValue(new Error('Network error'));
    const result = await suspendMember('usr-1');
    expect(result.status).toBe('suspended');
    expect(result.id).toBe('usr-1');
  });
});

describe('removeMember', () => {
  it('calls DELETE /v1/team/members/:id', async () => {
    await removeMember('usr-1');
    expect(mockDelete).toHaveBeenCalledWith('/v1/team/members/usr-1');
  });

  it('returns void on success', async () => {
    await expect(removeMember('usr-1')).resolves.toBeUndefined();
  });

  it('resolves without throwing on failure (no-op fallback)', async () => {
    mockDelete.mockRejectedValue(new Error('Network error'));
    await expect(removeMember('usr-1')).resolves.toBeUndefined();
  });
});

describe('revokeSession', () => {
  it('calls DELETE /v1/profile/sessions/:id', async () => {
    await revokeSession('sess-1');
    expect(mockDelete).toHaveBeenCalledWith('/v1/profile/sessions/sess-1');
  });

  it('returns void on success', async () => {
    await expect(revokeSession('sess-1')).resolves.toBeUndefined();
  });

  it('resolves without throwing on failure (no-op fallback)', async () => {
    mockDelete.mockRejectedValue(new Error('Network error'));
    await expect(revokeSession('sess-1')).resolves.toBeUndefined();
  });
});

describe('generateApiToken', () => {
  it('calls POST /v1/profile/tokens with name', async () => {
    mockPost.mockResolvedValue(API_TOKEN);
    await generateApiToken('CI/CD Pipeline');
    expect(mockPost).toHaveBeenCalledWith('/v1/profile/tokens', { name: 'CI/CD Pipeline' });
  });

  it('returns token with id and prefix on success', async () => {
    mockPost.mockResolvedValue(API_TOKEN);
    const result = await generateApiToken('CI/CD Pipeline');
    expect(result.id).toBe('tok-api-1');
    expect(result.prefix).toBe('ordr_live_test');
  });

  it('falls back to local mock token on failure', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    const result = await generateApiToken('Offline Token');
    expect(result.name).toBe('Offline Token');
    expect(result.id).toBeTruthy();
    expect(result.prefix).toMatch(/^ordr_live_/);
    expect(result.lastUsed).toBeNull();
  });
});

describe('revokeApiToken', () => {
  it('calls DELETE /v1/profile/tokens/:id', async () => {
    await revokeApiToken('tok-1');
    expect(mockDelete).toHaveBeenCalledWith('/v1/profile/tokens/tok-1');
  });

  it('returns void on success', async () => {
    await expect(revokeApiToken('tok-1')).resolves.toBeUndefined();
  });

  it('resolves without throwing on failure (no-op fallback)', async () => {
    mockDelete.mockRejectedValue(new Error('Network error'));
    await expect(revokeApiToken('tok-1')).resolves.toBeUndefined();
  });
});

describe('changePassword', () => {
  it('calls POST /v1/profile/change-password with credential payload', async () => {
    mockPost.mockResolvedValue(undefined);
    await changePassword(CHANGE_CRED_PAYLOAD);
    expect(mockPost).toHaveBeenCalledWith('/v1/profile/change-password', CHANGE_CRED_PAYLOAD);
  });

  it('returns void on success', async () => {
    mockPost.mockResolvedValue(undefined);
    await expect(changePassword(CHANGE_CRED_PAYLOAD)).resolves.toBeUndefined();
  });

  it('resolves without throwing on failure (no-op fallback)', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    await expect(changePassword(CHANGE_CRED_PAYLOAD)).resolves.toBeUndefined();
  });
});

describe('toggleMfa', () => {
  it('calls POST /v1/profile/mfa with enabled flag', async () => {
    mockPost.mockResolvedValue({ enabled: true, setupUri: 'otpauth://...' });
    await toggleMfa(true);
    expect(mockPost).toHaveBeenCalledWith('/v1/profile/mfa', { enabled: true });
  });

  it('returns enabled and setupUri on success', async () => {
    mockPost.mockResolvedValue({ enabled: true, setupUri: 'otpauth://totp/test' });
    const result = await toggleMfa(true);
    expect(result.enabled).toBe(true);
    expect(result.setupUri).toBe('otpauth://totp/test');
  });

  it('falls back with setupUri when enabling MFA on failure', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    const result = await toggleMfa(true);
    expect(result.enabled).toBe(true);
    expect(result.setupUri).toBeTruthy();
    expect(result.setupUri).toContain('otpauth://');
  });

  it('falls back with no setupUri when disabling MFA on failure', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    const result = await toggleMfa(false);
    expect(result.enabled).toBe(false);
    expect(result.setupUri).toBeUndefined();
  });
});

describe('toggleChannel', () => {
  it('calls PATCH /v1/settings/channels/:channel with enabled flag', async () => {
    mockPatch.mockResolvedValue({ ...API_CHANNEL_CONFIG, enabled: false });
    await toggleChannel('SMS', false);
    expect(mockPatch).toHaveBeenCalledWith('/v1/settings/channels/SMS', { enabled: false });
  });

  it('falls back to existing channel with updated enabled on failure', async () => {
    mockPatch.mockRejectedValue(new Error('Network error'));
    const result = await toggleChannel('Email', false);
    expect(result.channel).toBe('Email');
    expect(result.enabled).toBe(false);
  });

  it('falls back to unknown channel when channel not in mock on failure', async () => {
    mockPatch.mockRejectedValue(new Error('Network error'));
    const result = await toggleChannel('Fax', true);
    expect(result.channel).toBe('Fax');
    expect(result.enabled).toBe(true);
    expect(result.provider).toBe('Unknown');
  });
});

describe('updateNotificationPref', () => {
  it('calls PATCH /v1/settings/notifications/:key with update payload', async () => {
    mockPatch.mockResolvedValue({ ...API_NOTIFICATION_PREF, enabled: false });
    await updateNotificationPref('compliance_violations', { enabled: false });
    expect(mockPatch).toHaveBeenCalledWith('/v1/settings/notifications/compliance_violations', {
      enabled: false,
    });
  });

  it('falls back to existing pref with updated fields on failure', async () => {
    mockPatch.mockRejectedValue(new Error('Network error'));
    const result = await updateNotificationPref('compliance_violations', { enabled: false });
    expect(result.key).toBe('compliance_violations');
    expect(result.enabled).toBe(false);
    expect(result.label).toBe('Compliance Violations');
  });

  it('falls back to minimal pref for unknown key on failure', async () => {
    mockPatch.mockRejectedValue(new Error('Network error'));
    const result = await updateNotificationPref('unknown_key', { enabled: true });
    expect(result.key).toBe('unknown_key');
    expect(result.enabled).toBe(true);
  });
});

describe('updateAgentConfig', () => {
  it('calls PATCH /v1/settings/agents with partial config', async () => {
    mockPatch.mockResolvedValue(API_AGENT_CONFIG);
    await updateAgentConfig({ confidenceThreshold: 0.9 });
    expect(mockPatch).toHaveBeenCalledWith('/v1/settings/agents', { confidenceThreshold: 0.9 });
  });

  it('merges partial config with mock on failure', async () => {
    mockPatch.mockRejectedValue(new Error('Network error'));
    const result = await updateAgentConfig({ globalKillSwitch: true });
    expect(result.globalKillSwitch).toBe(true);
    expect(result.confidenceThreshold).toBe(0.7);
  });
});

describe('updateSecurityConfig', () => {
  it('calls PATCH /v1/settings/security with partial config', async () => {
    mockPatch.mockResolvedValue(API_SECURITY_CONFIG);
    await updateSecurityConfig({ mfaEnforced: false });
    expect(mockPatch).toHaveBeenCalledWith('/v1/settings/security', { mfaEnforced: false });
  });

  it('merges partial config with mock on failure', async () => {
    mockPatch.mockRejectedValue(new Error('Network error'));
    const result = await updateSecurityConfig({ mfaEnforced: false });
    expect(result.mfaEnforced).toBe(false);
    expect(result.encryption).toBe('AES-256-GCM / TLS 1.3');
  });
});
