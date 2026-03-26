/**
 * Interactions Page — Interaction timeline with metadata ONLY.
 *
 * COMPLIANCE: NO message content (PHI/PII) is ever displayed.
 * Only metadata: channel, timestamp, status, direction, correlation ID.
 * HIPAA §164.312 / SOC2 C1 / ISO 27001 A.8.11
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { apiClient } from '../lib/api';

// --- Types ---

interface InteractionMeta {
  id: string;
  customerId: string;
  customerName: string;
  channel: 'sms' | 'email' | 'voice' | 'chat' | 'ivr';
  direction: 'inbound' | 'outbound';
  status: 'sent' | 'delivered' | 'failed' | 'pending' | 'received';
  timestamp: string;
  correlationId: string;
  agentId: string | null;
}

// --- Constants ---

const channelLabel: Record<InteractionMeta['channel'], string> = {
  sms: 'SMS',
  email: 'Email',
  voice: 'Voice',
  chat: 'Chat',
  ivr: 'IVR',
};

const channelIcon: Record<InteractionMeta['channel'], string> = {
  sms: '\u2709',
  email: '\u2709',
  voice: '\u260E',
  chat: '\u25AC',
  ivr: '\u260E',
};

const statusBadge: Record<InteractionMeta['status'], 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  sent: 'info',
  delivered: 'success',
  failed: 'danger',
  pending: 'warning',
  received: 'success',
};

const directionStyle: Record<InteractionMeta['direction'], string> = {
  inbound: 'border-l-blue-400',
  outbound: 'border-l-emerald-400',
};

// --- Mock data ---

const channels: InteractionMeta['channel'][] = ['sms', 'email', 'voice', 'chat', 'ivr'];
const statuses: InteractionMeta['status'][] = ['sent', 'delivered', 'failed', 'pending', 'received'];
const directions: InteractionMeta['direction'][] = ['inbound', 'outbound'];
const customerNames = [
  'Acme Corp', 'Globex Inc', 'Initech', 'Umbrella LLC', 'Stark Industries',
  'Wayne Enterprises', 'Oscorp', 'LexCorp', 'Pied Piper', 'Hooli',
];

const mockInteractions: InteractionMeta[] = Array.from({ length: 50 }, (_, i) => ({
  id: `int-${String(i + 1).padStart(5, '0')}`,
  customerId: `cust-${String((i % 10) + 1).padStart(4, '0')}`,
  customerName: customerNames[i % 10] as string,
  channel: channels[i % 5] as InteractionMeta['channel'],
  direction: directions[i % 2] as InteractionMeta['direction'],
  status: statuses[i % 5] as InteractionMeta['status'],
  timestamp: new Date(Date.now() - i * 1800000).toISOString(),
  correlationId: `req-${crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : `${Date.now()}-${i}`}`,
  agentId: i % 3 === 0 ? `agent-${(i % 4) + 1}` : null,
}));

// --- Component ---

export function Interactions(): ReactNode {
  const [interactions, setInteractions] = useState<InteractionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchInteractions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (channelFilter !== 'all') params.set('channel', channelFilter);
      if (search.trim()) params.set('customerId', search.trim());
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);

      const res = await apiClient.get<{ interactions: InteractionMeta[] }>(
        `/v1/interactions?${params.toString()}`,
      );
      setInteractions(res.interactions);
    } catch {
      // Graceful degradation
      let filtered = mockInteractions;
      if (channelFilter !== 'all') {
        filtered = filtered.filter((i) => i.channel === channelFilter);
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        filtered = filtered.filter(
          (i) => i.customerName.toLowerCase().includes(q) || i.customerId.includes(q),
        );
      }
      setInteractions(filtered);
    } finally {
      setLoading(false);
    }
  }, [channelFilter, search, dateFrom, dateTo]);

  useEffect(() => {
    void fetchInteractions();
  }, [fetchInteractions]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-content">Interactions</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Communication metadata timeline — content is not displayed (PHI protected)
        </p>
      </div>

      {/* Compliance notice */}
      <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
        <span className="text-blue-400" aria-hidden="true">{'\u25C6'}</span>
        <p className="text-xs text-blue-300">
          Message content is never displayed in this view. Only metadata (channel, status,
          timestamp, direction) is shown per HIPAA and SOC2 requirements.
        </p>
      </div>

      {/* Filters */}
      <Card padding={false}>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <Input
              label="Customer"
              placeholder="Search by customer name or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter by customer"
            />
          </div>
          <div className="w-40">
            <Input
              label="From"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="From date"
            />
          </div>
          <div className="w-40">
            <Input
              label="To"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="To date"
            />
          </div>
          <div className="flex items-center gap-1">
            {['all', ...channels].map((ch) => (
              <Button
                key={ch}
                variant={channelFilter === ch ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setChannelFilter(ch)}
              >
                {ch === 'all' ? 'All' : channelLabel[ch as InteractionMeta['channel']]}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Timeline */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner size="lg" label="Loading interactions" />
        </div>
      ) : interactions.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-content-secondary">
            No interactions found matching the current filters.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {interactions.map((interaction) => (
            <div
              key={interaction.id}
              className={`rounded-lg border border-border border-l-4 bg-surface-secondary p-4 transition-colors hover:bg-surface-tertiary/30 ${directionStyle[interaction.direction]}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary text-sm"
                    aria-hidden="true"
                  >
                    {channelIcon[interaction.channel]}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-content">
                        {interaction.customerName}
                      </span>
                      <Badge
                        variant={interaction.direction === 'inbound' ? 'info' : 'success'}
                        size="sm"
                      >
                        {interaction.direction}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Badge variant="neutral" size="sm">
                        {channelLabel[interaction.channel]}
                      </Badge>
                      <Badge variant={statusBadge[interaction.status]} dot size="sm">
                        {interaction.status}
                      </Badge>
                      {interaction.agentId && (
                        <span className="text-2xs text-content-tertiary">
                          Agent: {interaction.agentId}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-xs text-content-secondary">
                    {new Date(interaction.timestamp).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="mt-1 font-mono text-2xs text-content-tertiary">
                    {interaction.correlationId}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
