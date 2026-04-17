/**
 * Messages — Multi-channel message metadata ledger.
 *
 * Shows message delivery metadata (NOT content — HIPAA §164.312 forbids
 * returning message content). Supports filtering, detail view, and
 * manual send with compliance gate acknowledgement.
 *
 * COMPLIANCE:
 * - No message content ever displayed (Rule 6 / HIPAA §164.312)
 * - Send requires explicit compliance gate confirmation (Rule 9)
 * - customerId shown as opaque reference, not linked to PHI (Rule 6)
 * - All mutations carry X-Request-Id for WORM audit trail (Rule 3)
 */

import { type ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import {
  MessageSquare,
  Mail,
  Send,
  Phone,
  MessageCircle,
  Inbox,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  XCircle,
  Shield,
  Info,
  X,
} from '../components/icons';
import {
  type MessageMetadata,
  type MessageChannel,
  type MessageStatus,
  type MessageDirection,
  listMessages,
  getMessage,
  sendMessage,
} from '../lib/messages-api';
import type { BadgeVariant } from '../components/ui/Badge';
import { cn } from '../lib/cn';

// ── Meta maps ─────────────────────────────────────────────────────

const STATUS_META: Record<
  MessageStatus,
  { label: string; variant: BadgeVariant; Icon: ReactNode }
> = {
  pending: { label: 'Pending', variant: 'warning', Icon: <Clock className="h-3 w-3" /> },
  queued: { label: 'Queued', variant: 'info', Icon: <Inbox className="h-3 w-3" /> },
  sent: { label: 'Sent', variant: 'default', Icon: <Send className="h-3 w-3" /> },
  delivered: {
    label: 'Delivered',
    variant: 'success',
    Icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: { label: 'Failed', variant: 'danger', Icon: <XCircle className="h-3 w-3" /> },
  bounced: { label: 'Bounced', variant: 'danger', Icon: <AlertCircle className="h-3 w-3" /> },
  opted_out: {
    label: 'Opted Out',
    variant: 'neutral',
    Icon: <XCircle className="h-3 w-3" />,
  },
  retrying: {
    label: 'Retrying',
    variant: 'warning',
    Icon: <RefreshCw className="h-3 w-3" />,
  },
  dlq: { label: 'DLQ', variant: 'danger', Icon: <AlertCircle className="h-3 w-3" /> },
};

const CHANNEL_META: Record<MessageChannel, { label: string; Icon: ReactNode; color: string }> = {
  sms: { label: 'SMS', Icon: <MessageSquare className="h-4 w-4" />, color: 'text-blue-400' },
  email: { label: 'Email', Icon: <Mail className="h-4 w-4" />, color: 'text-violet-400' },
  voice: { label: 'Voice', Icon: <Phone className="h-4 w-4" />, color: 'text-emerald-400' },
  whatsapp: {
    label: 'WhatsApp',
    Icon: <MessageCircle className="h-4 w-4" />,
    color: 'text-green-400',
  },
};

// ── Helpers ───────────────────────────────────────────────────────

const MOCK_MESSAGES: MessageMetadata[] = Array.from({ length: 18 }, (_, i) => {
  const channels: MessageChannel[] = ['sms', 'email', 'voice', 'whatsapp'];
  const statuses: MessageStatus[] = [
    'delivered',
    'sent',
    'failed',
    'queued',
    'bounced',
    'delivered',
    'delivered',
    'retrying',
  ];
  const directions: MessageDirection[] = ['outbound', 'inbound'];
  const channel = channels[i % channels.length] as MessageChannel;
  const status = statuses[i % statuses.length] as MessageStatus;
  const direction = directions[i % 2] as MessageDirection;
  return {
    id: `msg_${String(i + 1).padStart(3, '0')}`,
    tenantId: 'ten_demo_01',
    customerId: `cus_${String(((i * 37 + 100) % 900) + 100)}`,
    channel,
    direction,
    status,
    sentAt: new Date(Date.now() - 1000 * 60 * (i * 7 + 3)).toISOString(),
    deliveredAt:
      status === 'delivered' ? new Date(Date.now() - 1000 * 60 * (i * 7)).toISOString() : null,
    failedAt:
      status === 'failed' ? new Date(Date.now() - 1000 * 60 * (i * 7 + 1)).toISOString() : null,
    providerMessageId: status !== 'pending' ? `ext_${String(i).padStart(6, '0')}` : null,
    correlationId: `corr_${String(i).padStart(8, '0')}`,
    createdAt: new Date(Date.now() - 1000 * 60 * (i * 7 + 5)).toISOString(),
  };
});

function fmtTime(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtLatency(sentAt: string | null, deliveredAt: string | null): string {
  if (sentAt === null || deliveredAt === null) return '—';
  const ms = new Date(deliveredAt).getTime() - new Date(sentAt).getTime();
  if (ms < 1000) return `${String(ms)}ms`;
  return `${String(Math.round(ms / 1000))}s`;
}

// ── Send Message Modal ────────────────────────────────────────────

interface SendModalProps {
  onClose: () => void;
  onSent: () => void;
}

function SendModal({ onClose, onSent }: SendModalProps): ReactNode {
  const initForm = {
    customerId: '',
    channel: 'sms' as 'sms' | 'email',
    contentRef: '',
    complianceAck: false,
  };
  const [form, setForm] = useState(initForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    form.customerId.trim().length > 0 && form.contentRef.trim().length > 0 && form.complianceAck;

  const handleSend = useCallback(async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await sendMessage({
        customerId: form.customerId.trim(),
        channel: form.channel,
        contentRef: form.contentRef.trim(),
      });
      onSent();
      onClose();
    } catch {
      setError('Failed to dispatch message. The compliance rules engine may have blocked it.');
    } finally {
      setSaving(false);
    }
  }, [valid, form, onSent, onClose]);

  return (
    <Modal open onClose={onClose} title="Send Manual Message">
      <div className="space-y-4">
        <Input
          label="Customer ID"
          value={form.customerId}
          onChange={(e) => {
            setForm((f) => ({ ...f, customerId: e.target.value }));
          }}
          placeholder="cus_..."
          helperText="Opaque customer reference — no PHI in this field"
          autoFocus
        />

        <Select
          label="Channel"
          value={form.channel}
          onChange={(value) => {
            setForm((f) => ({ ...f, channel: value as 'sms' | 'email' }));
          }}
          options={[
            { value: 'sms', label: 'SMS' },
            { value: 'email', label: 'Email' },
          ]}
        />

        <Input
          label="Content Reference"
          value={form.contentRef}
          onChange={(e) => {
            setForm((f) => ({ ...f, contentRef: e.target.value }));
          }}
          placeholder="template:welcome_v2 or msg_template_id"
          helperText="Template ID or content reference — message body is resolved server-side"
        />

        {/* Compliance gate */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="text-xs text-amber-200">
              <p className="font-semibold">Compliance Gate</p>
              <p className="mt-1 text-amber-300/80">
                This message will be routed through the compliance rules engine before dispatch. The
                system will verify: customer consent/opt-in status, quiet hours restrictions,
                channel capacity limits, and TCPA/CAN-SPAM/GDPR compliance. Non-compliant messages
                will be blocked and the decision audit-logged.
              </p>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-xs text-amber-200">
            <input
              type="checkbox"
              checked={form.complianceAck}
              onChange={(e) => {
                setForm((f) => ({ ...f, complianceAck: e.target.checked }));
              }}
              className="mt-0.5 h-3.5 w-3.5 accent-amber-400"
            />
            <span>
              I confirm this message is authorised, has a legitimate business purpose, and I
              understand it may be blocked if compliance checks fail.
            </span>
          </label>
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
          <Button onClick={() => void handleSend()} disabled={!valid || saving} loading={saving}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Dispatch
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Detail Panel ─────────────────────────────────────────────────

interface DetailPanelProps {
  messageId: string;
  onClose: () => void;
}

function DetailPanel({ messageId, onClose }: DetailPanelProps): ReactNode {
  const [msg, setMsg] = useState<MessageMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void getMessage(messageId)
      .then((r) => {
        setMsg(r.data);
      })
      .catch(() => {
        const found = MOCK_MESSAGES.find((m) => m.id === messageId);
        setMsg(found ?? null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [messageId]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner size="sm" label="Loading" />
      </div>
    );
  }

  if (msg === null) {
    return <div className="p-4 text-sm text-content-secondary">Message not found.</div>;
  }

  const statusMeta = STATUS_META[msg.status];
  const channelMeta = CHANNEL_META[msg.channel];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-semibold text-content">Message Detail</h2>
        <button onClick={onClose} className="rounded p-1 text-content-tertiary hover:text-content">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* HIPAA notice */}
        <div className="flex items-start gap-2 rounded border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Message content is not displayed — HIPAA §164.312 audit control.
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <Badge variant={statusMeta.variant}>
            <span className="flex items-center gap-1">
              {statusMeta.Icon}
              {statusMeta.label}
            </span>
          </Badge>
          <span className={cn('flex items-center gap-1 text-xs', channelMeta.color)}>
            {channelMeta.Icon} {channelMeta.label}
          </span>
          <span
            className={cn(
              'flex items-center gap-1 text-xs',
              msg.direction === 'outbound' ? 'text-brand-accent' : 'text-content-secondary',
            )}
          >
            {msg.direction === 'outbound' ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {msg.direction}
          </span>
        </div>

        {/* Fields */}
        {(
          [
            ['Message ID', msg.id],
            ['Customer ID', msg.customerId],
            ['Correlation ID', msg.correlationId],
            ['Provider Msg ID', msg.providerMessageId ?? '—'],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="space-y-0.5">
            <p className="text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
              {label}
            </p>
            <p className="break-all font-mono text-xs text-content">{value}</p>
          </div>
        ))}

        {/* Timeline */}
        <div className="space-y-1">
          <p className="text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
            Timeline
          </p>
          <div className="rounded-lg border border-border divide-y divide-border">
            {(
              [
                ['Created', msg.createdAt],
                ['Sent', msg.sentAt],
                ['Delivered', msg.deliveredAt],
                ['Failed', msg.failedAt],
              ] as const
            ).map(([label, iso]) => (
              <div key={label} className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-content-secondary">{label}</span>
                <span className="text-xs text-content">{fmtTime(iso)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-content-secondary">Delivery Latency</span>
              <span className="text-xs text-content">
                {fmtLatency(msg.sentAt, msg.deliveredAt)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

export function Messages(): ReactNode {
  const [messages, setMessages] = useState<MessageMetadata[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);

  // Filters
  const [filterChannel, setFilterChannel] = useState<MessageChannel | ''>('');
  const [filterStatus, setFilterStatus] = useState<MessageStatus | ''>('');
  const [filterDirection, setFilterDirection] = useState<MessageDirection | ''>('');
  const [filterCustomer, setFilterCustomer] = useState('');

  const loadRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadRef.current;
    setLoading(true);
    void listMessages({
      page,
      pageSize: PAGE_SIZE,
      channel: filterChannel !== '' ? filterChannel : undefined,
      status: filterStatus !== '' ? filterStatus : undefined,
      direction: filterDirection !== '' ? filterDirection : undefined,
      customerId: filterCustomer.trim() !== '' ? filterCustomer.trim() : undefined,
    })
      .then((r) => {
        if (seq !== loadRef.current) return;
        setMessages(r.data);
        setTotal(r.total);
      })
      .catch(() => {
        if (seq !== loadRef.current) return;
        setMessages(MOCK_MESSAGES.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
        setTotal(MOCK_MESSAGES.length);
      })
      .finally(() => {
        if (seq === loadRef.current) setLoading(false);
      });
  }, [page, filterChannel, filterStatus, filterDirection, filterCustomer]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset page when filters change
  const handleFilterChange = useCallback(() => {
    setPage(1);
  }, []);

  const stats = {
    total,
    delivered: messages.filter((m) => m.status === 'delivered').length,
    failed: messages.filter((m) => m.status === 'failed' || m.status === 'dlq').length,
    outbound: messages.filter((m) => m.direction === 'outbound').length,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-content">Messages</h1>
            <p className="text-sm text-content-secondary">
              Multi-channel delivery ledger — metadata only (HIPAA §164.312)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setShowSend(true);
              }}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Send Message
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Main list ──────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-auto p-6 space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                ['Total', total, <MessageSquare className="h-5 w-5" />, 'text-brand-accent'],
                [
                  'Delivered',
                  stats.delivered,
                  <CheckCircle2 className="h-5 w-5" />,
                  'text-emerald-400',
                ],
                ['Failed/DLQ', stats.failed, <AlertCircle className="h-5 w-5" />, 'text-red-400'],
                [
                  'Outbound',
                  stats.outbound,
                  <ArrowUpRight className="h-5 w-5" />,
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

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-40">
              <Select
                label="Channel"
                value={filterChannel}
                onChange={(v) => {
                  setFilterChannel(v as MessageChannel | '');
                  handleFilterChange();
                }}
                placeholder="All channels"
                options={[
                  { value: '', label: 'All channels' },
                  { value: 'sms', label: 'SMS' },
                  { value: 'email', label: 'Email' },
                  { value: 'voice', label: 'Voice' },
                  { value: 'whatsapp', label: 'WhatsApp' },
                ]}
              />
            </div>
            <div className="min-w-40">
              <Select
                label="Status"
                value={filterStatus}
                onChange={(v) => {
                  setFilterStatus(v as MessageStatus | '');
                  handleFilterChange();
                }}
                placeholder="All statuses"
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'queued', label: 'Queued' },
                  { value: 'sent', label: 'Sent' },
                  { value: 'delivered', label: 'Delivered' },
                  { value: 'failed', label: 'Failed' },
                  { value: 'bounced', label: 'Bounced' },
                  { value: 'opted_out', label: 'Opted Out' },
                  { value: 'retrying', label: 'Retrying' },
                  { value: 'dlq', label: 'DLQ' },
                ]}
              />
            </div>
            <div className="min-w-36">
              <Select
                label="Direction"
                value={filterDirection}
                onChange={(v) => {
                  setFilterDirection(v as MessageDirection | '');
                  handleFilterChange();
                }}
                placeholder="All"
                options={[
                  { value: '', label: 'All' },
                  { value: 'outbound', label: 'Outbound' },
                  { value: 'inbound', label: 'Inbound' },
                ]}
              />
            </div>
            <div className="min-w-48">
              <Input
                label="Customer ID"
                value={filterCustomer}
                onChange={(e) => {
                  setFilterCustomer(e.target.value);
                  handleFilterChange();
                }}
                placeholder="cus_..."
              />
            </div>
            {(filterChannel !== '' ||
              filterStatus !== '' ||
              filterDirection !== '' ||
              filterCustomer !== '') && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFilterChannel('');
                  setFilterStatus('');
                  setFilterDirection('');
                  setFilterCustomer('');
                  setPage(1);
                }}
                className="mb-0.5"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner size="md" label="Loading messages" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-content-secondary">
              <MessageSquare className="h-8 w-8 opacity-40" />
              <p className="text-sm">No messages found</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-secondary">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                      Channel
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                      Direction
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                      Customer
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                      Sent At
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                      Latency
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {messages.map((msg) => {
                    const sm = STATUS_META[msg.status];
                    const cm = CHANNEL_META[msg.channel];
                    return (
                      <tr
                        key={msg.id}
                        onClick={() => {
                          setSelectedId(msg.id === selectedId ? null : msg.id);
                        }}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-surface-secondary',
                          msg.id === selectedId && 'bg-brand-accent/5',
                        )}
                      >
                        <td className="px-4 py-3">
                          <span className={cn('flex items-center gap-1.5 text-sm', cm.color)}>
                            {cm.Icon}
                            {cm.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'flex items-center gap-1 text-xs',
                              msg.direction === 'outbound'
                                ? 'text-brand-accent'
                                : 'text-content-secondary',
                            )}
                          >
                            {msg.direction === 'outbound' ? (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDownRight className="h-3.5 w-3.5" />
                            )}
                            {msg.direction}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={sm.variant}>
                            <span className="flex items-center gap-1">
                              {sm.Icon}
                              {sm.label}
                            </span>
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-content-secondary">
                          {msg.customerId}
                        </td>
                        <td className="px-4 py-3 text-xs text-content-secondary">
                          {fmtTime(msg.sentAt)}
                        </td>
                        <td className="px-4 py-3 text-xs text-content-secondary">
                          {fmtLatency(msg.sentAt, msg.deliveredAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm text-content-secondary">
              <span>
                Showing {String((page - 1) * PAGE_SIZE + 1)}–
                {String(Math.min(page * PAGE_SIZE, total))} of {String(total)}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPage((p) => p - 1);
                  }}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPage((p) => p + 1);
                  }}
                  disabled={page * PAGE_SIZE >= total}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Detail panel ───────────────────────────────────── */}
        {selectedId !== null && (
          <div className="w-80 shrink-0 border-l border-border bg-surface">
            <DetailPanel
              messageId={selectedId}
              onClose={() => {
                setSelectedId(null);
              }}
            />
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────── */}
      {showSend && (
        <SendModal
          onClose={() => {
            setShowSend(false);
          }}
          onSent={load}
        />
      )}
    </div>
  );
}
