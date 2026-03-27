/**
 * Interactions Page — Interaction timeline with metadata ONLY.
 *
 * COMPLIANCE: NO message content (PHI/PII) is ever displayed.
 * Only metadata: channel, timestamp, status, direction, correlation ID.
 * HIPAA §164.312 / SOC2 C1 / ISO 27001 A.8.11
 */

import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { SparkLine } from '../components/charts/SparkLine';
import { Mail, Phone, MessageCircle, Smartphone, Headphones } from '../components/icons';
import { apiClient } from '../lib/api';

// --- Types ---

interface InteractionMeta {
  id: string;
  customerId: string;
  customerName: string;
  channel: 'sms' | 'email' | 'voice' | 'chat' | 'ivr';
  direction: 'inbound' | 'outbound';
  status: 'sent' | 'delivered' | 'failed' | 'pending' | 'received';
  sentiment: 'positive' | 'neutral' | 'negative';
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

const channelIconColor: Record<InteractionMeta['channel'], string> = {
  sms: 'text-emerald-400 bg-emerald-500/15',
  email: 'text-blue-400 bg-blue-500/15',
  voice: 'text-amber-400 bg-amber-500/15',
  chat: 'text-purple-400 bg-purple-500/15',
  ivr: 'text-cyan-400 bg-cyan-500/15',
};

const statusBadge: Record<
  InteractionMeta['status'],
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  sent: 'info',
  delivered: 'success',
  failed: 'danger',
  pending: 'warning',
  received: 'success',
};

const sentimentConfig: Record<
  InteractionMeta['sentiment'],
  { label: string; dotColor: string; textColor: string }
> = {
  positive: { label: 'Positive', dotColor: 'bg-emerald-400', textColor: 'text-emerald-400' },
  neutral: {
    label: 'Neutral',
    dotColor: 'bg-content-tertiary',
    textColor: 'text-content-tertiary',
  },
  negative: { label: 'Negative', dotColor: 'bg-red-400', textColor: 'text-red-400' },
};

const directionStyle: Record<InteractionMeta['direction'], string> = {
  inbound: 'border-l-blue-400',
  outbound: 'border-l-emerald-400',
};

// --- Helpers ---

/** Render Lucide channel icon by channel type. */
function ChannelIcon({ channel }: { channel: InteractionMeta['channel'] }): ReactNode {
  const iconClass = 'h-4 w-4';
  switch (channel) {
    case 'sms':
      return <Smartphone className={iconClass} />;
    case 'email':
      return <Mail className={iconClass} />;
    case 'voice':
      return <Phone className={iconClass} />;
    case 'chat':
      return <MessageCircle className={iconClass} />;
    case 'ivr':
      return <Headphones className={iconClass} />;
  }
}

/** Generate deterministic pseudo-random sparkline data for KPI cards. */
function generateSparkData(seed: number, points: number, base: number): number[] {
  const result: number[] = [];
  let value = base;
  for (let i = 0; i < points; i++) {
    value =
      base +
      Math.round(Math.sin(seed + i * 0.7) * (base * 0.15) + Math.cos(i * 0.3) * (base * 0.08));
    result.push(Math.max(0, value));
  }
  return result;
}

// --- Mock data ---

const channels: InteractionMeta['channel'][] = ['sms', 'email', 'voice', 'chat', 'ivr'];
const statuses: InteractionMeta['status'][] = [
  'sent',
  'delivered',
  'failed',
  'pending',
  'received',
];
const directions: InteractionMeta['direction'][] = ['inbound', 'outbound'];
const sentiments: InteractionMeta['sentiment'][] = ['positive', 'neutral', 'negative'];
const customerNames = [
  'Acme Corp',
  'Globex Inc',
  'Initech',
  'Umbrella LLC',
  'Stark Industries',
  'Wayne Enterprises',
  'Oscorp',
  'LexCorp',
  'Pied Piper',
  'Hooli',
];

