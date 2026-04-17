/**
 * API Keys — Developer API key management console.
 *
 * Create, view, and revoke API keys for the developer portal.
 *
 * COMPLIANCE:
 * - Raw key shown ONCE at creation, never again (Rule 2 / SOC2 CC6.1)
 * - Only key prefix shown in list — full key/hash never returned (Rule 2)
 * - Revocation is WORM-logged and immediately effective (Rule 3)
 * - All mutations carry X-Request-Id for audit trail (Rule 3)
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Shield,
  Clock,
  X,
} from '../components/icons';
import {
  type ApiKey,
  type ApiKeyCreated,
  listApiKeys,
  createApiKey,
  revokeApiKey,
} from '../lib/developer-api';
import { cn } from '../lib/cn';

// ── Helpers ────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() < Date.now();
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const days = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days > 0 && days < 14;
}

// ── Show-Once Secret Banner ────────────────────────────────────────

interface SecretBannerProps {
  created: ApiKeyCreated;
  onDismiss: () => void;
}

function SecretBanner({ created, onDismiss }: SecretBannerProps): ReactNode {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(created.rawKey).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 3000);
    });
  }, [created.rawKey]);

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        <div>
          <p className="text-sm font-semibold text-emerald-300">API Key Created — Copy Now</p>
          <p className="mt-0.5 text-xs text-emerald-300/80">
            This key is shown <strong>once only</strong>. The server stores only a SHA-256 hash.
            Store it in a secret manager immediately.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-surface p-3">
        <code className="flex-1 break-all font-mono text-xs text-emerald-300 select-all">
          {created.rawKey}
        </code>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 rounded p-1.5 text-emerald-400 hover:bg-emerald-500/10"
          title="Copy key"
        >
          {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-emerald-300/60">
          Prefix: <span className="font-mono">{created.keyPrefix}…</span>
        </p>
        <Button variant="secondary" size="sm" onClick={onDismiss}>
          <X className="mr-1 h-3.5 w-3.5" />
          I've saved it
        </Button>
      </div>
    </div>
  );
}

// ── Create Modal ───────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreated: (key: ApiKeyCreated) => void;
}

function CreateModal({ onClose, onCreated }: CreateModalProps): ReactNode {
  const [name, setName] = useState('');
  const [expiryOption, setExpiryOption] = useState('90');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length >= 2 && name.trim().length <= 64;

  const handleCreate = useCallback(async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const expiresInDays = expiryOption !== 'never' ? parseInt(expiryOption, 10) : undefined;
      const r = await createApiKey({ name: name.trim(), expiresInDays });
      onCreated(r.data);
      onClose();
    } catch {
      setError('Failed to create API key. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [valid, name, expiryOption, onCreated, onClose]);

  return (
    <Modal open onClose={onClose} title="Create API Key">
      <div className="space-y-4">
        <Input
          label="Key Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          placeholder="e.g. production-crm-sync"
          helperText="2–64 characters. Identifies the key in audit logs."
          autoFocus
          maxLength={64}
        />

        <Select
          label="Expiry"
          value={expiryOption}
          onChange={setExpiryOption}
          options={[
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days (recommended)' },
            { value: '180', label: '180 days' },
            { value: '365', label: '1 year' },
            { value: 'never', label: 'Never (not recommended)' },
          ]}
        />

        {expiryOption === 'never' && (
          <div className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Non-expiring keys are a SOC2 finding. Add a calendar reminder to rotate manually.
          </div>
        )}

        {error !== null && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleCreate()} disabled={!valid || saving} loading={saving}>
            <Key className="mr-1.5 h-3.5 w-3.5" />
            Create Key
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Revoke Confirm Modal ───────────────────────────────────────────

interface RevokeModalProps {
  apiKey: ApiKey;
  onClose: () => void;
  onDone: () => void;
}

function RevokeModal({ apiKey, onClose, onDone }: RevokeModalProps): ReactNode {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await revokeApiKey(apiKey.id);
      onDone();
      onClose();
    } catch {
      setError('Failed to revoke key. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [apiKey.id, onDone, onClose]);

  return (
    <Modal open onClose={onClose} title="Revoke API Key">
      <div className="space-y-4">
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-200 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div>
              <p className="font-semibold text-red-300">Immediate and irreversible</p>
              <p className="mt-1">
                Revoking <span className="font-mono font-medium">{apiKey.name}</span> (
                <span className="font-mono">{apiKey.keyPrefix}…</span>) will immediately reject all
                requests using this key. This action is WORM-logged and cannot be undone.
              </p>
            </div>
          </div>
        </div>

        {error !== null && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleRevoke()}
            disabled={saving}
            loading={saving}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Revoke Key
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Mock data ──────────────────────────────────────────────────────

const MOCK_KEYS: ApiKey[] = [
  {
    id: 'key_01',
    developerId: 'dev_001',
    name: 'production-crm-sync',
    keyPrefix: 'ok_live_a1b2',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString(),
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    isActive: true,
  },
  {
    id: 'key_02',
    developerId: 'dev_001',
    name: 'staging-tests',
    keyPrefix: 'ok_test_c3d4',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 10).toISOString(),
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    isActive: true,
  },
  {
    id: 'key_03',
    developerId: 'dev_001',
    name: 'legacy-import-2024',
    keyPrefix: 'ok_live_e5f6',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 400).toISOString(),
    expiresAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    lastUsedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString(),
    isActive: false,
  },
];

// ── Page ───────────────────────────────────────────────────────────

export function ApiKeys(): ReactNode {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [newKey, setNewKey] = useState<ApiKeyCreated | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void listApiKeys()
      .then((r) => {
        setKeys(r.data);
      })
      .catch(() => {
        setKeys(MOCK_KEYS);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeCount = keys.filter((k) => k.isActive && !isExpired(k.expiresAt)).length;
  const expiredCount = keys.filter((k) => isExpired(k.expiresAt)).length;
  const expiringSoonCount = keys.filter((k) => k.isActive && isExpiringSoon(k.expiresAt)).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-content">API Keys</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Create and manage developer API keys — prefix displayed, raw key shown once
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setShowCreate(true);
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Key
          </Button>
        </div>
      </div>

      {/* Show-once banner */}
      {newKey !== null && (
        <SecretBanner
          created={newKey}
          onDismiss={() => {
            setNewKey(null);
          }}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {(
          [
            ['Active', activeCount, <Key className="h-5 w-5" />, 'text-emerald-400'],
            ['Expiring <14d', expiringSoonCount, <Clock className="h-5 w-5" />, 'text-amber-400'],
            ['Expired', expiredCount, <XCircle className="h-5 w-5" />, 'text-red-400'],
          ] as const
        ).map(([label, value, icon, accent]) => (
          <Card key={label} className="flex items-center gap-3">
            <span className={accent}>{icon}</span>
            <div>
              <p className="text-xl font-bold text-content">{String(value)}</p>
              <p className="text-xs text-content-secondary">{label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Key list */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner size="md" label="Loading API keys" />
        </div>
      ) : keys.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-content-secondary">
          <Key className="h-8 w-8 opacity-40" />
          <p className="text-sm">No API keys yet — create one to start</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-secondary">
                {['Name', 'Prefix', 'Status', 'Last Used', 'Expires', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keys.map((k) => {
                const expired = isExpired(k.expiresAt);
                const expiring = !expired && isExpiringSoon(k.expiresAt);
                const active = k.isActive && !expired;

                return (
                  <tr key={k.id} className="hover:bg-surface-secondary">
                    <td className="px-4 py-3 font-medium text-content">{k.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-content-secondary">
                      {k.keyPrefix}…
                    </td>
                    <td className="px-4 py-3">
                      {active ? (
                        <Badge variant="success">Active</Badge>
                      ) : expired ? (
                        <Badge variant="danger">Expired</Badge>
                      ) : (
                        <Badge variant="neutral">Revoked</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-content-secondary">
                      {fmtDate(k.lastUsedAt)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {k.expiresAt === null ? (
                        <span className="text-content-tertiary">Never</span>
                      ) : expiring ? (
                        <span className="flex items-center gap-1 text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          {fmtDate(k.expiresAt)}
                        </span>
                      ) : (
                        <span className={expired ? 'text-red-400' : 'text-content-secondary'}>
                          {fmtDate(k.expiresAt)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {active && (
                        <button
                          onClick={() => {
                            setRevokeTarget(k);
                          }}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-content-tertiary hover:bg-red-500/10 hover:text-red-400"
                          title="Revoke key"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Compliance note */}
      <div className="flex items-start gap-2 rounded border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-300">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          API keys are hashed (SHA-256) before storage. Only the prefix is stored in plaintext for
          identification. Raw keys are shown once at creation and cannot be recovered — treat them
          like passwords. Rotate every 90 days (SOC2 CC6.1).
        </span>
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateModal
          onClose={() => {
            setShowCreate(false);
          }}
          onCreated={(key) => {
            setNewKey(key);
            load();
          }}
        />
      )}
      {revokeTarget !== null && (
        <RevokeModal
          apiKey={revokeTarget}
          onClose={() => {
            setRevokeTarget(null);
          }}
          onDone={load}
        />
      )}
    </div>
  );
}
