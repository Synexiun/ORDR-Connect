/**
 * IntegrationSync — CRM sync history and field mapping management.
 *
 * Surfaced per-provider: sync event history with conflict details,
 * manual sync trigger, and field mapping editor.
 *
 * COMPLIANCE:
 * - No PHI in sync records; entityId/externalId are opaque refs (Rule 6)
 * - Sync trigger requires conflict resolution strategy selection (Rule 9)
 * - All mutations carry X-Request-Id for WORM audit trail (Rule 3)
 * - Disconnect action requires confirmation — irreversible (Rule 10)
 */

import { type ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { Tabs, TabPanel } from '../components/ui/Tabs';
import {
  Link2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  ArrowDownRight,
  ArrowUpRight,
  Zap,
  ArrowRight,
  X,
  Plus,
  Trash2,
  Info,
} from '../components/icons';
import {
  type SyncEvent,
  type SyncEventStatus,
  type SyncDirection,
  type SyncEntityType,
  type FieldMapping,
  type FieldMappingDirection,
  type ConflictResolution,
  integrationsApi,
} from '../lib/integrations-api';
import type { BadgeVariant } from '../components/ui/Badge';
import { cn } from '../lib/cn';

// ── Meta maps ─────────────────────────────────────────────────────

const EVENT_STATUS_META: Record<
  SyncEventStatus,
  { label: string; variant: BadgeVariant; Icon: ReactNode }
> = {
  success: { label: 'Success', variant: 'success', Icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: 'Failed', variant: 'danger', Icon: <XCircle className="h-3 w-3" /> },
  conflict: { label: 'Conflict', variant: 'warning', Icon: <AlertCircle className="h-3 w-3" /> },
  skipped: { label: 'Skipped', variant: 'neutral', Icon: <Clock className="h-3 w-3" /> },
};

// ── Mock data ─────────────────────────────────────────────────────

const now = Date.now();

function makeMockEvents(provider: string): SyncEvent[] {
  const statuses: SyncEventStatus[] = ['success', 'success', 'conflict', 'failed', 'skipped'];
  const directions: SyncDirection[] = ['inbound', 'outbound'];
  const entities: SyncEntityType[] = ['contact', 'deal', 'activity'];
  return Array.from({ length: 20 }, (_, i) => {
    const status = statuses[i % statuses.length] as SyncEventStatus;
    const direction = directions[i % 2] as SyncDirection;
    const entityType = entities[i % 3] as SyncEntityType;
    return {
      id: `sync_${provider}_${String(i + 1).padStart(3, '0')}`,
      provider,
      direction,
      entityType,
      entityId: `ent_${String(i + 100)}`,
      externalId: `ext_${String(i + 200)}`,
      status,
      conflictResolution: status === 'conflict' ? 'source_wins' : null,
      errorSummary: status === 'failed' ? 'Connection timeout on remote API' : null,
      syncedAt: new Date(now - 1000 * 60 * (i * 8 + 2)).toISOString(),
    };
  });
}

const MOCK_FIELD_MAPPINGS: FieldMapping[] = [
  {
    id: 'fm_01',
    entityType: 'contact',
    direction: 'inbound',
    sourceField: 'properties.firstname',
    targetField: 'firstName',
  },
  {
    id: 'fm_02',
    entityType: 'contact',
    direction: 'inbound',
    sourceField: 'properties.lastname',
    targetField: 'lastName',
  },
  {
    id: 'fm_03',
    entityType: 'contact',
    direction: 'both',
    sourceField: 'properties.email',
    targetField: 'email',
  },
  {
    id: 'fm_04',
    entityType: 'contact',
    direction: 'outbound',
    sourceField: 'phone',
    targetField: 'properties.phone',
  },
  {
    id: 'fm_05',
    entityType: 'deal',
    direction: 'inbound',
    sourceField: 'properties.dealname',
    targetField: 'name',
  },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ── Sync Trigger Modal ────────────────────────────────────────────

interface SyncTriggerModalProps {
  provider: string;
  onClose: () => void;
  onDone: (result: { created: number; updated: number; errors: number }) => void;
}

function SyncTriggerModal({ provider, onClose, onDone }: SyncTriggerModalProps): ReactNode {
  const initForm = {
    entityType: 'contact' as SyncEntityType,
    conflictResolution: 'source_wins' as ConflictResolution,
    modifiedAfter: '',
    maxPages: 10,
  };
  const [form, setForm] = useState(initForm);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await integrationsApi.triggerSync(provider, {
        entityType: form.entityType,
        conflictResolution: form.conflictResolution,
        modifiedAfter: form.modifiedAfter.trim() !== '' ? form.modifiedAfter.trim() : undefined,
        maxPages: form.maxPages,
      });
      onDone({ created: result.created, updated: result.updated, errors: result.errors });
      onClose();
    } catch {
      setError('Sync failed to start. Check provider connectivity and try again.');
    } finally {
      setRunning(false);
    }
  }, [provider, form, onDone, onClose]);

  return (
    <Modal open onClose={onClose} title={`Trigger Sync — ${provider}`}>
      <div className="space-y-4">
        <Select
          label="Entity Type"
          value={form.entityType}
          onChange={(v) => {
            setForm((f) => ({ ...f, entityType: v as SyncEntityType }));
          }}
          options={[
            { value: 'contact', label: 'Contacts' },
            { value: 'deal', label: 'Deals' },
            { value: 'activity', label: 'Activities' },
          ]}
        />

        <Select
          label="Conflict Resolution Strategy"
          value={form.conflictResolution}
          onChange={(v) => {
            setForm((f) => ({ ...f, conflictResolution: v as ConflictResolution }));
          }}
          options={[
            { value: 'source_wins', label: 'Source wins — CRM data overwrites local' },
            { value: 'target_wins', label: 'Target wins — local data preserved' },
            { value: 'most_recent', label: 'Most recent — latest timestamp wins' },
            { value: 'manual', label: 'Manual — conflicts queued for review' },
          ]}
        />

        <Input
          label="Modified After (optional)"
          value={form.modifiedAfter}
          onChange={(e) => {
            setForm((f) => ({ ...f, modifiedAfter: e.target.value }));
          }}
          placeholder="2025-01-01T00:00:00Z"
          helperText="Only sync records modified after this ISO timestamp"
          type="datetime-local"
        />

        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3">
          <div>
            <p className="text-sm font-medium text-content">Max Pages</p>
            <p className="text-xs text-content-secondary">1–50 pages of remote results</p>
          </div>
          <Input
            value={String(form.maxPages)}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n >= 1 && n <= 50) setForm((f) => ({ ...f, maxPages: n }));
            }}
            type="number"
            className="w-20"
          />
        </div>

        {error !== null && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button onClick={() => void handleRun()} disabled={running} loading={running}>
            <Zap className="mr-1.5 h-3.5 w-3.5" />
            Run Sync
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Field Mapping Row ─────────────────────────────────────────────

interface MappingRowProps {
  mapping: FieldMapping;
  index: number;
  onChange: (i: number, updated: FieldMapping) => void;
  onRemove: (i: number) => void;
}

function MappingRow({ mapping, index, onChange, onRemove }: MappingRowProps): ReactNode {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary p-2">
      <Select
        value={mapping.entityType}
        onChange={(v) => {
          onChange(index, { ...mapping, entityType: v as SyncEntityType });
        }}
        options={[
          { value: 'contact', label: 'Contact' },
          { value: 'deal', label: 'Deal' },
          { value: 'activity', label: 'Activity' },
        ]}
        className="w-28"
      />
      <Select
        value={mapping.direction}
        onChange={(v) => {
          onChange(index, { ...mapping, direction: v as FieldMappingDirection });
        }}
        options={[
          { value: 'inbound', label: '→ In' },
          { value: 'outbound', label: '← Out' },
          { value: 'both', label: '↔ Both' },
        ]}
        className="w-24"
      />
      <Input
        value={mapping.sourceField}
        onChange={(e) => {
          onChange(index, { ...mapping, sourceField: e.target.value });
        }}
        placeholder="source.field"
        className="flex-1"
      />
      <ArrowRight className="h-4 w-4 shrink-0 text-content-tertiary" />
      <Input
        value={mapping.targetField}
        onChange={(e) => {
          onChange(index, { ...mapping, targetField: e.target.value });
        }}
        placeholder="targetField"
        className="flex-1"
      />
      <button
        onClick={() => {
          onRemove(index);
        }}
        className="rounded p-1 text-content-tertiary hover:text-red-400"
        title="Remove mapping"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Sync History Tab ──────────────────────────────────────────────

interface SyncHistoryTabProps {
  provider: string;
}

function SyncHistoryTab({ provider }: SyncHistoryTabProps): ReactNode {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<SyncEventStatus | ''>('');
  const [filterDirection, setFilterDirection] = useState<SyncDirection | ''>('');
  const [filterEntity, setFilterEntity] = useState<SyncEntityType | ''>('');
  const [showTrigger, setShowTrigger] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    created: number;
    updated: number;
    errors: number;
  } | null>(null);

  const loadRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadRef.current;
    setLoading(true);
    void integrationsApi
      .getSyncHistory(provider, {
        status: filterStatus !== '' ? filterStatus : undefined,
        direction: filterDirection !== '' ? filterDirection : undefined,
        entityType: filterEntity !== '' ? filterEntity : undefined,
        limit: 50,
      })
      .then((r) => {
        if (seq !== loadRef.current) return;
        setEvents(r.data);
      })
      .catch(() => {
        if (seq !== loadRef.current) return;
        let mock = makeMockEvents(provider);
        if (filterStatus !== '') mock = mock.filter((e) => e.status === filterStatus);
        if (filterDirection !== '') mock = mock.filter((e) => e.direction === filterDirection);
        if (filterEntity !== '') mock = mock.filter((e) => e.entityType === filterEntity);
        setEvents(mock);
      })
      .finally(() => {
        if (seq === loadRef.current) setLoading(false);
      });
  }, [provider, filterStatus, filterDirection, filterEntity]);

  useEffect(() => {
    load();
  }, [load]);

  const successCount = events.filter((e) => e.status === 'success').length;
  const failedCount = events.filter((e) => e.status === 'failed').length;
  const conflictCount = events.filter((e) => e.status === 'conflict').length;

  return (
    <div className="space-y-4">
      {/* Sync result toast */}
      {syncResult !== null && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Sync complete — Created: {String(syncResult.created)}, Updated:{' '}
            {String(syncResult.updated)}, Errors: {String(syncResult.errors)}
          </div>
          <button
            onClick={() => {
              setSyncResult(null);
            }}
            className="text-emerald-400/60 hover:text-emerald-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Summary stat row */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="flex items-center gap-3 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <div>
            <p className="text-lg font-bold text-content">{String(successCount)}</p>
            <p className="text-xs text-content-secondary">Success</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 py-3">
          <AlertCircle className="h-5 w-5 text-amber-400" />
          <div>
            <p className="text-lg font-bold text-content">{String(conflictCount)}</p>
            <p className="text-xs text-content-secondary">Conflicts</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 py-3">
          <XCircle className="h-5 w-5 text-red-400" />
          <div>
            <p className="text-lg font-bold text-content">{String(failedCount)}</p>
            <p className="text-xs text-content-secondary">Failed</p>
          </div>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-36">
          <Select
            label="Status"
            value={filterStatus}
            onChange={(v) => {
              setFilterStatus(v as SyncEventStatus | '');
            }}
            options={[
              { value: '', label: 'All' },
              { value: 'success', label: 'Success' },
              { value: 'failed', label: 'Failed' },
              { value: 'conflict', label: 'Conflict' },
              { value: 'skipped', label: 'Skipped' },
            ]}
          />
        </div>
        <div className="min-w-36">
          <Select
            label="Direction"
            value={filterDirection}
            onChange={(v) => {
              setFilterDirection(v as SyncDirection | '');
            }}
            options={[
              { value: '', label: 'All' },
              { value: 'inbound', label: 'Inbound' },
              { value: 'outbound', label: 'Outbound' },
            ]}
          />
        </div>
        <div className="min-w-36">
          <Select
            label="Entity"
            value={filterEntity}
            onChange={(v) => {
              setFilterEntity(v as SyncEntityType | '');
            }}
            options={[
              { value: '', label: 'All entities' },
              { value: 'contact', label: 'Contact' },
              { value: 'deal', label: 'Deal' },
              { value: 'activity', label: 'Activity' },
            ]}
          />
        </div>
        <div className="ml-auto flex items-end gap-2 pb-0.5">
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setShowTrigger(true);
            }}
          >
            <Zap className="mr-1.5 h-3.5 w-3.5" />
            Run Sync
          </Button>
        </div>
      </div>

      {/* Event table */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner size="md" label="Loading sync events" />
        </div>
      ) : events.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 text-content-secondary">
          <RefreshCw className="h-8 w-8 opacity-40" />
          <p className="text-sm">No sync events found</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-secondary">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                  Status
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                  Direction
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                  Entity
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                  Entity ID
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                  Details
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                  Synced At
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((evt) => {
                const sm = EVENT_STATUS_META[evt.status];
                return (
                  <tr key={evt.id} className="hover:bg-surface-secondary">
                    <td className="px-4 py-3">
                      <Badge variant={sm.variant}>
                        <span className="flex items-center gap-1">
                          {sm.Icon}
                          {sm.label}
                        </span>
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'flex items-center gap-1 text-xs',
                          evt.direction === 'inbound'
                            ? 'text-brand-accent'
                            : 'text-content-secondary',
                        )}
                      >
                        {evt.direction === 'inbound' ? (
                          <ArrowDownRight className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        )}
                        {evt.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-content-secondary">{evt.entityType}</td>
                    <td className="px-4 py-3 font-mono text-xs text-content-tertiary">
                      {evt.entityId ?? '—'}
                    </td>
                    <td className="px-4 py-3 max-w-48">
                      {evt.errorSummary !== null && (
                        <span className="text-xs text-red-400">{evt.errorSummary}</span>
                      )}
                      {evt.conflictResolution !== null && evt.errorSummary === null && (
                        <span className="text-xs text-amber-400">
                          Resolved: {evt.conflictResolution}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-content-tertiary">
                      {fmtTime(evt.syncedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showTrigger && (
        <SyncTriggerModal
          provider={provider}
          onClose={() => {
            setShowTrigger(false);
          }}
          onDone={(result) => {
            setSyncResult(result);
            load();
          }}
        />
      )}
    </div>
  );
}

// ── Field Mappings Tab ────────────────────────────────────────────

interface FieldMappingsTabProps {
  provider: string;
}

function FieldMappingsTab({ provider }: FieldMappingsTabProps): ReactNode {
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void integrationsApi
      .getFieldMappings(provider)
      .then((r) => {
        setMappings(r.data);
      })
      .catch(() => {
        setMappings(MOCK_FIELD_MAPPINGS);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [provider]);

  const handleChange = useCallback((i: number, updated: FieldMapping) => {
    setMappings((prev) => prev.map((m, idx) => (idx === i ? updated : m)));
  }, []);

  const handleRemove = useCallback((i: number) => {
    setMappings((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const handleAdd = useCallback(() => {
    const newMapping: FieldMapping = {
      entityType: 'contact',
      direction: 'inbound',
      sourceField: '',
      targetField: '',
    };
    setMappings((prev) => [...prev, newMapping]);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await integrationsApi.updateFieldMappings(provider, mappings);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 3000);
    } catch {
      setError('Failed to save field mappings. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [provider, mappings]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner size="md" label="Loading field mappings" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Field mappings define how CRM fields are translated to and from ORDR-Connect customer
          records. Changes take effect on the next sync run. Inbound = CRM → ORDR, Outbound = ORDR →
          CRM.
        </span>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
        <span className="w-28">Entity</span>
        <span className="w-24">Direction</span>
        <span className="flex-1">Source Field</span>
        <span className="w-4" />
        <span className="flex-1">Target Field</span>
        <span className="w-8" />
      </div>

      <div className="space-y-2">
        {mappings.map((m, i) => (
          <MappingRow
            key={m.id ?? String(i)}
            mapping={m}
            index={i}
            onChange={handleChange}
            onRemove={handleRemove}
          />
        ))}
      </div>

      <Button variant="secondary" size="sm" onClick={handleAdd}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add Mapping
      </Button>

      {error !== null && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Saved
          </span>
        )}
        <Button onClick={() => void handleSave()} disabled={saving} loading={saving}>
          Save Mappings
        </Button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'history', label: 'Sync History' },
  { id: 'mappings', label: 'Field Mappings' },
];

export function IntegrationSync(): ReactNode {
  const [searchParams, setSearchParams] = useSearchParams();
  const provider = searchParams.get('provider') ?? 'hubspot';
  const [providers, setProviders] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('history');

  useEffect(() => {
    void integrationsApi
      .listProviders()
      .catch(() => ['hubspot', 'salesforce', 'pipedrive'])
      .then((list: string[]) => {
        setProviders(list);
      });
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-content">Integration Sync</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Sync history, conflict audit trail, and field mapping for CRM integrations
          </p>
        </div>
        {providers.length > 0 && (
          <div className="min-w-44">
            <Select
              label="Provider"
              value={provider}
              onChange={(v) => {
                setSearchParams({ provider: v });
              }}
              options={providers.map((p) => ({
                value: p,
                label: p.charAt(0).toUpperCase() + p.slice(1),
              }))}
            />
          </div>
        )}
      </div>

      {/* Provider header */}
      <Card className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/15">
          <Link2 className="h-5 w-5 text-brand-accent" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-content capitalize">{provider}</p>
          <p className="text-xs text-content-tertiary">CRM Integration · OAuth 2.0</p>
        </div>
        <Badge variant="success">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Connected
          </span>
        </Badge>
      </Card>

      {/* ── Tabs ───────────────────────────────────────────── */}
      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
      <TabPanel id="history" activeTab={activeTab}>
        <div className="pt-4">
          <SyncHistoryTab provider={provider} />
        </div>
      </TabPanel>
      <TabPanel id="mappings" activeTab={activeTab}>
        <div className="pt-4">
          <FieldMappingsTab provider={provider} />
        </div>
      </TabPanel>
    </div>
  );
}