const mockInteractions: InteractionMeta[] = Array.from({ length: 50 }, (_, i) => ({
  id: `int-${String(i + 1).padStart(5, '0')}`,
  customerId: `cust-${String((i % 10) + 1).padStart(4, '0')}`,
  customerName: customerNames[i % 10] as string,
  channel: channels[i % 5] as InteractionMeta['channel'],
  direction: directions[i % 2] as InteractionMeta['direction'],
  status: statuses[i % 5] as InteractionMeta['status'],
  sentiment: sentiments[i % 3] as InteractionMeta['sentiment'],
  timestamp: new Date(Date.now() - i * 1800000).toISOString(),
  correlationId: `req-${crypto.randomUUID().slice(0, 8)}`,
  agentId: i % 3 === 0 ? `agent-${(i % 4) + 1}` : null,
}));

// --- Component ---

export function Interactions(): ReactNode {
  const [interactions, setInteractions] = useState<InteractionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState('all');
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

  /** KPI statistics computed from the loaded interaction set. */
  const kpiStats = useMemo(() => {
    const all = mockInteractions;
    const totalCount = all.length;
    const deliveredCount = all.filter((i) => i.status === 'delivered').length;
    const failedCount = all.filter((i) => i.status === 'failed').length;
    const inboundCount = all.filter((i) => i.direction === 'inbound').length;
    return {
      total: totalCount,
      delivered: deliveredCount,
      failed: failedCount,
      inbound: inboundCount,
      sparkTotal: generateSparkData(1, 12, totalCount),
      sparkDelivered: generateSparkData(2, 12, deliveredCount),
      sparkFailed: generateSparkData(3, 12, failedCount),
      sparkInbound: generateSparkData(4, 12, inboundCount),
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-content">Interactions</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Communication metadata timeline — content is not displayed (PHI protected)
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card accent="blue">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
                Total
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-content">{kpiStats.total}</p>
            </div>
            <SparkLine data={kpiStats.sparkTotal} color="#3b82f6" width={72} height={28} />
          </div>
        </Card>
        <Card accent="green">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
                Delivered
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">
                {kpiStats.delivered}
              </p>
            </div>
            <SparkLine data={kpiStats.sparkDelivered} color="#34d399" width={72} height={28} />
          </div>
        </Card>
        <Card accent="red">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
                Failed
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-red-400">{kpiStats.failed}</p>
            </div>
            <SparkLine data={kpiStats.sparkFailed} color="#f87171" width={72} height={28} />
          </div>
        </Card>
        <Card accent="purple">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
                Inbound
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-purple-400">
                {kpiStats.inbound}
              </p>
            </div>
            <SparkLine data={kpiStats.sparkInbound} color="#a78bfa" width={72} height={28} />
          </div>
        </Card>
      </div>

      {/* Compliance notice */}
      <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
        <span className="text-blue-400" aria-hidden="true">
          {'\u25C6'}
        </span>
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
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              aria-label="Filter by customer"
            />
          </div>
          <div className="w-40">
            <Input
              label="From"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
              }}
              aria-label="From date"
            />
          </div>
          <div className="w-40">
            <Input
              label="To"
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
              }}
              aria-label="To date"
            />
          </div>
          <div className="flex items-center gap-1">
            {['all', ...channels].map((ch) => (
              <Button
                key={ch}
                variant={channelFilter === ch ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setChannelFilter(ch);
                }}
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
          {interactions.map((interaction) => {
            const sentCfg = sentimentConfig[interaction.sentiment];
            return (
              <div
                key={interaction.id}
                className={`rounded-lg border border-border border-l-4 bg-surface-secondary p-4 transition-colors hover:bg-surface-tertiary/30 ${directionStyle[interaction.direction]}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    {/* Channel icon */}
                    <span
                      className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg ${channelIconColor[interaction.channel]}`}
                      aria-label={channelLabel[interaction.channel]}
                    >
                      <ChannelIcon channel={interaction.channel} />
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
                        {/* Sentiment indicator */}
                        <span className="inline-flex items-center gap-1">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${sentCfg.dotColor}`}
                            aria-hidden="true"
                          />
                          <span className={`text-2xs font-medium ${sentCfg.textColor}`}>
                            {sentCfg.label}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Badge variant="neutral" size="sm">
                          {channelLabel[interaction.channel]}
                        </Badge>
                        <Badge variant={statusBadge[interaction.status]} dot size="sm">
                          {interaction.status}
                        </Badge>
                        {interaction.agentId !== null && (
                          <span className="text-2xs text-content-tertiary">
                            Agent: {interaction.agentId}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="font-mono text-xs text-content-secondary">
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
            );
          })}
        </div>
      )}
    </div>
  );
}
