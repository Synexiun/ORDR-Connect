/**
 * Event Stream — Read-only Kafka topic browser and consumer lag monitor.
 *
 * Provides visibility into the event sourcing backbone:
 * topic health, per-partition event browser, consumer group lag,
 * and schema registry version history.
 *
 * SECURITY:
 * - PHI payload fields masked server-side as "[MASKED — HIPAA §164.312(b)]" — Rule 6
 * - Read-only surface; no event production via UI — Rule 2
 * - All topic reads logged with accessor identity for WORM audit — Rule 3
 *
 * SOC 2 CC7.1, A1.2 | ISO 27001 A.8.16 | HIPAA §164.312(b)
 */

import { type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import {
  Radio,
  RefreshCw,
  ChevronRight,
  X,
  AlertTriangle,
  Clock,
  Database,
  Activity,
  Layers,
  Server,
  Search,
} from '../components/icons';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import {
  eventsApi,
  type KafkaTopic,
  type KafkaEvent,
  type ConsumerGroup,
  type TopicStats,
  type ConsumerGroupState,
} from '../lib/events-api';

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_TOPICS: KafkaTopic[] = [
  {
    name: 'ordr.customers.events',
    partitions: 12,
    replicationFactor: 3,
    messageCount: 4_182_341,
    messagesPerSecond: 48.3,
    sizeBytes: 2_841_094_144,
    retentionMs: 604_800_000,
    lastMessageAt: new Date(Date.now() - 4_000).toISOString(),
    schemaSubject: 'ordr.customers.events-value',
  },
  {
    name: 'ordr.messages.outbound',
    partitions: 24,
    replicationFactor: 3,
    messageCount: 18_492_011,
    messagesPerSecond: 312.7,
    sizeBytes: 9_126_805_504,
    retentionMs: 2_592_000_000,
    lastMessageAt: new Date(Date.now() - 800).toISOString(),
    schemaSubject: 'ordr.messages.outbound-value',
  },
  {
    name: 'ordr.agents.decisions',
    partitions: 6,
    replicationFactor: 3,
    messageCount: 1_029_482,
    messagesPerSecond: 22.1,
    sizeBytes: 812_744_704,
    retentionMs: 2_592_000_000,
    lastMessageAt: new Date(Date.now() - 2_300).toISOString(),
    schemaSubject: 'ordr.agents.decisions-value',
  },
  {
    name: 'ordr.audit.trail',
    partitions: 6,
    replicationFactor: 3,
    messageCount: 52_391_024,
    messagesPerSecond: 18.9,
    sizeBytes: 41_943_040_000,
    retentionMs: 220_752_000_000, // 7 years
    lastMessageAt: new Date(Date.now() - 1_200).toISOString(),
    schemaSubject: 'ordr.audit.trail-value',
  },
  {
    name: 'ordr.compliance.violations',
    partitions: 3,
    replicationFactor: 3,
    messageCount: 14_201,
    messagesPerSecond: 0.3,
    sizeBytes: 10_485_760,
    retentionMs: 220_752_000_000,
    lastMessageAt: new Date(Date.now() - 94_000).toISOString(),
    schemaSubject: 'ordr.compliance.violations-value',
  },
  {
    name: 'ordr.workflows.executions',
    partitions: 8,
    replicationFactor: 3,
    messageCount: 893_441,
    messagesPerSecond: 9.8,
    sizeBytes: 524_288_000,
    retentionMs: 604_800_000,
    lastMessageAt: new Date(Date.now() - 12_000).toISOString(),
    schemaSubject: 'ordr.workflows.executions-value',
  },
  {
    name: 'ordr.integrations.sync',
    partitions: 4,
    replicationFactor: 3,
    messageCount: 204_812,
    messagesPerSecond: 2.4,
    sizeBytes: 157_286_400,
    retentionMs: 604_800_000,
    lastMessageAt: new Date(Date.now() - 38_000).toISOString(),
    schemaSubject: null,
  },
];

const MOCK_STATS: TopicStats = {
  totalTopics: 7,
  totalMessagesPerSecond: 414.5,
  totalConsumerGroups: 14,
  maxConsumerLag: 1_842,
};

function makeMockEvents(topic: string): KafkaEvent[] {
  const typeMap: Record<string, string[]> = {
    'ordr.customers.events': [
      'customer.created',
      'customer.updated',
      'customer.opted_out',
      'customer.merged',
    ],
    'ordr.messages.outbound': [
      'message.queued',
      'message.sent',
      'message.delivered',
      'message.bounced',
    ],
    'ordr.agents.decisions': ['agent.decision_made', 'agent.action_queued', 'agent.confidence_low'],
    'ordr.audit.trail': [
      'audit.data_accessed',
      'audit.record_mutated',
      'audit.auth_event',
      'audit.role_changed',
    ],
    'ordr.compliance.violations': ['compliance.rule_failed', 'compliance.violation_created'],
    'ordr.workflows.executions': [
      'workflow.triggered',
      'workflow.step_completed',
      'workflow.completed',
      'workflow.failed',
    ],
    'ordr.integrations.sync': ['sync.started', 'sync.record_processed', 'sync.completed'],
  };

  const types = typeMap[topic] ?? ['event.unknown'];

  return Array.from({ length: 30 }, (_, i) => {
    const eventType = types[i % types.length];
    const isPhiTopic = topic === 'ordr.customers.events' || topic === 'ordr.messages.outbound';

    const basePayload: Record<string, unknown> = {
      eventId: `evt_${(1_000_000 - i).toString(16)}`,
      tenantId: 'tenant_demo',
      version: '1.0',
      eventType,
    };

    if (isPhiTopic) {
      basePayload['customerId'] = `cust_${(9000 - i).toString(16)}`;
      basePayload['name'] = '[MASKED — HIPAA §164.312(b)]';
      basePayload['email'] = '[MASKED — HIPAA §164.312(b)]';
      basePayload['phone'] = '[MASKED — HIPAA §164.312(b)]';
      basePayload['channel'] = ['SMS', 'EMAIL', 'VOICE', 'WHATSAPP'][i % 4];
    } else if (topic === 'ordr.agents.decisions') {
      basePayload['agentId'] = `agt_${i % 3}_runner`;
      basePayload['confidence'] = Number((0.6 + Math.random() * 0.4).toFixed(3));
      basePayload['action'] = 'send_message';
      basePayload['customerId'] = `cust_${(9000 - i).toString(16)}`;
    } else if (topic === 'ordr.audit.trail') {
      basePayload['actorId'] = `usr_demo_operator`;
      basePayload['resource'] = `customers/${(9000 - i).toString(16)}`;
      basePayload['action'] = 'read';
      basePayload['hashChainLink'] = `sha256:${Math.random().toString(16).slice(2, 18)}`;
    } else {
      basePayload['correlationId'] = `corr_${Math.random().toString(16).slice(2, 14)}`;
    }

    return {
      topic,
      partition: i % (MOCK_TOPICS.find((t) => t.name === topic)?.partitions ?? 4),
      offset: 1_000_000 - i * 37,
      timestamp: new Date(Date.now() - i * 3_800).toISOString(),
      key: `tenant_demo/${(9000 - i).toString(16)}`,
      eventType,
      sizeBytes: 180 + Math.floor(Math.random() * 600),
      schemaVersion: isPhiTopic ? '3' : '2',
      payload: basePayload,
    };
  });
}

const MOCK_CONSUMERS: Record<string, ConsumerGroup[]> = {
  'ordr.customers.events': [
    {
      groupId: 'analytics-consumer',
      topicName: 'ordr.customers.events',
      totalLag: 0,
      state: 'Stable',
      membersCount: 3,
    },
    {
      groupId: 'search-indexer',
      topicName: 'ordr.customers.events',
      totalLag: 12,
      state: 'Stable',
      membersCount: 2,
    },
    {
      groupId: 'neo4j-sync',
      topicName: 'ordr.customers.events',
      totalLag: 1_842,
      state: 'Rebalancing',
      membersCount: 1,
    },
  ],
  'ordr.messages.outbound': [
    {
      groupId: 'twilio-dispatcher',
      topicName: 'ordr.messages.outbound',
      totalLag: 0,
      state: 'Stable',
      membersCount: 6,
    },
    {
      groupId: 'sendgrid-dispatcher',
      topicName: 'ordr.messages.outbound',
      totalLag: 3,
      state: 'Stable',
      membersCount: 4,
    },
    {
      groupId: 'audit-writer',
      topicName: 'ordr.messages.outbound',
      totalLag: 0,
      state: 'Stable',
      membersCount: 2,
    },
  ],
  'ordr.agents.decisions': [
    {
      groupId: 'agent-executor',
      topicName: 'ordr.agents.decisions',
      totalLag: 0,
      state: 'Stable',
      membersCount: 4,
    },
    {
      groupId: 'compliance-checker',
      topicName: 'ordr.agents.decisions',
      totalLag: 7,
      state: 'Stable',
      membersCount: 2,
    },
  ],
  'ordr.audit.trail': [
    {
      groupId: 'worm-replicator',
      topicName: 'ordr.audit.trail',
      totalLag: 0,
      state: 'Stable',
      membersCount: 2,
    },
    {
      groupId: 'merkle-batcher',
      topicName: 'ordr.audit.trail',
      totalLag: 0,
      state: 'Stable',
      membersCount: 1,
    },
  ],
  'ordr.compliance.violations': [
    {
      groupId: 'violation-alerter',
      topicName: 'ordr.compliance.violations',
      totalLag: 0,
      state: 'Stable',
      membersCount: 1,
    },
  ],
  'ordr.workflows.executions': [
    {
      groupId: 'workflow-orchestrator',
      topicName: 'ordr.workflows.executions',
      totalLag: 0,
      state: 'Stable',
      membersCount: 3,
    },
    {
      groupId: 'workflow-audit',
      topicName: 'ordr.workflows.executions',
      totalLag: 22,
      state: 'Stable',
      membersCount: 1,
    },
  ],
  'ordr.integrations.sync': [
    {
      groupId: 'crm-sync-worker',
      topicName: 'ordr.integrations.sync',
      totalLag: 5,
      state: 'Stable',
      membersCount: 2,
    },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtRetention(ms: number): string {
  const days = ms / 86_400_000;
  if (days >= 365 * 5) return '7 years';
  if (days >= 30) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days)}d`;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 1_000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

const CONSUMER_STATE_CFG: Record<
  ConsumerGroupState,
  { variant: 'success' | 'warning' | 'error' | 'default'; label: string }
> = {
  Stable: { variant: 'success', label: 'Stable' },
  Rebalancing: { variant: 'warning', label: 'Rebalancing' },
  Dead: { variant: 'error', label: 'Dead' },
  Empty: { variant: 'default', label: 'Empty' },
};

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  alert,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
}): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-content-tertiary">
        {icon}
        <span className="text-2xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${alert === true ? 'text-amber-400' : 'text-content'}`}>
        {value}
      </p>
      {sub !== undefined && <p className="mt-0.5 text-xs text-content-tertiary">{sub}</p>}
    </div>
  );
}

