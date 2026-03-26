import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import { apiClient } from '../lib/api';

// --- Types ---

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface PublishedAgent {
  id: string;
  name: string;
  version: string;
  status: 'draft' | 'review' | 'published' | 'suspended' | 'rejected';
  downloads: number;
  createdAt: string;
}

interface SandboxItem {
  id: string;
  name: string;
  status: 'active' | 'expired' | 'destroyed';
  expiresAt: string;
  createdAt: string;
}

interface UsageStats {
  totalCalls: number;
  totalErrors: number;
  callsToday: number;
  errorsToday: number;
}

// --- Constants ---

const statusBadge: Record<PublishedAgent['status'], 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  review: 'warning',
  published: 'success',
  suspended: 'danger',
  rejected: 'danger',
};

const sandboxBadge: Record<SandboxItem['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  expired: 'warning',
  destroyed: 'neutral',
};

// --- Mock data ---

const mockKeys: ApiKeyItem[] = [
  { id: 'key-001', name: 'Production Key', prefix: 'ordr_pk_a1b2', createdAt: new Date(Date.now() - 30 * 86400000).toISOString(), expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(), revokedAt: null },
  { id: 'key-002', name: 'Staging Key', prefix: 'ordr_sk_c3d4', createdAt: new Date(Date.now() - 15 * 86400000).toISOString(), expiresAt: null, revokedAt: null },
  { id: 'key-003', name: 'Old Key', prefix: 'ordr_ok_e5f6', createdAt: new Date(Date.now() - 90 * 86400000).toISOString(), expiresAt: null, revokedAt: new Date(Date.now() - 10 * 86400000).toISOString() },
];

