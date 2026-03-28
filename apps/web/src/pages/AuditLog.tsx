/**
 * AuditLog — Immutable WORM audit trail viewer.
 *
 * Displays the cryptographically chained audit log for the authenticated tenant.
 * Supports pagination and filtering by event type, actor type, and time range.
 *
 * COMPLIANCE:
 * - SOC2 CC7.2 — Authorized review of security-relevant events.
 * - HIPAA §164.312(b) — Audit controls: no PHI in any log field.
 * - ISO 27001 A.12.4.1 — Event log read access for authorized reviewers.
 * - Access restricted to tenant_admin and above (enforced server-side).
 * - All API calls include X-Request-Id for correlation (Rule 3).
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { Input } from '../components/ui/Input';
import {
  ShieldCheck,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ScrollText,
} from '../components/icons';
import {
  fetchAuditLogs,
  fetchAuditChainStatus,
  type AuditLogEvent,
  type AuditChainStatus,
  type AuditActorType,
  type FetchAuditLogsParams,
} from '../lib/audit-api';

// ─── Constants ───────────────────────────────────────────────────

const EVENT_TYPE_OPTIONS = [
  { value: '', label: 'All Event Types' },
  { value: 'auth.login', label: 'auth.login' },
  { value: 'auth.logout', label: 'auth.logout' },
  { value: 'auth.failed', label: 'auth.failed' },
  { value: 'auth.mfa_verified', label: 'auth.mfa_verified' },
  { value: 'data.created', label: 'data.created' },
  { value: 'data.read', label: 'data.read' },
  { value: 'data.updated', label: 'data.updated' },
  { value: 'data.deleted', label: 'data.deleted' },
  { value: 'agent.action', label: 'agent.action' },
  { value: 'agent.decision', label: 'agent.decision' },
  { value: 'agent.killed', label: 'agent.killed' },
  { value: 'compliance.check', label: 'compliance.check' },
  { value: 'compliance.violation', label: 'compliance.violation' },
  { value: 'api.request', label: 'api.request' },
  { value: 'phi.accessed', label: 'phi.accessed' },
  { value: 'phi.exported', label: 'phi.exported' },
  { value: 'user.provisioned', label: 'user.provisioned' },
  { value: 'user.updated', label: 'user.updated' },
  { value: 'user.deactivated', label: 'user.deactivated' },
  { value: 'system.config_change', label: 'system.config_change' },
  { value: 'system.deployment', label: 'system.deployment' },
];

const ACTOR_TYPE_OPTIONS = [
  { value: '', label: 'All Actors' },
  { value: 'user', label: 'User' },
  { value: 'agent', label: 'Agent' },
  { value: 'system', label: 'System' },
];

const PAGE_SIZES = [
  { value: '25', label: '25 / page' },
  { value: '50', label: '50 / page' },
  { value: '100', label: '100 / page' },
  { value: '200', label: '200 / page' },
];

// ─── Helpers ─────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function actorBadgeVariant(actorType: AuditActorType): 'info' | 'warning' | 'neutral' {
  if (actorType === 'user') return 'info';
  if (actorType === 'agent') return 'warning';
  return 'neutral';
}

function eventBadgeVariant(
  eventType: string,
): 'danger' | 'warning' | 'success' | 'info' | 'neutral' {
  if (eventType.startsWith('compliance.violation') || eventType.startsWith('auth.failed'))
    return 'danger';
  if (
    eventType.startsWith('compliance.') ||
    eventType.startsWith('phi.') ||
    eventType.startsWith('agent.killed')
  )
    return 'warning';
  if (eventType.startsWith('auth.login') || eventType.startsWith('auth.mfa')) return 'success';
  if (eventType.startsWith('agent.') || eventType.startsWith('data.')) return 'info';
  return 'neutral';
}

// ─── Sub-components ──────────────────────────────────────────────

function ChainStatusCard({ status }: { status: AuditChainStatus }): ReactNode {
  return (
    <Card className="flex items-center gap-6 px-5 py-4">
      <div className="flex items-center gap-2 text-success-600">
        <ShieldCheck className="h-5 w-5" />
        <span className="text-sm font-semibold">Chain Verified</span>
      </div>
      <div className="h-5 w-px bg-border" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">Total Events</span>
        <span className="text-sm font-mono font-semibold">
          {status.totalEvents.toLocaleString()}
        </span>
      </div>
      <div className="h-5 w-px bg-border" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">Last Sequence</span>
        <span className="text-sm font-mono font-semibold">#{status.lastSequence}</span>
      </div>
      <div className="h-5 w-px bg-border" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">Last Event</span>
        <span className="text-sm font-mono">
          {status.lastTimestamp !== null ? formatTimestamp(status.lastTimestamp) : '—'}
        </span>
      </div>
      <div className="h-5 w-px bg-border" />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-xs text-muted-foreground">Last Hash</span>
        <span className="text-xs font-mono text-muted-foreground truncate">
          {status.lastHash.slice(0, 16)}…
        </span>
      </div>
    </Card>
  );
}

function EventRow({ event }: { event: AuditLogEvent }): ReactNode {
  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
        #{event.sequenceNumber}
      </td>
      <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
        {formatTimestamp(event.timestamp)}
      </td>
      <td className="px-4 py-3">
        <Badge variant={eventBadgeVariant(event.eventType)} size="sm">
          {event.eventType}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <Badge variant={actorBadgeVariant(event.actorType)} size="sm">
          {event.actorType}
        </Badge>
      </td>
      <td className="px-4 py-3 text-xs font-mono text-muted-foreground max-w-[120px] truncate">
        {event.actorId}
      </td>
      <td className="px-4 py-3 text-xs text-foreground">{event.resource}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{event.action}</td>
      <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
        {event.hash.slice(0, 8)}…
      </td>
    </tr>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function AuditLog(): ReactNode {
  const [events, setEvents] = useState<AuditLogEvent[]>([]);
  const [chainStatus, setChainStatus] = useState<AuditChainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [eventType, setEventType] = useState('');
  const [actorType, setActorType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams: FetchAuditLogsParams = {
        page,
        limit,
        ...(eventType !== '' ? { eventType } : {}),
        ...(actorType !== '' ? { actorType: actorType as AuditActorType } : {}),
        ...(dateFrom !== '' ? { from: new Date(dateFrom).toISOString() } : {}),
        ...(dateTo !== '' ? { to: new Date(`${dateTo}T23:59:59`).toISOString() } : {}),
      };
      const [logsRes, statusRes] = await Promise.allSettled([
        fetchAuditLogs(queryParams),
        fetchAuditChainStatus(),
      ]);

      if (logsRes.status === 'fulfilled') {
        setEvents(logsRes.value.events);
        setTotal(logsRes.value.total);
        setPages(logsRes.value.pages);
      } else {
        setError('Failed to load audit events.');
      }

      if (statusRes.status === 'fulfilled') {
        setChainStatus(statusRes.value);
      }
    } finally {
      setLoading(false);
    }
  }, [page, limit, eventType, actorType, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleApplyFilters(): void {
    setPage(1);
    void load();
  }

  function handleClearFilters(): void {
    setEventType('');
    setActorType('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <ScrollText className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Immutable WORM audit trail — cryptographically chained. SOC2 CC7.2 / HIPAA §164.312(b)
          </p>
        </div>
      </div>

      {/* Chain status */}
      {chainStatus !== null && <ChainStatusCard status={chainStatus} />}

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <Select
            label="Event Type"
            options={EVENT_TYPE_OPTIONS}
            value={eventType}
            onChange={setEventType}
          />
          <Select
            label="Actor Type"
            options={ACTOR_TYPE_OPTIONS}
            value={actorType}
            onChange={setActorType}
          />
          <Input
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
            }}
          />
          <Input
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
            }}
          />
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={handleApplyFilters} className="flex-1">
              Apply
            </Button>
            <Button size="sm" variant="outline" onClick={handleClearFilters}>
              Clear
            </Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        {/* Table header row */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-foreground">
            {loading ? 'Loading…' : `${total.toLocaleString()} events`}
          </span>
          <div className="flex items-center gap-3">
            <Select
              options={PAGE_SIZES}
              value={String(limit)}
              onChange={(v) => {
                setLimit(Number(v));
                setPage(1);
              }}
            />
          </div>
        </div>

        {error !== null && (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-danger-600">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" label="Loading audit events" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">#</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Timestamp</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">
                    Event Type
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Actor</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Actor ID</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Resource</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Action</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Hash</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      No audit events found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  events.map((event) => <EventRow key={event.id} event={event} />)
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Page {page} of {pages} ({total.toLocaleString()} total)
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPage((p) => Math.max(1, p - 1));
                }}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPage((p) => Math.min(pages, p + 1));
                }}
                disabled={page >= pages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
