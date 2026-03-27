/**
 * Profile — User profile management page.
 *
 * COMPLIANCE: No PHI displayed. Password changes require current password
 * verification. MFA management with setup flow. Session tokens are
 * in-memory only (HIPAA 164.312). All mutations are audit-logged.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Toggle } from '../components/ui/Toggle';
import { Spinner } from '../components/ui/Spinner';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import {
  User,
  Key,
  Shield,
  Monitor,
  Code,
  Settings,
  Save,
  Plus,
  Eye,
  EyeOff,
  Copy,
  Upload,
} from '../components/icons';
import { useAuth } from '../lib/auth';
import {
  type ActiveSession,
  type ApiToken,
  fetchActiveSessions,
  fetchApiTokens,
  updateProfile,
  changePassword,
  toggleMfa,
  revokeSession,
  generateApiToken,
  revokeApiToken,
} from '../lib/settings-api';

// --- Constants ---

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
];

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light (Coming Soon)' },
  { value: 'system', label: 'System' },
];

// --- Section component for visual grouping ---

interface SectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}

function Section({ icon, title, description, children }: SectionProps): ReactNode {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-tertiary text-content-secondary">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-content">{title}</h2>
          <p className="text-xs text-content-tertiary">{description}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

// --- Helpers ---

function formatDate(iso: string): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function maskToken(prefix: string): string {
  return `${prefix}${'*'.repeat(20)}`;
}

// --- Component ---

export function Profile(): ReactNode {
  const { user } = useAuth();

  // --- State ---
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Profile fields
  const [displayName, setDisplayName] = useState(user?.name ?? 'Demo Operator');
  const [email, setEmail] = useState(user?.email ?? 'demo@ordr-connect.io');

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // MFA
  const [mfaEnabled, setMfaEnabled] = useState(true);
  const [mfaSetupUri, setMfaSetupUri] = useState<string | null>(null);

  // Sessions
  const [sessions, setSessions] = useState<ActiveSession[]>([]);

  // Tokens
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [showNewToken, setShowNewToken] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');

  // Preferences
  const [theme, setTheme] = useState('dark');
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('America/New_York');

  // --- Load data on mount ---
  useEffect(() => {
    let cancelled = false;

    async function loadAll(): Promise<void> {
      setLoading(true);
      const [sessionList, tokenList] = await Promise.all([fetchActiveSessions(), fetchApiTokens()]);
      if (cancelled) return;
      setSessions(sessionList);
      setTokens(tokenList);
      setLoading(false);
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync user data when it changes
  useEffect(() => {
    if (user) {
      setDisplayName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  // --- Handlers ---

  const handleSaveProfile = useCallback(async () => {
    setSaving(true);
    await updateProfile({ name: displayName, email });
    setSaving(false);
  }, [displayName, email]);

  const handleChangePassword = useCallback(async () => {
    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword.length < 12) {
      setPasswordError('Password must be at least 12 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setPasswordError('Failed to change password. Verify your current password.');
    }
  }, [currentPassword, newPassword, confirmPassword]);

  const handleToggleMfa = useCallback(async (enabled: boolean) => {
    const result = await toggleMfa(enabled);
    setMfaEnabled(result.enabled);
    setMfaSetupUri(result.setupUri ?? null);
  }, []);

  const handleRevokeSession = useCallback(async (sessionId: string) => {
    await revokeSession(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }, []);

  const handleGenerateToken = useCallback(async () => {
    if (!newTokenName) return;
    const token = await generateApiToken(newTokenName);
    setTokens((prev) => [...prev, token]);
    setShowNewToken(false);
    setNewTokenName('');
  }, [newTokenName]);

  const handleRevokeToken = useCallback(async (tokenId: string) => {
    await revokeApiToken(tokenId);
    setTokens((prev) => prev.filter((t) => t.id !== tokenId));
  }, []);

  // --- Loading state ---

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading profile" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">Profile</h1>
        <p className="page-subtitle">Manage your account settings and preferences</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Avatar & Basic Info */}
        <Section
          icon={<User className="h-5 w-5" />}
          title="Personal Information"
          description="Your display name and contact details"
        >
          <div className="space-y-4">
            {/* Avatar */}
            <div className="flex items-center gap-4">
              <Avatar name={displayName} size="lg" />
              <div>
                <Button variant="secondary" size="sm" icon={<Upload className="h-4 w-4" />}>
                  Upload Photo
                </Button>
                <p className="mt-1 text-xs text-content-tertiary">JPG, PNG or WebP. Max 1MB.</p>
              </div>
            </div>

            <Input
              label="Display Name"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
              }}
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
            <div className="flex items-center gap-2">
              <Badge variant="info" size="sm">
                {user?.role ?? 'admin'}
              </Badge>
              <Badge variant="neutral" size="sm">
                Tenant: {user?.tenantId ?? 'tenant-demo'}
              </Badge>
            </div>
            <div className="flex justify-end">
              <Button
                icon={<Save className="h-4 w-4" />}
                loading={saving}
                onClick={handleSaveProfile}
              >
                Save Profile
              </Button>
            </div>
          </div>
        </Section>

        {/* Password */}
        <Section
          icon={<Key className="h-5 w-5" />}
          title="Change Password"
          description="Update your password (Argon2id hashed)"
        >
          <div className="space-y-4">
            <Input
              label="Current Password"
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
              }}
            />
            <Input
              label="New Password"
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
              }}
              helperText="Minimum 12 characters"
              error={
                passwordError && newPassword.length > 0 && newPassword.length < 12
                  ? 'Too short'
                  : undefined
              }
            />
            <Input
              label="Confirm New Password"
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
              }}
              error={
                confirmPassword.length > 0 && newPassword !== confirmPassword
                  ? 'Passwords do not match'
                  : undefined
              }
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setShowPasswords(!showPasswords);
                }}
                className="inline-flex items-center gap-1.5 text-xs text-content-secondary hover:text-content"
              >
                {showPasswords ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {showPasswords ? 'Hide' : 'Show'} passwords
              </button>
              <Button
                variant="secondary"
                onClick={handleChangePassword}
                disabled={!currentPassword || !newPassword || !confirmPassword}
              >
                Update Password
              </Button>
            </div>
            {passwordError && <p className="text-xs text-red-400">{passwordError}</p>}
            {passwordSuccess && (
              <p className="text-xs text-emerald-400">Password updated successfully</p>
            )}
          </div>
        </Section>

        {/* MFA */}
        <Section
          icon={<Shield className="h-5 w-5" />}
          title="Multi-Factor Authentication"
          description="Required for production access (HIPAA)"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">MFA Status</p>
                <p className="text-xs text-content-tertiary">TOTP-based authentication</p>
              </div>
              <div className="flex items-center gap-3">
                <Toggle checked={mfaEnabled} onChange={handleToggleMfa} />
                <Badge variant={mfaEnabled ? 'success' : 'danger'} dot size="sm">
                  {mfaEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            </div>
            {mfaSetupUri !== null && (
              <div className="rounded-lg border border-border bg-surface px-4 py-3">
                <p className="text-sm font-medium text-content">Setup Instructions</p>
                <ol className="mt-2 space-y-1 text-xs text-content-secondary">
                  <li>1. Install an authenticator app (Google Authenticator, Authy)</li>
                  <li>2. Scan the QR code or enter the setup key manually</li>
                  <li>3. Enter the 6-digit code to verify</li>
                </ol>
                <div className="mt-3 rounded border border-border bg-surface-tertiary p-3">
                  <p className="break-all font-mono text-xs text-content-tertiary">{mfaSetupUri}</p>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Active Sessions */}
        <Section
          icon={<Monitor className="h-5 w-5" />}
          title="Active Sessions"
          description="Manage your active sessions across devices"
        >
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-content">{session.device}</p>
                    {session.current && (
                      <Badge variant="success" size="sm">
                        Current
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-content-tertiary">
                    IP: {session.ip} -- Last active: {formatDate(session.lastActive)}
                  </p>
                </div>
                {!session.current && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRevokeSession(session.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
            {sessions.length === 0 && (
              <p className="py-4 text-center text-sm text-content-tertiary">No active sessions</p>
            )}
          </div>
        </Section>

        {/* API Tokens */}
        <Section
          icon={<Code className="h-5 w-5" />}
          title="API Tokens"
          description="SHA-256 hashed before storage, prefixed for identification"
        >
          <div className="space-y-2">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-content">{token.name}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="font-mono text-xs text-content-tertiary">
                      {maskToken(token.prefix)}
                    </span>
                    <button
                      type="button"
                      className="text-content-tertiary hover:text-content"
                      aria-label="Copy token prefix"
                      onClick={() => {
                        void navigator.clipboard.writeText(token.prefix);
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="mt-0.5 text-2xs text-content-tertiary">
                    Created: {formatDate(token.createdAt)} | Last used:{' '}
                    {formatDate(token.lastUsed ?? '')} | Expires: {formatDate(token.expiresAt)}
                  </p>
                </div>
                <Button variant="danger" size="sm" onClick={() => handleRevokeToken(token.id)}>
                  Revoke
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setShowNewToken(true);
              }}
            >
              Generate New Token
            </Button>
          </div>
        </Section>

        {/* Preferences */}
        <Section
          icon={<Settings className="h-5 w-5" />}
          title="Preferences"
          description="Customize your experience"
        >
          <div className="space-y-4">
            <Select label="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
            <Select
              label="Language"
              options={LANGUAGE_OPTIONS}
              value={language}
              onChange={setLanguage}
            />
            <Select
              label="Timezone"
              options={TIMEZONE_OPTIONS}
              value={timezone}
              onChange={setTimezone}
            />
            <div className="flex justify-end">
              <Button icon={<Save className="h-4 w-4" />}>Save Preferences</Button>
            </div>
          </div>
        </Section>
      </div>

      {/* Generate Token Modal */}
      <Modal
        open={showNewToken}
        onClose={() => {
          setShowNewToken(false);
        }}
        title="Generate API Token"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowNewToken(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleGenerateToken} disabled={!newTokenName}>
              Generate
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Token Name"
            value={newTokenName}
            onChange={(e) => {
              setNewTokenName(e.target.value);
            }}
            placeholder="e.g. CI/CD Pipeline, Monitoring"
            helperText="Token will expire after 90 days. SHA-256 hashed before storage."
          />
        </div>
      </Modal>
    </div>
  );
}