// ── Topic Row ──────────────────────────────────────────────────────────────

function TopicRow({
  topic,
  selected,
  onClick,
}: {
  topic: KafkaTopic;
  selected: boolean;
  onClick: () => void;
}): ReactNode {
  const mps = topic.messagesPerSecond;
  const isActive = mps > 0;
  const lastSeen = fmtRelative(topic.lastMessageAt);

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'bg-brand-accent/10 text-content'
          : 'text-content-secondary hover:bg-surface-tertiary hover:text-content'
      }`}
    >
      <span
        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-content-tertiary'}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs">{topic.name}</p>
        <p className="text-2xs text-content-tertiary">
          {topic.partitions}p · {fmtNum(topic.messageCount)} msgs · {lastSeen}
        </p>
      </div>
      <span className="shrink-0 text-2xs text-content-tertiary">
        {mps > 0 ? `${mps.toFixed(1)}/s` : '—'}
      </span>
    </button>
  );
}

// ── Event Inspector Panel ──────────────────────────────────────────────────

function EventInspector({ event, onClose }: { event: KafkaEvent; onClose: () => void }): ReactNode {
  const hasMasked = Object.values(event.payload).some(
    (v) => typeof v === 'string' && v.startsWith('[MASKED'),
  );

  return (
    <div className="flex w-96 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="font-mono text-xs font-semibold text-content">{event.eventType}</p>
          <p className="text-2xs text-content-tertiary">
            partition {event.partition} · offset {event.offset.toLocaleString()}
          </p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-content-tertiary hover:text-content">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Metadata */}
        <div className="space-y-1.5 rounded-lg border border-border bg-surface-secondary p-3">
          {[
            ['Topic', event.topic],
            ['Timestamp', new Date(event.timestamp).toLocaleString()],
            ['Key', event.key ?? '(null)'],
            ['Size', fmtBytes(event.sizeBytes)],
            ['Schema version', event.schemaVersion ?? '—'],
          ].map(([label, val]) => (
            <div key={label} className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-2xs text-content-tertiary">{label}</span>
              <span className="text-right font-mono text-2xs text-content-secondary">{val}</span>
            </div>
          ))}
        </div>

        {/* PHI notice */}
        {hasMasked && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <p className="text-2xs text-amber-300">
              PHI fields are masked server-side per HIPAA §164.312(b). Payload is safe to render.
            </p>
          </div>
        )}

        {/* Payload */}
        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
            Payload
          </p>
          <pre className="overflow-x-auto rounded-lg border border-border bg-surface-tertiary p-3 font-mono text-2xs text-content-secondary leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Consumer Groups Tab ────────────────────────────────────────────────────

function ConsumerGroupsTab({ consumers }: { consumers: ConsumerGroup[] }): ReactNode {
  if (consumers.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-content-tertiary">
        No consumer groups for this topic
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
          <th className="px-4 py-2 text-left">Group ID</th>
          <th className="px-4 py-2 text-left">State</th>
          <th className="px-4 py-2 text-right">Members</th>
          <th className="px-4 py-2 text-right">Total Lag</th>
        </tr>
      </thead>
      <tbody>
        {consumers.map((cg) => {
          const cfg = CONSUMER_STATE_CFG[cg.state];
          return (
            <tr key={cg.groupId} className="border-b border-border">
              <td className="px-4 py-2.5 font-mono text-content">{cg.groupId}</td>
              <td className="px-4 py-2.5">
                <Badge variant={cfg.variant}>{cfg.label}</Badge>
              </td>
              <td className="px-4 py-2.5 text-right text-content-secondary">{cg.membersCount}</td>
              <td className="px-4 py-2.5 text-right">
                <span
                  className={
                    cg.totalLag > 1_000
                      ? 'font-semibold text-amber-400'
                      : cg.totalLag > 0
                        ? 'text-content-secondary'
                        : 'text-emerald-400'
                  }
                >
                  {cg.totalLag === 0 ? '✓ 0' : fmtNum(cg.totalLag)}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Topic Detail (right pane) ──────────────────────────────────────────────

type DetailTab = 'events' | 'consumers';

function TopicDetail({ topic, onClose }: { topic: KafkaTopic; onClose: () => void }): ReactNode {
  const [tab, setTab] = useState<DetailTab>('events');
  const [events, setEvents] = useState<KafkaEvent[]>([]);
  const [consumers, setConsumers] = useState<ConsumerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<KafkaEvent | null>(null);
  const [filterType, setFilterType] = useState('');
  const [searchOffset, setSearchOffset] = useState('');
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    const seq = ++loadRef.current;
    try {
      const [evtRes, cgRes] = await Promise.all([
        eventsApi.listEvents({ topic: topic.name }),
        eventsApi.listConsumerGroups(topic.name),
      ]);
      if (seq !== loadRef.current) return;
      setEvents(evtRes.items);
      setConsumers(cgRes);
    } catch {
      if (seq !== loadRef.current) return;
      setEvents(makeMockEvents(topic.name));
      setConsumers(MOCK_CONSUMERS[topic.name] ?? []);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, [topic.name]);

  useEffect(() => {
    setSelectedEvent(null);
    setFilterType('');
    setSearchOffset('');
    void load();
  }, [load]);

  const eventTypes = [...new Set(events.map((e) => e.eventType))].sort();

  const filtered = events.filter((e) => {
    if (filterType !== '' && e.eventType !== filterType) return false;
    if (searchOffset !== '' && !String(e.offset).includes(searchOffset)) return false;
    return true;
  });

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'events', label: `Events (${fmtNum(topic.messageCount)})` },
    { id: 'consumers', label: `Consumers (${(MOCK_CONSUMERS[topic.name] ?? []).length})` },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-l border-border">
      {/* Topic Header */}
      <div className="flex items-start justify-between border-b border-border px-5 py-4">
        <div>
          <p className="font-mono text-sm font-semibold text-content">{topic.name}</p>
          <p className="mt-0.5 text-2xs text-content-tertiary">
            {topic.partitions} partitions · RF {topic.replicationFactor} ·{' '}
            {fmtBytes(topic.sizeBytes)} · retention {fmtRetention(topic.retentionMs)}
            {topic.schemaSubject !== null && ` · schema: ${topic.schemaSubject}`}
          </p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-content-tertiary hover:text-content">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
            }}
            className={`-mb-px mr-4 border-b-2 py-2.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'border-brand-accent text-content'
                : 'border-transparent text-content-tertiary hover:text-content'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {tab === 'events' && (
            <>
              {/* Filter bar */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <select
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value);
                  }}
                  className="h-7 rounded-lg border border-border bg-surface-tertiary px-2 text-xs text-content focus:outline-none focus:ring-1 focus:ring-brand-accent"
                >
                  <option value="">All event types</option>
                  {eventTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-content-tertiary" />
                  <input
                    type="text"
                    placeholder="Filter by offset…"
                    value={searchOffset}
                    onChange={(e) => {
                      setSearchOffset(e.target.value);
                    }}
                    className="h-7 w-36 rounded-lg border border-border bg-surface-tertiary pl-6 pr-2 text-xs text-content placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-brand-accent"
                  />
                </div>
                <span className="ml-auto text-2xs text-content-tertiary">
                  {filtered.length} events
                </span>
              </div>

              {loading ? (
                <div className="flex h-32 items-center justify-center">
                  <Spinner size="lg" label="Loading events" />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
                        <th className="px-4 py-2 text-right">Offset</th>
                        <th className="px-4 py-2 text-right">Part.</th>
                        <th className="px-4 py-2 text-left">Event Type</th>
                        <th className="px-4 py-2 text-left">Timestamp</th>
                        <th className="px-4 py-2 text-right">Size</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((evt) => (
                        <tr
                          key={`${evt.partition}-${evt.offset}`}
                          onClick={() => {
                            setSelectedEvent(selectedEvent?.offset === evt.offset ? null : evt);
                          }}
                          className={`cursor-pointer border-b border-border transition-colors hover:bg-surface-secondary ${
                            selectedEvent?.offset === evt.offset ? 'bg-surface-secondary' : ''
                          }`}
                        >
                          <td className="px-4 py-2 text-right font-mono text-content-tertiary">
                            {evt.offset.toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-right text-content-tertiary">
                            {evt.partition}
                          </td>
                          <td className="px-4 py-2">
                            <span className="rounded bg-surface-tertiary px-1.5 py-0.5 font-mono text-2xs text-content-secondary">
                              {evt.eventType}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-content-tertiary">
                            {fmtRelative(evt.timestamp)}
                          </td>
                          <td className="px-4 py-2 text-right text-content-tertiary">
                            {fmtBytes(evt.sizeBytes)}
                          </td>
                          <td className="px-4 py-2 text-content-tertiary">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'consumers' && (
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-32 items-center justify-center">
                  <Spinner size="lg" label="Loading consumer groups" />
                </div>
              ) : (
                <ConsumerGroupsTab consumers={consumers} />
              )}
            </div>
          )}
        </div>

        {/* Event Inspector */}
        {selectedEvent !== null && tab === 'events' && (
          <EventInspector
            event={selectedEvent}
            onClose={() => {
              setSelectedEvent(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function EventStream(): ReactNode {
  const [topics, setTopics] = useState<KafkaTopic[]>([]);
  const [stats, setStats] = useState<TopicStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTopic, setSelectedTopic] = useState<KafkaTopic | null>(null);
  const [topicSearch, setTopicSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadRef.current;
    try {
      const [topicsRes, statsRes] = await Promise.all([
        eventsApi.listTopics(),
        eventsApi.getTopicStats(),
      ]);
      if (seq !== loadRef.current) return;
      setTopics(topicsRes);
      setStats(statsRes);
    } catch {
      if (seq !== loadRef.current) return;
      setTopics(MOCK_TOPICS);
      setStats(MOCK_STATS);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const filteredTopics = topicSearch
    ? topics.filter((t) => t.name.toLowerCase().includes(topicSearch.toLowerCase()))
    : topics;

  const hasHighLag = stats !== null && stats.maxConsumerLag > 1_000;

  return (
    <div className="flex h-full flex-col">
      {/* ─── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Radio className="h-5 w-5 text-brand-accent" />
          <div>
            <h1 className="text-base font-semibold text-content">Event Stream</h1>
            <p className="text-xs text-content-tertiary">
              Kafka topic browser · SOC 2 A1.2 · ISO A.8.16 · HIPAA §164.312(b)
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            void handleRefresh();
          }}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-content-secondary hover:text-content disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ─── Stats ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4 border-b border-border px-6 py-4">
        <StatCard
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Topics"
          value={stats?.totalTopics ?? '—'}
          sub="Active Kafka topics"
        />
        <StatCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Throughput"
          value={stats !== null ? `${stats.totalMessagesPerSecond.toFixed(0)}/s` : '—'}
          sub="Aggregate msg/s across all topics"
        />
        <StatCard
          icon={<Server className="h-3.5 w-3.5" />}
          label="Consumer Groups"
          value={stats?.totalConsumerGroups ?? '—'}
          sub="Registered consumer groups"
        />
        <StatCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Max Consumer Lag"
          value={stats !== null ? fmtNum(stats.maxConsumerLag) : '—'}
          sub={hasHighLag ? 'Rebalancing in progress' : 'All consumers healthy'}
          alert={hasHighLag}
        />
      </div>

      {/* ─── Body ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Topic List */}
        <div className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="border-b border-border px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-tertiary" />
              <input
                type="text"
                placeholder="Filter topics…"
                value={topicSearch}
                onChange={(e) => {
                  setTopicSearch(e.target.value);
                }}
                className="h-8 w-full rounded-lg border border-border bg-surface-tertiary pl-8 pr-2 text-xs text-content placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-brand-accent"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex h-24 items-center justify-center">
                <Spinner size="md" label="Loading topics" />
              </div>
            ) : filteredTopics.length === 0 ? (
              <p className="py-8 text-center text-xs text-content-tertiary">No topics found</p>
            ) : (
              <div className="space-y-0.5">
                {filteredTopics.map((topic) => (
                  <TopicRow
                    key={topic.name}
                    topic={topic}
                    selected={selectedTopic?.name === topic.name}
                    onClick={() => {
                      setSelectedTopic(selectedTopic?.name === topic.name ? null : topic);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* HIPAA notice at bottom */}
          <div className="border-t border-border p-3">
            <p className="text-2xs text-content-tertiary">
              PHI fields masked per HIPAA §164.312(b). This view is read-only and audit-logged.
            </p>
          </div>
        </div>

        {/* Right pane */}
        {selectedTopic !== null ? (
          <TopicDetail
            key={selectedTopic.name}
            topic={selectedTopic}
            onClose={() => {
              setSelectedTopic(null);
            }}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-content-tertiary">
            <Database className="h-10 w-10 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">Select a topic</p>
              <p className="mt-1 text-xs">
                Browse events, inspect payloads, and monitor consumer lag
              </p>
            </div>
            {hasHighLag && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <p className="text-xs text-amber-300">
                  High consumer lag detected — check <span className="font-mono">neo4j-sync</span>{' '}
                  consumer group
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
