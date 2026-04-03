/**
 * Settings — Interactive tabbed settings interface.
 *
 * COMPLIANCE: No PHI in settings data. All mutations trigger audit events
 * via apiClient correlation IDs. Tenant isolation enforced server-side.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Toggle } from '../components/ui/Toggle';
import { Tabs, TabPanel } from '../components/ui/Tabs';
import { Spinner } from '../components/ui/Spinner';
import { Modal } from '../components/ui/Modal';
import {
  Settings as SettingsIcon,
  Link2,
  Shield,
  Bot,
  Mail,
  Bell,
  Lock,
  Palette,
  Plus,
  Save,
  ChevronUp,
  ChevronDown,
  Power,
  Trash2,
} from '../components/icons';
import {
  type TenantSettings,
  type SsoConnection,
  type CustomRole,
  type AgentConfig,
  type ChannelConfig,
  type NotificationPref,
  type SecurityConfig,
  fetchTenantSettings,
  fetchSsoConnections,
  fetchRoles,
  fetchAgentConfig,
  fetchChannelConfig,
  fetchNotificationPrefs,
  fetchSecurityConfig,
  updateTenantSettings,
  createSsoConnection,
  createRole,
  updateAgentConfig,
  toggleChannel,
  reorderChannel,
  updateNotificationPref,
  updateSecurityConfig,
} from '../lib/settings-api';

// --- Tab definitions ---

const SETTING_TABS = [
  { id: 'general', label: 'General', icon: <SettingsIcon className="h-4 w-4" /> },
  { id: 'sso', label: 'SSO', icon: <Link2 className="h-4 w-4" /> },
  { id: 'roles', label: 'Roles', icon: <Shield className="h-4 w-4" /> },
  { id: 'agents', label: 'Agents', icon: <Bot className="h-4 w-4" /> },
  { id: 'channels', label: 'Channels', icon: <Mail className="h-4 w-4" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
  { id: 'security', label: 'Security', icon: <Lock className="h-4 w-4" /> },
  { id: 'branding', label: 'Branding', icon: <Palette className="h-4 w-4" /> },
];

const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
];

const RETENTION_OPTIONS = [
  { value: '6 years', label: '6 Years (HIPAA Minimum)' },
  { value: '7 years', label: '7 Years (Recommended)' },
  { value: '10 years', label: '10 Years' },
];

const AVAILABLE_PERMISSIONS = [
  'read',
  'write',
  'delete',
  'agent-control',
  'analytics',
  'audit-logs',
  'compliance',
  'collections',
  'full-access',
];

const SSO_PROTOCOL_OPTIONS = [
  { value: 'saml', label: 'SAML 2.0' },
  { value: 'oidc', label: 'OpenID Connect' },
  { value: 'oauth', label: 'OAuth 2.1' },
];

// --- Helpers ---

function ssoStatusBadge(status: SsoConnection['status']): ReactNode {
  const variant = status === 'connected' ? 'success' : status === 'pending' ? 'warning' : 'danger';
  return (
    <Badge variant={variant} dot size="sm">
      {status === 'connected' ? 'Connected' : status === 'pending' ? 'Pending' : 'Error'}
    </Badge>
  );
}

function autonomyBadgeVariant(level: string): 'success' | 'warning' | 'info' {
  if (level === 'Fully autonomous') return 'success';
  if (level === 'Semi-autonomous') return 'warning';
  return 'info';
}

// --- Component ---

export function Settings(): ReactNode {
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // --- State for each tab ---
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const [ssoConnections, setSsoConnections] = useState<SsoConnection[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPref[]>([]);
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig | null>(null);

  // --- Modal state ---
  const [showAddSso, setShowAddSso] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newSso, setNewSso] = useState<{
    provider: string;
    protocol: 'saml' | 'oidc' | 'oauth';
    domain: string;
  }>({ provider: '', protocol: 'saml', domain: '' });
  const [newRole, setNewRole] = useState({ name: '', permissions: [] as string[] });
  const [newIp, setNewIp] = useState('');

  // --- Load all settings on mount ---
  useEffect(() => {
    let cancelled = false;

    async function loadAll(): Promise<void> {
      setLoading(true);
      const [tenant, sso, roleList, agents, channelList, notifs, security] = await Promise.all([
        fetchTenantSettings(),
        fetchSsoConnections(),
        fetchRoles(),
        fetchAgentConfig(),
        fetchChannelConfig(),
        fetchNotificationPrefs(),
        fetchSecurityConfig(),
      ]);

      if (cancelled) return;
      setTenantSettings(tenant);
      setSsoConnections(sso);
      setRoles(roleList);
      setAgentConfig(agents);
      setChannels(channelList);
      setNotifPrefs(notifs);
      setSecurityConfig(security);
      setLoading(false);
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Save handlers ---

  const handleSaveGeneral = useCallback(async () => {
    if (!tenantSettings) return;
    setSaving(true);
    const updated = await updateTenantSettings(tenantSettings);
    setTenantSettings(updated);
    setSaving(false);
  }, [tenantSettings]);

  const handleAddSso = useCallback(async () => {
    if (!newSso.provider || !newSso.domain) return;
    const created = await createSsoConnection(newSso);
    setSsoConnections((prev) => [...prev, created]);
    setShowAddSso(false);
    setNewSso({ provider: '', protocol: 'saml', domain: '' });
  }, [newSso]);

  const handleCreateRole = useCallback(async () => {
    if (!newRole.name || newRole.permissions.length === 0) return;
    const created = await createRole(newRole);
    setRoles((prev) => [...prev, created]);
    setShowCreateRole(false);
    setNewRole({ name: '', permissions: [] });
  }, [newRole]);

  const handleSaveAgents = useCallback(async () => {
    if (!agentConfig) return;
    setSaving(true);
    const updated = await updateAgentConfig(agentConfig);
    setAgentConfig(updated);
    setSaving(false);
  }, [agentConfig]);

  const handleToggleChannel = useCallback(async (channel: string, enabled: boolean) => {
    const updated = await toggleChannel(channel, enabled);
    setChannels((prev) => prev.map((c) => (c.channel === updated.channel ? updated : c)));
  }, []);

  const handleReorderChannel = useCallback(async (channel: string, direction: 'up' | 'down') => {
    const updated = await reorderChannel(channel, direction);
    if (updated.length > 0) {
      setChannels(updated);
    } else {
      setChannels((prev) => {
        const idx = prev.findIndex((c) => c.channel === channel);
        if (idx < 0) return prev;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= prev.length) return prev;
        const current = prev[idx];
        const target = prev[swapIdx];
        if (!current || !target) return prev;
        const next = [...prev];
        next[idx] = { ...current, priority: target.priority };
        next[swapIdx] = { ...target, priority: current.priority };
        next.sort((a, b) => a.priority - b.priority);
        return next;
      });
    }
  }, []);

  const handleToggleNotif = useCallback(async (key: string, enabled: boolean) => {
    const updated = await updateNotificationPref(key, { enabled });
    setNotifPrefs((prev) => prev.map((n) => (n.key === updated.key ? updated : n)));
  }, []);

  const handleToggleNotifChannel = useCallback(
    async (key: string, channel: 'email' | 'slack' | 'sms', add: boolean) => {
      const existing = notifPrefs.find((n) => n.key === key);
      if (!existing) return;
      const newChannels = add
        ? [...existing.channels, channel]
        : existing.channels.filter((c) => c !== channel);
      const updated = await updateNotificationPref(key, { channels: newChannels });
      setNotifPrefs((prev) => prev.map((n) => (n.key === updated.key ? updated : n)));
    },
    [notifPrefs],
  );

  const handleSaveSecurity = useCallback(async () => {
    if (!securityConfig) return;
    setSaving(true);
    const updated = await updateSecurityConfig(securityConfig);
    setSecurityConfig(updated);
    setSaving(false);
  }, [securityConfig]);

  const handleSaveBranding = useCallback(async () => {
    if (!tenantSettings) return;
    setSaving(true);
    const updated = await updateTenantSettings({
      brandColor: tenantSettings.brandColor,
      logoUrl: tenantSettings.logoUrl,
    });
    setTenantSettings(updated);
    setSaving(false);
  }, [tenantSettings]);

  const handleAddIp = useCallback(() => {
    if (!newIp || !securityConfig) return;
    setSecurityConfig({ ...securityConfig, ipAllowlist: [...securityConfig.ipAllowlist, newIp] });
    setNewIp('');
  }, [newIp, securityConfig]);

  const handleRemoveIp = useCallback(
    (ip: string) => {
      if (!securityConfig) return;
      setSecurityConfig({
        ...securityConfig,
        ipAllowlist: securityConfig.ipAllowlist.filter((i) => i !== ip),
      });
    },
    [securityConfig],
  );

  // --- Loading state ---

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading settings" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Tenant configuration and system preferences</p>
      </div>

      {/* Tabs */}
      <Tabs tabs={SETTING_TABS} activeTab={activeTab} onChange={setActiveTab} />

      {/* General Tab */}
      <TabPanel id="general" activeTab={activeTab}>
        <Card
          title="Tenant Settings"
          actions={
            <Badge variant="info" size="sm">
              Managed
            </Badge>
          }
        >
          <div className="space-y-4">
            <Input
              label="Organization Name"
              value={tenantSettings?.organizationName ?? ''}
              onChange={(e) => {
                setTenantSettings((s) =>
                  s !== null ? { ...s, organizationName: e.target.value } : s,
                );
              }}
              helperText="Your tenant display name"
            />
            <Select
              label="Timezone"
              options={TIMEZONE_OPTIONS}
              value={tenantSettings?.timezone ?? 'UTC'}
              onChange={(val) => {
                setTenantSettings((s) => (s !== null ? { ...s, timezone: val } : s));
              }}
            />
            <Select
              label="Data Retention"
              options={RETENTION_OPTIONS}
              value={tenantSettings?.dataRetention ?? '7 years'}
              onChange={(val) => {
                setTenantSettings((s) => (s !== null ? { ...s, dataRetention: val } : s));
              }}
            />
            <Select
              label="Default Language"
              options={LANGUAGE_OPTIONS}
              value={tenantSettings?.defaultLanguage ?? 'en'}
              onChange={(val) => {
                setTenantSettings((s) => (s !== null ? { ...s, defaultLanguage: val } : s));
              }}
            />
            <div className="flex justify-end pt-2">
              <Button
                icon={<Save className="h-4 w-4" />}
                loading={saving}
                onClick={handleSaveGeneral}
              >
                Save Changes
              </Button>
            </div>
          </div>
        </Card>
      </TabPanel>

      {/* SSO Tab */}
      <TabPanel id="sso" activeTab={activeTab}>
        <Card
          title="SSO Connections"
          actions={
            <Badge variant="info" size="sm">
              WorkOS
            </Badge>
          }
        >
          <div className="space-y-3">
            {ssoConnections.map((conn) => (
              <div
                key={conn.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-content">{conn.provider}</p>
                  <p className="text-xs text-content-tertiary">
                    {conn.protocol.toUpperCase()} -- {conn.domain}
                  </p>
                </div>
                {ssoStatusBadge(conn.status)}
              </div>
            ))}
            <Button
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setShowAddSso(true);
              }}
              size="sm"
            >
              Add SSO Connection
            </Button>
          </div>
        </Card>

        <Modal
          open={showAddSso}
          onClose={() => {
            setShowAddSso(false);
          }}
          title="Add SSO Connection"
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowAddSso(false);
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleAddSso}>Add Connection</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label="Provider Name"
              value={newSso.provider}
              onChange={(e) => {
                setNewSso((s) => ({ ...s, provider: e.target.value }));
              }}
              placeholder="e.g. Okta, Azure AD"
            />
            <Select
              label="Protocol"
              options={SSO_PROTOCOL_OPTIONS}
              value={newSso.protocol}
              onChange={(val) => {
                setNewSso((s) => ({ ...s, protocol: val as 'saml' | 'oidc' | 'oauth' }));
              }}
            />
            <Input
              label="Domain"
              value={newSso.domain}
              onChange={(e) => {
                setNewSso((s) => ({ ...s, domain: e.target.value }));
              }}
              placeholder="e.g. yourcompany.okta.com"
            />
          </div>
        </Modal>
      </TabPanel>

      {/* Roles Tab */}
      <TabPanel id="roles" activeTab={activeTab}>
        <Card
          title="Custom Roles"
          actions={
            <Badge variant="warning" size="sm">
              RBAC + ABAC
            </Badge>
          }
        >
          <div className="space-y-3">
            {roles.map((role) => (
              <div
                key={role.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-content">{role.name}</p>
                    {role.isSystem && (
                      <Badge variant="neutral" size="sm">
                        System
                      </Badge>
                    )}
                    <span className="text-xs text-content-tertiary">
                      {role.userCount} user{role.userCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {role.permissions.map((perm) => (
                      <Badge key={perm} variant="neutral" size="sm">
                        {perm}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setShowCreateRole(true);
              }}
              size="sm"
            >
              Create Custom Role
            </Button>
          </div>
        </Card>

        <Modal
          open={showCreateRole}
          onClose={() => {
            setShowCreateRole(false);
          }}
          title="Create Custom Role"
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowCreateRole(false);
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateRole}>Create Role</Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label="Role Name"
              value={newRole.name}
              onChange={(e) => {
                setNewRole((s) => ({ ...s, name: e.target.value }));
              }}
              placeholder="e.g. Collection Lead"
            />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-content-secondary">
                Permissions
              </label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_PERMISSIONS.map((perm) => {
                  const selected = newRole.permissions.includes(perm);
                  return (
                    <button
                      key={perm}
                      type="button"
                      onClick={() => {
                        setNewRole((s) => ({
                          ...s,
                          permissions: selected
                            ? s.permissions.filter((p) => p !== perm)
                            : [...s.permissions, perm],
                        }));
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-brand-accent text-[#060608]'
                          : 'bg-surface-tertiary text-content-secondary hover:bg-border-light'
                      }`}
                    >
                      {perm}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      </TabPanel>

      {/* Agents Tab */}
      <TabPanel id="agents" activeTab={activeTab}>
        <Card
          title="Agent Configuration"
          actions={
            <Badge variant="warning" size="sm">
              Safety Bounded
            </Badge>
          }
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-content-secondary">
                Confidence Threshold:{' '}
                <span className="font-mono text-amber-400">
                  {agentConfig?.confidenceThreshold.toFixed(2)}
                </span>
              </label>
              <input
                type="range"
                min="0.50"
                max="0.99"
                step="0.01"
                value={agentConfig?.confidenceThreshold ?? 0.7}
                onChange={(e) => {
                  setAgentConfig((s) =>
                    s !== null ? { ...s, confidenceThreshold: parseFloat(e.target.value) } : s,
                  );
                }}
                className="w-full accent-brand-accent"
              />
              <p className="text-xs text-content-tertiary">
                Actions below this trigger HITL review (minimum 0.50)
              </p>
            </div>

            <Input
              label="Max Actions Per Session"
              type="number"
              value={String(agentConfig?.maxActionsPerSession ?? 25)}
              onChange={(e) => {
                setAgentConfig((s) =>
                  s !== null
                    ? { ...s, maxActionsPerSession: parseInt(e.target.value, 10) || 0 }
                    : s,
                );
              }}
              helperText="Agent budget limit per execution"
            />

            <Input
              label="Cost Limit Per Session ($)"
              type="number"
              value={String(agentConfig?.costLimitPerSession ?? 1.0)}
              onChange={(e) => {
                setAgentConfig((s) =>
                  s !== null ? { ...s, costLimitPerSession: parseFloat(e.target.value) || 0 } : s,
                );
              }}
              helperText="Maximum USD spend per agent run"
            />

            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Global Kill Switch</p>
                <p className="text-xs text-content-tertiary">
                  Immediately halt all agent operations
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Toggle
                  checked={agentConfig?.globalKillSwitch ?? false}
                  onChange={(checked) => {
                    setAgentConfig((s) => (s !== null ? { ...s, globalKillSwitch: checked } : s));
                  }}
                />
                <Badge
                  variant={agentConfig?.globalKillSwitch === true ? 'danger' : 'success'}
                  dot
                  size="sm"
                >
                  {agentConfig?.globalKillSwitch === true ? 'Agents Halted' : 'Agents Active'}
                </Badge>
              </div>
            </div>

            {/* Autonomy levels */}
            <div className="border-t border-border pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">
                Autonomy Levels
              </p>
              {agentConfig?.autonomyLevels.map((agent) => (
                <div
                  key={agent.role}
                  className="mb-2 flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-2.5 last:mb-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content">{agent.role}</span>
                    <Badge variant={autonomyBadgeVariant(agent.level)} size="sm">
                      {agent.level}
                    </Badge>
                  </div>
                  <span className="font-mono text-xs text-content-tertiary">
                    Budget: {agent.budget}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                icon={<Save className="h-4 w-4" />}
                loading={saving}
                onClick={handleSaveAgents}
              >
                Save Agent Config
              </Button>
            </div>
          </div>
        </Card>
      </TabPanel>

      {/* Channels Tab */}
      <TabPanel id="channels" activeTab={activeTab}>
        <Card title="Channel Preferences Defaults">
          <div className="space-y-3">
            {channels.map((ch, idx) => (
              <div
                key={ch.channel}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleReorderChannel(ch.channel, 'up')}
                      className="rounded p-0.5 text-content-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-30"
                      aria-label={`Move ${ch.channel} up`}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === channels.length - 1}
                      onClick={() => handleReorderChannel(ch.channel, 'down')}
                      className="rounded p-0.5 text-content-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-30"
                      aria-label={`Move ${ch.channel} down`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-surface-tertiary text-2xs font-bold text-content-secondary">
                    {ch.priority}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-content">{ch.channel}</p>
                    <p className="text-xs text-content-tertiary">Provider: {ch.provider}</p>
                  </div>
                </div>
                <Toggle
                  checked={ch.enabled}
                  onChange={(enabled) => handleToggleChannel(ch.channel, enabled)}
                  size="sm"
                />
              </div>
            ))}
          </div>
        </Card>
      </TabPanel>

      {/* Notifications Tab */}
      <TabPanel id="notifications" activeTab={activeTab}>
        <Card title="Notification Preferences">
          <div className="space-y-3">
            {notifPrefs.map((pref) => (
              <div key={pref.key} className="rounded-lg border border-border bg-surface px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-content">{pref.label}</p>
                    <p className="text-xs text-content-tertiary">{pref.description}</p>
                  </div>
                  <Toggle
                    checked={pref.enabled}
                    onChange={(enabled) => handleToggleNotif(pref.key, enabled)}
                    size="sm"
                  />
                </div>
                {pref.enabled && (
                  <div className="mt-2 flex items-center gap-4 border-t border-border pt-2">
                    <span className="text-xs text-content-tertiary">Channels:</span>
                    {(['email', 'slack', 'sms'] as const).map((ch) => (
                      <label key={ch} className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pref.channels.includes(ch)}
                          onChange={(e) => handleToggleNotifChannel(pref.key, ch, e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-border bg-surface accent-brand-accent"
                        />
                        <span className="text-xs text-content-secondary capitalize">{ch}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </TabPanel>

      {/* Security Tab */}
      <TabPanel id="security" activeTab={activeTab}>
        <Card
          title="Security"
          actions={
            <Badge variant="success" size="sm">
              Hardened
            </Badge>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Encryption</p>
                <p className="text-xs text-content-tertiary">At rest and in transit</p>
              </div>
              <span className="text-xs text-emerald-400">{securityConfig?.encryption}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Key Rotation</p>
                <p className="text-xs text-content-tertiary">Automated rotation cycle</p>
              </div>
              <span className="text-xs text-content-secondary">{securityConfig?.keyRotation}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Audit Log Integrity</p>
                <p className="text-xs text-content-tertiary">{securityConfig?.auditIntegrity}</p>
              </div>
              <Badge variant="success" dot size="sm">
                Verified
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Session Security</p>
                <p className="text-xs text-content-tertiary">{securityConfig?.sessionSecurity}</p>
              </div>
              <Badge variant="success" dot size="sm">
                HIPAA Compliant
              </Badge>
            </div>

            {/* MFA Enforcement */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">MFA Enforcement</p>
                <p className="text-xs text-content-tertiary">Require MFA for all users</p>
              </div>
              <Toggle
                checked={securityConfig?.mfaEnforced ?? true}
                onChange={(checked) => {
                  setSecurityConfig((s) => (s !== null ? { ...s, mfaEnforced: checked } : s));
                }}
              />
            </div>

            {/* IP Allowlist */}
            <div className="border-t border-border pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">
                IP Allowlist
              </p>
              <div className="space-y-2">
                {securityConfig?.ipAllowlist.map((ip) => (
                  <div
                    key={ip}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-2"
                  >
                    <span className="font-mono text-sm text-content">{ip}</span>
                    <button
                      type="button"
                      onClick={() => {
                        handleRemoveIp(ip);
                      }}
                      className="rounded p-1 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-red-400"
                      aria-label={`Remove ${ip}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={newIp}
                  onChange={(e) => {
                    setNewIp(e.target.value);
                  }}
                  placeholder="e.g. 10.0.0.0/8"
                  className="flex-1"
                />
                <Button variant="secondary" size="sm" onClick={handleAddIp}>
                  Add
                </Button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                icon={<Save className="h-4 w-4" />}
                loading={saving}
                onClick={handleSaveSecurity}
              >
                Save Security Config
              </Button>
            </div>
          </div>
        </Card>
      </TabPanel>

      {/* Branding Tab */}
      <TabPanel id="branding" activeTab={activeTab}>
        <Card title="Brand Customization">
          <div className="space-y-6">
            {/* Color picker */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-content-secondary">
                Brand Color
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={tenantSettings?.brandColor ?? '#3b82f6'}
                  onChange={(e) => {
                    setTenantSettings((s) =>
                      s !== null ? { ...s, brandColor: e.target.value } : s,
                    );
                  }}
                  className="h-10 w-14 cursor-pointer rounded border border-border bg-surface"
                />
                <Input
                  value={tenantSettings?.brandColor ?? '#3b82f6'}
                  onChange={(e) => {
                    setTenantSettings((s) =>
                      s !== null ? { ...s, brandColor: e.target.value } : s,
                    );
                  }}
                  className="w-32 font-mono"
                />
                <div
                  className="flex h-10 items-center rounded-lg px-4 text-sm font-medium text-white"
                  style={{ backgroundColor: tenantSettings?.brandColor ?? '#3b82f6' }}
                >
                  Preview
                </div>
              </div>
            </div>

            {/* Logo upload placeholder */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-content-secondary">Logo</label>
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface text-content-tertiary">
                  {tenantSettings?.logoUrl !== null ? (
                    <img
                      src={tenantSettings?.logoUrl}
                      alt="Logo"
                      className="h-full w-full rounded-xl object-contain p-2"
                    />
                  ) : (
                    <Palette className="h-8 w-8" />
                  )}
                </div>
                <div>
                  <Button variant="secondary" size="sm" icon={<Power className="h-4 w-4" />}>
                    Upload Logo
                  </Button>
                  <p className="mt-1 text-xs text-content-tertiary">PNG, SVG, or WebP. Max 2MB.</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                icon={<Save className="h-4 w-4" />}
                loading={saving}
                onClick={handleSaveBranding}
              >
                Save Branding
              </Button>
            </div>
          </div>
        </Card>
      </TabPanel>
    </div>
  );
}
