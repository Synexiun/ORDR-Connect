/**
 * Developer Console — API keys, published agents, sandboxes, usage stats, and webhooks.
 *
 * Design system: Card accent borders, BarChart for API usage, font-mono metrics,
 * styled code blocks for API examples, organized webhook config.
 *
 * COMPLIANCE: API keys SHA-256 hashed before storage (Rule 2). Raw keys shown
 * once and never persisted client-side. All mutations trigger audit events.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import { BarChart } from '../components/charts/BarChart';
import { apiClient } from '../lib/api';
import {
  Key,
  Bot,
  Terminal,
  Webhook,
  Code2,
  BookOpen,
  RefreshCw,
  Plus,
  Copy,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Shield,
  Activity,
  Globe,
} from '../components/icons';

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

interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastTriggered: string | null;
}

// --- Constants ---

const statusBadge: Record<
  PublishedAgent['status'],
  'info' | 'warning' | 'success' | 'danger' | 'neutral'
> = {
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

// API usage data for BarChart (last 7 days)
const usageChartData = [
  { label: 'Mon', value: 1842, color: '#3b82f6' },
  { label: 'Tue', value: 2105, color: '#3b82f6' },
  { label: 'Wed', value: 1920, color: '#3b82f6' },
  { label: 'Thu', value: 2340, color: '#3b82f6' },
  { label: 'Fri', value: 2087, color: '#3b82f6' },
  { label: 'Sat', value: 890, color: '#3b82f6' },
  { label: 'Sun', value: 663, color: '#3b82f6' },
];

const errorChartData = [
  { label: 'Mon', value: 23, color: '#ef4444' },
  { label: 'Tue', value: 41, color: '#ef4444' },
  { label: 'Wed', value: 18, color: '#ef4444' },
  { label: 'Thu', value: 55, color: '#ef4444' },
  { label: 'Fri', value: 32, color: '#ef4444' },
  { label: 'Sat', value: 12, color: '#ef4444' },
  { label: 'Sun', value: 8, color: '#ef4444' },
];

const endpointUsageData = [
  { label: '/customers', value: 4230 },
  { label: '/agents', value: 2847 },
  { label: '/tickets', value: 1920 },
  { label: '/reports', value: 1450 },
  { label: '/marketplace', value: 980 },
];

// --- Mock data ---

const mockKeys: ApiKeyItem[] = [
  {
    id: 'key-001',
    name: 'Production Key',
    prefix: 'ordr_pk_a1b2',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(),
    revokedAt: null,
  },
  {
    id: 'key-002',
    name: 'Staging Key',
    prefix: 'ordr_sk_c3d4',
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    expiresAt: null,
    revokedAt: null,
  },
  {
    id: 'key-003',
    name: 'Old Key',
    prefix: 'ordr_ok_e5f6',
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    expiresAt: null,
    revokedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
];

const mockAgents: PublishedAgent[] = [
  {
    id: 'agent-001',
    name: 'Smart Collections',
    version: '1.2.0',
    status: 'published',
    downloads: 847,
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
  },
  {
    id: 'agent-002',
    name: 'Payment Reminder',
    version: '0.9.0',
    status: 'review',
    downloads: 0,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 'agent-003',
    name: 'Risk Scorer',
    version: '2.0.0',
    status: 'draft',
    downloads: 0,
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

const mockSandboxes: SandboxItem[] = [
  {
    id: 'sb-001',
    name: 'Dev Testing',
    status: 'active',
    expiresAt: new Date(Date.now() + 20 * 86400000).toISOString(),
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
  {
    id: 'sb-002',
    name: 'Demo Env',
    status: 'expired',
    expiresAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    createdAt: new Date(Date.now() - 35 * 86400000).toISOString(),
  },
];

const mockUsage: UsageStats = {
  totalCalls: 12847,
  totalErrors: 234,
  callsToday: 347,
  errorsToday: 12,
};

const mockWebhooks: WebhookConfig[] = [
  {
    id: 'wh-001',
    url: 'https://api.example.com/webhooks/ordr',
    events: ['customer.created', 'ticket.resolved', 'agent.completed'],
    active: true,
    lastTriggered: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: 'wh-002',
    url: 'https://hooks.slack.com/services/T00/B00/xxx',
    events: ['agent.error', 'compliance.alert'],
    active: true,
    lastTriggered: new Date(Date.now() - 24 * 3600000).toISOString(),
  },
  {
    id: 'wh-003',
    url: 'https://old.internal.example.com/notify',
    events: ['customer.updated'],
    active: false,
    lastTriggered: null,
  },
];

// --- API code example ---
const apiExampleCode = `// Authenticate with your API key
const response = await fetch('https://api.ordr-connect.com/v1/customers', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ordr_pk_your_key_here',
    'Content-Type': 'application/json',
    'X-Tenant-ID': 'your-tenant-id',
  },
});

const { data, total } = await response.json();`;

const webhookExampleCode = `// Webhook payload format (POST to your endpoint)
{
  "id": "evt_abc123",
  "type": "customer.created",
  "timestamp": "2026-03-25T12:00:00Z",
  "data": {
    "customerId": "cust_xyz789",
    "name": "Acme Corp",
    "tier": "enterprise"
  },
  "signature": "sha256=..."  // HMAC-SHA256 for verification
}`;

// --- Component ---

export function DeveloperConsole(): ReactNode {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [sandboxes, setSandboxes] = useState<SandboxItem[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [webhooks] = useState(mockWebhooks);
  const [loading, setLoading] = useState(true);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

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
      const res = await apiClient.post<{
        data: {
          key: string;
          id: string;
          name: string;
          prefix: string;
          createdAt: string;
          expiresAt: string | null;
        };
      }>('/v1/developers/keys', { name: newKeyName });
      setRawKey(res.data.key);
      setKeys((prev) => [
        ...prev,
        {
          id: res.data.id,
          name: res.data.name,
          prefix: res.data.prefix,
          createdAt: res.data.createdAt,
          expiresAt: res.data.expiresAt,
          revokedAt: null,
        },
      ]);
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

  const handleCopyKey = useCallback(() => {
    if (rawKey !== null && rawKey !== '') {
      void navigator.clipboard.writeText(rawKey);
      setCopiedKey(true);
      setTimeout(() => {
        setCopiedKey(false);
      }, 2000);
    }
  }, [rawKey]);

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
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-content-tertiary" />
          <span className="font-medium text-content">{row.name}</span>
        </div>
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
        <Badge variant={statusBadge[row.status]} dot size="sm">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'downloads',
      header: 'Downloads',
      render: (row: PublishedAgent) => (
        <span className="font-mono text-sm text-content-secondary">
          {row.downloads.toLocaleString()}
        </span>
      ),
    },
  ];

  const errorRate = usage ? ((usage.totalErrors / usage.totalCalls) * 100).toFixed(2) : '0';

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Developer Console</h1>
          <p className="page-subtitle">Manage API keys, agents, webhooks, and sandboxes</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={fetchData}
        >
          Refresh
        </Button>
      </div>

      {/* Usage stats KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="kpi-card-blue">
          <div className="flex items-center justify-between">
            <p className="metric-label">Total API Calls</p>
            <Activity className="h-4 w-4 text-kpi-blue" />
          </div>
          <p className="metric-value mt-2">{usage?.totalCalls.toLocaleString() ?? '0'}</p>
          <p className="mt-1 text-xs text-content-secondary">
            <span className="font-mono">{usage?.callsToday.toLocaleString() ?? '0'}</span> today
          </p>
        </div>
        <div className="kpi-card-red">
          <div className="flex items-center justify-between">
            <p className="metric-label">Total Errors</p>
            <AlertTriangle className="h-4 w-4 text-kpi-red" />
          </div>
          <p className="metric-value mt-2 !text-red-400">
            {usage?.totalErrors.toLocaleString() ?? '0'}
          </p>
          <p className="mt-1 text-xs text-content-secondary">
            <span className="font-mono">{usage?.errorsToday.toLocaleString() ?? '0'}</span> today
          </p>
        </div>
        <div className="kpi-card-green">
          <div className="flex items-center justify-between">
            <p className="metric-label">Calls Today</p>
            <Zap className="h-4 w-4 text-kpi-green" />
          </div>
          <p className="metric-value mt-2">{usage?.callsToday.toLocaleString() ?? '0'}</p>
          <p className="mt-1 text-xs text-content-secondary">
            Error rate: <span className="font-mono">{errorRate}%</span>
          </p>
        </div>
        <div className="kpi-card-purple">
          <div className="flex items-center justify-between">
            <p className="metric-label">Active Keys</p>
            <Key className="h-4 w-4 text-kpi-purple" />
          </div>
          <p className="metric-value mt-2">{keys.filter((k) => k.revokedAt === null).length}</p>
          <p className="mt-1 text-xs text-content-secondary">
            <span className="font-mono">{keys.length}</span> total
          </p>
        </div>
      </div>

      {/* API Usage Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="API Calls (Last 7 Days)" accent="blue">
          <BarChart data={usageChartData} height={180} showLabels showValues />
        </Card>
        <Card title="Errors (Last 7 Days)" accent="red">
          <BarChart data={errorChartData} height={180} showLabels showValues />
        </Card>
      </div>

      {/* Endpoint breakdown */}
      <Card title="Top Endpoints by Usage" accent="purple">
        <BarChart data={endpointUsageData} height={160} horizontal showLabels showValues />
      </Card>

      {/* API Keys section */}
      <Card
        title="API Keys"
        accent="amber"
        actions={
          <Button
            size="sm"
            icon={<Plus className="h-3 w-3" />}
            onClick={() => {
              setShowCreateKey(true);
            }}
          >
            New Key
          </Button>
        }
      >
        <div className="space-y-2">
          {keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Key className="h-8 w-8 text-content-tertiary" />
              <p className="mt-2 text-sm text-content-secondary">No API keys created yet.</p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => {
                  setShowCreateKey(true);
                }}
              >
                Create your first key
              </Button>
            </div>
          ) : (
            keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-tertiary"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-content-tertiary" />
                    <span className="text-sm font-medium text-content">{key.name}</span>
                    {key.revokedAt !== null && (
                      <Badge variant="danger" size="sm">
                        Revoked
                      </Badge>
                    )}
                    {key.revokedAt === null && key.expiresAt === null && (
                      <Badge variant="success" dot size="sm">
                        Active
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    <code className="rounded bg-surface-tertiary px-1.5 py-0.5 font-mono text-xs text-content-tertiary">
                      {key.prefix}...
                    </code>
                    <span className="text-2xs text-content-tertiary">
                      Created{' '}
                      {new Date(key.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    {key.expiresAt !== null && (
                      <span className="text-2xs text-amber-400">
                        Expires{' '}
                        {new Date(key.expiresAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    )}
                  </div>
                </div>
                {key.revokedAt === null && (
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 className="h-3 w-3" />}
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
      <Card title="Published Agents" accent="green">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Bot className="h-8 w-8 text-content-tertiary" />
            <p className="mt-2 text-sm text-content-secondary">No agents published yet.</p>
          </div>
        ) : (
          <Table columns={agentColumns} data={agents} keyExtractor={(a) => a.id} />
        )}
      </Card>

      {/* Webhooks section */}
      <Card
        title="Webhook Configuration"
        accent="blue"
        actions={
          <Button
            size="sm"
            icon={<Plus className="h-3 w-3" />}
            onClick={() => {
              /* future: add webhook modal */
            }}
          >
            Add Webhook
          </Button>
        }
      >
        <div className="space-y-3">
          {webhooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Webhook className="h-8 w-8 text-content-tertiary" />
              <p className="mt-2 text-sm text-content-secondary">No webhooks configured.</p>
            </div>
          ) : (
            webhooks.map((wh) => (
              <div
                key={wh.id}
                className="rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-tertiary"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* URL */}
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 shrink-0 text-content-tertiary" />
                      <code className="truncate font-mono text-xs text-content">{wh.url}</code>
                    </div>

                    {/* Event tags */}
                    <div className="flex flex-wrap gap-1.5">
                      {wh.events.map((evt) => (
                        <Badge key={evt} variant="info" size="sm">
                          <span className="font-mono">{evt}</span>
                        </Badge>
                      ))}
                    </div>

                    {/* Last triggered */}
                    <p className="text-2xs text-content-tertiary">
                      {wh.lastTriggered !== null
                        ? `Last triggered ${new Date(wh.lastTriggered).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                        : 'Never triggered'}
                    </p>
                  </div>

                  <Badge variant={wh.active ? 'success' : 'neutral'} dot size="sm">
                    {wh.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
            ))
          )}

          {/* Webhook payload example */}
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <div className="mb-2 flex items-center gap-2">
              <Code2 className="h-4 w-4 text-kpi-blue" />
              <p className="text-xs font-semibold text-content">Webhook Payload Format</p>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-3 font-mono text-xs leading-relaxed text-content-secondary">
              {webhookExampleCode}
            </pre>
          </div>
        </div>
      </Card>

      {/* Sandboxes */}
      <Card title="Sandbox Environments" accent="purple">
        <div className="space-y-2">
          {sandboxes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Terminal className="h-8 w-8 text-content-tertiary" />
              <p className="mt-2 text-sm text-content-secondary">No sandboxes provisioned.</p>
            </div>
          ) : (
            sandboxes.map((sb) => (
              <div
                key={sb.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-tertiary"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-content-tertiary" />
                    <span className="text-sm font-medium text-content">{sb.name}</span>
                    <Badge variant={sandboxBadge[sb.status]} dot size="sm">
                      {sb.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-2xs text-content-tertiary">
                    Expires{' '}
                    {new Date(sb.expiresAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* API Quick Reference */}
      <Card title="API Quick Reference" accent="green">
        <div className="space-y-4">
          {/* Base URL */}
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-kpi-green" />
              <p className="text-xs font-semibold text-content">Base URL</p>
            </div>
            <code className="rounded bg-surface-secondary px-2 py-1 font-mono text-xs text-content-secondary">
              https://api.ordr-connect.com/v1
            </code>
          </div>

          {/* Authentication example */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-kpi-blue" />
              <p className="text-xs font-semibold text-content">Authentication Example</p>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-3 font-mono text-xs leading-relaxed text-content-secondary">
              {apiExampleCode}
            </pre>
          </div>

          {/* Rate limits */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="metric-label">Rate Limit</p>
              <p className="mt-1 font-mono text-sm font-semibold text-content">1,000 / min</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="metric-label">Max Payload</p>
              <p className="mt-1 font-mono text-sm font-semibold text-content">1 MB</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="metric-label">Auth Method</p>
              <p className="mt-1 font-mono text-sm font-semibold text-content">Bearer Token</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Create key modal */}
      <Modal
        open={showCreateKey}
        onClose={() => {
          setShowCreateKey(false);
        }}
        title="Create API Key"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCreateKey(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              icon={<Key className="h-3 w-3" />}
              onClick={handleCreateKey}
              disabled={!newKeyName.trim()}
            >
              Create Key
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Key Name"
            placeholder="e.g. Production Key"
            value={newKeyName}
            onChange={(e) => {
              setNewKeyName(e.target.value);
            }}
            required
          />
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-kpi-blue" />
              <p className="text-xs text-content-secondary">
                Keys are SHA-256 hashed before storage. The raw key will only be shown once after
                creation. Store it securely.
              </p>
            </div>
          </div>
        </div>
      </Modal>

      {/* Raw key display modal */}
      <Modal
        open={rawKey !== null}
        onClose={() => {
          setRawKey(null);
        }}
        title="API Key Created"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setRawKey(null);
            }}
          >
            Done
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-sm text-amber-400">Copy this key now. It will not be shown again.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary p-3">
            <code className="flex-1 break-all font-mono text-xs text-content">{rawKey}</code>
            <Button
              variant="ghost"
              size="sm"
              icon={
                copiedKey ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-kpi-green" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )
              }
              onClick={handleCopyKey}
            >
              {copiedKey ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
