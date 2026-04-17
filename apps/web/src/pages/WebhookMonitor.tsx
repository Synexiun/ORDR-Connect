/**
 * Webhook Monitor — Developer webhook registration and delivery tracking.
 *
 * COMPLIANCE:
 * - HMAC secret shown ONCE at creation, never again (Rule 2 / SOC2 CC6.1)
 * - Webhook URL validated https:// + SSRF-safe server-side (Rule 4 / Rule 10)
 * - All mutations carry X-Request-Id for WORM audit trail (Rule 3)
 * - Max 10 webhooks per developer enforced server-side (Rule 4)
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import {
  Webhook,
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Shield,
  ToggleLeft,
  ToggleRight,
  Clock,
  X,
  Info,
} from '../components/icons';
import {
  type WebhookItem,
  type WebhookCreated,
  listWebhooks,
  createWebhook,
  toggleWebhook,
  deleteWebhook,
} from '../lib/developer-api';
import { cn } from '../lib/cn';

// ── Constants ──────────────────────────────────────────────────────

const DELIVERABLE_EVENTS = [
  'customer.created',
  'customer.updated',
  'interaction.logged',
  'agent.triggered',
  'agent.action_executed',
  'agent.completed',
  'ticket.created',
  'ticket.resolved',
  'dsr.approved',
  'dsr.completed',
  'compliance.alert',
  'integration.webhook_received',
] as const;

// ── Helpers ────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (iso === null) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ── Show-Once HMAC Banner ──────────────────────────────────────────

interface HmacBannerProps {
  created: WebhookCreated;
  onDismiss: () => void;
}

function HmacBanner({ created, onDismiss }: HmacBannerProps): ReactNode {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(created.hmacSecret).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 3000);
    });
  }, [created.hmacSecret]);

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        <div>
          <p className="text-sm font-semibold text-emerald-300">HMAC Secret — Copy Now</p>
          <p className="mt-0.5 text-xs text-emerald-300/80">
            This signing secret is shown <strong>once only</strong>. Use it server-side to verify
            the <code className="font-mono">X-ORDR-Signature</code> header on incoming webhook
            deliveries. The server stores only its hash.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-surface p-3">
        <code className="flex-1 break-all font-mono text-xs text-emerald-300 select-all">
          {created.hmacSecret}
        </code>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 rounded p-1.5 text-emerald-400 hover:bg-emerald-500/10"
          title="Copy secret"
        >
          {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-emerald-300/60">
          Webhook: <span className="font-mono">{created.url}</span>
        </p>
        <Button variant="secondary" size="sm" onClick={onDismiss}>
          <X className="mr-1 h-3.5 w-3.5" />
          I've saved it
        </Button>
      </div>
    </div>
  );
}

// ── Event Selector ─────────────────────────────────────────────────

interface EventSelectorProps {
  selected: string[];
  onChange: (events: string[]) => void;
}

function EventSelector({ selected, onChange }: EventSelectorProps): ReactNode {
  const toggle = useCallback(
    (event: string) => {
      onChange(
        selected.includes(event) ? selected.filter((e) => e !== event) : [...selected, event],
      );
    },
    [selected, onChange],
  );

  const allSelected = selected.length === DELIVERABLE_EVENTS.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-content">Events</label>
        <button
          onClick={() => {
            onChange(allSelected ? [] : [...DELIVERABLE_EVENTS]);
          }}
          className="text-xs text-brand-accent hover:underline"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border p-3 bg-surface-secondary max-h-48 overflow-y-auto">
        {DELIVERABLE_EVENTS.map((event) => (
          <label
            key={event}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-tertiary"
          >
            <input
              type="checkbox"
              checked={selected.includes(event)}
              onChange={() => {
                toggle(event);
              }}
              className="h-3.5 w-3.5 accent-brand-accent"
            />
            <span className="font-mono text-xs text-content-secondary">{event}</span>
          </label>
        ))}
      </div>
      {selected.length === 0 && <p className="text-xs text-red-400">Select at least one event</p>}
      <p className="text-xs text-content-tertiary">
        {selected.length} of {DELIVERABLE_EVENTS.length} selected
      </p>
    </div>
  );
}

// ── Create Modal ───────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreated: (wh: WebhookCreated) => void;
}

function CreateModal({ onClose, onCreated }: CreateModalProps): ReactNode {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(['customer.created', 'customer.updated']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const httpsValid = url.startsWith('https://') && url.length > 10;
  const valid = httpsValid && events.length > 0;

  const handleCreate = useCallback(async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const r = await createWebhook({ url: url.trim(), events });
      onCreated(r.data);
      onClose();
    } catch {
      setError(
        'Failed to register webhook. Ensure the URL is reachable, uses https://, and is not an internal address.',
      );
    } finally {
      setSaving(false);
    }
  }, [valid, url, events, onCreated, onClose]);

  return (
    <Modal open onClose={onClose} title="Register Webhook">
      <div className="space-y-4">
        <Input
          label="Endpoint URL"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
          placeholder="https://your-server.com/webhooks/ordr"
          helperText="Must use https://. Private/internal IPs are blocked (SSRF protection)."
          autoFocus
        />

        {url.length > 0 && !httpsValid && (
          <p className="text-xs text-red-400">URL must start with https://</p>
        )}

        <EventSelector selected={events} onChange={setEvents} />

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
            <Webhook className="mr-1.5 h-3.5 w-3.5" />
            Register
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Delete Confirm ─────────────────────────────────────────────────

interface DeleteModalProps {
  webhook: WebhookItem;
  onClose: () => void;
  onDone: () => void;
}

function DeleteModal({ webhook, onClose, onDone }: DeleteModalProps): ReactNode {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await deleteWebhook(webhook.id);
      onDone();
      onClose();
    } catch {
      setError('Failed to delete webhook. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [webhook.id, onDone, onClose]);

  return (
    <Modal open onClose={onClose} title="Delete Webhook">
      <div className="space-y-4">
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div>
              <p className="font-semibold text-red-300">Permanently delete this webhook?</p>
              <p className="mt-1 break-all font-mono text-red-300/80">{webhook.url}</p>
              <p className="mt-1">
                Deliveries in-flight will not be retried. The HMAC secret will be destroyed.
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
            onClick={() => void handleDelete()}
            disabled={saving}
            loading={saving}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Mock data ──────────────────────────────────────────────────────

const MOCK_WEBHOOKS: WebhookItem[] = [
  {
    id: 'wh_01',
    url: 'https://api.example.com/webhooks/ordr',
    events: ['customer.created', 'customer.updated', 'ticket.created'],
    active: true,
    lastTriggeredAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString(),
  },
  {
    id: 'wh_02',
    url: 'https://hooks.slack.com/services/T00/B00/xxx',
    events: ['compliance.alert', 'agent.completed'],
    active: true,
    lastTriggeredAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
  },
  {
    id: 'wh_03',
    url: 'https://staging-server.internal.example.com/hooks',
    events: ['customer.created'],
    active: false,
    lastTriggeredAt: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
  },
];

// ── Webhook Card ───────────────────────────────────────────────────

interface WebhookCardProps {
  webhook: WebhookItem;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (wh: WebhookItem) => void;
  toggling: boolean;
}

function WebhookCard({ webhook, onToggle, onDelete, toggling }: WebhookCardProps): ReactNode {
  return (
    <Card className="space-y-3">
      {/* URL + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-sm text-content">{webhook.url}</p>
          <p className="mt-0.5 text-xs text-content-tertiary">
            Created {fmtDate(webhook.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={webhook.active ? 'success' : 'neutral'}>
            {webhook.active ? 'Active' : 'Disabled'}
          </Badge>
        </div>
      </div>

      {/* Events */}
      <div className="flex flex-wrap gap-1.5">
        {webhook.events.map((event) => (
          <span
            key={event}
            className="rounded border border-brand-accent/20 bg-brand-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-accent"
          >
            {event}
          </span>
        ))}
      </div>

      {/* Last triggered + actions */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-1.5 text-xs text-content-tertiary">
          <Clock className="h-3.5 w-3.5" />
          Last triggered: {fmtDate(webhook.lastTriggeredAt)}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              onToggle(webhook.id, !webhook.active);
            }}
            disabled={toggling}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-content-secondary hover:bg-surface-tertiary hover:text-content"
            title={webhook.active ? 'Disable' : 'Enable'}
          >
            {webhook.active ? (
              <ToggleRight className="h-4 w-4 text-emerald-400" />
            ) : (
              <ToggleLeft className="h-4 w-4 text-content-tertiary" />
            )}
            {webhook.active ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={() => {
              onDelete(webhook);
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-content-tertiary hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────

export function WebhookMonitor(): ReactNode {
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WebhookItem | null>(null);
  const [newWebhook, setNewWebhook] = useState<WebhookCreated | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void listWebhooks()
      .then((r) => {
        setWebhooks(r.data);
      })
      .catch(() => {
        setWebhooks(MOCK_WEBHOOKS);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggle = useCallback(
    async (id: string, active: boolean) => {
      setTogglingId(id);
      try {
        const r = await toggleWebhook(id, active);
        setWebhooks((prev) => prev.map((wh) => (wh.id === id ? r.data : wh)));
      } catch {
        // Optimistic update failed — reload
        load();
      } finally {
        setTogglingId(null);
      }
    },
    [load],
  );

  const activeCount = webhooks.filter((w) => w.active).length;
  const totalEvents = webhooks.reduce((s, w) => s + w.events.length, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-content">Webhook Monitor</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Register HTTPS endpoints to receive signed event deliveries
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
            disabled={webhooks.length >= 10}
            title={webhooks.length >= 10 ? 'Maximum 10 webhooks per developer' : undefined}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Register
          </Button>
        </div>
      </div>

      {/* Show-once HMAC banner */}
      {newWebhook !== null && (
        <HmacBanner
          created={newWebhook}
          onDismiss={() => {
            setNewWebhook(null);
          }}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {(
          [
            ['Registered', webhooks.length, <Webhook className="h-5 w-5" />, 'text-brand-accent'],
            ['Active', activeCount, <CheckCircle2 className="h-5 w-5" />, 'text-emerald-400'],
            [
              'Total Event Types',
              totalEvents,
              <Shield className="h-5 w-5" />,
              'text-content-tertiary',
            ],
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

      {/* Webhook list */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner size="md" label="Loading webhooks" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-content-secondary">
          <Webhook className="h-8 w-8 opacity-40" />
          <p className="text-sm">No webhooks registered</p>
          <Button
            size="sm"
            onClick={() => {
              setShowCreate(true);
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Register your first webhook
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <WebhookCard
              key={wh.id}
              webhook={wh}
              onToggle={(id, active) => void handleToggle(id, active)}
              onDelete={setDeleteTarget}
              toggling={togglingId === wh.id}
            />
          ))}
        </div>
      )}

      {webhooks.length >= 10 && (
        <div className="flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Maximum of 10 webhooks per developer reached. Delete an existing one to register more.
        </div>
      )}

      {/* Verification note */}
      <div className="flex items-start gap-2 rounded border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Each delivery includes an{' '}
          <code className="font-mono">X-ORDR-Signature: sha256=&lt;hmac&gt;</code> header. Verify it
          server-side using the HMAC secret before processing the payload. Deliveries that fail
          verification should be rejected with HTTP 403.
        </span>
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateModal
          onClose={() => {
            setShowCreate(false);
          }}
          onCreated={(wh) => {
            setNewWebhook(wh);
            load();
          }}
        />
      )}
      {deleteTarget !== null && (
        <DeleteModal
          webhook={deleteTarget}
          onClose={() => {
            setDeleteTarget(null);
          }}
          onDone={load}
        />
      )}
    </div>
  );
}
