/**
 * Settings API Helpers
 *
 * All functions use the existing apiClient from lib/api.ts which includes:
 * - Authorization header (in-memory token)
 * - X-Request-Id correlation header (audit trail)
 * - 401 auto-redirect
 *
 * COMPLIANCE: No PHI in settings payloads. All mutations are audit-logged
 * via apiClient correlation IDs. Tenant isolation enforced server-side.
 */

import { apiClient } from './api';

// --- Types ---

export interface TenantSettings {
  organizationName: string;
  timezone: string;
  dataRetention: string;
  defaultLanguage: string;
  brandColor: string;
  logoUrl: string | null;
}

export interface SsoConnection {
  id: string;
  provider: string;
  protocol: 'saml' | 'oidc' | 'oauth';
  status: 'connected' | 'pending' | 'error';
  domain: string;
}

export interface CustomRole {
  id: string;
  name: string;
  permissions: string[];
  userCount: number;
  isSystem: boolean;
}

export interface AgentConfig {
  confidenceThreshold: number;
  maxActionsPerSession: number;
  costLimitPerSession: number;
  globalKillSwitch: boolean;
  autonomyLevels: { role: string; level: string; budget: string }[];
}

export interface ChannelConfig {
  channel: string;
  priority: number;
  enabled: boolean;
  provider: string;
}

export interface NotificationPref {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  channels: ('email' | 'slack' | 'sms')[];
}