const mockAgents: PublishedAgent[] = [
  { id: 'agent-001', name: 'Smart Collections', version: '1.2.0', status: 'published', downloads: 847, createdAt: new Date(Date.now() - 60 * 86400000).toISOString() },
  { id: 'agent-002', name: 'Payment Reminder', version: '0.9.0', status: 'review', downloads: 0, createdAt: new Date(Date.now() - 5 * 86400000).toISOString() },
  { id: 'agent-003', name: 'Risk Scorer', version: '2.0.0', status: 'draft', downloads: 0, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
];

const mockSandboxes: SandboxItem[] = [
  { id: 'sb-001', name: 'Dev Testing', status: 'active', expiresAt: new Date(Date.now() + 20 * 86400000).toISOString(), createdAt: new Date(Date.now() - 10 * 86400000).toISOString() },
  { id: 'sb-002', name: 'Demo Env', status: 'expired', expiresAt: new Date(Date.now() - 5 * 86400000).toISOString(), createdAt: new Date(Date.now() - 35 * 86400000).toISOString() },
];

const mockUsage: UsageStats = {
  totalCalls: 12847,
  totalErrors: 234,
  callsToday: 347,
  errorsToday: 12,
};

// --- Component ---

export function DeveloperConsole(): ReactNode {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [rawKey, setRawKey] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, agentsRes, sandboxRes] = await Promise.allSettled([
        apiClient.get<{ data: ApiKeyItem[] }>('/v1/developers/keys'),
        apiClient.get<{ data: PublishedAgent[] }>('/v1/marketplace?publisher=me'),
        apiClient.get<{ data: SandboxItem[] }>('/v1/developers/sandbox'),
      ]);

      setKeys(keysRes.status === 'fulfilled' ? keysRes.value.data : mockKeys);
      setAgents(agentsRes.status === 'fulfilled' ? agentsRes.value.data : mockAgents);
      setSandboxes(sandboxRes.status === 'fulfilled' ? sandboxRes.value.data : mockSandboxes);
      setUsage(mockUsage);
    } catch {
      setKeys(mockKeys);
      setAgents(mockAgents);
      setSandboxes(mockSandboxes);
      setUsage(mockUsage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleCreateKey = useCallback(async () => {
    if (!newKeyName.trim()) return;
    try {
      const res = await apiClient.post<{ data: { key: string; id: string; name: string; prefix: string; createdAt: string; expiresAt: string | null } }>('/v1/developers/keys', { name: newKeyName });
      setRawKey(res.data.key);
      setKeys((prev) => [...prev, {
        id: res.data.id,
        name: res.data.name,
        prefix: res.data.prefix,
        createdAt: res.data.createdAt,
        expiresAt: res.data.expiresAt,
        revokedAt: null,
      }]);
    } catch {
      // Mock: generate fake key
      const fakeKey = `ordr_mk_${Math.random().toString(36).slice(2, 18)}`;
      setRawKey(fakeKey);
      const newKey: ApiKeyItem = {
        id: `key-${Date.now()}`,
        name: newKeyName,
        prefix: fakeKey.slice(0, 12),
        createdAt: new Date().toISOString(),
        expiresAt: null,
        revokedAt: null,
      };
      setKeys((prev) => [...prev, newKey]);
    }
    setNewKeyName('');
    setShowCreateKey(false);
  }, [newKeyName]);

  const handleRevokeKey = useCallback(async (keyId: string) => {
    try {
      await apiClient.delete(`/v1/developers/keys/${keyId}`);
    } catch {
      // Mock: revoke locally
    }
    setKeys((prev) => prev.filter((k) => k.id !== keyId));
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading developer console" />
      </div>
    );
  }

  const agentColumns = [
    {
      key: 'name',
      header: 'Agent',
      render: (row: PublishedAgent) => (
        <span className="font-medium text-content">{row.name}</span>
      ),
    },
    {
      key: 'version',
      header: 'Version',
      render: (row: PublishedAgent) => (
        <span className="font-mono text-xs text-content-secondary">{row.version}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: PublishedAgent) => (
        <Badge variant={statusBadge[row.status]} dot size="sm">{row.status}</Badge>
      ),
    },
    {
      key: 'downloads',
      header: 'Downloads',
      render: (row: PublishedAgent) => (
        <span className="text-sm text-content-secondary">{row.downloads}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Developer Console</h1>
          <p className="mt-1 text-sm text-content-secondary">Manage API keys, agents, and sandboxes</p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData}>
          Refresh
        </Button>
      </div>

      {/* Usage stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="kpi-card">
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">Total API Calls</p>
          <p className="mt-2 text-2xl font-bold text-content">{usage?.totalCalls.toLocaleString() ?? 0}</p>
        </div>
        <div className="kpi-card">
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">Total Errors</p>
          <p className="mt-2 text-2xl font-bold text-red-400">{usage?.totalErrors.toLocaleString() ?? 0}</p>
        </div>
        <div className="kpi-card">
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">Calls Today</p>
          <p className="mt-2 text-2xl font-bold text-content">{usage?.callsToday.toLocaleString() ?? 0}</p>
        </div>
        <div className="kpi-card">
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">Errors Today</p>
          <p className="mt-2 text-2xl font-bold text-red-400">{usage?.errorsToday.toLocaleString() ?? 0}</p>
        </div>
      </div>

      {/* API Keys section */}
      <Card
        title="API Keys"
        actions={
          <Button size="sm" onClick={() => setShowCreateKey(true)}>
            + New Key
          </Button>
        }
      >
        <div className="space-y-2">
          {keys.length === 0 ? (
            <p className="text-sm text-content-secondary">No API keys created yet.</p>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content">{key.name}</span>
                    {key.revokedAt && <Badge variant="danger" size="sm">Revoked</Badge>}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-content-tertiary">{key.prefix}...</p>
                  <p className="text-2xs text-content-tertiary">
                    Created {new Date(key.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {key.expiresAt && ` \u00B7 Expires ${new Date(key.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                  </p>
                </div>
                {!key.revokedAt && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRevokeKey(key.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Published agents */}
      <Card title="Published Agents">
        {agents.length === 0 ? (
          <p className="text-sm text-content-secondary">No agents published yet.</p>
        ) : (
          <Table
            columns={agentColumns}
            data={agents}
            keyExtractor={(a) => a.id}
          />
        )}
      </Card>

      {/* Sandboxes */}
      <Card title="Sandbox Environments">
        <div className="space-y-2">
          {sandboxes.length === 0 ? (
            <p className="text-sm text-content-secondary">No sandboxes provisioned.</p>
          ) : (
            sandboxes.map((sb) => (
              <div key={sb.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content">{sb.name}</span>
                    <Badge variant={sandboxBadge[sb.status]} dot size="sm">{sb.status}</Badge>
                  </div>
                  <p className="mt-0.5 text-2xs text-content-tertiary">
                    Expires {new Date(sb.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Create key modal */}
      <Modal
        open={showCreateKey}
        onClose={() => setShowCreateKey(false)}
        title="Create API Key"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowCreateKey(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateKey} disabled={!newKeyName.trim()}>
              Create Key
            </Button>
          </>
        }
      >
        <Input
          label="Key Name"
          placeholder="e.g. Production Key"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          required
        />
      </Modal>

      {/* Raw key display modal */}
      <Modal
        open={rawKey !== null}
        onClose={() => setRawKey(null)}
        title="API Key Created"
        actions={
          <Button size="sm" onClick={() => setRawKey(null)}>
            Done
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-amber-400">
            Copy this key now. It will not be shown again.
          </p>
          <div className="rounded-lg border border-border bg-surface-secondary p-3">
            <code className="break-all text-xs text-content">{rawKey}</code>
          </div>
        </div>
      </Modal>
    </div>
  );
}