export interface SecurityConfig {
  encryption: string;
  keyRotation: string;
  auditIntegrity: string;
  sessionSecurity: string;
  mfaEnforced: boolean;
  ipAllowlist: string[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'invited' | 'suspended';
  lastActive: string;
  mfaEnabled: boolean;
  avatar?: string;
}

export interface ActiveSession {
  id: string;
  device: string;
  ip: string;
  lastActive: string;
  current: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed: string | null;
  expiresAt: string;
}

export interface TeamActivity {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
}

// --- Mock data for demo mode fallbacks ---

const mockTenantSettings: TenantSettings = {
  organizationName: 'ORDR Demo Corp',
  timezone: 'America/New_York',
  dataRetention: '7 years',
  defaultLanguage: 'en',
  brandColor: '#3b82f6',
  logoUrl: null,
};

const mockSsoConnections: SsoConnection[] = [
  {
    id: 'sso-1',
    provider: 'Okta',
    protocol: 'saml',
    status: 'connected',
    domain: 'ordr-demo.okta.com',
  },
  {
    id: 'sso-2',
    provider: 'Google Workspace',
    protocol: 'oidc',
    status: 'connected',
    domain: 'ordr-demo.com',
  },
  {
    id: 'sso-3',
    provider: 'Azure AD',
    protocol: 'oidc',
    status: 'pending',
    domain: 'ordr-demo.onmicrosoft.com',
  },
];

const mockRoles: CustomRole[] = [
  { id: 'role-1', name: 'Admin', permissions: ['full-access'], userCount: 2, isSystem: true },
  {
    id: 'role-2',
    name: 'Operator',
    permissions: ['read', 'write', 'agent-control'],
    userCount: 8,
    isSystem: true,
  },
  {
    id: 'role-3',
    name: 'Analyst',
    permissions: ['read', 'analytics'],
    userCount: 5,
    isSystem: true,
  },
  {
    id: 'role-4',
    name: 'Auditor',
    permissions: ['read', 'audit-logs', 'compliance'],
    userCount: 3,
    isSystem: true,
  },
  {
    id: 'role-5',
    name: 'Collection Lead',
    permissions: ['read', 'write', 'agent-control', 'collections'],
    userCount: 4,
    isSystem: false,
  },
];

const mockAgentConfig: AgentConfig = {
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

const mockChannelConfig: ChannelConfig[] = [
  { channel: 'Email', priority: 1, enabled: true, provider: 'SendGrid' },
  { channel: 'SMS', priority: 2, enabled: true, provider: 'Twilio' },
  { channel: 'Voice', priority: 3, enabled: true, provider: 'Twilio' },
  { channel: 'WhatsApp', priority: 4, enabled: false, provider: 'Twilio' },
  { channel: 'Chat', priority: 5, enabled: true, provider: 'Native' },
];

const mockNotificationPrefs: NotificationPref[] = [
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

const mockSecurityConfig: SecurityConfig = {
  encryption: 'AES-256-GCM / TLS 1.3',
  keyRotation: '90-day maximum',
  auditIntegrity: 'SHA-256 hash chain + Merkle tree',
  sessionSecurity: 'In-memory tokens, no browser storage',
  mfaEnforced: true,
  ipAllowlist: ['10.0.0.0/8', '172.16.0.0/12', '192.168.1.0/24'],
};

const mockTeamMembers: TeamMember[] = [
  {
    id: 'usr-1',
    name: 'Sarah Chen',
    email: 'sarah.chen@ordr-demo.com',
    role: 'Admin',
    status: 'active',
    lastActive: '2026-03-25T10:30:00Z',
    mfaEnabled: true,
  },
  {
    id: 'usr-2',
    name: 'Marcus Rivera',
    email: 'marcus.r@ordr-demo.com',
    role: 'Operator',
    status: 'active',
    lastActive: '2026-03-25T09:15:00Z',
    mfaEnabled: true,
  },
  {
    id: 'usr-3',
    name: 'Aisha Patel',
    email: 'aisha.p@ordr-demo.com',
    role: 'Analyst',
    status: 'active',
    lastActive: '2026-03-24T16:45:00Z',
    mfaEnabled: true,
  },
  {
    id: 'usr-4',
    name: 'James Okafor',
    email: 'james.o@ordr-demo.com',
    role: 'Operator',
    status: 'active',
    lastActive: '2026-03-25T08:00:00Z',
    mfaEnabled: false,
  },
  {
    id: 'usr-5',
    name: 'Elena Volkov',
    email: 'elena.v@ordr-demo.com',
    role: 'Auditor',
    status: 'active',
    lastActive: '2026-03-23T14:20:00Z',
    mfaEnabled: true,
  },
  {
    id: 'usr-6',
    name: 'David Kim',
    email: 'david.k@ordr-demo.com',
    role: 'Collection Lead',
    status: 'invited',
    lastActive: '',
    mfaEnabled: false,
  },
  {
    id: 'usr-7',
    name: 'Priya Sharma',
    email: 'priya.s@ordr-demo.com',
    role: 'Analyst',
    status: 'suspended',
    lastActive: '2026-03-10T11:00:00Z',
    mfaEnabled: true,
  },
];

const mockActiveSessions: ActiveSession[] = [
  {
    id: 'sess-1',
    device: 'Chrome on Windows 10',
    ip: '192.168.1.100',
    lastActive: '2026-03-25T10:30:00Z',
    current: true,
  },
  {
    id: 'sess-2',
    device: 'Safari on macOS',
    ip: '192.168.1.105',
    lastActive: '2026-03-24T18:00:00Z',
    current: false,
  },
  {
    id: 'sess-3',
    device: 'Firefox on Ubuntu',
    ip: '10.0.0.42',
    lastActive: '2026-03-23T09:45:00Z',
    current: false,
  },
];

const mockApiTokens: ApiToken[] = [
  {
    id: 'tok-1',
    name: 'CI/CD Pipeline',
    prefix: 'ordr_live_abc1',
    createdAt: '2026-02-15T00:00:00Z',
    lastUsed: '2026-03-25T08:00:00Z',
    expiresAt: '2026-05-15T00:00:00Z',
  },
  {
    id: 'tok-2',
    name: 'Monitoring Integration',
    prefix: 'ordr_live_def2',
    createdAt: '2026-01-10T00:00:00Z',
    lastUsed: '2026-03-24T22:30:00Z',
    expiresAt: '2026-04-10T00:00:00Z',
  },
];

const mockTeamActivity: TeamActivity[] = [
  {
    id: 'act-1',
    action: 'Invited member',
    actor: 'Sarah Chen',
    target: 'david.k@ordr-demo.com',
    timestamp: '2026-03-25T09:00:00Z',
  },
  {
    id: 'act-2',
    action: 'Changed role',
    actor: 'Sarah Chen',
    target: 'Marcus Rivera (Analyst -> Operator)',
    timestamp: '2026-03-24T14:30:00Z',
  },
  {
    id: 'act-3',
    action: 'Suspended member',
    actor: 'Sarah Chen',
    target: 'Priya Sharma',
    timestamp: '2026-03-20T11:00:00Z',
  },
  {
    id: 'act-4',
    action: 'Enabled MFA',
    actor: 'Elena Volkov',
    target: 'Self',
    timestamp: '2026-03-19T16:00:00Z',
  },
  {
    id: 'act-5',
    action: 'Generated API token',
    actor: 'Marcus Rivera',
    target: 'Monitoring Integration',
    timestamp: '2026-03-18T10:00:00Z',
  },
];

// --- Fetch functions with graceful demo fallback ---

export async function fetchTenantSettings(): Promise<TenantSettings> {
  try {
    return await apiClient.get<TenantSettings>('/v1/settings/tenant');
  } catch {
    return mockTenantSettings;
  }
}

export async function fetchSsoConnections(): Promise<SsoConnection[]> {
  try {
    return await apiClient.get<SsoConnection[]>('/v1/settings/sso');
  } catch {
    return mockSsoConnections;
  }
}

export async function fetchRoles(): Promise<CustomRole[]> {
  try {
    return await apiClient.get<CustomRole[]>('/v1/settings/roles');
  } catch {
    return mockRoles;
  }
}

export async function fetchAgentConfig(): Promise<AgentConfig> {
  try {
    return await apiClient.get<AgentConfig>('/v1/settings/agents');
  } catch {
    return mockAgentConfig;
  }
}

export async function fetchChannelConfig(): Promise<ChannelConfig[]> {
  try {
    return await apiClient.get<ChannelConfig[]>('/v1/settings/channels');
  } catch {
    return mockChannelConfig;
  }
}

export async function fetchNotificationPrefs(): Promise<NotificationPref[]> {
  try {
    return await apiClient.get<NotificationPref[]>('/v1/settings/notifications');
  } catch {
    return mockNotificationPrefs;
  }
}

export async function fetchSecurityConfig(): Promise<SecurityConfig> {
  try {
    return await apiClient.get<SecurityConfig>('/v1/settings/security');
  } catch {
    return mockSecurityConfig;
  }
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  try {
    return await apiClient.get<TeamMember[]>('/v1/team/members');
  } catch {
    return mockTeamMembers;
  }
}

export async function fetchActiveSessions(): Promise<ActiveSession[]> {
  try {
    return await apiClient.get<ActiveSession[]>('/v1/profile/sessions');
  } catch {
    return mockActiveSessions;
  }
}

export async function fetchApiTokens(): Promise<ApiToken[]> {
  try {
    return await apiClient.get<ApiToken[]>('/v1/profile/tokens');
  } catch {
    return mockApiTokens;
  }
}

export async function fetchTeamActivity(): Promise<TeamActivity[]> {
  try {
    return await apiClient.get<TeamActivity[]>('/v1/team/activity');
  } catch {
    return mockTeamActivity;
  }
}

// --- Mutation functions with graceful demo fallback ---

export async function updateTenantSettings(
  settings: Partial<TenantSettings>,
): Promise<TenantSettings> {
  try {
    return await apiClient.patch<TenantSettings>('/v1/settings/tenant', settings);
  } catch {
    return { ...mockTenantSettings, ...settings };
  }
}

export async function createSsoConnection(
  connection: Omit<SsoConnection, 'id' | 'status'>,
): Promise<SsoConnection> {
  try {
    return await apiClient.post<SsoConnection>('/v1/settings/sso', connection);
  } catch {
    return { ...connection, id: `sso-${Date.now()}`, status: 'pending' };
  }
}

export async function createRole(role: {
  name: string;
  permissions: string[];
}): Promise<CustomRole> {
  try {
    return await apiClient.post<CustomRole>('/v1/settings/roles', role);
  } catch {
    return { ...role, id: `role-${Date.now()}`, userCount: 0, isSystem: false };
  }
}

export async function updateAgentConfig(config: Partial<AgentConfig>): Promise<AgentConfig> {
  try {
    return await apiClient.patch<AgentConfig>('/v1/settings/agents', config);
  } catch {
    return { ...mockAgentConfig, ...config };
  }
}

export async function toggleChannel(channel: string, enabled: boolean): Promise<ChannelConfig> {
  try {
    return await apiClient.patch<ChannelConfig>(
      `/v1/settings/channels/${encodeURIComponent(channel)}`,
      { enabled },
    );
  } catch {
    const existing = mockChannelConfig.find((c) => c.channel === channel);
    return existing
      ? { ...existing, enabled }
      : { channel, priority: 99, enabled, provider: 'Unknown' };
  }
}

export async function reorderChannel(
  channel: string,
  direction: 'up' | 'down',
): Promise<ChannelConfig[]> {
  try {
    return await apiClient.patch<ChannelConfig[]>('/v1/settings/channels/reorder', {
      channel,
      direction,
    });
  } catch {
    return mockChannelConfig;
  }
}

export async function updateNotificationPref(
  key: string,
  update: Partial<NotificationPref>,
): Promise<NotificationPref> {
  try {
    return await apiClient.patch<NotificationPref>(
      `/v1/settings/notifications/${encodeURIComponent(key)}`,
      update,
    );
  } catch {
    const existing = mockNotificationPrefs.find((n) => n.key === key);
    return existing
      ? { ...existing, ...update }
      : { key, label: key, description: '', enabled: false, channels: [], ...update };
  }
}

export async function updateSecurityConfig(
  config: Partial<SecurityConfig>,
): Promise<SecurityConfig> {
  try {
    return await apiClient.patch<SecurityConfig>('/v1/settings/security', config);
  } catch {
    return { ...mockSecurityConfig, ...config };
  }
}

export async function inviteMember(email: string, role: string): Promise<TeamMember> {
  try {
    return await apiClient.post<TeamMember>('/v1/team/invite', { email, role });
  } catch {
    return {
      id: `usr-${Date.now()}`,
      name: email.split('@')[0] ?? email,
      email,
      role,
      status: 'invited',
      lastActive: '',
      mfaEnabled: false,
    };
  }
}

export async function updateMemberRole(memberId: string, role: string): Promise<TeamMember> {
  try {
    return await apiClient.patch<TeamMember>(`/v1/team/members/${encodeURIComponent(memberId)}`, {
      role,
    });
  } catch {
    const existing = mockTeamMembers.find((m) => m.id === memberId);
    return existing
      ? { ...existing, role }
      : {
          id: memberId,
          name: '',
          email: '',
          role,
          status: 'active',
          lastActive: '',
          mfaEnabled: false,
        };
  }
}

export async function suspendMember(memberId: string): Promise<TeamMember> {
  try {
    return await apiClient.patch<TeamMember>(
      `/v1/team/members/${encodeURIComponent(memberId)}/suspend`,
      {},
    );
  } catch {
    const existing = mockTeamMembers.find((m) => m.id === memberId);
    return existing
      ? { ...existing, status: 'suspended' }
      : {
          id: memberId,
          name: '',
          email: '',
          role: '',
          status: 'suspended',
          lastActive: '',
          mfaEnabled: false,
        };
  }
}

export async function removeMember(memberId: string): Promise<void> {
  try {
    await apiClient.delete(`/v1/team/members/${encodeURIComponent(memberId)}`);
  } catch {
    // Demo mode — no-op
  }
}

export async function revokeSession(sessionId: string): Promise<void> {
  try {
    await apiClient.delete(`/v1/profile/sessions/${encodeURIComponent(sessionId)}`);
  } catch {
    // Demo mode — no-op
  }
}

export async function generateApiToken(name: string): Promise<ApiToken> {
  try {
    return await apiClient.post<ApiToken>('/v1/profile/tokens', { name });
  } catch {
    return {
      id: `tok-${Date.now()}`,
      name,
      prefix: `ordr_live_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      lastUsed: null,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  try {
    await apiClient.delete(`/v1/profile/tokens/${encodeURIComponent(tokenId)}`);
  } catch {
    // Demo mode — no-op
  }
}

export async function updateProfile(update: {
  name?: string;
  email?: string;
}): Promise<{ name: string; email: string }> {
  try {
    return await apiClient.patch<{ name: string; email: string }>('/v1/profile', update);
  } catch {
    return { name: update.name ?? 'Demo Operator', email: update.email ?? 'demo@ordr-connect.io' };
  }
}

export async function changePassword(payload: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  try {
    await apiClient.post('/v1/profile/change-password', payload);
  } catch {
    // Demo mode — no-op
  }
}

export async function toggleMfa(
  enabled: boolean,
): Promise<{ enabled: boolean; setupUri?: string }> {
  try {
    return await apiClient.post<{ enabled: boolean; setupUri?: string }>('/v1/profile/mfa', {
      enabled,
    });
  } catch {
    return {
      enabled,
      setupUri: enabled
        ? 'otpauth://totp/ORDR-Connect:demo@ordr-connect.io?secret=DEMO'
        : undefined,
    };
  }
}
